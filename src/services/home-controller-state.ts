import type { SensorData } from './supabase';
import { connectionStatus, type CloudDeviceState } from './cloud-hardware';
import { remoteObservation, selectSettings } from './receiver-state';
import { measuredRotation } from './sensor-readings';
import { readBatteryState } from './battery-state';

const enabled = (value: unknown) => value === true || value === 'on' || value === 1;
const stamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : -Infinity;
/** Keep AC setting clocks independent from sensor measurements and heartbeats. */
export function mergeHomeSettings(previous?: Record<string, any> | null, incoming?: Record<string, any> | null, now = Date.now()): Record<string, any> {
  const snapshot = { ...previous };
  if (!incoming) return snapshot;
  const valid = (value: unknown) => stamp(value) !== -Infinity && stamp(value) <= now + 5000;
  if (Object.prototype.hasOwnProperty.call(incoming, 'configured_state') &&
      (!previous?.updated || valid(incoming.updated) && stamp(incoming.updated) >= stamp(previous.updated))) {
    snapshot.configured_state = incoming.configured_state;
  }
  if (valid(incoming.updated) && stamp(incoming.updated) >= stamp(previous?.updated)) snapshot.updated = incoming.updated;
  for (const [field, at] of [['desired_state', 'commanded_at'], ['reported_state', 'reported_at'], ['observed_remote_state', 'observed_remote_at']]) {
    if (Object.prototype.hasOwnProperty.call(incoming, field) && valid(incoming[at]) && stamp(incoming[at]) >= stamp(previous?.[at])) {
      snapshot[field] = incoming[field]; snapshot[at] = incoming[at];
      if (field === 'observed_remote_state') snapshot.observed_remote_field_at = incoming.observed_remote_field_at;
    }
  }
  return snapshot;
}
export function applyHomeControllerState(item: SensorData, row?: CloudDeviceState | null, now = Date.now()): SensorData {
  if (row && row.node_id !== item.id) return item;
  const oldHeartbeat = row?.last_seen && stamp(row.last_seen) < stamp(item.lastSeen);
  if (oldHeartbeat && !row?.measurement_at && !row?.node_updated_at && !row?.control_snapshot) return item;
  const hardware = row && !oldHeartbeat && stamp(row.last_seen) !== -Infinity && stamp(row.last_seen) <= now + 5000 ? row : null;
  const incomingBattery = readBatteryState(row?.applied_config, row?.last_seen, now);
  const batteryState = incomingBattery && stamp(incomingBattery.observedAt) >= stamp(item.batteryState?.observedAt) ? incomingBattery : item.batteryState;
  let snapshot = mergeHomeSettings(item.settingsSnapshot, row?.control_snapshot, now);
  if (hardware) snapshot = { ...snapshot, ...remoteObservation(hardware.latest_ir, hardware.last_seen, snapshot) };
  const settings = selectSettings(snapshot).state;
  const connection = hardware ? connectionStatus(hardware, now) : item.lastSeen
    ? connectionStatus({ node_id: item.id, device_id: item.serialNumber || '', last_seen: item.lastSeen, sleeping_until: item.sleepingUntil }, now)
    : 'unavailable';
  const has = (key: string) => Boolean(row && Object.prototype.hasOwnProperty.call(row, key));
  const measurementAt = row?.measurement_at;
  const acceptMeasurement = stamp(measurementAt) !== -Infinity && stamp(measurementAt) <= now + 5000 && stamp(measurementAt) >= stamp(item.measurementAt);
  // Node.updated also advances on heartbeats; it cannot date a measurement.
  const acceptNode = !item.measurementAt && stamp(row?.node_updated_at) !== -Infinity && stamp(row?.node_updated_at) <= now + 5000 && stamp(row?.node_updated_at) >= stamp(item.nodeReadingAt);
  const powerFeedback = acceptMeasurement && has('ac_on') ? { value: row?.ac_on ?? null, observedAt: measurementAt! } : item.powerFeedback;
  const temperature = has('temp') ? row?.temp : row?.temperature;
  const temperatureText = typeof temperature === 'number' && Number.isFinite(temperature) ? temperature.toFixed(1) + ' °C' : '—';
  const power = settings?.power === true || settings?.power === 'on' ? 'on' : settings?.power === false || settings?.power === 'off' ? 'off' : undefined;
  const functions = [
    ['Vertical swing', settings?.swing_vertical ?? settings?.swing],
    ['Horizontal swing', settings?.swing_horizontal],
    ['Turbo', settings?.turbo], ['Eco', settings?.eco], ['Quiet', settings?.quiet],
    ['Sleep', settings?.sleep], ['Display', settings?.display], ['Clean', settings?.clean], ['I Feel', settings?.i_feel],
  ].filter(([, value]) => enabled(value)).map(([label]) => String(label));
  const summary = [power?.toUpperCase(), settings?.mode ? String(settings.mode).toUpperCase() : undefined, settings?.fan ? String(settings.fan).toUpperCase() + ' FAN' : undefined].filter(Boolean).join(' · ') || '—';
  return { ...item, connectionState: connection, statusLabel: connection === 'unavailable' ? 'Status unavailable' : connection[0].toUpperCase() + connection.slice(1),
    settingsSnapshot: snapshot, lastSeen: hardware?.last_seen || item.lastSeen, sleepingUntil: hardware ? hardware.sleeping_until : item.sleepingUntil,
    serialNumber: hardware?.device_id || item.serialNumber,
    powerSetting: power, operatingMode: settings?.mode, fanMode: settings?.fan,
    setpoint: typeof settings?.temp === 'number' && Number.isFinite(settings.temp) ? settings.temp : undefined,
    specialFunctions: functions, airconState: summary, aircon: summary,
    powerFeedback,
    ...(acceptMeasurement || acceptNode ? {
      ...(acceptMeasurement ? { measurementAt: measurementAt || undefined } : { nodeReadingAt: row?.node_updated_at }),
      ...(has('temp') || has('temperature') ? { ventTemp: temperatureText, value: temperatureText } : {}),
      ...(has('rotation_rpm') ? { rotation_rpm: measuredRotation(row?.rotation_rpm, row?.rotation_quality ?? (acceptNode ? item.rotation_quality : undefined)), rotation_quality: row?.rotation_quality ?? (acceptNode ? item.rotation_quality : undefined) } : {}),
    } : {}),
    ...(has('sensor_config') && stamp(row?.node_updated_at) >= stamp(item.sensorConfigAt) ? { sensorConfig: row?.sensor_config, sensorConfigAt: row?.node_updated_at } : {}),
    rssi: row?.rssi ?? item.rssi,
    batteryState,
    battery: batteryState ? batteryState.percent === null ? '—' : Math.round(batteryState.percent) + '%'
      : typeof row?.battery === 'number' && Number.isFinite(row.battery) && row.battery >= 0 && row.battery <= 100 ? Math.round(row.battery) + '%' : item.battery,
  };
}
export function mergeHomeControllerFetch(fetched: SensorData[], current: SensorData[]): SensorData[] {
  return fetched.map(item => {
    const latest = current.find(previous => previous.id === item.id && previous.roomId === item.roomId);
    if (!latest || latest.airconId !== item.airconId) return item;
    let merged = { ...item, settingsSnapshot: mergeHomeSettings(latest.settingsSnapshot, item.settingsSnapshot) };
    if (stamp(latest.lastSeen) > stamp(item.lastSeen)) merged = { ...merged, lastSeen: latest.lastSeen, sleepingUntil: latest.sleepingUntil };
    if (stamp(latest.measurementAt) > stamp(item.measurementAt)) merged = { ...merged, measurementAt: latest.measurementAt, ventTemp: latest.ventTemp, value: latest.value, rotation_rpm: latest.rotation_rpm, rotation_quality: latest.rotation_quality };
    if (stamp(latest.powerFeedback?.observedAt) > stamp(item.powerFeedback?.observedAt)) merged = { ...merged, powerFeedback: latest.powerFeedback };
    if (stamp(latest.sensorConfigAt) > stamp(item.sensorConfigAt)) merged = { ...merged, sensorConfig: latest.sensorConfig, sensorConfigAt: latest.sensorConfigAt };
    if (stamp(latest.batteryState?.observedAt) > stamp(item.batteryState?.observedAt)) merged = { ...merged, battery: latest.battery, batteryState: latest.batteryState };
    return applyHomeControllerState(merged);
  });
}
