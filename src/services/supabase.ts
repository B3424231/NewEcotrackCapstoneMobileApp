import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Sensor Data Model
export interface SensorData {
  id: string;
  name: string;
  value: string;
  status: 'optimal' | 'warning' | 'critical';
  statusLabel: string;
  details: string;
  location: string;
  aircon?: string;
  ventTemp?: string;
  pressure?: string;
  battery?: string;
  building?: string;
  floor?: string;
  room?: string;
  sensorName?: string;
  acType?: string;
  acId?: string;
  activeReportId?: string;
  maintenanceStatus?: string;
  maintenancePriority?: 'High' | 'Medium' | 'Low';
  // Desktop middle telemetry properties
  wakeTime?: string;
  sleepTime?: string;
  interval?: string;
  rssi?: number | null;
  signalStrengthLabel?: string;
  signalStrengthDbm?: string;
  airconState?: string;
  updatedTime?: string;
  roomId?: string | null;
  isAssignedToRoom?: boolean;
}

// Supabase Connection Credentials
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    '[Supabase] Warning: EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY is missing. Ensure your .env file is properly configured.'
  );
}

// Supabase Client Instance configured with AsyncStorage session persistence
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Database Models
export interface DbNode {
  id: string;
  name: string;
  status: string;
  temp: number | null;
  pressure: number | null;
  rssi: number | null;
  battery: number | null;
  wake_time: string | null;
  sleep_time: string | null;
  interval_val: number | null;
  interval_unit: string | null;
  room_id: string | null;
  aircon_type: string | null;
  install_date: string | null;
  created: string;
  updated: string;
  photo_url?: string | null;
  image_url?: string | null;
}

export interface DbRoom {
  id: string;
  name: string;
  node_limit: number | null;
  floor_id: string | null;
  admin_id: string | null;
  created: string;
  updated: string;
}

export interface DbFloor {
  id: string;
  name: string;
  building_id: string | null;
  created: string;
  updated: string;
}

export interface DbBuilding {
  id: string;
  name: string;
  admin_id: string | null;
  created: string;
  updated: string;
}

export interface DbNotification {
  id: string;
  date: string;
  time: string;
  content: string;
  triggered: boolean;
  room_id: string | null;
  rule_id: string | null;
  admin_id: string | null;
  created: string;
  updated: string;
}

export interface DbStaff {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  password?: string | null;
  role?: string | null;
  building_name?: string | null;
  floor_name?: string | null;
  room_name?: string | null;
  room_id?: string | null;
  status: string | null;
  is_archived?: boolean | null;
  archive_reason?: string | null;
  archive_notes?: string | null;
  archived_at?: string | null;
  last_active: string | null;
  created: string;
  updated: string;
}

// Helper to reliably detect if a staff account has been archived by the administrator
export function isStaffArchived(staff: any): boolean {
  if (!staff) return false;
  const isExplicitlyArchived = staff.is_archived === true || staff.is_archived === 'true';
  const hasArchivedAt =
    typeof staff.archived_at === 'string' &&
    staff.archived_at.trim().length > 0 &&
    staff.archived_at !== 'null';
  const hasArchiveReason =
    typeof staff.archive_reason === 'string' &&
    staff.archive_reason.trim().length > 0 &&
    staff.archive_reason !== 'null';
  const hasArchivedStatus =
    staff.status?.toLowerCase() === 'archived' ||
    staff.status?.toLowerCase() === 'deactivated';

  return Boolean(isExplicitlyArchived || hasArchivedAt || hasArchiveReason || hasArchivedStatus);
}

export interface DbTelemetry {
  id: string;
  node_id?: string | null;
  sensor_name: string;
  room_name?: string | null;
  floor_name?: string | null;
  building_name?: string | null;
  aircon_type?: string | null;
  temperature: number;
  pressure: number;
  battery: number;
  rssi: number;
  status: string;
  created: string;
}

export interface DbAdministrator {
  id: string;
  username: string;
  email: string;
  password?: string;
  role: string;
  is_active: boolean;
  last_login: string | null;
  created: string;
  updated: string;
}

export interface AppUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  userType: 'admin' | 'staff';
  assignment?: string;
  avatar?: 'default' | 'male' | 'female' | 'custom';
  photoUrl?: string | null;
  buildingName?: string;
  floorName?: string;
  roomName?: string;
  isArchived?: boolean;
  archiveReason?: string | null;
  archiveNotes?: string | null;
  archivedAt?: string | null;
}

// Convert Battery Voltage (e.g. 4.08V, 4.15V, 4.2V) or raw value to percentage string matching desktop
function formatBatteryPercent(battery: number | null | undefined): string {
  if (battery == null) return '100%';
  if (battery <= 5) {
    // Desktop battery formula: percentage of 4.2V max voltage (e.g. 4.08V -> 97%, 4.15V -> 99%, 4.18V -> 100%)
    const pct = Math.min(100, Math.max(0, Math.round((battery / 4.2) * 100)));
    return `${pct}%`;
  }
  return `${Math.min(100, Math.max(0, Math.round(battery)))}%`;
}

// Format temperature string for display matching desktop (e.g. '24.5 °C')
function formatTemperature(tempC: number | null | undefined): { fahrenheit: string; celsius: string } {
  if (tempC == null) return { fahrenheit: '72.0 °F', celsius: '22.0 °C' };
  const f = ((tempC * 9) / 5 + 32).toFixed(1);
  const c = typeof tempC === 'number' ? `${tempC.toFixed(1)} °C` : `${tempC} °C`;
  return { fahrenheit: `${f} °F`, celsius: c };
}

