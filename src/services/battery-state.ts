/** Battery metadata comes from firmware; its mock source is retained internally. */
export interface BatteryObservation {
  percent: number | null;
  voltage: number | null;
  charging: boolean | null;
  chargeState: 'charging' | 'full' | 'discharging' | null;
  observedAt: string;
  source?: string;
  capacityMah?: number;
}

export function readBatteryState(config: unknown, observedAt?: string, now = Date.now()): BatteryObservation | undefined {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return undefined;
  const value = config as Record<string, unknown>;
  if (!Object.keys(value).some(key => key.startsWith('battery_'))) return undefined;
  const seen = Date.parse(observedAt || '');
  if (!Number.isFinite(seen) || seen > now + 5000) return undefined;
  const number = (input: unknown, min: number, max: number) => typeof input === 'number' && Number.isFinite(input) && input >= min && input <= max ? input : null;
  return {
    // Explicit percentages, including 0..5, never pass through a voltage conversion.
    percent: number(value.battery_percent_estimate, 0, 100),
    voltage: number(value.battery_voltage, 2.5, 4.35),
    charging: typeof value.battery_charging === 'boolean' ? value.battery_charging : null,
    chargeState: value.battery_charge_state === 'charging' || value.battery_charge_state === 'full' || value.battery_charge_state === 'discharging' ? value.battery_charge_state : null,
    observedAt: observedAt!,
    source: typeof value.battery_source === 'string' ? value.battery_source : undefined,
    capacityMah: number(value.battery_capacity_mah, 1, 100000) ?? undefined,
  };
}

export function batteryStatus(state?: BatteryObservation, online = false, now = Date.now()): string | null {
  const seen = Date.parse(state?.observedAt || '');
  if (!online || !state || state.percent === null || !Number.isFinite(seen) || seen > now + 5000 || now - seen > 45000) return null;
  if (state.chargeState === 'full' && state.percent === 100 && state.charging === false) return 'Fully charged';
  if (state.charging === true && state.chargeState === 'charging' && state.percent < 100) return 'Charging';
  if (state.charging === false && state.chargeState === 'discharging') return 'On battery';
  return null;
}
