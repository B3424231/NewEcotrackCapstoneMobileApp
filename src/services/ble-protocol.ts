/** Firmware protocol v1. Request IDs correlate receipts; they are not credentials. */
export function requestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}
export function utf8Binary(text: string): string {
  return encodeURIComponent(text).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}
export function provisioningPackets(payload: Record<string, unknown>, id = requestId()): { id: string; packets: string[] } {
  const bytes = utf8Binary(JSON.stringify({ ...payload, request_id: id }));
  if (bytes.length > 2048) throw new Error('Provisioning payload is too large.');
  const total = Math.ceil(bytes.length / 160);
  return { id, packets: Array.from({ length: total }, (_, index) =>
    id + ':' + index + ':' + total + ':' + bytes.slice(index * 160, (index + 1) * 160)) };
}
export function validateWifi(ssid: string, password: string): void {
  if (!ssid.trim() || utf8Binary(ssid).length > 32 || utf8Binary(password).length < 8 || utf8Binary(password).length > 63)
    throw new Error('Enter a Wi-Fi name and password of 8..63 bytes.');
}
