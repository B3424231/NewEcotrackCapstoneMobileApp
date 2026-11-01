import { fetchAccessibleRows, exactMatchFilter } from './query-utils';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, DbNode, DbRoom, DbFloor } from './supabase';
import { CloudHardware, connectionStatus, normalizeIrCapture } from './cloud-hardware';
import { remoteObservation, selectSettings } from './receiver-state';
import registry from './ac-capability-registry';

export interface ProtocolCapability {
  protocolName: string;
  brand: string;
  label: string;
  minTemp: number;
  maxTemp: number;
  modes: string[];
  fans: string[];
  swing: boolean;
  turbo: boolean;
  eco: boolean;
  sleep: boolean;
  timer: boolean;
}

export const SUPPORTED_IR_PROTOCOLS: Record<string, ProtocolCapability> = {
  midea_ir: {
    protocolName: 'midea_ir',
    brand: 'Midea',
    label: 'Midea / Carrier / Comfee (climate_ir: midea)',
    minTemp: 16,
    maxTemp: 30,
    modes: ['cool', 'dry', 'fan', 'auto', 'heat'],
    fans: ['low', 'medium', 'high', 'auto'],
    swing: true,
    turbo: true,
    eco: true,
    sleep: true,
    timer: true,
  },
  gree: {
    protocolName: 'gree',
    brand: 'Gree',
    label: 'Gree Electric / Tosot (climate_ir: gree)',
    minTemp: 16,
    maxTemp: 30,
    modes: ['cool', 'dry', 'fan', 'auto', 'heat'],
    fans: ['low', 'medium', 'high', 'auto', 'turbo'],
    swing: true,
    turbo: true,
    eco: true,
    sleep: true,
    timer: true,
  },
  daikin: {
    protocolName: 'daikin',
    brand: 'Daikin',
    label: 'Daikin ARC433 / ARC4xx (climate_ir: daikin)',
    minTemp: 18,
    maxTemp: 32,
    modes: ['cool', 'dry', 'fan', 'auto', 'heat'],
    fans: ['low', 'medium', 'high', 'auto', 'quiet'],
    swing: true,
    turbo: true,
    eco: true,
    sleep: true,
    timer: true,
  },
  carrier: {
    protocolName: 'carrier',
    brand: 'Carrier',
    label: 'Carrier Inverter / Optima (climate_ir: carrier)',
    minTemp: 17,
    maxTemp: 30,
    modes: ['cool', 'dry', 'fan', 'auto'],
    fans: ['low', 'medium', 'high', 'auto'],
    swing: true,
    turbo: true,
    eco: true,
    sleep: true,
    timer: true,
  },
  panasonic: {
    protocolName: 'panasonic',
    brand: 'Panasonic',
    label: 'Panasonic CS Series (climate_ir: panasonic)',
    minTemp: 16,
    maxTemp: 30,
    modes: ['cool', 'dry', 'fan', 'auto', 'heat'],
    fans: ['low', 'medium', 'high', 'auto'],
    swing: true,
    turbo: true,
    eco: true,
    sleep: true,
    timer: true,
  },
  koppel_ir: {
    protocolName: 'koppel_ir',
    brand: 'Koppel',
    label: 'Koppel Split / Window (climate_ir: koppel)',
    minTemp: 16,
    maxTemp: 30,
    modes: ['cool', 'dry', 'fan', 'auto'],
    fans: ['low', 'medium', 'high', 'auto'],
    swing: true,
    turbo: true,
    eco: true,
    sleep: true,
    timer: true,
  },
  mitsubishi: {
    protocolName: 'mitsubishi',
    brand: 'Mitsubishi',
    label: 'Mitsubishi Heavy / Electric (climate_ir: mitsubishi)',
    minTemp: 16,
    maxTemp: 31,
    modes: ['cool', 'dry', 'fan', 'auto', 'heat'],
    fans: ['low', 'medium', 'high', 'auto', 'silent'],
    swing: true,
    turbo: true,
    eco: true,
    sleep: true,
    timer: true,
  },
  samsung: {
    protocolName: 'samsung',
    brand: 'Samsung',
    label: 'Samsung WindFree / Digital (climate_ir: samsung)',
    minTemp: 16,
    maxTemp: 30,
    modes: ['cool', 'dry', 'fan', 'auto', 'heat'],
    fans: ['low', 'medium', 'high', 'auto', 'turbo'],
    swing: true,
    turbo: true,
    eco: true,
    sleep: true,
    timer: true,
  },
  generic_ac: {
    protocolName: 'generic_ac',
    brand: 'Generic',
    label: 'Universal Generic AC (climate_ir: generic)',
    minTemp: 16,
    maxTemp: 30,
    modes: ['cool', 'dry', 'fan', 'auto'],
    fans: ['low', 'medium', 'high', 'auto'],
    swing: true,
    turbo: false,
    eco: true,
    sleep: true,
    timer: true,
  },
};

