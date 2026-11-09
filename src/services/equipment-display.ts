import { functionalDeviceText } from './sensor-readings';

type EquipmentRow = Record<string, any>;

export interface EquipmentDisplayContext {
  aircons: EquipmentRow[];
  nodes: EquipmentRow[];
  rooms: EquipmentRow[];
  floors: EquipmentRow[];
  buildings: EquipmentRow[];
}

export interface EquipmentDisplaySeed {
  airconId?: string;
  airconName?: string;
  airconType?: string;
  controllerId?: string;
  controllerName?: string;
  protocolName?: string;
  roomId?: string;
  location?: string;
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const key = (value: unknown): string => text(value).toLowerCase();
const same = (left: unknown, right: unknown): boolean => Boolean(key(left)) && key(left) === key(right);
const unique = (rows: EquipmentRow[]): EquipmentRow | undefined => rows.length === 1 ? rows[0] : undefined;

/** An identifier or decoded IR protocol is never a saved display name. */
export function equipmentDisplayName(value: unknown, identifiers: unknown[] = [], protocol?: unknown): string | undefined {
  const name = text(value);
  if (!name || identifiers.some(id => same(name, id)) || same(name, protocol) ||
    /\b(?:esp32(?:[-_ ]?s3)?|heltec|mcp9808|mpx5010dp|lm393(?:dr)?|sx1262)\b/i.test(name) || /^node[_-]/i.test(name) ||
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(name)) return undefined;
  return functionalDeviceText(name);
}

export function equipmentType(value: unknown, protocol?: unknown): string | undefined {
  const kind = text(value);
  if (!kind || kind === '—' || same(kind, protocol)) return undefined;
  // Older dispatches combined the brand with the physical type in this field.
  return kind.replace(/^.+?\s+-\s+((?:split|window|ceiling|floor|cassette|portable|central|ducted|wall)\b.*)$/i, '$1');
}

/** Use registered relationships, never a room-only match, to identify equipment. */
export function resolveEquipmentDisplay(seed: EquipmentDisplaySeed, context: EquipmentDisplayContext): EquipmentDisplaySeed {
  const reference = text(seed.airconId) || text(seed.airconName);
  let aircon = unique(context.aircons.filter(ac => same(ac.id, reference)));
  if (!aircon) aircon = unique(context.aircons.filter(ac => same(ac.asset_tag, reference)));

  let node: EquipmentRow | undefined;
  const nodeReference = text(aircon?.controller_node_id) || text(seed.controllerId);
  if (nodeReference) node = unique(context.nodes.filter(candidate => same(candidate.id, nodeReference)));
  else {
    const legacyReference = text(aircon?.node_id) || reference;
    node = unique(context.nodes.filter(candidate => same(candidate.id, legacyReference)));
    if (!node) node = unique(context.nodes.filter(candidate => same(candidate.name, legacyReference)));
  }
  if (!aircon && node) aircon = unique(context.aircons.filter(ac => ac.controller_node_id
    ? same(ac.controller_node_id, node!.id)
    : same(ac.node_id, node!.id) || same(ac.node_id, node!.name)));

  const protocolName = text(aircon?.protocol_name) || text(aircon?.protocol) || text(node?.protocol_name) || text(seed.protocolName) || undefined;
  const identifiers = [seed.airconId, seed.controllerId, aircon?.id, aircon?.asset_tag, node?.id];
  const controllerName = equipmentDisplayName(node?.name, [node?.id], protocolName) || equipmentDisplayName(seed.controllerName, identifiers, protocolName);
  const airconName = equipmentDisplayName(aircon?.name, [aircon?.id, node?.id], protocolName) || equipmentDisplayName(seed.airconName, identifiers, protocolName);
  const airconType = equipmentType(aircon?.aircon_type, protocolName) || equipmentType(aircon?.model, protocolName) ||
    equipmentType(node?.aircon_type, protocolName) || equipmentType(seed.airconType, protocolName);

  const roomId = text(seed.roomId) || text(aircon?.room_id) || text(node?.room_id) || undefined;
  const room = context.rooms.find(candidate => same(candidate.id, roomId));
  const floor = room && context.floors.find(candidate => same(candidate.id, room.floor_id));
  const building = floor && context.buildings.find(candidate => same(candidate.id, floor.building_id));
  const location = [building?.name, floor?.name, room?.name].map(text).filter(Boolean).join(' • ') || seed.location;

  return { airconId: seed.airconId, airconName, airconType, controllerId: text(node?.id) || seed.controllerId,
    controllerName, protocolName, roomId, location };
}

/** Refresh presentation only; immutable notification events remain unchanged. */
export function refreshEquipmentText(value: string | undefined, previous: EquipmentDisplaySeed, current: EquipmentDisplaySeed): string | undefined {
  let result = value;
  const replace = (oldValue?: string, newValue?: string) => {
    if (!result || !oldValue || !newValue || same(oldValue, newValue) || result.includes(newValue)) return;
    const escaped = oldValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'gu'), (_match, prefix) => prefix + newValue);
  };
  replace(previous.controllerName, current.controllerName);
  if (!same(previous.airconName, current.protocolName)) replace(previous.airconName, current.airconName);
  replace(previous.airconId, current.airconName);
  replace(previous.location, current.location);
  return result;
}
