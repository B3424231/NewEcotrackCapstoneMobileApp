import { airflowRpmText } from './airflow-pressure';

/** Measured rotation is independent of AC power and of the forecast inputs. */
export function measuredRotation(value: unknown, quality?: unknown): number | null {
  if (['missing', 'fault', 'out_of_range', 'invalid'].includes(String(quality))) return null;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function rotationReading(value: unknown, quality?: unknown, config?: unknown): string {
  return airflowRpmText(value, quality);
}

/** Keep real protocol identities internal while making visible labels functional. */
export function functionalDeviceText(value: unknown): string {
  return String(value ?? '').replace(/\b(?:ESP32(?:[-_ ]?S3)?|Heltec|MCP9808|MPX5010DP|LM393(?:DR)?|SX1262|2N2222?A?)\b/gi, 'Device');
}

export function displayDeviceId(value: unknown): string {
  const id = String(value ?? '').trim();
  if (!id) return 'Unavailable';
  if (!/esp32|heltec|mcp9808|mpx5010dp|lm393|sx1262|2n222/i.test(id)) return id;
  const suffix = id.replace(/[^a-z0-9]/gi, '').slice(-6);
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `Device ${(/^[a-f0-9]{6}$/i.test(suffix) ? suffix : (hash >>> 0).toString(16).padStart(8, '0').slice(-6)).toUpperCase()}`;
}
