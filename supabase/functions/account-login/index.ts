import { createClient } from 'npm:@supabase/supabase-js@2.112.4';

const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Cache-Control': 'no-store' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
const literal = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(b => b.toString(16).padStart(2, '0')).join('');

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  try {
    const raw = await request.text();
    if (raw.length > 4096) return reply(400, { error: 'Invalid credentials' });
    const { identifier, password } = JSON.parse(raw);
    if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier.trim() || !password || identifier.length > 254 || password.length > 1024) return reply(400, { error: 'Invalid credentials' });
    const url = Deno.env.get('SUPABASE_URL')!;
    const privileged = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    const login = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    const id = identifier.trim().toLowerCase();
    const { data: allowed, error: throttleError } = await privileged.rpc('ecotrack_auth_attempt', { p_key: await hash(id) });
    if (throttleError || !allowed) return reply(429, { error: 'Please wait before trying again' });
    const phone = id.replace(/[^0-9]/g, '');
    const staffFilter = id.includes('@') ? `email.eq.${literal(id)}` : /^\+?[\d ()-]+$/.test(id) ? `phone_digits.eq.${literal(phone)}` : `name.eq.${literal(identifier.trim())}`;
    const adminFilter = id.includes('@') ? `email.eq.${literal(id)}` : /^\+?[\d ()-]+$/.test(id) ? `phone_digits.eq.${literal(phone)}` : `username.eq.${literal(identifier.trim())}`;
    const [staff, admins] = await Promise.all([
      privileged.from('staff').select('id,auth_user_id,is_archived,status').or(staffFilter).limit(2),
      privileged.from('administrators').select('id,auth_user_id,is_archived').or(adminFilter).limit(2),
    ]);
    const matches = [...(staff.data || []).map(row => ({ ...row, type: 'staff' })), ...(admins.data || []).map(row => ({ ...row, type: 'admin', status: '' }))];
    if (staff.error || admins.error || matches.length !== 1 || !matches[0].auth_user_id || matches[0].is_archived || ['archived','deactivated','disabled'].includes(String(matches[0].status).toLowerCase())) return reply(401, { error: 'Invalid credentials' });
    const account = matches[0];
    const { data: existing, error: identityError } = await privileged.auth.admin.getUserById(account.auth_user_id);
    if (identityError || !existing.user?.email) return reply(401, { error: 'Invalid credentials' });
    const { data, error } = await login.auth.signInWithPassword({ email: existing.user.email, password });
    if (error || !data.session || data.user?.id !== account.auth_user_id) return reply(401, { error: 'Invalid credentials' });
    // Only a fresh, successful password challenge can clear administrator-forced logout.
    if (account.type === 'staff') {
      const { error: updateError } = await privileged.from('staff').update({ force_logout: false }).eq('id', account.id);
      if (updateError) return reply(503, { error: 'Account is temporarily unavailable' });
    }
    return reply(200, { access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  } catch { return reply(400, { error: 'Unable to sign in' }); }
});
