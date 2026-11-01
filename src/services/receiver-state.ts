import { parseAirconSnapshot } from './aircon-state';
type RecordState = Record<string, any>;
export function selectSettings(snapshot: RecordState | null): { state: RecordState | null; source: string } {
  const state: RecordState = {}, times: Record<string, number> = {}, sources: Record<string, string> = {};
  for (const [kind, data, at] of [
    ['configured', snapshot?.configured_state, 0],
    ['requested', snapshot?.desired_state, Date.parse(snapshot?.commanded_at || '') || 0],
    ['reported', snapshot?.reported_state, Date.parse(snapshot?.reported_at || '') || 0],
    ['remote', snapshot?.observed_remote_state, Date.parse(snapshot?.observed_remote_at || '') || 0],
  ] as [string, RecordState | null, number][]) {
    if (!data) continue;
    for (const [key, value] of Object.entries(data)) {
      if (value == null || key === 'source') continue;
      const stamp = kind === 'remote' ? Date.parse(snapshot?.observed_remote_field_at?.[key] || snapshot?.observed_remote_at || '') || 0 : at;
      if (times[key] === undefined || stamp >= times[key]) { state[key] = value; times[key] = stamp; sources[key] = kind; }
    }
  }
  const keys = Object.keys(state);
  return { state: keys.length ? state : null, source: sources.power || sources.mode || sources.temp || sources.fan || sources[keys[0]] || 'unknown' };
}
export function remoteObservation(capture: unknown, receivedAt?: string, previous: RecordState = {}): RecordState {
  const frame = parseAirconSnapshot(capture) as RecordState | null;
  const retained = Object.fromEntries(Object.entries(previous).filter(([key]) => key.startsWith('observed_remote_')));
  if (!frame) return retained;
  const decodedFrame = frame.frame_kind !== 'settings_only' && frame.state ? frame : frame.last_decoded;
  if (!decodedFrame?.state || decodedFrame.frame_kind === 'settings_only' || (!decodedFrame.raw_data && !(decodedFrame.raw_count > 0))) return retained;
  const protocol = String(decodedFrame.protocol || decodedFrame.raw_type || '').toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,48}$/.test(protocol) || protocol === 'UNKNOWN') return retained;
  const update: RecordState = {};
  for (const [key, value] of Object.entries(decodedFrame.state)) {
    if (['power', 'turbo', 'swing', 'swing_vertical', 'swing_horizontal', 'eco', 'quiet', 'sleep', 'display', 'filter', 'clean', 'beep', 'i_feel'].includes(key)) {
      if ([true, false, 'on', 'off', 0, 1].includes(value as any)) update[key] = [true, 'on', 1].includes(value as any);
    } else if (key === 'temp' && typeof value === 'number' && Number.isFinite(value)) update.temp = value;
    else if (key === 'mode' && ['auto', 'cool', 'heat', 'dry', 'fan'].includes(value as string)) update.mode = value;
    else if (key === 'fan' && ['auto', 'low', 'medium', 'high', 'max', 'quiet', 'silent', 'turbo'].includes(value as string))
      update.fan = protocol === 'TCL112AC' && value === 'turbo' ? 'high' : value;
  }
  if (!Object.keys(update).length) return retained;
  const identity = JSON.stringify([decodedFrame.boot_count, decodedFrame.sequence, decodedFrame.captured_at_epoch_ms,
    decodedFrame.captured_at_ms, protocol, decodedFrame.hex, update, decodedFrame.ac_capabilities, decodedFrame.remote_model]);
  const epoch = Number(decodedFrame.captured_at_epoch_ms);
  const server = Date.parse(decodedFrame.received_at || '');
  const validEpoch = Number.isFinite(epoch) && epoch > 0 && epoch <= 8640000000000000 && (!Number.isFinite(server) || epoch <= server + 5000);
  const capturedAt = validEpoch ? new Date(epoch).toISOString() : Number.isFinite(server) ? new Date(server).toISOString() : receivedAt;
  const at = identity === previous.observed_remote_frame ? previous.observed_remote_at : capturedAt;
  if (Date.parse(at || '') < Date.parse(previous.observed_remote_at || '')) return retained;
  const same = previous.observed_remote_protocol === protocol;
  const fields = { ...(same ? previous.observed_remote_state : {}), ...update, source: 'ir_receiver' };
  const times = { ...(same ? previous.observed_remote_field_at : {}) };
  for (const key of Object.keys(update)) {
    const fieldAt = decodedFrame.field_at?.[key];
    times[key] = Number.isFinite(Date.parse(fieldAt || '')) && Date.parse(fieldAt) <= Date.parse(at || '') + 5000 ? fieldAt : at;
  }
  return { observed_remote_state: fields, observed_remote_field_at: times, observed_remote_at: at, observed_remote_frame: identity,
    observed_remote_protocol: protocol, observed_remote_model: Number.isInteger(decodedFrame.remote_model) && decodedFrame.remote_model > 0
      ? decodedFrame.remote_model : same ? previous.observed_remote_model : null,
    observed_remote_capabilities: decodedFrame.ac_capabilities || (same ? previous.observed_remote_capabilities : null) };
}
