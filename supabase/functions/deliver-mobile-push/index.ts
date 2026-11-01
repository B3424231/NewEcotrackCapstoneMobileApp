import { createClient } from 'npm:@supabase/supabase-js@2.112.4';

const expoUrl = 'https://exp.host/--/api/v2/push';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function deliverBatch(client: any, deliveries: any[], request: typeof fetch = fetch) {
  if (!deliveries.length) return 0;
  const [notifications, registrations] = await Promise.all([
    client.from('mobile_notifications').select('id,staff_id,is_broadcast,title,message,priority,type,related_report_id').in('id', deliveries.map(row => row.notification_id)),
    client.from('staff_push_tokens').select('*').in('token', deliveries.map(row => row.token)),
  ]);
  if (notifications.error || registrations.error) throw new Error('Push recipients could not be loaded');
  const staff = await client.from('staff').select('id,auth_user_id,is_archived,force_logout,status,auth_valid_after').in('id', registrations.data.map((row: any) => row.staff_id));
  if (staff.error) throw new Error('Push accounts could not be verified');
  const now = Date.now();
  const update = async (row: any, patch: any) => {
    const result = await client.from('ecotrack_push_deliveries').update({ ...patch, lease_until: null }).eq('id', row.id);
    if (result.error) throw new Error('Push checkpoint could not be saved');
  };
  const retry = (row: any, error: string) => update(row, {
    status: row.attempts >= 8 ? 'failed' : row.status,
    last_error: error, next_attempt_at: new Date(now + Math.min(3600000, 60000 * 2 ** Math.min(row.attempts, 6))).toISOString(),
  });
  const pending: { row: any; payload: any }[] = [];
  const receipts: any[] = [];
  for (const row of deliveries) {
    const token = registrations.data.find((item: any) => item.token === row.token);
    const worker = staff.data.find((item: any) => item.id === token?.staff_id);
    const notification = notifications.data.find((item: any) => item.id === row.notification_id);
    const urgent = notification && (['critical', 'urgent', 'high'].includes(notification.priority) || ['urgent_repair', 'overdue_alert'].includes(notification.type));
    const valid = token && worker && notification && worker.auth_user_id === token.auth_user_id && !worker.is_archived && !worker.force_logout &&
      !['archived', 'deactivated', 'disabled'].includes(String(worker.status).toLowerCase()) &&
      new Date(token.updated_at).getTime() > now - 60 * 86400000 && (!worker.auth_valid_after || worker.auth_valid_after === '-infinity' || new Date(token.updated_at) > new Date(worker.auth_valid_after)) &&
      (notification.is_broadcast || notification.staff_id === worker.id) && (urgent ? token.critical_enabled : token.maintenance_enabled);
    if (!valid) { await update(row, { status: 'failed', last_error: 'Recipient unavailable or notification preference disabled' }); continue; }
    if (row.status === 'receipt' && row.ticket_id) { receipts.push(row); continue; }
    pending.push({ row, payload: {
      to: token.token, title: notification.title, body: notification.message, sound: 'default', priority: urgent ? 'high' : 'normal',
      channelId: urgent ? 'alerts' : 'messages',
      data: { notificationId: notification.id, relatedReportId: notification.related_report_id, channelId: urgent ? 'alerts' : 'messages' },
    } });
  }
  const post = async (endpoint: string, payload: unknown) => {
    const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
    const response = await request(expoUrl + endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}) },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Expo service temporarily unavailable');
    return response.json();
  };
  const reject = async (row: any, error: string) => {
    if (error === 'DeviceNotRegistered') {
      await update(row, { status: 'failed', last_error: error });
      const removed = await client.from('staff_push_tokens').delete().eq('token', row.token);
      if (removed.error) throw new Error('Invalid token could not be removed');
    } else if (['MessageTooBig', 'MismatchSenderId', 'InvalidCredentials'].includes(error)) {
      await update(row, { status: 'failed', last_error: error });
    } else await retry(row, error);
  };
  if (pending.length) {
    let tickets;
    try { tickets = (await post('/send', pending.map(item => item.payload))).data; }
    catch { tickets = null; }
    for (let index = 0; index < pending.length; index++) {
      const { row } = pending[index], ticket = Array.isArray(tickets) ? tickets[index] : null;
      if (ticket?.status === 'ok' && typeof ticket.id === 'string') {
        await update(row, { status: 'receipt', ticket_id: ticket.id, last_error: null, attempts: 0, next_attempt_at: new Date(now + 15 * 60000).toISOString() });
      } else await reject(row, ticket?.details?.error || 'Expo ticket was not accepted');
    }
  }
  if (receipts.length) {
    let results;
    try { results = (await post('/getReceipts', { ids: receipts.map(row => row.ticket_id) })).data; }
    catch { results = null; }
    for (const row of receipts) {
      const receipt = results?.[row.ticket_id];
      if (receipt?.status === 'ok') await update(row, { status: 'delivered', last_error: null });
      else if (receipt?.status === 'error') await reject(row, receipt.details?.error || 'Expo receipt failed');
      else await retry(row, 'Expo receipt is not available yet');
    }
  }
  return deliveries.length;
}

Deno.serve(async request => {
  const nonce = request.headers.get('Authorization')?.match(/^Bearer ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)?.[1];
  if (!nonce) return json(401, { error: 'Push worker authorization required' });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    const authorized = await client.rpc('ecotrack_authorize_push_worker', { p_nonce: nonce });
    if (authorized.error || authorized.data !== true) return json(401, { error: 'Push wake token is invalid or expired' });
    const claimed = await client.rpc('ecotrack_claim_push_deliveries', { p_limit: 100 });
    if (claimed.error) return json(503, { error: 'Push queue unavailable' });
    return json(200, { processed: await deliverBatch(client, claimed.data || []) });
  } catch { return json(503, { error: 'Push delivery will retry after its lease expires' }); }
});