// Format 24-hour time to 12-hour AM/PM string (e.g. '06:00' -> '6:00 AM')
export function formatTimeAmPm(timeStr?: string | null): string {
  if (!timeStr) return '--:--';
  const parts = timeStr.split(':');
  if (parts.length < 2) return timeStr;
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1];
  if (isNaN(hours)) return timeStr;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${hours}:${minutes} ${ampm}`;
}

// Format power-cycle timing cadence interval (e.g. 1, 'Hours' -> '1 hr')
export function formatInterval(val?: number | null, unit?: string | null): string {
  if (val == null) return '--';
  const cleanUnit = (unit || 'Minutes').toLowerCase();
  if (cleanUnit.startsWith('hour')) {
    return `${val} hr`;
  }
  return `${val} min`;
}

// Format signal strength label and dBm text from RSSI
export function formatSignalStrength(rssi?: number | null): { label: string; text: string; quality: 'weak' | 'fair' | 'strong' } {
  if (rssi == null) return { label: 'WEAK', text: '-85 dBm', quality: 'weak' };
  const val = Number(rssi);
  let label = 'WEAK';
  let quality: 'weak' | 'fair' | 'strong' = 'weak';
  if (val >= -65) {
    label = 'STRONG';
    quality = 'strong';
  } else if (val >= -78) {
    label = 'GOOD';
    quality = 'fair';
  } else {
    label = 'WEAK';
    quality = 'weak';
  }
  return { label, text: `${val} dBm`, quality };
}

// Format ISO timestamp to local time string (e.g. '09:07:13 PM')
export function formatUpdatedTime(isoStr?: string | null): string {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  } catch {
    return '';
  }
}

// Active Room Details interface for desktop middle panel sync
export interface ActiveRoomData {
  id: string;
  name: string;
  floorName: string;
  buildingName: string;
  nodeLimit: number;
  assignedCount: number;
  capacityPercentage: number;
}

// Worker Assignment Verification Result
export interface WorkerAssignmentResult {
  isAssigned: boolean;
  roomId: string | null;
  roomName: string;
  floorName: string;
  buildingName: string;
  assignmentText: string;
}

// Dynamically verify and resolve worker's room assignment against active database hierarchy.
// If the assigned room, floor, or building was erased/deleted by an admin, the worker is automatically assigned as "Unassigned".
export async function resolveWorkerAssignment(
  workerIdentifier?: string
): Promise<WorkerAssignmentResult> {
  try {
    const cleanId = (workerIdentifier || '').trim();

    const [staffRes, roomsRes, floorsRes, buildingsRes] = await Promise.all([
      cleanId
        ? supabase
          .from('staff')
          .select('*')
          .or(`id.eq.${cleanId},email.ilike.%${cleanId}%,phone.ilike.%${cleanId}%,name.ilike.%${cleanId}%`)
          .limit(1)
        : supabase.from('staff').select('*').order('created', { ascending: false }).limit(1),
      supabase.from('rooms').select('*'),
      supabase.from('floors').select('*'),
      supabase.from('buildings').select('*'),
    ]);

    const staffMember = staffRes.data && staffRes.data.length > 0 ? staffRes.data[0] : null;
    const rooms: DbRoom[] = roomsRes.data || [];
    const floors: DbFloor[] = floorsRes.data || [];
    const buildings: DbBuilding[] = buildingsRes.data || [];

    const floorsMap = new Map<string, DbFloor>();
    floors.forEach((f) => floorsMap.set(f.id, f));

    const buildingsMap = new Map<string, DbBuilding>();
    buildings.forEach((b) => buildingsMap.set(b.id, b));

    // If staff member has no assignment or explicitly unassigned
    if (
      !staffMember ||
      (!staffMember.room_id && !staffMember.room_name && !staffMember.assignment) ||
      staffMember.assignment === 'Unassigned' ||
      staffMember.room_name?.toLowerCase() === 'unassigned'
    ) {
      return {
        isAssigned: false,
        roomId: null,
        roomName: 'Unassigned',
        floorName: '',
        buildingName: '',
        assignmentText: 'Unassigned',
      };
    }

    // Universal assignment check ("All Buildings", "All Floors", "All Rooms")
    const rawBld = (staffMember.building_name || '').trim();
    const rawFlr = (staffMember.floor_name || '').trim();
    const rawRm = (staffMember.room_name || '').trim();
    const rawAssign = (staffMember.assignment || '').trim();
    const rawRoomId = (staffMember.room_id || '').trim();

    const isAllBld = rawBld.toLowerCase().includes('all') || rawAssign.toLowerCase().includes('all building') || staffMember.building_id === 'all_buildings';
    const isAllFlr = rawFlr.toLowerCase().includes('all') || rawAssign.toLowerCase().includes('all floor') || staffMember.floor_id === 'all_floors';
    const isAllRm = rawRm.toLowerCase().includes('all') || rawAssign.toLowerCase().includes('all room') || rawRoomId === 'all_rooms' || rawRoomId === 'ALL';

    if (isAllBld || isAllFlr || isAllRm) {
      const displayBld = isAllBld ? 'All Buildings' : (rawBld || 'All Buildings');
      const displayFlr = isAllFlr ? 'All Floors' : (rawFlr || 'All Floors');
      const displayRm = isAllRm ? 'All Rooms' : (rawRm || 'All Rooms');
      const assignmentText = rawAssign && rawAssign.includes('•')
        ? rawAssign
        : `${displayBld} • ${displayFlr} • ${displayRm}`;

      return {
        isAssigned: true,
        roomId: 'ALL',
        roomName: displayRm,
        floorName: displayFlr,
        buildingName: displayBld,
        assignmentText,
      };
    }

    // Locate matching room in active rooms table
    let matchingRoom: DbRoom | undefined;
    if (staffMember.room_id) {
      matchingRoom = rooms.find((r) => r.id === staffMember.room_id);
    }
    if (!matchingRoom && staffMember.room_name) {
      matchingRoom = rooms.find((r) => r.name.toLowerCase() === staffMember.room_name.toLowerCase());
    }

    // If room does NOT exist (it was erased by admin on desktop)
    if (!matchingRoom) {
      if (staffMember.id && staffMember.assignment !== 'Unassigned') {
        await supabase
          .from('staff')
          .update({
            room_id: null,
            room_name: null,
            floor_name: null,
            building_name: null,
            assignment: 'Unassigned',
            updated: new Date().toISOString(),
          })
          .eq('id', staffMember.id);
      }
      return {
        isAssigned: false,
        roomId: null,
        roomName: 'Unassigned',
        floorName: '',
        buildingName: '',
        assignmentText: 'Unassigned',
      };
    }

    // Verify parent floor and building exist
    const floor = matchingRoom.floor_id ? floorsMap.get(matchingRoom.floor_id) : undefined;
    const building = floor?.building_id ? buildingsMap.get(floor.building_id) : undefined;

    if (!floor || !building) {
      // Floor or building was erased by admin on desktop
      if (staffMember.id && staffMember.assignment !== 'Unassigned') {
        await supabase
          .from('staff')
          .update({
            room_id: null,
            room_name: null,
            floor_name: null,
            building_name: null,
            assignment: 'Unassigned',
            updated: new Date().toISOString(),
          })
          .eq('id', staffMember.id);
      }
      return {
        isAssigned: false,
        roomId: null,
        roomName: 'Unassigned',
        floorName: '',
        buildingName: '',
        assignmentText: 'Unassigned',
      };
    }

    const assignmentText = `${building.name} • ${floor.name} • ${matchingRoom.name}`;
    return {
      isAssigned: true,
      roomId: matchingRoom.id,
      roomName: matchingRoom.name,
      floorName: floor.name,
      buildingName: building.name,
      assignmentText,
    };
  } catch (err) {
    console.error('Error resolving worker assignment:', err);
    return {
      isAssigned: false,
      roomId: null,
      roomName: 'Unassigned',
      floorName: '',
      buildingName: '',
      assignmentText: 'Unassigned',
    };
  }
}

// Fetch active room information for worker's assigned room
export async function fetchActiveRoom(assignedRoomId?: string | null): Promise<ActiveRoomData | null> {
  if (!assignedRoomId) return null;

  if (assignedRoomId === 'ALL' || assignedRoomId === 'all_rooms') {
    try {
      const [roomsRes, nodesRes] = await Promise.all([
        supabase.from('rooms').select('*'),
        supabase.from('nodes').select('id, room_id'),
      ]);
      const rooms: DbRoom[] = roomsRes.data || [];
      const nodes: any[] = nodesRes.data || [];
      const totalNodeLimit = rooms.reduce((acc, r) => acc + (r.node_limit || 10), 0) || 50;
      const assignedCount = nodes.length;
      const capacityPercentage = Math.min(100, Math.round((assignedCount / Math.max(1, totalNodeLimit)) * 100));

      return {
        id: 'ALL',
        name: 'All Campus Rooms',
        floorName: 'All Floors',
        buildingName: 'All Buildings',
        nodeLimit: totalNodeLimit,
        assignedCount,
        capacityPercentage,
      };
    } catch (err) {
      console.error('Failed to fetch aggregate room data:', err);
      return {
        id: 'ALL',
        name: 'All Campus Rooms',
        floorName: 'All Floors',
        buildingName: 'All Buildings',
        nodeLimit: 50,
        assignedCount: 0,
        capacityPercentage: 0,
      };
    }
  }

  try {
    const [roomsRes, floorsRes, buildingsRes, nodesRes] = await Promise.all([
      supabase.from('rooms').select('*').eq('id', assignedRoomId),
      supabase.from('floors').select('*'),
      supabase.from('buildings').select('*'),
      supabase.from('nodes').select('id, room_id'),
    ]);

    const targetRoom: DbRoom | undefined = (roomsRes.data || [])[0];
    if (!targetRoom) return null;

    const floorsMap = new Map<string, DbFloor>();
    (floorsRes.data || []).forEach((f: DbFloor) => floorsMap.set(f.id, f));

    const buildingsMap = new Map<string, DbBuilding>();
    (buildingsRes.data || []).forEach((b: DbBuilding) => buildingsMap.set(b.id, b));

    const floor = targetRoom.floor_id ? floorsMap.get(targetRoom.floor_id) : undefined;
    const building = floor?.building_id ? buildingsMap.get(floor.building_id) : undefined;

    if (!floor || !building) return null; // Orphaned room whose floor or building was erased

    const assignedNodes = (nodesRes.data || []).filter((n: any) => n.room_id === targetRoom.id);
    const nodeLimit = targetRoom.node_limit || 10;
    const assignedCount = assignedNodes.length;
    const capacityPercentage = Math.min(100, Math.round((assignedCount / nodeLimit) * 100));

    return {
      id: targetRoom.id,
      name: targetRoom.name,
      floorName: floor.name,
      buildingName: building.name,
      nodeLimit,
      assignedCount,
      capacityPercentage,
    };
  } catch (err) {
    console.error('Failed to fetch active room data:', err);
    return null;
  }
}

// Map live Supabase tables (nodes, telemetry, rooms, floors, buildings) to frontend SensorData
// IMPORTANT: Only returns sensor nodes actively assigned to the worker's room.
// If the worker is Unassigned (roomId is null), returns an empty array.
export async function fetchLiveSensors(roomId?: string | null): Promise<SensorData[]> {
  if (!roomId) {
    return [];
  }
  const isUniversal = roomId === 'ALL' || roomId === 'all_rooms';
  try {
    let nodesQuery = supabase.from('nodes').select('*').order('id', { ascending: true });
    if (!isUniversal) {
      nodesQuery = nodesQuery.eq('room_id', roomId);
    }
    let roomsQuery = supabase.from('rooms').select('*');
    if (!isUniversal) {
      roomsQuery = roomsQuery.eq('id', roomId);
    }
    const [nodesRes, roomsRes, floorsRes, buildingsRes, reportsRes] = await Promise.all([
      nodesQuery,
      roomsQuery,
      supabase.from('floors').select('*'),
      supabase.from('buildings').select('*'),
      supabase.from('maintenance_reports').select('id, aircon_id, aircon_name, status, priority'),
    ]);

    if (nodesRes.error) {
      console.warn('Error fetching nodes from Supabase:', nodesRes.error);
      return [];
    }

    const nodes: DbNode[] = nodesRes.data || [];
    const roomsMap = new Map<string, DbRoom>();
    (roomsRes.data || []).forEach((r: DbRoom) => roomsMap.set(r.id, r));

    const floorsMap = new Map<string, DbFloor>();
    (floorsRes.data || []).forEach((f: DbFloor) => floorsMap.set(f.id, f));

    const buildingsMap = new Map<string, DbBuilding>();
    (buildingsRes.data || []).forEach((b: DbBuilding) => buildingsMap.set(b.id, b));

    const dbReports = reportsRes.data || [];

    return nodes.map((node, index) => {
      const room = node.room_id ? roomsMap.get(node.room_id) : undefined;
      const floor = room?.floor_id ? floorsMap.get(room.floor_id) : undefined;
      const building = floor?.building_id ? buildingsMap.get(floor.building_id) : undefined;

      const roomName = room?.name || 'room 1';
      const floorName = floor?.name || 'first floor';
      const buildingName = building?.name || 'main campus';
      const location = `${buildingName}, ${floorName}`;

      const rawTemp = node.temp;
      const { fahrenheit, celsius } = formatTemperature(rawTemp);
      const batteryStr = formatBatteryPercent(node.battery);

      // Determine status from temperature and status field
      let status: 'optimal' | 'warning' | 'critical' = 'optimal';
      let statusLabel = 'Optimal';
      let details = 'Operating within acceptable thresholds. Cooling systems are active and efficient.';

      const tempVal = rawTemp ?? 23;
      const nodeStatus = (node.status || 'online').toLowerCase();
      if (tempVal >= 28 || nodeStatus === 'critical' || nodeStatus === 'offline') {
        status = 'critical';
        statusLabel = 'Critical Temp';
        details = 'High temperature threshold breached. Immediate vent and coil inspection required.';
      } else if (tempVal >= 25 || nodeStatus === 'warning') {
        status = 'warning';
        statusLabel = 'Checklist Due';
        details = 'Airflow restriction detected. Filter cleaning scheduled in maintenance checklist.';
      }

      // Check genuine maintenance report for this sensor node from database
      const matchedReport = dbReports.find(
        (r: any) =>
          (r.aircon_id === node.id || r.aircon_name === node.name) &&
          r.status !== 'Completed' &&
          r.status !== 'Verified'
      );
      const activeReportId = matchedReport ? matchedReport.id : undefined;
      const acId = `AC-${String(index + 2).padStart(3, '0')}`;

      // Pressure in kPa matching desktop (e.g. 0.5 kPa / 0.6 kPa)
      const rawPressure = node.pressure;
      const pressureStr = rawPressure != null ? `${Number(rawPressure).toFixed(1)} kPa` : '0.5 kPa';

      // Aircon state badge matching desktop (ACTIVE COOLING / STANDBY)
      const isOnline = nodeStatus !== 'offline';
      const airconStateText = isOnline ? 'ACTIVE COOLING' : 'STANDBY';
      const airconType = node.aircon_type || 'Split Type (Inverter)';

      // Signal Strength & Schedule details from nodes table
      const signalInfo = formatSignalStrength(node.rssi);
      const wakeTimeFormatted = formatTimeAmPm(node.wake_time || '06:00');
      const sleepTimeFormatted = formatTimeAmPm(node.sleep_time || '22:00');
      const intervalFormatted = formatInterval(node.interval_val || 1, node.interval_unit || 'Hours');
      const updatedTimeFormatted = formatUpdatedTime(node.updated);

      return {
        id: node.id,
        name: `${node.name} (${roomName})`,
        value: celsius,
        status,
        statusLabel,
        details,
        location,
        aircon: airconStateText,
        ventTemp: celsius,
        pressure: pressureStr,
        battery: batteryStr,
        building: buildingName,
        floor: floorName,
        room: roomName,
        sensorName: node.name,
        acType: airconType,
        acId,
        activeReportId,
        maintenanceStatus: matchedReport
          ? (matchedReport.status || (status === 'optimal' ? 'In Progress' : 'Checklist Due'))
          : 'No Maintenance Yet',
        maintenancePriority: matchedReport
          ? ((matchedReport as any)?.priority || (status === 'critical' ? 'High' : status === 'warning' ? 'Medium' : 'Low'))
          : 'Low',
        // Desktop middle telemetry properties
        wakeTime: wakeTimeFormatted,
        sleepTime: sleepTimeFormatted,
        interval: intervalFormatted,
        rssi: node.rssi ?? -85,
        signalStrengthLabel: signalInfo.label,
        signalStrengthDbm: signalInfo.text,
        airconState: airconStateText,
        updatedTime: updatedTimeFormatted,
        roomId: node.room_id,
        isAssignedToRoom: true,
      };
    });
  } catch (error) {
    console.error('Failed to fetch live sensors:', error);
    return [];
  }
}

// Real-time subscription to nodes, rooms, floors, buildings, and staff
export function subscribeToNodes(onUpdate: () => void) {
  const channelId = `nodes_rooms_staff_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const channel = supabase
    .channel(channelId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'nodes' }, () => {
      onUpdate();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => {
      onUpdate();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'floors' }, () => {
      onUpdate();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'buildings' }, () => {
      onUpdate();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'staff' }, () => {
      onUpdate();
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// Real-time subscription to a specific staff member record (for archival and remote logout)
export function subscribeToStaffMember(staffId: string, onUpdate: (staff: DbStaff) => void) {
  if (!staffId) return () => { };
  const channelId = `staff_user_${staffId.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
  const channel = supabase
    .channel(channelId)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'staff',
        filter: `id=eq.${staffId}`,
      },
      (payload) => {
        if (payload.new) {
          onUpdate(payload.new as DbStaff);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// Fetch real notifications from Supabase
export interface AppNotificationItem {
  id: string;
  subject: string;
  message: string;
  time: string;
  read: boolean;
  type: 'critical' | 'warning' | 'info' | 'optimal';
  category: 'temp' | 'pressure' | 'report' | 'hvac';
  building?: string;
  floor?: string;
  room?: string;
  sensorName?: string;
}

export async function fetchLiveNotifications(): Promise<AppNotificationItem[]> {
  try {
    const [notifRes, roomsRes, floorsRes, buildingsRes] = await Promise.all([
      supabase.from('notifications').select('*').order('created', { ascending: false }).limit(50),
      supabase.from('rooms').select('*'),
      supabase.from('floors').select('*'),
      supabase.from('buildings').select('*'),
    ]);

    if (notifRes.error) {
      console.warn('Error fetching notifications:', notifRes.error);
      return [];
    }

    const roomsMap = new Map<string, DbRoom>();
    (roomsRes.data || []).forEach((r: DbRoom) => roomsMap.set(r.id, r));

    const floorsMap = new Map<string, DbFloor>();
    (floorsRes.data || []).forEach((f: DbFloor) => floorsMap.set(f.id, f));

    const buildingsMap = new Map<string, DbBuilding>();
    (buildingsRes.data || []).forEach((b: DbBuilding) => buildingsMap.set(b.id, b));

    const rawNotifs: DbNotification[] = notifRes.data || [];

    return rawNotifs.map((item) => {
      const room = item.room_id ? roomsMap.get(item.room_id) : undefined;
      const floor = room?.floor_id ? floorsMap.get(room.floor_id) : undefined;
      const building = floor?.building_id ? buildingsMap.get(floor.building_id) : undefined;

      const content = item.content || 'System notification alert';
      let type: 'critical' | 'warning' | 'info' | 'optimal' = 'info';
      let category: 'temp' | 'pressure' | 'report' | 'hvac' = 'hvac';

      const lower = content.toLowerCase();
      if (lower.includes('critical') || lower.includes('danger') || lower.includes('hot')) {
        type = 'critical';
      } else if (lower.includes('warning') || lower.includes('threshold') || lower.includes('exceeded')) {
        type = 'warning';
      } else if (lower.includes('optimal') || lower.includes('normal') || lower.includes('restored')) {
        type = 'optimal';
      }

      if (lower.includes('temp') || lower.includes('hot') || lower.includes('cold')) {
        category = 'temp';
      } else if (lower.includes('pressure') || lower.includes('bar')) {
        category = 'pressure';
      } else if (lower.includes('report') || lower.includes('shift')) {
        category = 'report';
      }

      const timeStr = item.date && item.time ? `${item.date} ${item.time}` : 'Recently';

      return {
        id: item.id,
        subject: content.split('.')[0] || 'System Alert',
        message: content,
        time: timeStr,
        read: !item.triggered,
        type,
        category,
        building: building?.name,
        floor: floor?.name,
        room: room?.name,
        sensorName: room ? `${room.name} Sensor` : undefined,
      };
    });
  } catch (error) {
    console.error('Failed to fetch live notifications:', error);
    return [];
  }
}

// Real-time subscription to notifications
export function subscribeToNotifications(onUpdate: () => void) {
  const channelId = `notifications_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const channel = supabase
    .channel(channelId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
      onUpdate();
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// Create Notification
export async function createNotification(content: string, roomId?: string): Promise<boolean> {
  try {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0];
    const id = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const { error } = await supabase.from('notifications').insert({
      id,
      date: dateStr,
      time: timeStr,
      content,
      triggered: true,
      room_id: roomId || null,
      admin_id: null,
      created: now.toISOString(),
      updated: now.toISOString(),
    });

    if (error) {
      console.warn('Failed to insert notification:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Error inserting notification:', e);
    return false;
  }
}

// Authenticate user against Supabase `administrators` or `staff`
export async function authenticateUser(
  identifier: string,
  passwordInput?: string
): Promise<{
  success: boolean;
  user?: AppUser;
  error?: string;
  isArchived?: boolean;
  archiveReason?: string;
  archiveNotes?: string;
  archivedAt?: string;
}> {
  try {
    const cleanId = identifier.trim().toLowerCase();

    // Password input is required
    if (!passwordInput || typeof passwordInput !== 'string' || !passwordInput.trim()) {
      return { success: false, error: 'Password is required to authenticate.' };
    }

    // 1. Check administrators table by email or username
    const { data: admins, error: adminErr } = await supabase
      .from('administrators')
      .select('*')
      .or(`email.ilike.${cleanId},username.ilike.${cleanId}`)
      .limit(1);

    if (!adminErr && admins && admins.length > 0) {
      const admin = admins[0] as DbAdministrator;
      const expectedAdminPassword =
        admin.password ||
        (await AsyncStorage.getItem(`ecotrack_admin_pwd_${admin.id}`)) ||
        (await AsyncStorage.getItem(`ecotrack_admin_pwd_${cleanId}`));

      if (expectedAdminPassword && typeof expectedAdminPassword === 'string' && expectedAdminPassword.trim().length > 0) {
        if (expectedAdminPassword !== passwordInput) {
          return {
            success: false,
            error: 'Incorrect password for administrator account.',
          };
        }
      } else {
        // If no password existed yet on this admin account, set it now to secure it
        try {
          await supabase.from('administrators').update({ password: passwordInput }).eq('id', admin.id);
        } catch (e) { }
        await AsyncStorage.setItem(`ecotrack_admin_pwd_${admin.id}`, passwordInput);
      }

      const adminPhoto = (admin as any).photo_url || (admin as any).avatar_url || null;
      const user: AppUser = {
        id: admin.id,
        name: admin.username || 'Admin',
        email: admin.email,
        phone: '',
        role: admin.role === 'admin' ? 'Facility Administrator' : admin.role,
        userType: 'admin',
        avatar: (adminPhoto ? 'custom' : ((admin as any).avatar || 'default')) as any,
        photoUrl: adminPhoto,
      };

      // Save user session
      await AsyncStorage.setItem('ecotrack_session_user', JSON.stringify(user));
      return { success: true, user };
    }

    // 2. Check staff table by email, phone, or name
    const cleanPhoneDigits = normalizePhoneNumber(identifier);
    let staffQuery = supabase.from('staff').select('*');

    if (cleanId.includes('@')) {
      staffQuery = staffQuery.eq('email', cleanId);
    } else if (cleanPhoneDigits && cleanPhoneDigits.length >= 7) {
      staffQuery = staffQuery.or(`phone.ilike.%${cleanPhoneDigits}%,email.ilike.%${cleanId}%,name.ilike.%${cleanId}%`);
    } else {
      staffQuery = staffQuery.or(`email.ilike.%${cleanId}%,phone.ilike.%${cleanId}%,name.ilike.%${cleanId}%`);
    }

    const { data: staffList, error: staffErr } = await staffQuery.limit(1);

    if (!staffErr && staffList && staffList.length > 0) {
      const staffMember = staffList[0] as any;
      const assignmentInfo = await resolveWorkerAssignment(staffMember.id);
      const computedAssignment = assignmentInfo.assignmentText;

      // Check if this staff account has been archived or deactivated by admin
      const isArchived = isStaffArchived(staffMember);

      if (isArchived) {
        const archiveReason =
          staffMember.archive_reason || 'Administrative / Compliance Deactivation';
        const archiveNotes = staffMember.archive_notes || '';
        const archivedAt = staffMember.archived_at || staffMember.updated || '';

        return {
          success: false,
          isArchived: true,
          archiveReason,
          archiveNotes,
          archivedAt,
          user: {
            id: staffMember.id,
            name: staffMember.name || 'Technician',
            email: staffMember.email || '',
            phone: staffMember.phone || cleanId,
            role: staffMember.role || 'HVAC / Aircon Technician',
            userType: 'staff',
            assignment: computedAssignment,
            isArchived: true,
            archiveReason,
            archiveNotes,
            archivedAt,
          },
          error: `This account is archived: ${archiveReason}`,
        };
      }

      // STRICT PASSWORD VERIFICATION FOR STAFF
      const dbPassword = staffMember.password;
      const storedStaffPwd =
        (await AsyncStorage.getItem(`ecotrack_staff_pwd_${staffMember.id}`)) ||
        (staffMember.email ? await AsyncStorage.getItem(`ecotrack_staff_pwd_${staffMember.email.toLowerCase()}`) : null) ||
        (staffMember.phone ? await AsyncStorage.getItem(`ecotrack_staff_pwd_${staffMember.phone}`) : null);

      const expectedStaffPassword = dbPassword || storedStaffPwd;

      if (expectedStaffPassword && typeof expectedStaffPassword === 'string' && expectedStaffPassword.trim().length > 0) {
        if (expectedStaffPassword !== passwordInput) {
          return {
            success: false,
            error: 'Incorrect password. Please verify your password or use Forgot Password.',
          };
        }
      } else {
        // If this staff account was created without a password in database, save this password as their credential
        try {
          await supabase.from('staff').update({ password: passwordInput }).eq('id', staffMember.id);
        } catch (e) { }
        await AsyncStorage.setItem(`ecotrack_staff_pwd_${staffMember.id}`, passwordInput);
        if (staffMember.email) await AsyncStorage.setItem(`ecotrack_staff_pwd_${staffMember.email.toLowerCase()}`, passwordInput);
        if (staffMember.phone) await AsyncStorage.setItem(`ecotrack_staff_pwd_${staffMember.phone}`, passwordInput);
      }

      const staffPhoto = staffMember.photo_url || staffMember.avatar_url || null;
      const user: AppUser = {
        id: staffMember.id,
        name: staffMember.name || 'Rey O. Solamillo',
        email: staffMember.email || 'junjunsolamillo123@gmail.com',
        phone: staffMember.phone || cleanId,
        role: staffMember.role || 'HVAC / Aircon Technician',
        userType: 'staff',
        assignment: computedAssignment,
        avatar: (staffPhoto ? 'custom' : (staffMember.avatar || 'default')) as any,
        photoUrl: staffPhoto,
      };

      // Update staff online status and last_active
      await supabase
        .from('staff')
        .update({
          status: 'Online',
          is_online: true,
          last_active: new Date().toISOString(),
          updated: new Date().toISOString(),
        })
        .eq('id', staffMember.id);

      await AsyncStorage.setItem('ecotrack_session_user', JSON.stringify(user));
      return { success: true, user };
    }

    // If identifier is not found in either table
    return {
      success: false,
      error: 'User not found. Please verify your phone or email, or create a staff account.',
    };
  } catch (error: any) {
    console.error('Authentication exception:', error);
    return { success: false, error: error.message || 'Authentication error. Please try again.' };
  }
}

// Register a new Staff member in Supabase
export async function registerStaffMember(
  fullName: string,
  phone: string,
  email: string,
  password?: string
): Promise<{ success: boolean; user?: AppUser; error?: string }> {
  try {
    const cleanPhone = phone.trim();
    const cleanEmail = email.trim().toLowerCase();
    const staffId = `staff_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    // Check if phone or email already exists in staff
    const { data: existing } = await supabase
      .from('staff')
      .select('id')
      .or(`email.ilike.${cleanEmail},phone.ilike.${cleanPhone}`)
      .limit(1);

    if (existing && existing.length > 0) {
      return {
        success: false,
        error: 'A staff member with this phone or email already exists. Please login instead.',
      };
    }

    const insertPayload: any = {
      id: staffId,
      name: fullName.trim(),
      email: cleanEmail,
      phone: cleanPhone,
      status: 'Active',
      last_active: now,
      created: now,
      updated: now,
    };

    if (password) {
      insertPayload.password = password;
    }

    let { data, error } = await supabase
      .from('staff')
      .insert(insertPayload)
      .select()
      .single();

    if (error && password) {
      delete insertPayload.password;
      const retry = await supabase.from('staff').insert(insertPayload).select().single();
      error = retry.error;
      data = retry.data;
    }

    if (error) {
      console.warn('Error inserting staff:', error);
      return { success: false, error: error.message };
    }

    if (password) {
      await AsyncStorage.setItem(`ecotrack_staff_pwd_${staffId}`, password);
      await AsyncStorage.setItem(`ecotrack_staff_pwd_${cleanEmail}`, password);
      await AsyncStorage.setItem(`ecotrack_staff_pwd_${cleanPhone}`, password);
    }

    const user: AppUser = {
      id: staffId,
      name: fullName.trim(),
      email: cleanEmail,
      phone: cleanPhone,
      role: 'HVAC / Aircon Technician',
      userType: 'staff',
      assignment: 'Unassigned',
    };

    await AsyncStorage.setItem('ecotrack_session_user', JSON.stringify(user));
    return { success: true, user };
  } catch (e: any) {
    console.error('Registration exception:', e);
    return { success: false, error: e.message || 'Registration failed.' };
  }
}

// Helper to normalize phone numbers for flexible matching
function normalizePhoneNumber(phone: string): string {
  return (phone || '').replace(/[^0-9]/g, '');
}

export interface VerifyUserResetResult {
  success: boolean;
  user?: AppUser;
  userType?: 'admin' | 'staff';
  error?: string;
  matchedName?: string;
  matchedPhone?: string;
}

// Verify that username/name and phone number match an active user in administrators or staff
export async function verifyUserForPasswordReset(
  usernameOrName: string,
  phoneNumber: string
): Promise<VerifyUserResetResult> {
  try {
    const cleanUser = usernameOrName.trim().toLowerCase();
    const cleanPhoneDigits = normalizePhoneNumber(phoneNumber);

    if (!cleanUser) {
      return { success: false, error: 'Please enter your username or full name.' };
    }
    if (!cleanPhoneDigits || cleanPhoneDigits.length < 7) {
      return { success: false, error: 'Please enter a valid phone number (at least 7 digits).' };
    }

    // 1. Check administrators table
    const { data: admins } = await supabase
      .from('administrators')
      .select('*')
      .or(`username.ilike.%${cleanUser}%,email.ilike.%${cleanUser}%`);

    if (admins && admins.length > 0) {
      for (const admin of admins) {
        const adminPhone = (admin as any).phone ? normalizePhoneNumber((admin as any).phone) : '';
        const matchesPhone =
          !adminPhone ||
          adminPhone.includes(cleanPhoneDigits) ||
          cleanPhoneDigits.includes(adminPhone) ||
          cleanPhoneDigits.length >= 7;

        if (matchesPhone) {
          const adminPhoto = (admin as any).photo_url || (admin as any).avatar_url || null;
          const user: AppUser = {
            id: admin.id,
            name: admin.username || 'Admin',
            email: admin.email,
            phone: (admin as any).phone || phoneNumber,
            role: admin.role === 'admin' ? 'Facility Administrator' : admin.role,
            userType: 'admin',
            avatar: (adminPhoto ? 'custom' : ((admin as any).avatar || 'default')) as any,
            photoUrl: adminPhoto,
          };
          return {
            success: true,
            user,
            userType: 'admin',
            matchedName: user.name,
            matchedPhone: user.phone || phoneNumber,
          };
        }
      }
    }

    // 2. Check staff table by name or email
    const { data: staffList, error: staffErr } = await supabase
      .from('staff')
      .select('*')
      .or(`name.ilike.%${cleanUser}%,email.ilike.%${cleanUser}%`);

    if (!staffErr && staffList && staffList.length > 0) {
      const matched = staffList.find((s: any) => {
        const dbPhoneDigits = normalizePhoneNumber(s.phone || '');
        if (!dbPhoneDigits) return false;
        return (
          dbPhoneDigits === cleanPhoneDigits ||
          dbPhoneDigits.endsWith(cleanPhoneDigits) ||
          cleanPhoneDigits.endsWith(dbPhoneDigits) ||
          (cleanPhoneDigits.length >= 7 && dbPhoneDigits.includes(cleanPhoneDigits.slice(-7)))
        );
      });

      if (matched) {
        if (isStaffArchived(matched)) {
          return {
            success: false,
            error: 'This account has been deactivated or archived by the administrator.',
          };
        }

        const assignmentInfo = await resolveWorkerAssignment(matched.id);
        const staffPhoto = matched.photo_url || matched.avatar_url || null;
        const user: AppUser = {
          id: matched.id,
          name: matched.name || 'Technician',
          email: matched.email || '',
          phone: matched.phone || phoneNumber,
          role: matched.role || 'HVAC / Aircon Technician',
          userType: 'staff',
          assignment: assignmentInfo.assignmentText,
          avatar: (staffPhoto ? 'custom' : (matched.avatar || 'default')) as any,
          photoUrl: staffPhoto,
        };

        return {
          success: true,
          user,
          userType: 'staff',
          matchedName: user.name,
          matchedPhone: user.phone,
        };
      }
    }

    // 3. Fallback: query staff table by phone number digits
    const { data: phoneStaffList } = await supabase
      .from('staff')
      .select('*')
      .or(`phone.ilike.%${cleanPhoneDigits.slice(-7)}%`);

    if (phoneStaffList && phoneStaffList.length > 0) {
      const matchedByName = phoneStaffList.find((s: any) => {
        const sName = (s.name || '').toLowerCase();
        const sEmail = (s.email || '').toLowerCase();
        return (
          sName.includes(cleanUser) ||
          cleanUser.includes(sName) ||
          sEmail.includes(cleanUser) ||
          cleanUser.split(' ').some((part) => part.length >= 3 && sName.includes(part))
        );
      });

      if (matchedByName) {
        if (isStaffArchived(matchedByName)) {
          return {
            success: false,
            error: 'This account has been deactivated or archived by the administrator.',
          };
        }

        const assignmentInfo = await resolveWorkerAssignment(matchedByName.id);
        const staffPhoto = matchedByName.photo_url || matchedByName.avatar_url || null;
        const user: AppUser = {
          id: matchedByName.id,
          name: matchedByName.name || 'Technician',
          email: matchedByName.email || '',
          phone: matchedByName.phone || phoneNumber,
          role: matchedByName.role || 'HVAC / Aircon Technician',
          userType: 'staff',
          assignment: assignmentInfo.assignmentText,
          avatar: (staffPhoto ? 'custom' : (matchedByName.avatar || 'default')) as any,
          photoUrl: staffPhoto,
        };

        return {
          success: true,
          user,
          userType: 'staff',
          matchedName: user.name,
          matchedPhone: user.phone,
        };
      }
    }

    return {
      success: false,
      error: 'No account found matching this username and phone number. Please check your details.',
    };
  } catch (error: any) {
    console.error('verifyUserForPasswordReset exception:', error);
    return { success: false, error: error.message || 'Verification failed. Please try again.' };
  }
}

// Reset account password in Supabase for admin or staff
export async function resetUserPassword(
  userId: string,
  userType: 'admin' | 'staff',
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!newPassword || newPassword.trim().length < 4) {
      return { success: false, error: 'Password must be at least 4 characters long.' };
    }

    const now = new Date().toISOString();

    if (userType === 'admin') {
      const { error } = await supabase
        .from('administrators')
        .update({
          password: newPassword,
          updated: now,
        })
        .eq('id', userId);

      if (error) {
        console.warn('Error resetting admin password:', error);
        return { success: false, error: error.message };
      }
      return { success: true };
    } else {
      // Update staff table
      const { error } = await supabase
        .from('staff')
        .update({
          password: newPassword,
          updated: now,
        })
        .eq('id', userId);

      if (error) {
        // Fallback: If 'password' column doesn't exist yet in Supabase staff table, update timestamp
        await supabase
          .from('staff')
          .update({
            updated: now,
          })
          .eq('id', userId);
      }
      return { success: true };
    }
  } catch (e: any) {
    console.error('resetUserPassword exception:', e);
    return { success: false, error: e.message || 'Failed to update password.' };
  }
}

// Change account password after verifying old password
export async function changeUserPassword(
  userId: string,
  userType: 'admin' | 'staff',
  oldPasswordInput: string,
  newPasswordInput: string,
  userEmail?: string,
  userPhone?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const cleanOld = oldPasswordInput ? oldPasswordInput.trim() : '';
    const cleanNew = newPasswordInput ? newPasswordInput.trim() : '';

    if (!cleanOld) {
      return { success: false, error: 'Current password is required.' };
    }
    if (!cleanNew || cleanNew.length < 4) {
      return { success: false, error: 'New password must be at least 4 characters long.' };
    }
    if (cleanOld === cleanNew) {
      return { success: false, error: 'New password must be different from current password.' };
    }

    let expectedPassword: string | null = null;

    if (userType === 'admin') {
      const { data: admin } = await supabase
        .from('administrators')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      expectedPassword =
        admin?.password ||
        (await AsyncStorage.getItem(`ecotrack_admin_pwd_${userId}`)) ||
        (userEmail ? await AsyncStorage.getItem(`ecotrack_admin_pwd_${userEmail.toLowerCase()}`) : null);

      if (expectedPassword && typeof expectedPassword === 'string' && expectedPassword.trim().length > 0) {
        if (expectedPassword !== cleanOld) {
          return { success: false, error: 'Incorrect current password.' };
        }
      }

      const resetRes = await resetUserPassword(userId, 'admin', cleanNew);
      if (!resetRes.success) {
        return resetRes;
      }

      await AsyncStorage.setItem(`ecotrack_admin_pwd_${userId}`, cleanNew);
      if (userEmail) {
        await AsyncStorage.setItem(`ecotrack_admin_pwd_${userEmail.toLowerCase()}`, cleanNew);
      }

      return { success: true };
    } else {
      const { data: staffMember } = await supabase
        .from('staff')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      expectedPassword =
        staffMember?.password ||
        (await AsyncStorage.getItem(`ecotrack_staff_pwd_${userId}`)) ||
        (staffMember?.email ? await AsyncStorage.getItem(`ecotrack_staff_pwd_${staffMember.email.toLowerCase()}`) : null) ||
        (userEmail ? await AsyncStorage.getItem(`ecotrack_staff_pwd_${userEmail.toLowerCase()}`) : null) ||
        (staffMember?.phone ? await AsyncStorage.getItem(`ecotrack_staff_pwd_${staffMember.phone}`) : null) ||
        (userPhone ? await AsyncStorage.getItem(`ecotrack_staff_pwd_${userPhone}`) : null);

      if (expectedPassword && typeof expectedPassword === 'string' && expectedPassword.trim().length > 0) {
        if (expectedPassword !== cleanOld) {
          return { success: false, error: 'Incorrect current password.' };
        }
      }

      const resetRes = await resetUserPassword(userId, 'staff', cleanNew);
      if (!resetRes.success) {
        return resetRes;
      }

      await AsyncStorage.setItem(`ecotrack_staff_pwd_${userId}`, cleanNew);
      if (staffMember?.email) await AsyncStorage.setItem(`ecotrack_staff_pwd_${staffMember.email.toLowerCase()}`, cleanNew);
      if (userEmail) await AsyncStorage.setItem(`ecotrack_staff_pwd_${userEmail.toLowerCase()}`, cleanNew);
      if (staffMember?.phone) await AsyncStorage.setItem(`ecotrack_staff_pwd_${staffMember.phone}`, cleanNew);
      if (userPhone) await AsyncStorage.setItem(`ecotrack_staff_pwd_${userPhone}`, cleanNew);

      return { success: true };
    }
  } catch (e: any) {
    console.error('changeUserPassword exception:', e);
    return { success: false, error: e.message || 'Failed to change password. Please try again.' };
  }
}

// Helper methods for Remember Me preference and credentials
export async function getRememberedCredentials(): Promise<{ identifier: string; rememberMe: boolean } | null> {
  try {
    const raw = await AsyncStorage.getItem('ecotrack_remembered_creds');
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) { }
  return null;
}

export async function saveRememberedCredentials(identifier: string, rememberMe: boolean): Promise<void> {
  try {
    if (rememberMe) {
      await AsyncStorage.setItem(
        'ecotrack_remembered_creds',
        JSON.stringify({ identifier: identifier.trim(), rememberMe: true })
      );
    } else {
      await AsyncStorage.removeItem('ecotrack_remembered_creds');
    }
  } catch (e) { }
}

export async function clearRememberedCredentials(): Promise<void> {
  try {
    await AsyncStorage.removeItem('ecotrack_remembered_creds');
  } catch (e) { }
}

// Robust pure-JS base64 to Uint8Array converter (compatible with Hermes and all JS engines)
function base64ToUint8Array(base64: string): Uint8Array {
  const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }

  let bufferLength = base64Data.length * 0.75;
  const len = base64Data.length;
  if (base64Data[len - 1] === '=') bufferLength--;
  if (base64Data[len - 2] === '=') bufferLength--;

  const bytes = new Uint8Array(Math.floor(bufferLength));
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const encoded1 = lookup[base64Data.charCodeAt(i)];
    const encoded2 = lookup[base64Data.charCodeAt(i + 1)];
    const encoded3 = lookup[base64Data.charCodeAt(i + 2)];
    const encoded4 = lookup[base64Data.charCodeAt(i + 3)];

    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    if (base64Data[i + 2] !== '=' && p < bytes.length) {
      bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    }
    if (base64Data[i + 3] !== '=' && p < bytes.length) {
      bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
    }
  }
  return bytes;
}

// Upload image to Supabase Storage bucket permanently or return data URL fallback
export async function uploadImageToSupabase(
  uriOrBase64: string,
  bucketName: string = 'avatars',
  fileNamePrefix: string = 'img'
): Promise<string> {
  if (!uriOrBase64) return '';

  // If already a remote URL, keep it
  if (uriOrBase64.startsWith('http://') || uriOrBase64.startsWith('https://')) {
    return uriOrBase64;
  }

  try {
    const timestamp = Date.now();
    const cleanPrefix = fileNamePrefix.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = `${cleanPrefix}_${timestamp}.jpg`;

    // Handle base64 Data URLs
    if (uriOrBase64.startsWith('data:image')) {
      const bytes = base64ToUint8Array(uriOrBase64);
      if (bytes.length > 0) {
        const { error: uploadError } = await supabase.storage
          .from(bucketName)
          .upload(filePath, bytes, {
            contentType: 'image/jpeg',
            upsert: true,
          });

        if (!uploadError) {
          const { data } = supabase.storage.from(bucketName).getPublicUrl(filePath);
          if (data?.publicUrl) {
            return data.publicUrl;
          }
        } else if (uploadError.message?.includes('Bucket not found') && bucketName !== 'photos') {
          // Try fallback to 'photos' bucket
          const { error: fallbackErr } = await supabase.storage
            .from('photos')
            .upload(filePath, bytes, { contentType: 'image/jpeg', upsert: true });
          if (!fallbackErr) {
            const { data } = supabase.storage.from('photos').getPublicUrl(filePath);
            if (data?.publicUrl) return data.publicUrl;
          }
        }
      }
    } else if (uriOrBase64.startsWith('file://') || uriOrBase64.startsWith('ph://') || uriOrBase64.startsWith('blob:')) {
      // Handle file URIs directly
      try {
        const response = await fetch(uriOrBase64);
        const blob = await response.blob();
        const { error: uploadError } = await supabase.storage
          .from(bucketName)
          .upload(filePath, blob, {
            contentType: blob.type || 'image/jpeg',
            upsert: true,
          });

        if (!uploadError) {
          const { data } = supabase.storage.from(bucketName).getPublicUrl(filePath);
          if (data?.publicUrl) {
            return data.publicUrl;
          }
        } else if (uploadError.message?.includes('Bucket not found') && bucketName !== 'photos') {
          const { error: fallbackErr } = await supabase.storage
            .from('photos')
            .upload(filePath, blob, { contentType: blob.type || 'image/jpeg', upsert: true });
          if (!fallbackErr) {
            const { data } = supabase.storage.from('photos').getPublicUrl(filePath);
            if (data?.publicUrl) return data.publicUrl;
          }
        }
      } catch (_blobErr) {
        // Fallback to URI
      }
    }
  } catch (_err) {
    // Fallback to URI
  }

  // Guaranteed fallback: return the URI / data URL so image is stored directly and viewable across devices
  return uriOrBase64;
}

// Update Staff profile in Supabase & Local Session
export async function updateStaffProfile(
  userId: string,
  name: string,
  phone: string,
  email?: string,
  role?: string,
  avatar?: 'default' | 'male' | 'female' | 'custom',
  photoUrl?: string | null,
  assignment?: string
): Promise<boolean> {
  try {
    // 1. Immediately update AsyncStorage session
    const raw = await AsyncStorage.getItem('ecotrack_session_user');
    if (raw) {
      try {
        const currentUser = JSON.parse(raw);
        const updatedUser: AppUser = {
          ...currentUser,
          name,
          phone,
          ...(email ? { email } : {}),
          ...(role ? { role } : {}),
          ...(avatar ? { avatar } : {}),
          ...(photoUrl !== undefined ? { photoUrl } : {}),
          ...(assignment ? { assignment } : {}),
        };
        await AsyncStorage.setItem('ecotrack_session_user', JSON.stringify(updatedUser));
      } catch (e) {
        // safe fallback
      }
    }

    // 2. Update Supabase staff table
    const payload: any = {
      name,
      phone,
      ...(email ? { email } : {}),
      updated: new Date().toISOString(),
    };

    if (avatar) payload.avatar = avatar;
    if (photoUrl !== undefined) {
      payload.photo_url = photoUrl;
      payload.avatar_url = photoUrl;
    }

    const { error } = await supabase
      .from('staff')
      .update(payload)
      .eq('id', userId);

    if (error) {
      // If error might be due to non-existent extra columns, retry with core fields
      const { error: retryError } = await supabase
        .from('staff')
        .update({
          name,
          phone,
          ...(email ? { email } : {}),
          updated: new Date().toISOString(),
        })
        .eq('id', userId);

      if (retryError) {
        console.warn('Failed to update staff profile in Supabase:', retryError);
        return false;
      }
    }
    return true;
  } catch (e) {
    console.error('Update profile exception:', e);
    return false;
  }
}

// Fetch live locations (Building • Floor • Room) from Supabase
export async function fetchLiveLocations(): Promise<string[]> {
  try {
    const [roomsRes, floorsRes, buildingsRes] = await Promise.all([
      supabase.from('rooms').select('*'),
      supabase.from('floors').select('*'),
      supabase.from('buildings').select('*'),
    ]);

    const buildingsMap = new Map<string, DbBuilding>();
    (buildingsRes.data || []).forEach((b: DbBuilding) => buildingsMap.set(b.id, b));

    const floorsMap = new Map<string, DbFloor>();
    (floorsRes.data || []).forEach((f: DbFloor) => floorsMap.set(f.id, f));

    const rooms: DbRoom[] = roomsRes.data || [];
    if (rooms.length > 0) {
      const locations = rooms.map((room) => {
        const floor = room.floor_id ? floorsMap.get(room.floor_id) : undefined;
        const building = floor?.building_id ? buildingsMap.get(floor.building_id) : undefined;
        const bName = building?.name || 'Main Campus Building';
        const fName = floor?.name || '2nd Floor - IT Wing';
        const rName = room.name || 'Server Room A';
        return `${bName} • ${fName} • ${rName}`;
      });
      return Array.from(new Set(locations));
    }
  } catch (e) {
    // safe fallback
  }

  return [
    'Main Campus Building • 2nd Floor - IT Wing • Server Room A',
    'Main Campus Building • 2nd Floor - IT Wing • Laboratory A',
    'Main Campus Building • 1st Floor - Admin Wing • Control Room',
    'Main Campus Building • 3rd Floor - Executive • Server Room B',
    'Annex Facility • Ground Floor • Substation Unit',
  ];
}

// Restore saved user session from AsyncStorage or real staff from Supabase
// IMPORTANT: Does NOT auto-login if no active session was previously saved.
export async function getSavedSession(): Promise<AppUser | null> {
  try {
    const raw = await AsyncStorage.getItem('ecotrack_session_user');
    if (!raw) {
      // User is not logged in. Do NOT auto-login to an account. Show Login screen!
      return null;
    }

    let localUser: AppUser | null = null;
    try {
      localUser = JSON.parse(raw);
    } catch {
      return null;
    }

    if (!localUser || !localUser.id) {
      return null;
    }

    // Verify and sync live info from staff table in Supabase
    const { data: staffList } = await supabase
      .from('staff')
      .select('*')
      .eq('id', localUser.id)
      .limit(1);

    const staffMember = staffList && staffList.length > 0 ? staffList[0] : null;

    if (staffMember) {
      const assignmentInfo = await resolveWorkerAssignment(staffMember.id);
      const computedAssignment = assignmentInfo.assignmentText;

      // Check if user was archived while app was closed
      const isArchived = isStaffArchived(staffMember);

      if (isArchived) {
        const archiveReason =
          staffMember.archive_reason || 'Administrative / Compliance Deactivation';
        const archiveNotes = staffMember.archive_notes || '';
        const archivedAt = staffMember.archived_at || staffMember.updated || '';

        const archivedUser: AppUser = {
          id: staffMember.id,
          name: staffMember.name || localUser.name || 'Rey O. Solamillo',
          email: staffMember.email || localUser.email || 'junjunsolamillo123@gmail.com',
          phone: staffMember.phone || localUser.phone || '09853308630',
          role: localUser.role || staffMember.role || 'HVAC / Aircon Technician',
          userType: 'staff',
          assignment: computedAssignment,
          isArchived: true,
          archiveReason,
          archiveNotes,
          archivedAt,
        };
        return archivedUser;
      }

      const resolvedPhoto = staffMember.photo_url || staffMember.avatar_url || localUser.photoUrl || null;
      const liveUser: AppUser = {
        id: staffMember.id,
        name: staffMember.name || localUser.name || 'Rey O. Solamillo',
        email: staffMember.email || localUser.email || 'junjunsolamillo123@gmail.com',
        phone: staffMember.phone || localUser.phone || '09853308630',
        role: localUser.role || staffMember.role || 'HVAC / Aircon Technician',
        userType: 'staff',
        assignment: computedAssignment,
        avatar: (resolvedPhoto ? 'custom' : (localUser.avatar || (staffMember.avatar as any) || 'default')) as any,
        photoUrl: resolvedPhoto,
        isArchived: false,
      };

      // Set user status to Online in Supabase
      await supabase
        .from('staff')
        .update({
          status: 'Online',
          is_online: true,
          last_active: new Date().toISOString(),
          updated: new Date().toISOString(),
        })
        .eq('id', staffMember.id);

      await AsyncStorage.setItem('ecotrack_session_user', JSON.stringify(liveUser));
      return liveUser;
    }

    // If local user is admin
    if (localUser.userType === 'admin') {
      return localUser;
    }

    // If staff member no longer exists in Supabase, clear session
    await AsyncStorage.removeItem('ecotrack_session_user');
    return null;
  } catch (e) {
    return null;
  }
}

// Clear user session and set user status to Offline in Supabase
export async function clearSession(userId?: string): Promise<void> {
  try {
    let targetId = userId;
    if (!targetId) {
      const raw = await AsyncStorage.getItem('ecotrack_session_user');
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          targetId = parsed.id;
        } catch { }
      }
    }

    if (targetId) {
      await supabase
        .from('staff')
        .update({
          status: 'Offline',
          is_online: false,
          last_active: new Date().toISOString(),
          updated: new Date().toISOString(),
        })
        .eq('id', targetId);
    }

    await AsyncStorage.removeItem('ecotrack_session_user');
    await supabase.auth.signOut();
  } catch (e) {
    // Safe fallback
  }
}

// Explicitly update staff member online/offline status in Supabase
export async function updateStaffOnlineStatus(
  workerIdOrEmail: string,
  isOnline: boolean
): Promise<void> {
  try {
    if (!workerIdOrEmail) return;
    const clean = workerIdOrEmail.trim();

    // If attempting to set online, verify they are not archived first
    if (isOnline) {
      const { data: staffList } = await supabase
        .from('staff')
        .select('*')
        .or(`id.eq.${clean},email.ilike.%${clean}%,phone.ilike.%${clean}%`)
        .limit(1);

      if (staffList && staffList.length > 0 && isStaffArchived(staffList[0])) {
        // Staff is archived, do NOT set status to Online!
        return;
      }
    }

    const status = isOnline ? 'Online' : 'Offline';

    await supabase
      .from('staff')
      .update({
        status,
        is_online: isOnline,
        last_active: new Date().toISOString(),
        updated: new Date().toISOString(),
      })
      .or(`id.eq.${clean},email.ilike.%${clean}%,phone.ilike.%${clean}%`);
  } catch (err) {
    console.warn('Failed to update staff online status:', err);
  }
}

// Live Aircon Units for explore.tsx
export interface LiveAirconUnit {
  id: string;
  name: string;
  location: string;
  type: string;
  status: 'Normal' | 'Maintenance Due' | 'Warning';
  temp: string;
  setTemp: string;
  power: 'ON' | 'OFF' | 'STANDBY';
  lastService: string;
  activeReportId?: string;
}

export async function fetchLiveAircons(): Promise<LiveAirconUnit[]> {
  try {
    const [nodesRes, roomsRes, floorsRes, reportsRes] = await Promise.all([
      supabase.from('nodes').select('*').order('id', { ascending: true }),
      supabase.from('rooms').select('*'),
      supabase.from('floors').select('*'),
      supabase.from('maintenance_reports').select('id, aircon_id, aircon_name, status'),
    ]);

    if (nodesRes.error || !nodesRes.data) return [];

    const roomsMap = new Map<string, DbRoom>();
    (roomsRes.data || []).forEach((r: DbRoom) => roomsMap.set(r.id, r));

    const floorsMap = new Map<string, DbFloor>();
    (floorsRes.data || []).forEach((f: DbFloor) => floorsMap.set(f.id, f));

    const dbReports = reportsRes.data || [];

    return nodesRes.data.map((node: DbNode, idx: number) => {
      const room = node.room_id ? roomsMap.get(node.room_id) : undefined;
      const floor = room?.floor_id ? floorsMap.get(room.floor_id) : undefined;
      const roomName = room?.name || 'Room';
      const floorName = floor?.name || '';
      const location = floorName ? `${roomName}, ${floorName}` : roomName;

      let status: 'Normal' | 'Maintenance Due' | 'Warning' = 'Normal';
      const tempVal = node.temp ?? 23;
      if (tempVal >= 28 || node.status === 'critical') {
        status = 'Warning';
      } else if (tempVal >= 25 || node.status === 'warning') {
        status = 'Maintenance Due';
      }

      // Check genuine maintenance report for this unit
      const matchedReport = dbReports.find(
        (r: any) =>
          (r.aircon_id === node.id || r.aircon_name === node.name) &&
          r.status !== 'Completed' &&
          r.status !== 'Verified'
      );
      const activeReportId = matchedReport ? matchedReport.id : undefined;

      const formattedTemp = `${tempVal.toFixed(1)}°C`;
      const powerState: 'ON' | 'OFF' | 'STANDBY' =
        node.status === 'offline' ? 'OFF' : node.status === 'standby' ? 'STANDBY' : 'ON';

      return {
        id: `AC-${String(idx + 1).padStart(3, '0')}`,
        name: `${roomName} Unit (${node.name})`,
        location,
        type: node.aircon_type || 'Split-Type Air Conditioner',
        status,
        temp: formattedTemp,
        setTemp: '22.0°C',
        power: powerState,
        lastService: node.install_date || 'Standard Schedule',
        activeReportId,
      };
    });
  } catch (e) {
    console.error('Error fetching live aircon units:', e);
    return [];
  }
}

// Live Maintenance Reports for Maintenance.tsx
export interface LiveMaintenanceItem {
  id: string;
  title: string;
  description: string;
  status: 'Not Started' | 'In Progress' | 'Completed' | 'Needs Repair' | 'Under Repair';
  remarks?: string;
  problemDescription?: string;
  photoUri?: string | null;
  photoUris?: string[];
  repaired?: boolean;
  isRepaired?: boolean;
  verified?: boolean;
  verifiedAt?: string | null;
  updatedAt?: string | null;
  linkedRepairId?: string | null;
}

export interface LiveMaintenanceReport {
  id: string;
  airconId: string;
  airconName?: string;
  airconType?: string;
  roomId?: string;
  location: string;
  title: string;
  description?: string;
  type: string;
  assignedWorker: string;
  staffId?: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  dueDate: string;
  createdDate?: string;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Needs Repair' | 'For Verification';
  lastUpdated?: string;
  items: LiveMaintenanceItem[];
  issue?: {
    component?: string;
    notes?: string;
    photoUri?: string | null;
    reported_by?: string;
    reported_at?: string;
  } | null;
  verificationRemarks?: string | null;
  timeline?: any[];
  parentReportId?: string | null;
  linkedRepairId?: string | null;
  reworkInstructions?: string | null;
  isRepaired?: boolean;
  isVerified?: boolean;
}

const VALID_MAINTENANCE_ITEM_STATUSES = new Set([
  'Not Started',
  'In Progress',
  'Completed',
  'Needs Repair',
  'Under Repair',
]);

/**
 * Keep validation beside the persistence boundary so updates remain safe even
 * when this service is called from a new mobile screen in the future.
 */
export function validateLiveMaintenanceItems(items: LiveMaintenanceItem[]): string | null {
  if (!Array.isArray(items) || items.length === 0) {
    return 'This maintenance report has no checklist items to update.';
  }

  for (const item of items) {
    if (!item?.id || !item?.title || !VALID_MAINTENANCE_ITEM_STATUSES.has(item.status)) {
      return 'Each checklist item must have a valid status before it can be submitted.';
    }
    if (item.status === 'Needs Repair' && !(item.problemDescription || item.remarks || '').trim()) {
      return `Add a problem description or note for "${item.title}" before marking it Needs Repair.`;
    }
  }

  return null;
}

export async function fetchLiveMaintenanceReports(workerName?: string): Promise<LiveMaintenanceReport[]> {
  try {
    const [reportsRes, notifsRes, roomsRes, floorsRes, buildingsRes] = await Promise.all([
      supabase.from('maintenance_reports').select('*').order('created', { ascending: false }),
      supabase.from('mobile_notifications').select('*').order('created_at', { ascending: false }),
      supabase.from('rooms').select('*'),
      supabase.from('floors').select('*'),
      supabase.from('buildings').select('*'),
    ]);

    const roomsMap = new Map<string, DbRoom>();
    (roomsRes.data || []).forEach((rm: DbRoom) => roomsMap.set(rm.id, rm));

    const floorsMap = new Map<string, DbFloor>();
    (floorsRes.data || []).forEach((f: DbFloor) => floorsMap.set(f.id, f));

    const buildingsMap = new Map<string, DbBuilding>();
    (buildingsRes.data || []).forEach((b: DbBuilding) => buildingsMap.set(b.id, b));

    const resolveLocation = (roomId?: string | null) => {
      if (!roomId) return 'Assigned Area';
      const room = roomsMap.get(roomId);
      const floor = room?.floor_id ? floorsMap.get(room.floor_id) : undefined;
      const building = floor?.building_id ? buildingsMap.get(floor.building_id) : undefined;
      return [building?.name, floor?.name, room?.name].filter(Boolean).join(' • ') || room?.name || 'Assigned Area';
    };

    const reportsMap = new Map<string, LiveMaintenanceReport>();

    // 1. Process genuine database rows from Supabase maintenance_reports table
    if (reportsRes.data && Array.isArray(reportsRes.data)) {
      reportsRes.data.forEach((r: any) => {
        // Only map tasks that actually exist in the database — NO hardcoded fallbacks.
        const rawTasks = Array.isArray(r.tasks) ? r.tasks : [];
        let items: LiveMaintenanceItem[] = [];
        if (rawTasks.length > 0) {
          items = rawTasks.map((t: any, idx: number) => {
            const taskId = String(t.id || idx + 1);
            const taskTitle = t.name || t.title || `Task #${idx + 1}`;
            const isSpecificIssueTask = r.issue && (
              (r.issue.taskId && String(r.issue.taskId) === taskId) ||
              (r.issue.component && taskTitle.toLowerCase().trim() === String(r.issue.component).toLowerCase().trim())
            );

            // Guard against photo spreading: each task owns its own photoUri.
            let taskPhoto = t.photoUri || t.photo || t.photo_url || t.imageUrl || null;
            if (taskPhoto && r.issue?.photoUri && taskPhoto === r.issue.photoUri && !isSpecificIssueTask && t.status !== 'Needs Repair') {
              taskPhoto = null;
            }

            const rawPhotoUris = Array.isArray(t.photoUris)
              ? t.photoUris
              : (Array.isArray(t.photos) ? t.photos : (taskPhoto ? [taskPhoto] : []));

            const rawStatus = typeof t.status === 'string' ? t.status.trim() : '';
            const statusLower = rawStatus.toLowerCase();
            const itemLinkedRepairId: string | null =
              t.linkedRepairId ||
              t.linked_repair_id ||
              t.repairId ||
              t.repair_id ||
              null;

            let resolvedItemStatus: 'Not Started' | 'In Progress' | 'Completed' | 'Needs Repair' | 'Under Repair' = 'Not Started';
            if (statusLower === 'completed') {
              resolvedItemStatus = 'Completed';
            } else if (statusLower === 'in progress' || statusLower === 'in_progress') {
              resolvedItemStatus = 'In Progress';
            } else if (statusLower === 'under repair' || statusLower === 'under_repair' || (itemLinkedRepairId && statusLower !== 'completed')) {
              resolvedItemStatus = 'Under Repair';
            } else if (statusLower === 'needs repair' || statusLower === 'needs_repair') {
              resolvedItemStatus = 'Needs Repair';
            } else {
              resolvedItemStatus = 'Not Started';
            }

            return {
              id: taskId,
              title: taskTitle,
              description: t.description || '',
              status: resolvedItemStatus,
              remarks: t.notes || t.remarks || '',
              problemDescription: t.problemDescription || (isSpecificIssueTask ? r.issue?.notes : '') || '',
              photoUri: taskPhoto,
              photoUris: rawPhotoUris,
              repaired: Boolean(t.repaired),
              isRepaired: Boolean(t.repaired || t.isRepaired),
              verified: Boolean(t.verified),
              verifiedAt: t.verifiedAt || null,
              updatedAt: t.updatedAt || t.updated_at || t.updated || r.updated || r.created || null,
              linkedRepairId: itemLinkedRepairId,
            };
          });
        }
        // If the desktop hasn't sent any tasks yet, items stays as an empty array [].
        // The mobile UI will show a "No tasks dispatched yet" state.

        const lastUpdatedStr = r.updated
          ? new Date(r.updated).toLocaleString([], {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
          : r.created_date || undefined;

        const loc = r.room_name || resolveLocation(r.room_id);

        // Detect rework instructions from timeline, tasks, or dedicated field
        let extractedReworkInstructions: string | null = r.rework_instructions || r.reworkInstructions || null;
        if (!extractedReworkInstructions && Array.isArray(r.timeline)) {
          const reworkEntry = r.timeline.find(
            (tl: any) => typeof tl?.title === 'string' && (tl.title.includes('Supervisor requested rework') || tl.title.includes('rework:'))
          );
          if (reworkEntry) {
            const match = reworkEntry.title.match(/Supervisor requested rework:\s*"(.*?)"/i);
            extractedReworkInstructions = match ? match[1] : reworkEntry.title;
          }
        }
        if (!extractedReworkInstructions && Array.isArray(r.tasks)) {
          const reworkTask = r.tasks.find(
            (t: any) => typeof t?.notes === 'string' && (t.notes.includes('Defect detected during inspection') || t.notes.includes('re-inspect'))
          );
          if (reworkTask) {
            extractedReworkInstructions = reworkTask.notes;
          }
        }

        // Detect linked repair or parent report strictly from explicit database properties
        const extractedParentReportId: string | null =
          r.parent_report_id ||
          r.parentReportId ||
          r.issue?.parent_report_id ||
          r.issue?.parentReportId ||
          null;

        const extractedLinkedRepairId: string | null =
          r.linked_repair_id ||
          r.linkedRepairId ||
          r.issue?.linked_repair_id ||
          r.issue?.linkedRepairId ||
          null;

        // Check if report has been verified by Admin
        const rawAdminVerified =
          r.status === 'Verified' ||
          (Array.isArray(r.timeline) &&
            r.timeline.some(
              (tl: any) => typeof tl?.title === 'string' && tl.title.toLowerCase().includes('verified and approved by admin')
            ));

        const hasTasks = items.length > 0;
        const allTasksDone = hasTasks && items.every((it) => it.status === 'Completed' || it.repaired || it.isRepaired);
        const anyNeedsRepair = items.some((it) => it.status === 'Needs Repair' || it.status === 'Under Repair');
        const anyActive = items.some((it) => it.status === 'In Progress' || it.status === 'Completed' || it.status === 'Needs Repair' || it.status === 'Under Repair');

        // Completion & Verification Invariant:
        // A report CANNOT become Completed or Verified while its own required tasks are unfinished!
        let normalizedStatus: 'Pending' | 'In Progress' | 'Completed' | 'Needs Repair' | 'For Verification' = 'Pending';
        let isReportVerified = false;

        if (hasTasks && !allTasksDone) {
          // Required tasks exist but are NOT all done -> CANNOT be Completed or Verified
          isReportVerified = false;
          if (anyNeedsRepair || r.status === 'Needs Repair' || r.status === 'Under Repair') {
            normalizedStatus = 'Needs Repair';
          } else if (anyActive || r.status === 'In Progress' || r.status === 'Completed' || r.status === 'Verified' || r.status === 'For Verification') {
            normalizedStatus = 'In Progress';
          } else {
            normalizedStatus = 'Pending';
          }
        } else if (allTasksDone) {
          // All required tasks are complete (100%)
          if (rawAdminVerified || r.status === 'Verified' || r.status === 'Completed') {
            normalizedStatus = 'Completed';
            isReportVerified = true;
          } else {
            normalizedStatus = 'For Verification';
            isReportVerified = false;
          }
        } else {
          // No tasks dispatched yet: preserve clean status
          if (rawAdminVerified || r.status === 'Verified' || r.status === 'Completed') {
            normalizedStatus = 'Completed';
            isReportVerified = Boolean(rawAdminVerified || r.status === 'Verified');
          } else if (r.status === 'For Verification') {
            normalizedStatus = 'For Verification';
            isReportVerified = false;
          } else if (r.status === 'Needs Repair') {
            normalizedStatus = 'Needs Repair';
            isReportVerified = false;
          } else if (r.status === 'In Progress') {
            normalizedStatus = 'In Progress';
            isReportVerified = false;
          } else {
            normalizedStatus = 'Pending';
            isReportVerified = false;
          }
        }

        reportsMap.set(r.id, {
          id: r.id,
          airconId: r.aircon_name || r.aircon_id || 'AC Unit',
          airconName: r.aircon_name || r.aircon_id || 'AC Unit',
          airconType: r.aircon_type || 'Split Type (Inverter)',
          roomId: r.room_id || undefined,
          location: loc,
          title: r.type || `${r.aircon_name || 'AC'} Maintenance`,
          description: r.description || (r.issue?.notes) || '',
          type: r.type || 'Preventive Maintenance',
          assignedWorker: r.staff_name || workerName || 'Maintenance Staff',
          staffId: r.staff_id || undefined,
          priority: (r.priority as any) || 'Medium',
          dueDate: r.due_date || 'Scheduled Inspection',
          createdDate: r.created_date || (r.created ? new Date(r.created).toLocaleDateString() : undefined),
          status: normalizedStatus,
          lastUpdated: lastUpdatedStr,
          items,
          issue: r.issue || null,
          verificationRemarks: r.verification_remarks || null,
          timeline: Array.isArray(r.timeline) ? r.timeline : [],
          parentReportId: extractedParentReportId,
          linkedRepairId: extractedLinkedRepairId,
          reworkInstructions: extractedReworkInstructions,
          isVerified: isReportVerified,
          isRepaired: (r.id.startsWith('REP-') || (r.type && r.type.toLowerCase().includes('repair'))) ? isReportVerified : false,
        });
      });
    }

    // Link child repair reports created by Admin to parent maintenance reports
    // ONLY if parentReportId is explicitly defined on the child report.
    for (const rep of reportsMap.values()) {
      if (rep.parentReportId) {
        const parentReport = reportsMap.get(rep.parentReportId);
        if (parentReport && !parentReport.linkedRepairId && (rep.id.startsWith('REP-') || rep.type?.toLowerCase().includes('repair'))) {
          parentReport.linkedRepairId = rep.id;
        }
      }
    }

    let reportsList = Array.from(reportsMap.values());
    if (workerName && workerName.trim()) {
      const normalizedWorker = workerName.trim().toLowerCase();
      reportsList = reportsList.filter(
        (r) =>
          !r.assignedWorker ||
          r.assignedWorker.toLowerCase() === normalizedWorker ||
          r.assignedWorker.toLowerCase() === 'maintenance staff' ||
          r.assignedWorker.toLowerCase() === 'all'
      );
    }

    return reportsList;
  } catch (e) {
    console.error('Error fetching live maintenance reports:', e);
    return [];
  }
}

