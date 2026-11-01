/** Browser GATT bridge for the same provisioning characteristics used by native BLE. */
type Characteristic = {
  readValue(): Promise<DataView>;
  writeValueWithResponse(value: Uint8Array): Promise<void>;
};
type BrowserDevice = {
  id: string;
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<BrowserDevice['gatt']>;
    disconnect(): void;
    getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<Characteristic> }>;
  };
};
type BluetoothEnvironment = {
  isSecureContext?: boolean;
  navigator?: { bluetooth?: { requestDevice(options: unknown): Promise<BrowserDevice> } };
};

export function webBluetoothAvailability(environment: BluetoothEnvironment = globalThis as BluetoothEnvironment): { available: boolean; message: string } {
  if (environment.isSecureContext !== true) return {
    available: false,
    message: 'Bluetooth requires a secure page. Open EcoTrack over HTTPS or localhost, or use the installed EcoTrack app.',
  };
  if (typeof environment.navigator?.bluetooth?.requestDevice !== 'function') return {
    available: false,
    message: 'This browser cannot access Bluetooth. Open EcoTrack in Chrome or Edge on a device with Bluetooth, or use the installed EcoTrack app.',
  };
  return { available: true, message: 'Choose the nearby EcoTrack AC device in the browser Bluetooth prompt. Keep Bluetooth enabled and the AC device powered on.' };
}

export function createWebBluetoothManager(environment: BluetoothEnvironment = globalThis as BluetoothEnvironment) {
  const selected = new Map<string, BrowserDevice>();
  const deviceFor = (id: string) => {
    const device = selected.get(id);
    if (!device?.gatt) throw new Error('Choose the AC device again with Connect to AC Device.');
    return device;
  };
  const nativeShape = (id: string) => ({
    id,
    name: deviceFor(id).name,
    async discoverAllServicesAndCharacteristics() { /* Characteristics are resolved by UUID below. */ },
    async readCharacteristicForService(serviceUuid: string, characteristicUuid: string) {
      const device = deviceFor(id);
      const service = await device.gatt!.getPrimaryService(serviceUuid);
      const characteristic = await service.getCharacteristic(characteristicUuid);
      const data = await characteristic.readValue();
      const binary = Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), byte => String.fromCharCode(byte)).join('');
      return { value: btoa(binary) };
    },
    async writeCharacteristicWithResponseForService(serviceUuid: string, characteristicUuid: string, base64: string) {
      const device = deviceFor(id);
      const service = await device.gatt!.getPrimaryService(serviceUuid);
      const characteristic = await service.getCharacteristic(characteristicUuid);
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      await characteristic.writeValueWithResponse(bytes);
    },
  });
  return {
    hasSelectedDevice(id: string) { return selected.has(id); },
    // Call synchronously from the button handler; requestDevice requires user activation.
    async requestDevice(serviceUuid: string): Promise<string> {
      const availability = webBluetoothAvailability(environment);
      if (!availability.available) throw new Error(availability.message);
      try {
        const device = await environment.navigator!.bluetooth!.requestDevice({
          filters: [{ services: [serviceUuid] }],
        });
        if (!device.gatt) throw new Error('The selected AC device does not provide Bluetooth GATT.');
        selected.set(device.id, device);
        return device.id;
      } catch (error) {
        const name = (error as Error)?.name;
        if (name === 'NotFoundError') throw new Error('No AC device selected. Turn Bluetooth on, keep the device nearby, and choose it from the Bluetooth prompt.');
        if (name === 'SecurityError' || name === 'NotAllowedError') throw new Error('Bluetooth access was blocked. Allow Bluetooth for this page, then press Connect to AC Device again.');
        throw error;
      }
    },
    async connectToDevice(id: string) {
      const device = deviceFor(id);
      if (!device.gatt!.connected) await device.gatt!.connect();
      return nativeShape(id);
    },
    async isDeviceConnected(id: string) { return selected.get(id)?.gatt?.connected === true; },
    async devices(ids: string[]) { return ids.map(id => { deviceFor(id); return nativeShape(id); }); },
    async cancelDeviceConnection(id: string) { selected.get(id)?.gatt?.disconnect(); },
  };
}

export const WebBluetoothManager = createWebBluetoothManager();
