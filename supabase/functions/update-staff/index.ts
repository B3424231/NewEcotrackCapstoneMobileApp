import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.112.4';

const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const profileColumns = 'id,auth_user_id,name,email,phone,role,status,is_online,is_archived,force_logout,room_id,room_name,floor_name,building_name,assignment,assignment_scope,assigned_floor_id,assigned_building_id,avatar,photo_url,avatar_url,created,updated,last_active';

function decodeAvatar(value: unknown) {
  if (typeof value !== 'string') throw new Error('Invalid photo.');
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new Error('Choose a JPG, PNG or WebP photo.');
  let raw: string;
  try { raw = atob(match[2]); } catch { throw new Error('The photo could not be decoded.'); }
  if (!raw.length || raw.length > 2 * 1024 * 1024) throw new Error('Photo must be no larger than 2 MB.');
  const bytes = Uint8Array.from(raw, ch => ch.charCodeAt(0));
  const starts = (...values: number[]) => values.every((v, i) => bytes[i] === v);
  const valid = match[1] === 'image/jpeg' ? starts(255, 216, 255)
    : match[1] === 'image/png' ? starts(137, 80, 78, 71, 13, 10, 26, 10)
    : starts(82, 73, 70, 70) && [87, 69, 66, 80].every((v, i) => bytes[i + 8] === v);
  if (!valid) throw new Error('The photo format does not match its contents.');
  return { bytes, mime: match[1], extension: match[1].split('/')[1] };
}

