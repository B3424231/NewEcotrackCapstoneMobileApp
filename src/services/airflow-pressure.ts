type Config = Record<string, any>;
const record = (value: unknown): value is Config => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const validRotation = (value: unknown, quality?: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && !['fault', 'missing', 'out_of_range', 'invalid'].includes(String(quality));

export function airflowReference(config: unknown): number | null {
  const value = record(config) && record(config.airflow_reference) ? config.airflow_reference.rpm : null;
  return validRotation(value) && value > 0 ? value : null;
}

/** A rotation ratio against a measured reference, never physical pressure or airspeed. */
export function airflowPercent(value: unknown, quality: unknown, config: unknown): number | null {
  const reference = airflowReference(config);
  if (!validRotation(value, quality) || reference === null) return null;
  const percent = value / reference * 100;
  return Number.isFinite(percent) ? percent : null;
}

/** Normalize each device before weighting its readings into an average. */
export function airflowAverage(groups: unknown, configs: Record<string, unknown>): number | null {
  if (!Array.isArray(groups)) return null;
  let sum = 0, count = 0;
  for (const group of groups) {
    if (!record(group) || typeof group.node_id !== 'string' || !Number.isSafeInteger(group.rotation_count) || group.rotation_count <= 0) continue;
    const percent = airflowPercent(group.rotation_avg, 'ok', configs[group.node_id]);
    if (percent === null) continue;
    sum += percent * group.rotation_count;
    count += group.rotation_count;
  }
  return count && Number.isFinite(sum / count) ? sum / count : null;
}

/** Validated wheel rotation; no saved percentage reference is required. */
export function airflowRpmText(value: unknown, quality?: unknown): string {
  return validRotation(value, quality) ? Math.round(value) + ' RPM' : '—';
}

export function airflowText(value: unknown, quality: unknown, config: unknown): string {
  if (!validRotation(value, quality)) return 'Unavailable';
  if (airflowReference(config) === null) return 'Reference needed';
  const percent = airflowPercent(value, quality, config);
  return percent === null ? 'Unavailable' : Math.round(percent) + '%';
}

/** Current blower measurement, independent of the selected fan setting. */
export function blowerReading(value: unknown, quality: unknown, config: unknown, observedAt: unknown, intervalSeconds?: number, now = Date.now()): { value: string; rpm: string } {
  const observed = typeof observedAt === 'string' ? Date.parse(observedAt) : NaN;
  const limit = typeof intervalSeconds === 'number' && Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? Math.max(15, intervalSeconds * 3) : 45;
  if (!validRotation(value, quality) || !Number.isFinite(observed) || now - observed < -5000 || now - observed > limit * 1000)
    return { value: 'Unavailable', rpm: 'Unavailable' };
  return { value: airflowText(value, quality, config), rpm: Math.round(value as number) + ' RPM' };
}

/** Raw RPM average from the same validated per-device samples used by Analytics. */
export function airflowRpmAverage(groups: unknown): number | null {
  if (!Array.isArray(groups)) return null;
  let sum = 0, count = 0;
  for (const group of groups) {
    if (!record(group) || typeof group.node_id !== 'string' || !Number.isSafeInteger(group.rotation_count) || group.rotation_count <= 0 || !validRotation(group.rotation_avg, group.rotation_quality)) continue;
    sum += group.rotation_avg * group.rotation_count; count += group.rotation_count;
  }
  return count && Number.isFinite(sum / count) ? sum / count : null;
}

export function canSetAirflowReference(value: unknown, quality: unknown, observedAt: unknown, intervalSeconds?: number, now = Date.now()): boolean {
  const observed = typeof observedAt === 'string' ? Date.parse(observedAt) : NaN;
  const age = now - observed;
  const limit = typeof intervalSeconds === 'number' && Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? Math.max(15, intervalSeconds * 3) : 45;
  return validRotation(value, quality) && value > 0 && Number.isFinite(observed) && age >= -5000 && age <= limit * 1000;
}

/** Existing RLS permits administrator saves; compare the JSON to preserve concurrent edits. */
export async function saveAirflowReference(client: any, nodeId: string, value: number, quality: unknown, observedAt: string, intervalSeconds?: number, isCurrent = () => true): Promise<Config> {
  if (!nodeId || !isCurrent()) throw new Error('The selected device changed. Open its details again.');
  if (!canSetAirflowReference(value, quality, observedAt, intervalSeconds)) throw new Error('Wait for a recent positive reading before setting a reference.');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const result = await client.from('nodes').select('sensor_config').eq('id', nodeId).abortSignal(controller.signal).single();
    if (result.error || !result.data) throw new Error('Unable to read this device configuration. Please try again.');
    if (result.data.sensor_config != null && !record(result.data.sensor_config)) throw new Error('The device configuration is invalid.');
    if (!isCurrent()) throw new Error('The selected device changed. Open its details again.');
    if (!canSetAirflowReference(value, quality, observedAt, intervalSeconds)) throw new Error('The reading is now too old. Wait for a recent reading and try again.');
    const previous = result.data.sensor_config;
    const next = { ...previous, airflow_reference: { rpm: value, observed_at: observedAt, saved_at: new Date().toISOString() } };
    let query = client.from('nodes').update({ sensor_config: next, updated: next.airflow_reference.saved_at }).eq('id', nodeId);
    query = previous == null ? query.is('sensor_config', null) : query.eq('sensor_config', JSON.stringify(previous));
    const saved = await query.select('sensor_config').abortSignal(controller.signal).single();
    if (saved.error || !saved.data || saved.data.sensor_config?.airflow_reference?.rpm !== value || saved.data.sensor_config?.airflow_reference?.observed_at !== observedAt) {
      throw new Error('Reference was not confirmed. An administrator can refresh and try again.');
    }
    return saved.data.sensor_config;
  } finally { clearTimeout(timer); }
}
