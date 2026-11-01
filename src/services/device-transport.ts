/** Local diagnostics supported by the checked-in ESP32 firmware. */
export function controllerBaseUrl(address: string): string {
  const endpoint = address.trim().toLowerCase().match(/^([^:]+)(?::(\d{1,5}))?$/);
  const host = endpoint?.[1] || '';
  const port = endpoint?.[2];
  if (!endpoint || (port !== undefined && (Number(port) < 1 || Number(port) > 65535))) {
    throw new Error('A local AC device IPv4 address or .local hostname with a valid optional port is required.');
  }
  const parts = host.split('.');
  const ipv4 = parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  const localIpv4 = ipv4 && (Number(parts[0]) === 10 ||
    (Number(parts[0]) === 172 && Number(parts[1]) >= 16 && Number(parts[1]) <= 31) ||
    (Number(parts[0]) === 192 && Number(parts[1]) === 168) ||
    (Number(parts[0]) === 169 && Number(parts[1]) === 254));
  const mdns = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local$/.test(host);
  if (!localIpv4 && !mdns) throw new Error('A local AC device IPv4 address or .local hostname is required.');
  return `http://${host}${port === undefined ? '' : `:${Number(port)}`}`;
}

export async function requestControllerJson(address: string, route: '/ping' | '/sniff-protocol' | '/ir/intent', timeoutMs = 8000, payload?: unknown): Promise<Record<string, unknown>> {
  const url = `${controllerBaseUrl(address)}${route}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: route === '/ping' ? 'GET' : 'POST',
      headers: { Accept: 'application/json', ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`AC Device request failed (${response.status}).`);
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid AC device response.');
    return data as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeController(address: string, identities: string[]): Promise<{ pingMs: number; rssi?: number }> {
  if (!identities.some(id => id.trim())) throw new Error('AC Device identity is required.');
  const started = Date.now();
  const data = await requestControllerJson(address, '/ping');
  if (data.status !== 'online' || typeof data.node_id !== 'string' || !identities.includes(data.node_id)) {
    throw new Error('AC Device identity did not match the registered node.');
  }
  return {
    pingMs: Date.now() - started,
    rssi: typeof data.rssi === 'number' && Number.isFinite(data.rssi) ? data.rssi : undefined,
  };
}
