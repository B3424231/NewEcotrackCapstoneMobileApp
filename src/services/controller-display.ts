import type { AcControllerData } from '@/services/supabase';
import { selectSettings } from './receiver-state';
import { blowerReading } from './airflow-pressure';

/** Operation-mode setting; physical power feedback is displayed separately. */
export function airconStateReading(item: AcControllerData): string {
  const { state } = selectSettings(item.settingsSnapshot || null);
  const normalize = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase().replace(/[ -]+/g, '_') : '';
  const labels: Record<string, string> = { cool: 'Cold', fan: 'Fan Only', fan_only: 'Fan Only', heat: 'Heat', dry: 'Dry', auto: 'Auto', off: 'Off' };
  return labels[normalize(state?.mode)] || labels[normalize(item.operatingMode)] || 'Not reported';
}

export function blowerFanReading(item: AcControllerData, now = Date.now()): { value: string; detail: string } {
  const { state } = selectSettings(item.settingsSnapshot || null);
  const fan = state?.fan ?? item.fanMode;
  const label = typeof fan === 'string' && fan.trim() ? fan.trim()[0].toUpperCase() + fan.trim().slice(1).toLowerCase() : 'Fan setting not reported';
  const reading = blowerReading(item.rotation_rpm, item.rotation_quality, item.sensorConfig, item.measurementAt, item.reportIntervalSeconds, now);
  return { value: reading.rpm === 'Unavailable' ? '—' : reading.rpm, detail: label };
}

export function controllerConnection(item: AcControllerData): { label: string; color: string } {
  const state = item.connectionState;
  if (state === 'online') return { label: 'Online', color: '#10b981' };
  if (state === 'sleeping') return { label: 'Sleeping', color: '#f59e0b' };
  if (state === 'offline') return { label: 'Offline', color: '#94a3b8' };
  return { label: 'Status unavailable', color: '#94a3b8' };
}
export function controllerPower(item: AcControllerData): string {
  return item.powerSetting === 'on' ? 'ON' : item.powerSetting === 'off' ? 'OFF' : '—';
}
export function batteryReading(value?: string): { text: string; color: string } {
  const number = value && /^\d+(\.\d+)?%?$/.test(value.trim()) ? Number(value.replace('%', '')) : NaN;
  if (!Number.isFinite(number) || number < 0 || number > 100) return { text: '—', color: '#94a3b8' };
  return { text: Math.round(number) + '%', color: number >= 40 ? '#10b981' : number >= 20 ? '#f59e0b' : '#ef4444' };
}
