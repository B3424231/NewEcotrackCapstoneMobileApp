// Read-only schema/API probe. No rows, credentials or personal data are printed.
const { createClient } = require('@supabase/supabase-js');
try { process.loadEnvFile('.env'); } catch { /* Environment may already be configured. */ }
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) throw Error('Public Supabase configuration is missing.');
if (key.startsWith('sb_secret_')) throw Error('Refusing to use a secret key for a public API audit.');
if (key.split('.').length === 3) {
  const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
  if (claims.role !== 'anon') throw Error('Refusing to use a non-anonymous JWT for this audit.');
}
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const checks = [
  ['staff', 'id,name,email,phone,password,status,is_online,room_id,updated'],
  ['administrators', 'id,username,email,password,role,phone'],
  ['rooms', 'id,name,floor_id'], ['floors', 'id,name,building_id'], ['buildings', 'id,name'],
  ['nodes', 'id,name,room_id,brand,mac_address,ip_address,wifi_ssid,protocol_name,updated'],
  ['aircons', 'id,asset_tag,node_id,room_id,brand,protocol,protocol_name,created_at,updated_at'],
  ['maintenance_reports', 'id,tasks,status,issue,timeline,parent_report_id,linked_repair_id,updated'],
  ['mobile_notifications', 'id,staff_id,staff_name,aircon_type,verification_remarks,is_snoozed,snooze_until'],
  ['notifications', 'id,created'],
];
(async () => {
  console.log('Anonymous HEAD requests only; no records fetched or modified.');
  const results = await Promise.all(checks.map(async ([table, columns]) => {
    const { error, status } = await client.from(table).select(columns, { head: true }).limit(0).abortSignal(AbortSignal.timeout(15000));
    const unavailableColumns = [];
    if (status === 400) {
      const probes = await Promise.all(columns.split(',').map(async column => {
        const result = await client.from(table).select(column, { head: true }).limit(0).abortSignal(AbortSignal.timeout(15000));
        return result.status === 400 ? column : null;
      }));
      unavailableColumns.push(...probes.filter(Boolean));
    }
    return { table, status, result: error ? 'failed' : 'columns available', errorCode: error?.code || undefined, ...(unavailableColumns.length ? { unavailableColumns } : {}) };
  }));
  for (const result of results) console.log(JSON.stringify(result));
  console.log('HEAD success verifies schema/API reachability only, not row visibility or authorization.');
  if (results.some(result => result.status === 0)) process.exitCode = 1;
})().catch(() => { console.error('Connection probe failed.'); process.exitCode = 1; });