export const CapabilityEngine = {
  resolveProtocolName(brandOrProtocol?: string): string {
    if (!brandOrProtocol) return 'unverified';
    const raw = brandOrProtocol.toLowerCase().trim();
    if (raw === 'daikin2') return 'daikin';
    if (SUPPORTED_IR_PROTOCOLS[raw]) return raw;
    const profile = Object.values(SUPPORTED_IR_PROTOCOLS).find(candidate => candidate.brand.toLowerCase() === raw);
    return profile?.protocolName || 'unverified';
  },

  getCapabilities(brandOrProtocol?: string): ProtocolCapability {
    const exact = registry.protocol(brandOrProtocol);
    if (exact !== 'UNKNOWN') {
      const caps = registry.capabilities(exact);
      return { ...caps, protocolName: exact, brand: Object.values(SUPPORTED_IR_PROTOCOLS).find(profile => registry.protocol(profile.protocolName) === exact)?.brand || exact.replace(/_?AC\d*$/, ''), label: exact,
        minTemp: caps.min_temp ?? 16, maxTemp: caps.max_temp ?? 30, modes: caps.modes, fans: caps.fans,
        swing: caps.swing, turbo: caps.turbo, eco: caps.eco, sleep: caps.sleep, timer: caps.timer };
    }
    const proto = this.resolveProtocolName(brandOrProtocol);
    const profile = SUPPORTED_IR_PROTOCOLS[proto] || { ...SUPPORTED_IR_PROTOCOLS.generic_ac, protocolName: 'unverified', brand: 'Unverified', label: 'Protocol verification required' };
    // The supplied firmware encoders are placeholders; these are registration
    // profiles, not evidence that a physical unit supports any command.
    return { ...profile, modes: [], fans: [], swing: false, turbo: false, eco: false, sleep: false, timer: false };
  },

  isSupported(brandOrProtocol: string, feature: string, value?: any): boolean {
    return false;
  },

  clampTemperature(brandOrProtocol: string, temp: number): number {
    const caps = this.getCapabilities(brandOrProtocol);
    return Math.max(caps.minTemp, Math.min(caps.maxTemp, temp));
  },

  getSupportedProtocols(): ProtocolCapability[] {
    return [];
  }
};

export interface AcControllerDevice {
  id: string; // e.g. "AC-001" or node ID
  deviceId: string; // Unique AC unit identifier e.g. "AC-001"
  name: string; // e.g. "Server Room A AC (node-1)"
  brand: string; // e.g. "Daikin", "Carrier", "Koppel", "Panasonic", "LG", etc.
  model: string; // e.g. "FTKC25TVM"
  nodeId: string; // Bound ESP32 AC Controller node name e.g. "node-1"
  nodeIp?: string;
  roomId?: string | null;
  roomName: string;
  location: string;
  airconType: string; // "Split Type (Inverter)", etc.
  protocol: string; // "midea_ir", "daikin", "gree", "carrier", etc.
  protocolName?: string;
  status: 'online' | 'offline' | 'standby';
  temp?: number;
  setTemp?: number;
  power?: 'ON' | 'OFF';
  desiredState?: Record<string, any>;
  controlSnapshot?: Record<string, any>;
  controllerName?: string;
  airconName?: string;
  registeredBy?: string;
  created?: string;
  updated?: string;
  irCommandsCount?: number;
}

export interface IrCommand {
  id: string;
  deviceId: string;
  commandType: string;
  protocol: string;
  rawData: string;
  decodedData: string;
  createdAt: string;
  airconId?: string;
  sourcePlatform?: string;
  updatedAt?: string;
}

