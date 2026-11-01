import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Cache-Control': 'no-store' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: request.headers.get('Authorization') || '' } }, auth: { persistSession: false } });
    const identity = await caller.auth.getUser();
    if (identity.error || !identity.data.user) return reply(401, { error: 'Sign in required' });
    const role = await caller.rpc('ecotrack_is_admin');
    if (role.error || role.data !== true) return reply(403, { error: 'Administrator required' });
    const raw = await request.text();
    if (raw.length > 4096) return reply(400, { error: 'Invalid administrator profile' });
    const { profile } = JSON.parse(raw);
    if (!profile || typeof profile.username !== 'string' || !profile.username.trim() || profile.username.length > 120 ||
      typeof profile.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email) || typeof profile.password !== 'string' || profile.password.length < 8 || profile.password.length > 1024) return reply(400, { error: 'Valid name, email and password required' });
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const id = 'admin_' + crypto.randomUUID().replace(/-/g, '');
    const email = profile.email.trim().toLowerCase();
    const inserted = await admin.from('administrators').insert({ id, username: profile.username.trim(), email, role: 'admin', is_active: true, is_archived: false, created: new Date().toISOString(), updated: new Date().toISOString() });
    if (inserted.error) return reply(409, { error: 'Administrator profile could not be created' });
    const created = await admin.auth.admin.createUser({ email, password: profile.password, email_confirm: true, app_metadata: { ecotrack_profile_id: id, ecotrack_account_type: 'admin' } });
    if (created.error || !created.data.user) {
      await admin.from('administrators').delete().eq('id', id).is('auth_user_id', null);
      return reply(409, { error: 'Administrator credentials could not be provisioned' });
    }
    return reply(200, { adminId: id, authUserId: created.data.user.id });
  } catch { return reply(400, { error: 'Administrator provisioning failed' }); }
});