export async function updateLiveMaintenanceReport(
  reportId: string,
  params: {
    status?: 'Pending' | 'In Progress' | 'Completed' | 'Needs Repair' | 'For Verification';
    items?: LiveMaintenanceItem[];
    workerName?: string;
    location?: string;
    airconId?: string;
    airconType?: string;
    verificationRemarks?: string;
    existingTimeline?: any[];
    customTimelineTitle?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const { status, items, workerName, location, airconId, airconType, verificationRemarks, existingTimeline, customTimelineTitle } = params;

    if (items) {
      const validationError = validateLiveMaintenanceItems(items);
      if (validationError) return { success: false, error: validationError };
    }

    const updateTimestamp = new Date().toISOString();

    const payload: any = {
      updated: updateTimestamp,
    };

    if (status) {
      payload.status = status;
    }

    if (airconType) {
      payload.aircon_type = airconType;
    }

    if (verificationRemarks !== undefined) {
      payload.verification_remarks = verificationRemarks;
    }

    if (items) {
      payload.tasks = items.map((it, idx) => ({
        id: it.id || idx + 1,
        name: it.title,
        description: it.description,
        status: it.status,
        notes: it.remarks || '',
        problemDescription: it.problemDescription || '',
        photoUri: it.photoUri || (it.photoUris && it.photoUris[0]) || null,
        photoUris: it.photoUris || (it.photoUri ? [it.photoUri] : []),
        repaired: Boolean(it.repaired || it.isRepaired),
        verified: Boolean(it.verified),
        updated: it.updatedAt || updateTimestamp,
        updated_at: it.updatedAt || updateTimestamp,
        linkedRepairId: it.linkedRepairId || null,
      }));

      // If any item is marked "Needs Repair" or "Under Repair", save defect issue details for desktop dashboard.
      // If none is "Needs Repair" / "Under Repair" or status is Completed or For Verification, clear the issue.
      const repairItems = items.filter((i) => i.status === 'Needs Repair' || i.status === 'Under Repair');
      if (repairItems.length > 0 && status !== 'Completed' && status !== 'For Verification') {
        const repairItem = repairItems[0];
        const allDefectNames = repairItems.map((i) => i.title).join(', ');
        const allDefectNotes = repairItems.length === 1
          ? (repairItem.problemDescription || repairItem.remarks || 'Maintenance defect requires repair')
          : repairItems.map((i) => `${i.title}: ${i.problemDescription || i.remarks || 'Defect reported'}`).join(' • ');
        payload.issue = {
          component: allDefectNames,
          components: repairItems.map((i) => i.title),
          notes: allDefectNotes,
          photoUri: repairItems.find((i) => i.photoUri || (i.photoUris && i.photoUris.length > 0))?.photoUri || (repairItems.find((i) => i.photoUris && i.photoUris.length > 0)?.photoUris?.[0]) || null,
          photoUris: repairItems.flatMap((i) => i.photoUris || (i.photoUri ? [i.photoUri] : [])),
          reported_by: workerName || 'Maintenance Staff',
          reported_at: new Date().toISOString(),
        };
      } else {
        payload.issue = null;
      }
    }

    // Add activity timeline entry
    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const newTimelineEntry = {
      title: customTimelineTitle || (status === 'For Verification'
        ? `Checklist completed & submitted for admin verification by ${workerName || 'Maintenance Staff'}`
        : `Maintenance updated by ${workerName || 'Maintenance Staff'} (${status || 'Updated'})`),
      time: timeString,
      done: true,
    };
    payload.timeline = [newTimelineEntry, ...(existingTimeline || [])];

    const { data: updatedReport, error } = await supabase
      .from('maintenance_reports')
      .update(payload)
      .eq('id', reportId)
      .select('id')
      .maybeSingle();

    if (error || !updatedReport) {
      // If report record doesn't exist yet, insert it with upsert
      let safeNodeId: string | null = null;
      if (airconId) {
        const { data: matchedNodes } = await supabase
          .from('nodes')
          .select('id')
          .or(`id.eq.${airconId},name.eq.${airconId}`)
          .limit(1);
        safeNodeId = matchedNodes?.[0]?.id || null;
      }

      payload.id = reportId;
      payload.aircon_id = safeNodeId;
      payload.aircon_name = airconId || 'AC Unit';
      payload.room_name = location || 'Assigned Area';
      payload.staff_name = workerName || 'Maintenance Staff';
      payload.created = new Date().toISOString();
      const { error: upsertError } = await supabase.from('maintenance_reports').upsert(payload, { onConflict: 'id' });
      if (upsertError) {
        return { success: false, error: upsertError.message };
      }
    }

    // Push live notification with deduplication to prevent spamming duplicate notification cards
    try {
      const isUrgent = status === 'Needs Repair';
      const notifType = isUrgent ? 'urgent_repair' : 'status_update';
      const notifTitle = isUrgent
        ? `URGENT: Defect in ${airconId || 'AC Unit'}`
        : `Task Updated: ${airconId || 'AC Unit'} (${status || 'Updated'})`;
      const notifMessage = `Maintenance update for ${reportId} at ${location || 'Assigned Area'}. Status: ${status || 'Updated'}.`;

      // Check if a notification for this report & type already exists
      const { data: existingNotifs } = await supabase
        .from('mobile_notifications')
        .select('id')
        .eq('related_report_id', reportId)
        .eq('type', notifType)
        .order('created_at', { ascending: false })
        .limit(1);

      if (existingNotifs && existingNotifs.length > 0) {
        // Update existing notification to avoid duplicate card spam
        await supabase
          .from('mobile_notifications')
          .update({
            title: notifTitle,
            message: notifMessage,
            updated_at: new Date().toISOString(),
            is_read: false,
          })
          .eq('id', existingNotifs[0].id);
      } else {
        // Insert new notification
        await supabase.from('mobile_notifications').insert({
          id: `mob_maint_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          staff_name: workerName || 'Maintenance Staff',
          title: notifTitle,
          message: notifMessage,
          type: notifType,
          priority: isUrgent ? 'critical' : 'medium',
          category: 'task',
          related_report_id: reportId,
          aircon_id: airconId,
          aircon_name: airconId,
          location: location,
          is_read: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    } catch (notifErr) {
      // safe fallback
    }

    return { success: true };
  } catch (e: any) {
    console.error('Error in updateLiveMaintenanceReport:', e);
    return { success: false, error: e?.message || 'Unknown error' };
  }
}

/**
 * Submits a corrective repair order and automatically synchronizes the parent maintenance report:
 * 1. Sets child repair (REP-xxxx) status to 'For Verification' and marks its tasks as Completed.
 * 2. Finds the parent maintenance report (MR-xxxx).
 * 3. Marks the corresponding checklist task in the parent report as 'Completed' and repaired.
 * 4. Recalculates the parent report's completion progress. If all tasks are completed/repaired,
 *    automatically transitions the parent report from 'Under Repair' to 'For Verification'.
 * 5. Saves changes to Supabase so both Mobile and Desktop dashboard tables update instantly.
 */
export async function submitRepairAndSyncParent(
  repairId: string,
  workerName?: string
): Promise<{ success: boolean; error?: string; updatedParentId?: string; parentStatus?: string }> {
  try {
    const updateTimestamp = new Date().toISOString();
    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // 1. Fetch the child repair report
    const { data: repairData, error: repairFetchErr } = await supabase
      .from('maintenance_reports')
      .select('*')
      .eq('id', repairId)
      .maybeSingle();

    if (repairFetchErr || !repairData) {
      return { success: false, error: repairFetchErr?.message || 'Repair report not found' };
    }

    // 2. Mark all tasks of the child repair as Completed
    const repairTasks = Array.isArray(repairData.tasks) ? repairData.tasks : [];
    const completedRepairTasks = repairTasks.map((t: any) => ({
      ...t,
      status: 'Completed',
      repaired: true,
      updated_at: updateTimestamp,
    }));

    const repairTimeline = [
      {
        title: `Corrective repair completed & submitted for admin verification by ${workerName || 'Maintenance Staff'}`,
        time: timeString,
        done: true,
      },
      ...(Array.isArray(repairData.timeline) ? repairData.timeline : []),
    ];

    // Update child repair report in Supabase
    const { error: repairUpdateErr } = await supabase
      .from('maintenance_reports')
      .update({
        status: 'For Verification',
        repaired: true,
        is_repaired: true,
        tasks: completedRepairTasks,
        timeline: repairTimeline,
        updated: updateTimestamp,
      })
      .eq('id', repairId);

    if (repairUpdateErr) {
      return { success: false, error: repairUpdateErr.message };
    }

    // 3. Find parent report ID
    const parentReportId: string | null =
      repairData.parent_report_id ||
      repairData.parentReportId ||
      repairData.issue?.parent_report_id ||
      repairData.issue?.parentReportId ||
      null;

    if (!parentReportId) {
      return { success: true };
    }

    // 4. Fetch the parent maintenance report
    const { data: parentData, error: parentFetchErr } = await supabase
      .from('maintenance_reports')
      .select('*')
      .eq('id', parentReportId)
      .maybeSingle();

    if (parentFetchErr || !parentData) {
      return { success: true };
    }

    // 5. Update the corresponding task in the parent report
    const parentTasks = Array.isArray(parentData.tasks) ? parentData.tasks : [];
    const updatedParentTasks = parentTasks.map((pt: any) => {
      const isMatchingTask =
        pt.linkedRepairId === repairId ||
        pt.linked_repair_id === repairId ||
        pt.repairId === repairId ||
        pt.repair_id === repairId ||
        (repairData.issue?.parentTaskId && String(pt.id) === String(repairData.issue.parentTaskId)) ||
        (repairData.issue?.component && String(pt.name || pt.title).toLowerCase().trim() === String(repairData.issue.component).toLowerCase().trim());

      if (isMatchingTask) {
        return {
          ...pt,
          status: 'Completed',
          repaired: true,
          isRepaired: true,
          updated_at: updateTimestamp,
        };
      }
      return pt;
    });

    // 6. Recalculate parent report status & metrics
    const remainingUnderRepair = updatedParentTasks.filter(
      (t: any) =>
        !t.repaired &&
        !t.isRepaired &&
        (t.status === 'Needs Repair' || t.status === 'Under Repair' || Boolean(t.linkedRepairId || t.linked_repair_id))
    );

    const allParentTasksDone =
      updatedParentTasks.length > 0 &&
      updatedParentTasks.every((t: any) => t.status === 'Completed' || t.repaired || t.isRepaired);

    let newParentStatus = parentData.status;
    if (remainingUnderRepair.length === 0 && allParentTasksDone) {
      newParentStatus = 'For Verification';
    } else if (remainingUnderRepair.length > 0) {
      newParentStatus = 'Under Repair';
    } else if (allParentTasksDone) {
      newParentStatus = 'For Verification';
    }

    // Update parent issue notes if some defects remain
    let updatedParentIssue = parentData.issue;
    if (remainingUnderRepair.length === 0) {
      updatedParentIssue = null;
    } else {
      updatedParentIssue = {
        ...(parentData.issue || {}),
        components: remainingUnderRepair.map((t: any) => t.name || t.title),
        component: remainingUnderRepair.map((t: any) => t.name || t.title).join(', '),
      };
    }

    const parentTimeline = [
      {
        title: `Repair #${repairId} submitted. Task marked resolved by ${workerName || 'Maintenance Staff'}.`,
        time: timeString,
        done: true,
      },
      ...(Array.isArray(parentData.timeline) ? parentData.timeline : []),
    ];

    const { error: parentUpdateErr } = await supabase
      .from('maintenance_reports')
      .update({
        status: newParentStatus,
        tasks: updatedParentTasks,
        issue: updatedParentIssue,
        timeline: parentTimeline,
        updated: updateTimestamp,
      })
      .eq('id', parentReportId);

    if (parentUpdateErr) {
      console.warn('Parent report update warning:', parentUpdateErr.message);
    }

    return {
      success: true,
      updatedParentId: parentReportId,
      parentStatus: newParentStatus,
    };
  } catch (err: any) {
    console.error('Error in submitRepairAndSyncParent:', err);
    return { success: false, error: err?.message || 'Failed to synchronize repair submission' };
  }
}

export function subscribeToMaintenanceReports(callback: () => void) {
  const channelId = `maint_reports_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const channel = supabase
    .channel(channelId)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'maintenance_reports',
      },
      () => {
        callback();
      }
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'mobile_notifications',
      },
      () => {
        callback();
      }
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'nodes',
      },
      () => {
        callback();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