function irStorageError(error: any): Error {
  return new Error(['42P01', 'PGRST202', 'PGRST205'].includes(error?.code)
    ? 'Shared IR storage is not installed on the server. Ask your administrator to enable IR code sharing.'
    : error?.message || 'The IR code operation was not confirmed.');
}
function irCommandFromRow(row: any): IrCommand {
  return { id: row.id, airconId: row.aircon_id, deviceId: row.aircons?.asset_tag || row.aircon_id,
    commandType: row.command_type, protocol: row.protocol, rawData: row.raw_data,
    decodedData: JSON.stringify(row.capture || {}), sourcePlatform: row.source_platform,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
async function findIrAircon(deviceId: string): Promise<{ id: string; asset_tag: string } | null> {
  if (!deviceId?.trim()) return null;
  const response = await fetchAccessibleRows(supabase, 'aircons', 'id,asset_tag',
    query => query.or(exactMatchFilter(['id', 'asset_tag'], deviceId.trim())));
  if (response.error) throw irStorageError(response.error);
  if ((response.data?.length || 0) > 1) throw new Error('This AC identity is ambiguous. Refresh the device list.');
  return response.data?.[0] || null;
}

export const STANDARD_IR_FUNCTIONS = [
  { type: 'POWER_ON', label: 'Power ON', icon: 'power' },
  { type: 'POWER_OFF', label: 'Power OFF', icon: 'power-off' },
  { type: 'TEMP_UP', label: 'Temp +', icon: 'arrow-up' },
  { type: 'TEMP_DOWN', label: 'Temp -', icon: 'arrow-down' },
  { type: 'MODE_COOL', label: 'Mode: Cool', icon: 'snowflake' },
  { type: 'FAN_AUTO', label: 'Fan: Auto', icon: 'fan' },
];

export const POPULAR_AC_BRANDS = [
  'Daikin',
  'Carrier',
  'Koppel',
  'Panasonic',
  'LG',
  'Mitsubishi',
  'Samsung',
  'Kolin',
  'TCL',
  'Midea',
  'Haier',
  'Condura',
  'Fujidenzo',
  'Sharp',
  'Gree',
  'Other / Generic',
];

const STORAGE_KEYS = {
  AIRCONS: '@ecotrack_aircons',
  IR_COMMANDS: '@ecotrack_ir_commands',
  CUSTOM_FUNCS_PREFIX: '@ecotrack_custom_funcs_',
};

export const AcControllerService = {
  applyHardwareState(ac: AcControllerDevice, row: import('./cloud-hardware').CloudDeviceState): AcControllerDevice {
    if (ac.nodeId !== row.node_id) return ac;
    const old = ac.controlSnapshot || {};
    if (old.hardware_device_id && old.hardware_device_id !== row.device_id) return ac;
    if (Date.parse(row.last_seen || '') < Date.parse(old.hardware_last_seen || '')) return ac;
    const snapshot: Record<string, any> = { ...old, ...remoteObservation(row.latest_ir, row.last_seen, old),
      hardware_device_id: row.device_id, hardware_last_seen: row.last_seen };
    const settings = selectSettings(snapshot).state;
    const protocol = snapshot.observed_remote_protocol || ac.protocolName || ac.protocol;
    return { ...ac, controlSnapshot: snapshot, desiredState: settings || undefined, protocol, protocolName: protocol,
      setTemp: Number.isFinite(settings?.temp) ? settings?.temp : undefined,
      power: [true, 'on'].includes(settings?.power) ? 'ON' : [false, 'off'].includes(settings?.power) ? 'OFF' : undefined,
      status: connectionStatus(row) === 'online' ? 'online' : connectionStatus(row) === 'sleeping' ? 'standby' : 'offline',
      nodeIp: row.ip_address || ac.nodeIp };
  },
  getProtocolForBrand(brand: string): string {
    return CapabilityEngine.resolveProtocolName(brand);
  },

  async sniffProtocol(nodeId: string, nodeIp?: string): Promise<{ success: boolean; protocol: string; brand: string; source: string }> {
    const result = await CloudHardware.request(nodeId, 'learn_ir', {}, 30000);
    const capture = result.capture || result;
    const protocol = registry.protocol(capture.protocol || capture.raw_type);
    if (protocol === 'UNKNOWN' || !(capture.raw_count >= 3)) return { success: false, protocol: '', brand: '', source: 'hardware' };
    // Shared IR encodings identify a protocol, not the physical manufacturer's name.
    return { success: true, protocol, brand: '', source: 'hardware' };
  },

  async getAllAircons(): Promise<AcControllerDevice[]> {
    try {
      const [nodesRes, roomsRes, floorsRes, airconsRes, hardware] = await Promise.all([
        fetchAccessibleRows(supabase, 'nodes', '*'),
        fetchAccessibleRows(supabase, 'rooms', '*'),
        fetchAccessibleRows(supabase, 'floors', '*'),
        fetchAccessibleRows(supabase, 'aircons', '*'),
        CloudHardware.list(),
      ]);

      if ([nodesRes, roomsRes, floorsRes, airconsRes].some(result => result.error)) throw new Error('Unable to load AC devices.');

      const roomsMap = new Map<string, DbRoom>();
      (roomsRes.data || []).forEach((r: DbRoom) => roomsMap.set(r.id, r));

      const floorsMap = new Map<string, DbFloor>();
      (floorsRes.data || []).forEach((f: DbFloor) => floorsMap.set(f.id, f));

      const combined: AcControllerDevice[] = [];
      const seenIds = new Set<string>();

      // 1. Process real aircons from Supabase aircons table (master source of user-entered brands)
      if (airconsRes.data && airconsRes.data.length > 0) {
        airconsRes.data.forEach((ac: any) => {
          const devId = ac.asset_tag || ac.id;
          seenIds.add(devId);
          if (ac.node_id) seenIds.add(ac.node_id);

          const matchedNode = (nodesRes.data || []).find((n: DbNode) => ac.controller_node_id ? n.id === ac.controller_node_id : (n.name === ac.node_id || n.id === ac.node_id));
          const rId = ac.room_id || matchedNode?.room_id;
          const room = rId ? roomsMap.get(rId) : undefined;
          const floor = room?.floor_id ? floorsMap.get(room.floor_id) : undefined;
          const roomName = room?.name || 'Unassigned';
          const floorName = floor?.name || '';
          const location = floorName ? `${roomName} (${floorName})` : roomName;
          const cloud = hardware.find(state => state.node_id === matchedNode?.id);
          const snapshot = { ...ac, ...remoteObservation(cloud?.latest_ir, cloud?.last_seen, ac), hardware_device_id: cloud?.device_id, hardware_last_seen: cloud?.last_seen };
          const settings = selectSettings(snapshot).state;
          const proto = snapshot.observed_remote_protocol || ac.protocol_name || ac.protocol || 'UNKNOWN';
          const isOnline = cloud ? connectionStatus(cloud) === 'online' : false;

          combined.push({
            id: ac.id || devId,
            deviceId: devId,
            name: matchedNode?.name || ac.name || devId,
            controllerName: matchedNode?.name,
            airconName: ac.name || ac.asset_tag,
            brand: ac.brand, // Exact dynamically entered brand from Admin or Mobile Staff!
            model: ac.model || ac.aircon_type || '',
            nodeId: matchedNode?.id || ac.controller_node_id || ac.node_id || '',
            nodeIp: matchedNode?.ip_address || undefined,
            roomId: rId,
            roomName,
            location,
            airconType: ac.aircon_type || ac.model || '',
            protocol: proto,
            protocolName: proto,
            status: isOnline ? 'online' : 'offline',
            temp: matchedNode?.temp != null ? Number(matchedNode.temp) : undefined,
            setTemp: Number.isFinite(settings?.temp) ? settings?.temp : undefined,
            desiredState: settings || undefined,
            controlSnapshot: snapshot,
            // Remote buttons reflect the last requested state; sensor badges use observed telemetry.
            power: settings?.power === 'on' || settings?.power === true ? 'ON' :
              settings?.power === 'off' || settings?.power === false ? 'OFF' : undefined,
            created: ac.created_at,
            updated: ac.updated_at,
          });
        });
      }

      return combined;
    } catch (err) {
      console.warn('Failed to load aircon controllers:', err);
      return [];
    }
  },

  async getAirconById(deviceId: string): Promise<AcControllerDevice | null> {
    const list = await this.getAllAircons();
    return list.find((a) => a.deviceId === deviceId || a.id === deviceId) || null;
  },

  async saveAircon(payload: Partial<AcControllerDevice>): Promise<AcControllerDevice> {
    const deviceId = payload.deviceId?.trim();
    const brand = payload.brand?.trim();
    if (!deviceId || !brand) throw new Error('Device ID and aircon brand are required.');
    const protocol = payload.protocolName || payload.protocol || 'UNKNOWN';
    const { data, error } = await supabase.rpc('ecotrack_device_mutation', {
      p_operation: 'save_aircon',
      p_id: deviceId,
      p_payload: {
        brand, model: payload.model || null, aircon_type: payload.airconType || payload.model || null,
        room_id: payload.roomId || null, node_id: payload.nodeId?.trim() || null, protocol_name: protocol,
      },
    });
    if (error || !data?.aircon?.id) {
      throw new Error(error?.message || 'AC Device setup is unavailable. Ask your administrator to update the server.');
    }
    let saved = data.aircon;
    if (payload.name?.trim() && saved.name !== payload.name.trim()) {
      const renamed = await supabase.from('aircons').update({ name: payload.name.trim() }).eq('id', saved.id).select('*').single();
      if (renamed.error || renamed.data?.name !== payload.name.trim()) throw new Error('The profile was saved, but its name could not be confirmed. Refresh before retrying.');
      saved = renamed.data;
    }
    const fullDevice: AcControllerDevice = {
      id: saved.id, deviceId: saved.asset_tag, name: saved.name || saved.asset_tag,
      brand: saved.brand, model: saved.model || '', nodeId: saved.node_id || '', roomId: saved.room_id,
      roomName: payload.roomName || 'Unassigned', location: payload.location || payload.roomName || 'Unassigned',
      airconType: saved.aircon_type || '', protocol: saved.protocol_name, protocolName: saved.protocol_name,
      status: saved.status === 'online' ? 'online' : 'offline',
      created: saved.created_at, updated: saved.updated_at,
    };
    // Cache writes are optional after the server has committed both records.
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.AIRCONS);
      const aircons: AcControllerDevice[] = stored ? JSON.parse(stored) : [];
      const filtered = aircons.filter(ac => ac.id !== fullDevice.id && ac.deviceId !== fullDevice.deviceId);
      await AsyncStorage.setItem(STORAGE_KEYS.AIRCONS, JSON.stringify([...filtered, fullDevice]));
    } catch (error) { console.warn('Unable to cache saved AC controller:', error); }
    return fullDevice;
  },

  async deleteAircon(deviceId: string): Promise<boolean> {
    if (!deviceId.trim()) return false;
    try {
      const { data, error } = await supabase.rpc('ecotrack_device_mutation', {
        p_operation: 'delete_aircon', p_id: deviceId, p_payload: {},
      });
      if (error || data?.deleted !== true) return false;
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.AIRCONS);
        const aircons: AcControllerDevice[] = raw ? JSON.parse(raw) : [];
        await AsyncStorage.setItem(STORAGE_KEYS.AIRCONS, JSON.stringify(aircons.filter(ac => ac.deviceId !== deviceId && ac.id !== deviceId && ac.id !== data.id)));
      } catch (error) { console.warn('Unable to clear AC controller cache:', error); }
      return true;
    } catch { return false; }
  },

  // Saved captures use the same AC database identity on mobile and desktop.
  async getAllIrCommands(): Promise<IrCommand[]> {
    const response = await fetchAccessibleRows(supabase, 'ecotrack_ir_codes', '*,aircons(asset_tag)');
    if (response.error) throw irStorageError(response.error);
    return (response.data || []).map(irCommandFromRow);
  },

  async getCommandsForDevice(deviceId: string): Promise<IrCommand[]> {
    const aircon = await findIrAircon(deviceId);
    if (!aircon) return [];
    const response = await fetchAccessibleRows(supabase, 'ecotrack_ir_codes', '*', query => query.eq('aircon_id', aircon.id));
    if (response.error) throw irStorageError(response.error);
    return (response.data || []).map(row => ({ ...irCommandFromRow(row), deviceId: aircon.asset_tag }));
  },

  async saveIrCommand(cmd: any): Promise<any> {
    const aircon = await findIrAircon(cmd?.airconId || cmd?.aircon_id || cmd?.deviceId || cmd?.device_id);
    if (!aircon) throw new Error('Select a registered AC before saving an IR code.');
    const commandType = String(cmd.commandType || cmd.command_type || '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(commandType)) throw new Error('Enter a valid IR command name.');
    const capture = normalizeIrCapture({ ...(cmd.capture || {}), protocol: cmd.protocol || cmd.capture?.protocol,
      raw_data: cmd.rawData || cmd.raw_data || cmd.capture?.raw_data });
    const response = await supabase.rpc('ecotrack_save_ir_code', {
      p_aircon_id: aircon.id, p_command_type: commandType, p_capture: capture, p_source: 'mobile',
    });
    if (response.error) throw irStorageError(response.error);
    const row = response.data;
    if (!row?.id || row.aircon_id !== aircon.id || row.command_type !== commandType ||
        row.protocol !== capture.protocol || row.raw_data !== capture.raw_data)
      throw new Error('The saved IR code was not confirmed. Refresh before retrying.');
    return { ...irCommandFromRow(row), deviceId: aircon.asset_tag };
  },

  async deleteIrCommand(deviceId: string, commandType: string): Promise<boolean> {
    const aircon = await findIrAircon(deviceId);
    if (!aircon) return false;
    const response = await supabase.rpc('ecotrack_delete_ir_code', {
      p_aircon_id: aircon.id, p_command_type: commandType,
    });
    if (response.error) throw irStorageError(response.error);
    if (response.data?.aircon_id !== aircon.id || typeof response.data?.deleted !== 'boolean')
      throw new Error('The IR code deletion was not confirmed.');
    return response.data.deleted;
  },

  async getCustomFunctions(deviceId: string): Promise<string[]> {
    return [];
  },

  async addCustomFunction(deviceId: string, rawName: string): Promise<string | null> {
    throw new Error('Custom IR functions are not implemented.');
  },

  async deleteCustomFunction(deviceId: string, funcName: string): Promise<boolean> {
    return false;
  },

  async applyBrandPreset(deviceId: string, brand: string): Promise<any[]> {
    return [];
  },

  async captureIrSignal(deviceId: string, commandType: string, brand?: string): Promise<any> {
    const device = await this.getAirconById(deviceId);
    if (!device?.nodeId) throw new Error('Select a registered AC device before capturing a signal.');
    const result = await CloudHardware.request(device.nodeId, 'learn_ir', {}, 30000);
    const capture = normalizeIrCapture(result.capture || result);
    return this.saveIrCommand({ airconId: device.id, commandType, protocol: capture.protocol, capture });
  },

  async testTransmit(deviceId: string, commandType: string): Promise<{ success: boolean; message: string }> {
    return {
      success: false,
      message: 'No hardware transmission was performed. Configure an AC device connection first.',
    };
  },

  async dispatchIntent(nodeId: string, payload: { protocol: string; state: any; aircon_id?: string }): Promise<boolean> {
    if (!nodeId || !payload.aircon_id) throw new Error('Select a registered AC device.');
    const device = await this.getAirconById(payload.aircon_id);
    if (!device || device.nodeId !== nodeId) throw new Error('This AC is not assigned to the selected AC device.');
    const profile = { protocol_name: payload.protocol, capability_profile: device.controlSnapshot?.capability_profile,
      control_snapshot: device.controlSnapshot };
    const valid = registry.validateState(profile, payload.state);
    if (!valid.valid) throw new Error(valid.errors.join(' '));
    await CloudHardware.request(nodeId, 'ac_intent', { aircon_id: device.id, protocol: payload.protocol, state: payload.state });
    return true;
  },

  async saveDesiredState(deviceId: string, state: Record<string, unknown>, protocol?: string): Promise<void> {
    const device = await this.getAirconById(deviceId);
    if (!device) throw new Error('AC device not found.');
    await this.dispatchIntent(device.nodeId, { aircon_id: device.id, protocol: protocol || device.protocolName || device.protocol, state });
  }

};
