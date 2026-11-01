export interface AirconStateSnapshot {
  desired_state?: Record<string, unknown> | null;
  reported_state?: Record<string, unknown> | null;
  commanded_at?: string | null;
  reported_at?: string | null;
  command_status?: string | null;
  command_id?: string | null;
  configured_state?: Record<string, unknown> | null;
  configured_at?: string | null;
}

export function parseAirconSnapshot(value: unknown): AirconStateSnapshot | null {
  if (typeof value === 'string') {
    try { return parseAirconSnapshot(JSON.parse(value)); } catch { return null; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AirconStateSnapshot : null;
}

function powerValue(value: unknown): boolean | null {
  if (value === true || value === 1 || ['on', 'true', '1'].includes(String(value).toLowerCase())) return true;
  if (value === false || value === 0 || ['off', 'false', '0'].includes(String(value).toLowerCase())) return false;
  return null;
}

/** Commands describe selected settings; only reported feedback describes operation. */
export function describeAirconState(value: unknown) {
  const snapshot = parseAirconSnapshot(value);
  const reported = snapshot?.reported_state;
  if (!snapshot?.desired_state && !reported && snapshot?.configured_state) {
    const mode = String(snapshot.configured_state.mode || '').trim().toLowerCase();
    const fan = String(snapshot.configured_state.fan || '').trim().toLowerCase();
    if (['cool', 'dry', 'fan', 'auto', 'heat'].includes(mode)) {
      const label = `${mode.toUpperCase()} SETTINGS`;
      const fanLabel = ['low', 'medium', 'high', 'auto', 'quiet', 'silent', 'turbo'].includes(fan) ? `${fan.toUpperCase()} FAN` : '';
      return { label, fanLabel, commandStatus: '', confirmed: false, power: null,
        summary: [label, fanLabel].filter(Boolean).join(' · ') };
    }
  }
  const reportTime = Date.parse(snapshot?.reported_at || '');
  const commandTime = Date.parse(snapshot?.commanded_at || '');
  const useReported = Boolean(reported && (!snapshot?.desired_state ||
    (Number.isFinite(reportTime) && (!Number.isFinite(commandTime) || reportTime >= commandTime))));
  const state = useReported ? reported : snapshot?.desired_state;
  const power = powerValue(state?.power);
  const mode = String(state?.mode || '').trim().toLowerCase();
  const fan = String(state?.fan || '').trim().toLowerCase();
  const validFans = ['low', 'medium', 'high', 'auto', 'quiet', 'silent', 'turbo'];
  const fanLabel = power !== false && validFans.includes(fan) ? `${fan.toUpperCase()} FAN` : '';
  const commandStatus = ['queued', 'transmitted', 'failed'].includes(snapshot?.command_status || '')
    ? snapshot!.command_status!.toUpperCase() : '';
  let label = 'UNCONFIRMED';
  if (power === false) label = useReported ? 'OFF / STANDBY' : 'POWER OFF REQUESTED';
  if (power === true) {
    if (useReported) {
      label = ({ fan: 'FAN ONLY', dry: 'DRY MODE', heat: 'HEAT MODE', auto: 'AUTO MODE',
        cool: state?.compressor_active === true ? 'ACTIVE COOLING' :
          state?.compressor_active === false ? 'COOLING IDLE' : 'COOL MODE' } as Record<string, string>)[mode] || 'ON (MODE UNKNOWN)';
    } else {
      label = ({ cool: 'COOLING REQUESTED', fan: 'FAN REQUESTED', dry: 'DRY REQUESTED',
        heat: 'HEATING REQUESTED', auto: 'AUTO REQUESTED' } as Record<string, string>)[mode] || 'POWER ON REQUESTED';
    }
  }
  return { label, fanLabel, commandStatus, confirmed: useReported && power !== null,
    power: useReported ? power : null, summary: [label, fanLabel, commandStatus].filter(Boolean).join(' · ') };
}
