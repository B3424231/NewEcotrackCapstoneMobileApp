import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppUser } from './supabase';

type Store = {
  getItem?(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiRemove(keys: string[]): Promise<void>;
};
type Result = { success: boolean; user?: AppUser; error?: string; isArchived?: boolean; archiveReason?: string; archiveNotes?: string; archivedAt?: string };

/** Cached display data is never accepted as proof of identity. */
export function createAuthService(client: Pick<SupabaseClient, 'auth' | 'rpc' | 'functions'> & Partial<Pick<SupabaseClient, 'from'>>, store: Store) {
  let recoverySubject: string | null = null;
  const clearLegacyCredentials = async () => {
    const keys = await store.getAllKeys();
    await store.multiRemove(keys.filter(key => /^ecotrack_(staff|admin)_pwd_/.test(key)));
  };
  const readProfile = async (): Promise<AppUser | null> => {
    const { data: identity, error: identityError } = await client.auth.getUser();
    if (identityError) {
      // Temporary service/network failures must not look like account revocation.
      if ([401, 403].includes(identityError.status ?? 0) ||
          ['session_not_found', 'user_not_found', 'bad_jwt'].includes(identityError.code ?? '') ||
          identityError.name === 'AuthSessionMissingError') return null;
      throw identityError;
    }
    if (!identity.user) return null;
    const { data, error } = await client.rpc('ecotrack_my_profile');
    if (error && error.code !== '42501') throw error;
    if (!error && data?.authUserId === identity.user.id && data.id && ['admin', 'staff'].includes(data.userType)) return data as AppUser;
    // The active-profile RPC rejects archived accounts. Existing own-row RLS
    // still permits the verified account to read its archive notice.
    if (!client.from) return null;
    const result = await client.from('staff')
      .select('id,auth_user_id,name,email,phone,role,assignment,is_archived,status,archive_reason,archive_notes,archived_at')
      .eq('auth_user_id', identity.user.id).maybeSingle();
    const staff = result.data;
    if (result.error && result.error.code !== '42501') throw result.error;
    if (result.error || !staff?.id || staff.auth_user_id !== identity.user.id ||
        !(staff.is_archived === true || String(staff.status).toLowerCase() === 'archived')) return null;
    return { id: staff.id, authUserId: identity.user.id, name: staff.name, email: staff.email,
      phone: staff.phone || '', role: staff.role || 'HVAC / Aircon Technician', userType: 'staff',
      assignment: staff.assignment || 'Unassigned', isArchived: true,
      archiveReason: staff.archive_reason || 'Account archived', archiveNotes: staff.archive_notes || null,
      archivedAt: staff.archived_at || null } as AppUser;
  };
  const saveProfile = async (user: AppUser) => {
    await clearLegacyCredentials();
    await store.setItem('ecotrack_session_user', JSON.stringify(user));
  };
  return {
    async authenticateUser(identifier: string, password?: string): Promise<Result> {
      if (!identifier.trim() || !password) return { success: false, error: 'Enter your account identifier and password.' };
      try {
        recoverySubject = null;
        let authenticated = false;

        // 1. Try Edge function if available
        if (typeof client.functions?.invoke === 'function') {
          try {
            const { data, error } = await client.functions.invoke('account-login', { body: { identifier: identifier.trim(), password } });
            if (!error && data?.access_token && data?.refresh_token) {
              const { error: sessionError } = await client.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
              if (!sessionError) authenticated = true;
            }
          } catch {
            // Function not deployed or unreachable; fall back to direct Auth sign-in
          }
        }

        // 2. Email fallback. Names and phones are resolved only by account-login.
        if (!authenticated) {
          const loginEmail = identifier.trim().toLowerCase();
          if (!loginEmail.includes('@')) {
            return { success: false, error: 'Name and phone sign-in is unavailable. Try your account email or contact your administrator.' };
          }

          let signInResult = await client.auth.signInWithPassword({
            email: loginEmail,
            password,
          });

          // Preserve the legacy initial-case retry for direct email sign-in.
          if ((signInResult.error || !signInResult.data?.session) && password.length > 0) {
            const firstChar = password.charAt(0);
            const alternateChar = firstChar === firstChar.toLowerCase() ? firstChar.toUpperCase() : firstChar.toLowerCase();
            const altPassword = alternateChar + password.slice(1);
            if (altPassword !== password) {
              const retryResult = await client.auth.signInWithPassword({
                email: loginEmail,
                password: altPassword,
              });
              if (!retryResult.error && retryResult.data?.session) {
                signInResult = retryResult;
              }
            }
          }

          if (signInResult.error || !signInResult.data?.session) {
            return { success: false, error: 'Invalid credentials. Check your email/username/phone and password.' };
          }
        }

        const user = await readProfile();
        if (!user) {
          await client.auth.signOut({ scope: 'local' });
          return { success: false, error: 'An active account profile is required. Contact your administrator.' };
        }
        if (user.isArchived) return { success: false, user, isArchived: true,
          archiveReason: user.archiveReason ?? undefined, archiveNotes: user.archiveNotes ?? undefined, archivedAt: user.archivedAt ?? undefined };
        await saveProfile(user);
        return { success: true, user };
      } catch { return { success: false, error: 'Unable to sign in. Please try again.' }; }
    },
    async registerStaffMember(fullName: string, phone: string, email: string, password?: string): Promise<Result> {
      if (!fullName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !/^[\d +()-]{7,24}$/.test(phone) || !password || password.length < 8) {
        return { success: false, error: 'Provide a name, valid email and phone, and a password of at least 8 characters.' };
      }
      try {
        // The database trigger creates an unassigned staff profile; role and
        // existing-profile links cannot come from user-controlled metadata.
        const { data, error } = await client.auth.signUp({ email: email.trim().toLowerCase(), password, options: { data: { full_name: fullName.trim(), phone: phone.trim() } } });
        if (error) return { success: false, error: 'Registration could not be completed. Check your details or contact your administrator.' };
        if (!data.session) return { success: false, error: 'Check your email to confirm your account before signing in.' };
        const user = await readProfile();
        if (!user) return { success: false, error: 'Your account profile is not available yet.' };
        await saveProfile(user);
        return { success: true, user };
      } catch { return { success: false, error: 'Registration is temporarily unavailable.' }; }
    },
    async getSavedSession(options: { throwOnUnavailable?: boolean } = {}): Promise<AppUser | null> {
      try {
        const user = await readProfile();
        if (!user) { await store.removeItem('ecotrack_session_user'); return null; }
        await saveProfile(user);
        return user;
      } catch (error) {
        if (options.throwOnUnavailable) throw error;
        await store.removeItem('ecotrack_session_user');
        return null;
      }
    },
    async requestPasswordRecovery(email: string): Promise<{ success: boolean; error?: string }> {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return { success: false, error: 'Enter your account email address.' };
      recoverySubject = null;
      try {
        const { error } = await client.auth.resetPasswordForEmail(email.trim().toLowerCase());
        return error ? { success: false, error: 'Recovery request could not be sent. Please try again later.' } : { success: true };
      } catch { return { success: false, error: 'Recovery is temporarily unavailable.' }; }
    },
    async verifyUserForPasswordReset(email: string, code: string): Promise<Result & { userType?: 'admin' | 'staff'; matchedName?: string; matchedPhone?: string }> {
      recoverySubject = null;
      if (!email.includes('@') || !/^\d{6,10}$/.test(code.trim())) return { success: false, error: 'Enter your email and the recovery code sent to it.' };
      try {
        const { data, error } = await client.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'recovery' });
        if (error || !data.session || !data.user) return { success: false, error: 'The recovery code is invalid or expired.' };
        const user = await readProfile();
        if (!user || user.authUserId !== data.user.id) return { success: false, error: 'An active account profile is required.' };
        recoverySubject = data.user.id;
        return { success: true, user, userType: user.userType, matchedName: user.name, matchedPhone: user.phone };
      } catch { return { success: false, error: 'Unable to verify the recovery code.' }; }
    },
    async resetUserPassword(userId: string, userType: 'admin' | 'staff', newPassword: string): Promise<{ success: boolean; error?: string }> {
      try {
        const user = await readProfile();
        if (!recoverySubject || user?.authUserId !== recoverySubject || user.id !== userId || user.userType !== userType) return { success: false, error: 'A verified recovery code is required.' };
        if (newPassword.length < 8) return { success: false, error: 'Password must be at least 8 characters long.' };
        const { error } = await client.auth.updateUser({ password: newPassword });
        if (error) return { success: false, error: 'Password could not be updated. Request a new code and try again.' };
        recoverySubject = null;
        await saveProfile(user);
        return { success: true };
      } catch { return { success: false, error: 'Unable to reset your password.' }; }
    },
    async changeUserPassword(userId: string, userType: 'admin' | 'staff', oldPassword: string, newPassword: string, _email?: string, _phone?: string): Promise<{ success: boolean; error?: string }> {
      if (!oldPassword || newPassword.length < 8 || oldPassword === newPassword) return { success: false, error: 'Provide your current password and a different new password of at least 8 characters.' };
      try {
        const user = await readProfile();
        if (!user || user.id !== userId || user.userType !== userType) return { success: false, error: 'Sign in again before changing your password.' };
        const { data: identity } = await client.auth.getUser();
        if (!identity.user?.email) return { success: false, error: 'Account email is unavailable.' };
        const { error: reauthError } = await client.auth.signInWithPassword({ email: identity.user.email, password: oldPassword });
        if (reauthError) return { success: false, error: 'Incorrect current password.' };
        const { error } = await client.auth.updateUser({ password: newPassword });
        if (error) return { success: false, error: 'Password could not be changed. Please try again.' };
        await clearLegacyCredentials();
        return { success: true };
      } catch { return { success: false, error: 'Unable to change your password.' }; }
    },
  };
}