// Auth secrets remain inside the Edge runtime; target identity comes from the DB.
export async function handleStaffEdit(request: Request) {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: request.headers.get('Authorization') || '' } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const identity = await caller.auth.getUser();
    if (identity.error || !identity.data.user) return reply(401, { error: 'Sign in required' });
    const allowed = await caller.rpc('ecotrack_is_admin');
    if (allowed.error || allowed.data !== true) return reply(403, { error: 'Administrator required' });
    const text = await request.text();
    if (text.length > 2_850_000) return reply(413, { error: 'Staff edit is too large.' });
    const input = JSON.parse(text);
    if (!input || typeof input.id !== 'string' || !input.id.trim() || input.id.length > 120
      || !input.changes || typeof input.changes !== 'object' || Array.isArray(input.changes)
      || !input.expected || typeof input.expected !== 'object' || Array.isArray(input.expected)
      || Object.keys(input).some(k => !['id', 'changes', 'expected', 'credentials', 'avatar'].includes(k))) {
      return reply(400, { error: 'Invalid staff edit.' });
    }
    const credentials = input.credentials ?? {};
    if (typeof credentials !== 'object' || Array.isArray(credentials) || credentials === null
      || Object.keys(credentials).some(k => !['email', 'password'].includes(k))) return reply(400, { error: 'Invalid sign-in changes.' });
    const credentialChanges: { email?: string; password?: string } = {};
    if ('email' in credentials) {
      if (typeof credentials.email !== 'string' || !emailPattern.test(credentials.email.trim()) || credentials.email.length > 254) {
        return reply(400, { error: 'Enter a valid email address.' });
      }
      credentialChanges.email = credentials.email.trim().toLowerCase();
    }
    if ('password' in credentials) {
      if (typeof credentials.password !== 'string' || credentials.password.length < 8 || credentials.password.length > 1024) {
        return reply(400, { error: 'Password must contain at least 8 characters.' });
      }
      credentialChanges.password = credentials.password;
    }
    const avatar = input.avatar === undefined ? null : decodeAvatar(input.avatar);
    // Caller-supplied references cannot overwrite another account's image.
    if ('photo_url' in input.changes) return reply(400, { error: 'Upload a new photo through the staff editor.' });
    const args = { p_id: input.id, p_changes: input.changes, p_expected: input.expected, p_apply: false };
    const preview = await caller.rpc('ecotrack_admin_edit_staff', args);
    if (preview.error || preview.data?.profile?.id !== input.id) {
      return reply(preview.error?.code === '40001' ? 409 : preview.error?.code === '42501' ? 403 : 400,
        { error: preview.error?.message || 'Staff edit could not be verified.', code: preview.error?.code });
    }
    const target = preview.data.profile;
    const needsAccount = Object.keys(credentialChanges).length > 0 || avatar !== null;
    let admin: SupabaseClient | null = null;
    if (needsAccount) {
      if (!target.auth_user_id) return reply(409, { error: 'This staff profile has no linked sign-in account. No changes were saved.' });
      admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
      const account = await admin.auth.admin.getUserById(target.auth_user_id);
      if (account.error || account.data?.user?.id !== target.auth_user_id
        || account.data.user.email?.toLowerCase() !== target.email?.toLowerCase()) {
        return reply(409, { error: 'The linked account could not be verified. No changes were saved.' });
      }
      const adminLink = await admin.from('administrators').select('id').eq('auth_user_id', target.auth_user_id).limit(1);
      if (adminLink.error || adminLink.data?.length) {
        return reply(409, { error: 'The linked account conflicts with an administrator profile. No changes were saved.' });
      }
      if (credentialChanges.email) {
        const duplicate = await admin.from('staff').select('id').eq('email', credentialChanges.email).neq('id', input.id).limit(1);
        const administrator = await admin.from('administrators').select('id').eq('email', credentialChanges.email).limit(1);
        if (duplicate.error || administrator.error) return reply(503, { error: 'Email availability could not be checked.' });
        if (duplicate.data?.length || administrator.data?.length) return reply(409, { error: 'This email already belongs to an account. No changes were saved.' });
      }
    }
    let uploadPath: string | null = null;
    if (avatar && admin) {
      uploadPath = `${target.auth_user_id}/${crypto.randomUUID()}.${avatar.extension}`;
      const upload = await admin.storage.from('avatars').upload(uploadPath, avatar.bytes, { contentType: avatar.mime, upsert: false });
      if (upload.error) return reply(503, { error: 'Photo upload failed. No profile changes were saved.' });
      args.p_changes = { ...input.changes, photo_url: `storage://avatars/${uploadPath}` };
    }
    const saved = await caller.rpc('ecotrack_admin_edit_staff', { ...args, p_apply: true });
    if (saved.error || saved.data?.profile?.id !== input.id) {
      // Remove only the newly uploaded object on a definitive rejection. An
      // uncertain network result may have committed; retain it for verification.
      const rejected = ['40001', '42501', '22023', '23505', '23503', 'P0002', 'P0001'].includes(saved.error?.code || '');
      if (uploadPath && admin && rejected) await admin.storage.from('avatars').remove([uploadPath]);
      return reply(saved.error?.code === '40001' ? 409 : 400,
        { error: saved.error?.message || 'The profile save was not confirmed. Refresh before retrying.', code: saved.error?.code });
    }
    let profile = saved.data.profile;
    if (Object.keys(credentialChanges).length && admin) {
      // Separate services cannot share a transaction. Report partial outcomes
      // precisely; never turn an Auth failure into a false full success.
      try {
        const stillAllowed = await caller.rpc('ecotrack_is_admin');
        const currentTarget = await admin.from('staff').select('id,auth_user_id,is_archived,status').eq('id', input.id).single();
        if (stillAllowed.error || stillAllowed.data !== true || currentTarget.error
          || currentTarget.data?.auth_user_id !== target.auth_user_id || currentTarget.data.is_archived
          || ['archived', 'deactivated', 'disabled'].includes(String(currentTarget.data.status || '').toLowerCase())) {
          return reply(200, { profile, credentialError: 'Account access changed during the save. Sign-in details were not changed.' });
        }
        const changed = await admin.auth.admin.updateUserById(target.auth_user_id, credentialChanges);
        if (changed.error || changed.data?.user?.id !== target.auth_user_id) {
          return reply(200, { profile, credentialError: changed.error?.message || 'Account update was not confirmed. Refresh before retrying.' });
        }
        const current = await admin.from('staff').select(profileColumns).eq('id', input.id).single();
        if (current.error || current.data?.id !== input.id || (credentialChanges.email && current.data.email !== credentialChanges.email)) {
          return reply(200, { profile, credentialError: 'Account update was received, but the refreshed profile could not be confirmed. Refresh the directory.' });
        }
        profile = current.data;
      } catch {
        return reply(200, { profile, credentialError: 'Account update was not confirmed. Refresh the directory before retrying.' });
      }
    }
    return reply(200, { profile });
  } catch {
    return reply(400, { error: 'Staff changes could not be confirmed. Refresh the directory before retrying.' });
  }
}

Deno.serve(handleStaffEdit);
