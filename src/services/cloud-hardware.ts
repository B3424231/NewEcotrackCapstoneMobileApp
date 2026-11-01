import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';
import { readWithTimeout, type ReadScope } from './query-utils';
import { requestId, validateWifi } from './ble-protocol';

export interface CloudDeviceState {
  node_id: string;
  device_id: string;
  last_seen?: string;
  sleeping_until?: string | null;
  firmware_version?: string;
  capabilities?: Record<string, unknown>;
  latest_ir?: Record<string, any> | null;
  ip_address?: string;
  wifi_ssid?: string;
  rssi?: number;
  battery?: number;
  temp?: number | null;
  temperature?: number | null;
  // Live measurement events have their own clock; they are not heartbeats.
  measurement_at?: string | null;
  node_updated_at?: string;
  sensor_config?: Record<string, any> | null;
  ac_on?: boolean | null;
  control_snapshot?: Record<string, any> | null;
  rotation_rpm?: number | null;
  rotation_quality?: 'ok' | 'missing' | 'fault';
}
export interface ControllerInfo {
  device_id: string;
  cloud_protocol: number;
  node_id?: string;
  wifi_status?: string;
  wifi_ssid?: string;
  ip_address?: string;
  cloud_status?: string;
  request_id?: string;
  error?: string;
  capabilities?: Record<string, unknown>;
}
export type AcDeviceMode = 'monitoring' | 'controller' | 'both';
export interface ControllerAssignment {
  device_mode?: AcDeviceMode;
  sensor_config?: {temperature:boolean;rotation_rpm:boolean} | null;
  installation_attempt_id?: string;
  controller_name: string;
  assignment_mode: 'existing' | 'new';
  aircon_id?: string;
  asset_tag?: string;
  aircon_name?: string;
  room_id: string | null;
  brand: string;
  aircon_type: string;
  protocol_name?: string;
}
export interface IrCapture extends Record<string, unknown> {
  protocol: string;
  raw_data: string;
  raw_count: number;
}
/** Retain measured timings; a protocol name or decoded state alone is not a code. */
export function normalizeIrCapture(input: Record<string, unknown>): IrCapture {
  const protocol = String(input?.protocol || input?.raw_type || '').trim().toUpperCase();
  const raw = typeof input?.raw_data === 'string' ? input.raw_data.replace(/\s/g, '') : '';
  if (!/^[A-Z][A-Z0-9_]{1,48}$/.test(protocol) || raw.length > 32768 || !/^\d+(,\d+){2,4095}$/.test(raw))
    throw new Error('Supply actual captured IR timings and an exact protocol.');
  const timings = raw.split(',');
  if (timings.some(value => value.length > 7 || Number(value) < 1 || Number(value) > 1000000))
    throw new Error('Invalid IR timing duration.');
  const metadata: Record<string, unknown> = {};
  for (const field of ['raw_type','sequence','boot_count','hex','frame_kind','state','ac_capabilities','remote_model','captured_at_ms','captured_at_epoch_ms','received_at']) {
    if (input[field] !== undefined) metadata[field] = input[field];
  }
  const capture = { ...metadata, protocol, raw_data: raw, raw_count: timings.length };
  if (JSON.stringify(capture).length > 65536) throw new Error('IR capture is too large.');
  return capture;
}
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export function connectionStatus(state?: CloudDeviceState | null, now = Date.now()): 'online' | 'offline' | 'sleeping' {
  if (Date.parse(state?.sleeping_until || '') > now) return 'sleeping';
  const seen = Date.parse(state?.last_seen || '');
  return Number.isFinite(seen) && seen <= now + 5000 && now - seen <= 45000 ? 'online' : 'offline';
}
/** A fresh heartbeat and a command acknowledgement are separate observations. */
export class CloudHardwareRequestError extends Error {
  constructor(message: string, readonly connectionState: 'online' | 'offline' | 'sleeping' | 'unknown') {
    super(message);
    this.name = 'CloudHardwareRequestError';
  }
}
export async function hardwareRpc(name: string, args: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (name === 'ecotrack_finish_controller_registration_with_ir' && error.code === 'PGRST202')
      throw new Error('IR code sharing is not enabled on the server yet. Ask your administrator to apply the update.');
    if (/ac_device_assignment|ac_device_registration/.test(name) && ['PGRST202','42883'].includes(error.code)) throw new Error('Install the AC device roles migration before registering this device type.');
    const registration = /controller_registration|validate_controller_assignment/.test(name);
    const ping = name === 'ecotrack_ping_controller';
    if (ping && error.code === 'PGRST202')
      throw new Error('Connection testing needs the server ping update. The AC device heartbeat can still be online.');
    if (registration && /admin(?:istrator)? (?:access )?required/i.test(error.message || ''))
      throw new Error('Staff device registration is not enabled on the server yet. Ask your administrator to apply the registration update.');
    throw new Error(error.code === '42501' ? (ping
      ? 'Connection testing is available for AC devices in your active assigned room. Sign in again and check your assignment.'
      : registration
      ? 'Device setup is restricted to your active assigned room. Sign in again and check your assignment.'
      : 'An administrator account is required for cloud hardware commands.') : error.message);
  }
  if (!data || typeof data !== 'object') throw new Error('Supabase did not confirm this hardware operation.');
  return data;
}
export const CloudHardware = {
  async list(scope?: ReadScope, selection?: {nodeIds: string[]; since?: string}): Promise<CloudDeviceState[]> {
    const read = async () => {
      const rows: CloudDeviceState[] = [], seen = new Set<string>();
      let after: string | null = null;
      let total: number | null = null;
      try {
        for (;;) {
          let query = supabase.from('ecotrack_device_state').select('*', { count: 'exact' }).order('node_id', { ascending: true }).limit(250);
          if (selection) { query = query.in('node_id', selection.nodeIds); if (selection.since) query = query.gte('last_seen', selection.since); }
          if (after) query = query.gt('node_id', after);
          const { data, error, count } = await readWithTimeout(signal => query.abortSignal(signal));
          if (error) return { data: null, error };
          if (!data?.length) return { data: rows, error: null };
          if (after === null && typeof count === 'number' && Number.isInteger(count) && count >= data.length) total = count;
          for (const row of data) {
            if (typeof row.node_id !== 'string' || seen.has(row.node_id)) throw new Error('Live AC device pagination returned an invalid identity.');
            seen.add(row.node_id); rows.push(row);
          }
          after = data[data.length - 1].node_id;
          if (total !== null && rows.length >= total) return { data: rows, error: null };
        }
      } catch (error) { return { data: null, error }; }
    };
    const result = scope ? await scope.run(supabase, 'hardware:states', read) : await read();
    if (result.error) { scope?.recordError(result.error); throw new Error('Unable to read live AC device status. Refresh or sign in again.'); }
    return result.data || [];
  },
  async listUpdates(nodeIds: string[], since?: string): Promise<CloudDeviceState[]> {
    const rows: CloudDeviceState[] = [], ids = [...new Set(nodeIds)].sort();
    for (let offset = 0; offset < ids.length; offset += 100) {
      rows.push(...await CloudHardware.list(undefined, {nodeIds: ids.slice(offset, offset + 100), since}));
    }
    return rows;
  },
  async get(nodeId: string, timeoutMs = 15000): Promise<CloudDeviceState> {
    const { data, error } = await readWithTimeout(signal => supabase.from('ecotrack_device_state')
      .select('*').eq('node_id', nodeId).abortSignal(signal).maybeSingle(), timeoutMs);
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Complete Bluetooth and cloud registration for this AC device first.');
    return data;
  },
  async registrationStatus(info: ControllerInfo): Promise<any> {
    if (!/^esp32s3-[a-f0-9]{12}$/.test(info.device_id) || info.cloud_protocol !== 1)
      throw new Error('Use the current EcoTrack cloud AC device sketch before registering this device.');
    return hardwareRpc('ecotrack_controller_registration_status', { p_device_id: info.device_id });
  },
  async register(info: ControllerInfo, setup: ControllerAssignment, credentials: { ssid: string; pass: string },
    provision: (payload: Record<string, unknown>, cloud: boolean) => Promise<ControllerInfo>, capture?: IrCapture): Promise<any> {
    const recorded = setup.device_mode !== 'monitoring' && capture ? normalizeIrCapture(capture) : undefined;
    const checked = await hardwareRpc(setup.device_mode ? 'ecotrack_validate_ac_device_assignment' : 'ecotrack_validate_controller_assignment', { p_device_id: info.device_id, p_setup: setup });
    if (checked.valid !== true) throw new Error('AC assignment could not be validated.');
    const status = await this.registrationStatus(info);
    const refresh = status.requires_credentials === true || info.cloud_status === 'unconfigured' ||
      (!!info.node_id && info.node_id !== status.node?.id) ||
      (info.cloud_status === 'error' && /auth|credential|reprovision|registration|token/i.test(info.error || ''));
    let nodeId = status.node?.id;
    if (refresh) {
      validateWifi(credentials.ssid, credentials.pass);
      if (!SUPABASE_URL.startsWith('https://') || !SUPABASE_ANON_KEY) throw new Error('Supabase public configuration is missing.');
      const prepared = await hardwareRpc('ecotrack_prepare_controller_registration', { p_device_id: info.device_id });
      if (!prepared.node?.id || !/^[a-f0-9]{64}$/.test(prepared.device_token || '')) throw new Error('Invalid cloud registration receipt.');
      nodeId = prepared.node.id;
      try {
        info = await provision({ ...credentials, device_id: info.device_id, supabase_url: SUPABASE_URL,
          supabase_key: SUPABASE_ANON_KEY, device_token: prepared.device_token }, true);
      } finally { delete prepared.device_token; }
    }
    if (!nodeId || info.cloud_status !== 'verified') throw new Error('The device has not verified its cloud connection. Keep it awake and retry.');
    const cloud = await this.get(nodeId);
    if (cloud.device_id !== info.device_id || connectionStatus(cloud) !== 'online')
      throw new Error('No recent heartbeat from this device. Reconnect Bluetooth and keep it awake before saving.');
    const saved = await hardwareRpc(setup.device_mode ? 'ecotrack_finish_ac_device_registration' : recorded ? 'ecotrack_finish_controller_registration_with_ir' : 'ecotrack_finish_controller_registration', {
      p_node_id: nodeId, p_device_id: info.device_id, p_setup: setup,
      ...(recorded ? { p_capture: recorded } : {}) });
    if (saved.success !== true || saved.connected !== true || saved.node?.id !== nodeId || !saved.aircon?.id)
      throw new Error('AC Device registration was not confirmed.');
    if (setup.device_mode && (saved.node.device_mode !== setup.device_mode || (setup.device_mode !== 'controller' && saved.node.monitor_aircon_id !== saved.aircon.id))) throw new Error('The requested AC device type was not confirmed.');
    if (setup.device_mode === 'monitoring' && (saved.aircon.node_id === nodeId || saved.aircon.controller_node_id === nodeId)) throw new Error('Monitoring-only registration unexpectedly attached an AC device.');
    if (recorded && (!saved.ir_code?.id || saved.ir_code.aircon_id !== saved.aircon.id ||
        saved.ir_code.protocol !== recorded.protocol || saved.ir_code.raw_data !== recorded.raw_data))
      throw new Error('The saved remote capture was not confirmed. Refresh before retrying registration.');
    return saved;
  },
  async request(nodeId: string, kind: 'ping' | 'learn_ir' | 'configure' | 'ac_intent',
    payload: Record<string, unknown> = {}, timeoutMs = 25000): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    const noResponse = 'No AC device response yet. The command may be queued; refresh before retrying.';
    let state: CloudDeviceState | null = null;
    let submitted = false;
    const remaining = () => {
      const ms = deadline - Date.now();
      if (ms <= 0) throw new Error(noResponse);
      return ms;
    };
    try {
      state = await this.get(nodeId, remaining());
      if (state.node_id !== nodeId) {
        state = null;
        throw new Error('Live AC device identity was not confirmed.');
      }
      if (connectionStatus(state) !== 'online') throw new Error(connectionStatus(state) === 'sleeping'
        ? 'This AC device is sleeping. Wake it before sending a command.' : 'This AC device is offline. Wait for a fresh heartbeat.');
      const id = requestId();
      const started = Date.now();
      const queueTimeout = remaining();
      submitted = true;
      // A transport timeout cannot prove that the server did not enqueue this ID.
      const queued = await readWithTimeout(() => kind === 'ping'
        ? hardwareRpc('ecotrack_ping_controller', { p_node_id: nodeId, p_request_id: id })
        : hardwareRpc('ecotrack_cloud_request', {
          p_node_id: nodeId, p_kind: kind, p_payload: payload, p_request_id: id,
        }), queueTimeout);
      if (queued.id !== id || queued.node_id !== nodeId || queued.kind !== kind) throw new Error('Hardware request identity was not confirmed.');
      while (Date.now() < deadline) {
        const { data, error } = await readWithTimeout(signal => supabase.from('ecotrack_device_commands')
          .select('*').eq('id', id).abortSignal(signal).maybeSingle(), remaining());
        remaining();
        if (error) throw new Error(error.message);
        if (!data || data.node_id !== nodeId || data.kind !== kind) throw new Error('The hardware request is no longer available.');
        if (data.status === 'completed') {
          if (data.result?.success !== true || data.result.command_id !== id) throw new Error('Invalid device acknowledgement.');
          return { ...data.result, round_trip_ms: Date.now() - started,
            rssi: typeof data.result.rssi === 'number' ? data.result.rssi : state.rssi };
        }
        if (['failed', 'expired', 'superseded'].includes(data.status)) throw new Error(data.result?.error || 'Hardware request ' + data.status + '.');
        await delay(Math.min(500, remaining()));
      }
      throw new Error(noResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AC Device acknowledgement unavailable.';
      throw new CloudHardwareRequestError(submitted && /timed out/i.test(message) ? noResponse : message,
        state ? connectionStatus(state) : 'unknown');
    }
  },
  subscribe(onUpdate: (row?: CloudDeviceState) => void, onAge?: () => void): () => void {
    const id = requestId();
    const channel = supabase.channel('mobile-hardware-' + id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ecotrack_device_state' }, event => onUpdate(event.new as CloudDeviceState))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aircons' }, () => onUpdate())
      .subscribe(status => { if (status === 'SUBSCRIBED') onUpdate(); });
    const broadcast = supabase.channel('ecotrack:hardware', { config: { private: true } })
      .on('broadcast', { event: 'device_state' }, event => {
        const row = event.payload?.record || event.payload?.new || event.payload;
        if (row?.node_id) onUpdate(row);
      }).subscribe();
    // Ages an idle heartbeat even when no database change arrives.
    const timer = setInterval(() => onAge ? onAge() : onUpdate(), 15000);
    return () => { clearInterval(timer); void supabase.removeChannel(channel); void supabase.removeChannel(broadcast); };
  },
};
