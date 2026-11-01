import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, LiveMaintenanceReport, resolveNotificationEquipment } from './supabase';
import { NotificationEmitter } from '@/utils/notification-emitter';
import { functionalDeviceText } from './sensor-readings';

export async function registerMobilePushToken(preferences: { critical: boolean; maintenance: boolean }): Promise<boolean> {
  try {
    const { Platform } = require('react-native');
    const Constants = require('expo-constants').default;
    if (Platform.OS === 'web' || Constants.executionEnvironment === 'store-client' || Constants.appOwnership === 'expo' || !require('expo-device').isDevice) return false;
    const Notifications = require('expo-notifications');
    const permission = await Notifications.getPermissionsAsync();
    if (permission.status !== 'granted' && !(permission.ios?.status !== undefined && permission.ios.status === Notifications.IosAuthorizationStatus?.PROVISIONAL)) return false;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
    if (!projectId) return false;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const { error } = await supabase.rpc('ecotrack_register_push_token', {
      p_token: token, p_platform: Platform.OS, p_critical: preferences.critical, p_maintenance: preferences.maintenance,
    });
    if (error) return false;
    await AsyncStorage.setItem('ecotrack_expo_push_token', token);
    return true;
  } catch { return false; }
}


export type MobileNotificationType =
  | 'task_assigned'
  | 'task_reminder'
  | 'overdue_alert'
  | 'urgent_repair'
  | 'preventive_routine'
  | 'controller_alert'
  | 'sensor_alert'
  | 'status_update'
  | 'system';

export type MobileNotificationPriority = 'critical' | 'urgent' | 'high' | 'medium' | 'low';

export type MobileNotificationCategory = 'task' | 'maintenance' | 'device' | 'sensor' | 'system';

export interface MobileNotificationItem {
  id: string;
  eventKey?: string;
  staffId?: string;
  staffName: string;
  title: string;
  message: string;
  type: MobileNotificationType;
  priority: MobileNotificationPriority;
  category: MobileNotificationCategory;
  relatedReportId?: string;
  airconId?: string;
  airconName?: string;
  airconType?: string;
  controllerId?: string;
  controllerName?: string;
  protocolName?: string;
  roomId?: string;
  location?: string;
  dueDate?: string;
  verificationRemarks?: string;
  isRead: boolean;
  isSnoozed?: boolean;
  snoozeUntil?: string;
  createdAt: string;
  updatedAt?: string;
}

type NotificationStateAction = 'read' | 'unread' | 'archive' | 'snooze' | 'unsnooze';
export interface MobileNotificationStateChange {
  action: NotificationStateAction;
  /** Omitted only when the server marks all visible notifications read. */
  ids?: string[];
  snoozeUntil?: string;
}

const stateListeners = new Set<(change?: MobileNotificationStateChange) => void>();
let stateRevision = 0;
let stateUpdatePending = false;

export function getMobileNotificationStateRevision(): number { return stateRevision; }
export function isMobileNotificationStateUpdating(): boolean { return stateUpdatePending; }

function notifyStateListeners(change?: MobileNotificationStateChange) {
  stateListeners.forEach(listener => {
    try { listener(change); } catch (error) { console.warn('Notification listener failed:', error); }
  });
}

export function applyMobileNotificationState(
  items: MobileNotificationItem[], change: MobileNotificationStateChange
): MobileNotificationItem[] {
  const ids = change.ids ? new Set(change.ids) : null;
  return items.flatMap(item => {
    if (ids && !ids.has(item.id)) return [item];
    if (change.action === 'archive') return [];
    if (change.action === 'read' || change.action === 'unread') return [{ ...item, isRead: change.action === 'read' }];
    return [{ ...item, isSnoozed: change.action === 'snooze', snoozeUntil: change.snoozeUntil }];
  });
}

async function commitNotificationState(
  operation: () => Promise<boolean>, change: MobileNotificationStateChange
): Promise<boolean> {
  // Prevent overlapping read/unread operations from committing in an ambiguous order.
  if (stateUpdatePending) return false;
  stateUpdatePending = true;
  stateRevision++;
  notifyStateListeners();
  try {
    const ok = await operation();
    if (ok) {
      stateRevision++;
      notifyStateListeners(change);
    }
    return ok;
  } catch (error) {
    console.warn('Unable to update notification state:', error);
    return false;
  } finally {
    stateUpdatePending = false;
    stateRevision++;
    // Refresh from the per-recipient RPC after the commit, including uncertain failures.
    notifyStateListeners();
  }
}

export interface CreateMobileNotificationPayload {
  /** Stable event identifier reused on retry. */
  eventKey?: string;
  broadcast?: boolean;
  staffId?: string;
  staffName?: string;
  title: string;
  message: string;
  type?: MobileNotificationType;
  priority?: MobileNotificationPriority;
  category?: MobileNotificationCategory;
  relatedReportId?: string;
  airconId?: string;
  airconName?: string;
  airconType?: string;
  location?: string;
  dueDate?: string;
  verificationRemarks?: string;
}

function sanitizeNotificationText(text?: string): string {
  if (!text) return '';
  return functionalDeviceText(text)
    .replace(/maintenance\s+rework\s+dispatched/gi, 'Corrective Repair Dispatched')
    .replace(/maintenance\s+rework/gi, 'Corrective Repair')
    .replace(/rework\s+dispatched/gi, 'Corrective repair dispatched')
    .replace(/rework/gi, 'Corrective Repair')
    .replace(/^RWK-/i, 'REP-')
    .replace(/#RWK-/gi, '#REP-');
}

// Convert raw DB row to MobileNotificationItem
function mapDbToNotificationItem(row: any): MobileNotificationItem {
  let cleanType = (row.type as MobileNotificationType) || 'task_reminder';
  if ((row.type as string) === 'rework_assigned' || (row.type as string)?.includes('rework')) {
    cleanType = 'urgent_repair';
  }

  const rawTitle = row.title || 'System Notification';
  const rawMsg = row.message || '';
  const rawReportId = row.related_report_id || undefined;

  return {
    id: row.id,
    eventKey: row.event_key || undefined,
    staffId: row.staff_id || undefined,
    staffName: row.staff_name || 'Maintenance Staff',
    title: sanitizeNotificationText(rawTitle),
    message: sanitizeNotificationText(rawMsg),
    type: cleanType,
    priority: (row.priority as MobileNotificationPriority) || 'medium',
    category: (row.category as MobileNotificationCategory) || 'maintenance',
    relatedReportId: rawReportId ? rawReportId.replace(/^RWK-/i, 'REP-') : undefined,
    airconId: row.aircon_id || undefined,
    airconName: row.aircon_name || undefined,
    airconType: row.aircon_type || undefined,
    controllerId: row.controller_id || row.node_id || undefined,
    controllerName: row.controller_name || undefined,
    protocolName: row.protocol_name || undefined,
    roomId: row.room_id || undefined,
    location: row.location || undefined,
    dueDate: row.due_date || undefined,
    verificationRemarks: row.verification_remarks ? sanitizeNotificationText(row.verification_remarks) : undefined,
    isRead: Boolean(row.is_read),
    isSnoozed: Boolean(row.is_snoozed),
    snoozeUntil: row.snooze_until || undefined,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || undefined,
  };
}

// Deduplicate mobile notifications to prevent spam and repeated cards
export function deduplicateMobileNotifications(items: MobileNotificationItem[]): MobileNotificationItem[] {
  const seenIds = new Set<string>();
  const seenSignatures = new Set<string>();
  const deduplicated: MobileNotificationItem[] = [];

  const newestFirst = [...items].sort((a, b) =>
    (Date.parse(b.updatedAt || b.createdAt) || 0) - (Date.parse(a.updatedAt || a.createdAt) || 0)
  );
  for (const item of newestFirst) {
    if (!item.id || seenIds.has(item.id)) continue;
    seenIds.add(item.id);

    // Create a semantic signature to catch identical notifications dispatched repeatedly
    // (e.g. rapid consecutive checklist toggles for the same report & status)
    const reportKey = item.relatedReportId || item.airconId || 'noreport';
    const typeKey = item.type || 'notype';
    const titleKey = (item.title || '').trim().toLowerCase();
    const sig = item.eventKey
      ? JSON.stringify(['event', item.eventKey])
      : JSON.stringify([item.staffId || item.staffName, reportKey, typeKey, titleKey, item.message]);

    if (seenSignatures.has(sig)) {
      // Duplicate notification for same report and status event: keep only the newest one
      continue;
    }
    seenSignatures.add(sig);
    deduplicated.push(item);
  }

  return deduplicated;
}

export interface MobileNotificationCursor { createdAt: string; id: string }
export interface MobileNotificationPage {
  items: MobileNotificationItem[];
  nextCursor?: MobileNotificationCursor;
}

// The database resolves identity and recipient state from the authenticated JWT.
export async function fetchMobileNotificationPage(
  cursor?: MobileNotificationCursor,
  limit: number = 60
): Promise<MobileNotificationPage> {
  const pageSize = Math.min(100, Math.max(1, Math.trunc(Number.isFinite(limit) ? limit : 60)));
  const { data, error } = await supabase.rpc('ecotrack_list_notifications', {
    p_limit: pageSize,
    p_before_created_at: cursor?.createdAt || null,
    p_before_id: cursor?.id || null,
  });
  if (error) throw new Error(error.message || 'Unable to load notifications.');
  if (!data || !Array.isArray(data.items)) throw new Error('Invalid notification response.');
  return {
    items: data.items.map(mapDbToNotificationItem),
    nextCursor: data.next_cursor ? { createdAt: data.next_cursor.created_at, id: data.next_cursor.id } : undefined,
  };
}

// Retain the argument for existing screens. A display name grants no access.
export async function fetchLiveMobileNotifications(_staffName?: string): Promise<MobileNotificationItem[]> {
  const items: MobileNotificationItem[] = [];
  const cursors = new Set<string>();
  let cursor: MobileNotificationCursor | undefined;
  do {
    const page = await fetchMobileNotificationPage(cursor);
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor) {
      const key = JSON.stringify(cursor);
      if (cursors.has(key)) throw new Error('Notification pagination did not advance.');
      cursors.add(key);
    }
  } while (cursor);
  return resolveNotificationEquipment(items);
}

// Events are shared and immutable; historical deduplication requires an audited migration.
export async function cleanDuplicateDbNotifications(_staffName?: string): Promise<number> {
  return 0;
}

export function subscribeToIncomingNotifications(
  _userName: string | undefined,
  onNewNotification: (item: MobileNotificationItem) => void
) {
  const channelId = `incoming_notifs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  let disposed = false;
  const channel = supabase
    .channel(channelId)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'mobile_notifications' },
      (payload) => {
        const row = payload.new;
        if (!row) return;

        // Supabase Realtime applies the event table's recipient RLS policy.
        // Display names must not hide or authorize immutable staff-ID assignments.
        const item = mapDbToNotificationItem(row);
        if (!item.airconId && !item.airconName && !item.relatedReportId) onNewNotification(item);
        else void resolveNotificationEquipment([item]).then(items => {
          if (!disposed) onNewNotification(items[0]);
        }).catch(() => { if (!disposed) onNewNotification(item); });
      }
    )
    .subscribe();

  return () => {
    disposed = true;
    supabase.removeChannel(channel);
  };
}

export function subscribeToMobileNotifications(onUpdate: (change?: MobileNotificationStateChange) => void) {
  const channelId = `mobile_notifs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  stateListeners.add(onUpdate);
  const channel = supabase
    .channel(channelId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mobile_notifications' }, () => onUpdate())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mobile_notification_state' }, () => onUpdate())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'nodes' }, () => onUpdate())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'aircons' }, () => onUpdate())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => onUpdate())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'floors' }, () => onUpdate())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'buildings' }, () => onUpdate())
    .subscribe();
  return () => { stateListeners.delete(onUpdate); supabase.removeChannel(channel); };
}

async function setNotificationState(
  ids: string[], action: NotificationStateAction, minutes?: number
): Promise<boolean> {
  if (!ids.length || ids.some(id => !id?.trim()) || ids.length > 1000) return false;
  const uniqueIds = [...new Set(ids)];
  return commitNotificationState(async () => {
    const { data, error } = await supabase.rpc('ecotrack_set_notification_state', {
      p_ids: uniqueIds,
      p_action: action,
      p_snooze_minutes: minutes ?? null,
    });
    // The RPC validates the complete selection and commits it atomically.
    return !error && data === uniqueIds.length;
  }, {
    action, ids: uniqueIds,
    snoozeUntil: action === 'snooze' ? new Date(Date.now() + minutes! * 60000).toISOString() : undefined,
  });
}

export async function markMobileNotificationAsRead(id: string, isRead: boolean = true): Promise<boolean> {
  return setNotificationState([id], isRead ? 'read' : 'unread');
}

export async function markAllMobileNotificationsAsRead(_staffName?: string): Promise<boolean> {
  return commitNotificationState(async () => {
    const { data, error } = await supabase.rpc('ecotrack_mark_all_notifications_read');
    return !error && Number.isInteger(data) && data >= 0;
  }, { action: 'read' });
}

// Delete means archive only for the current recipient, including broadcasts.
export async function deleteMobileNotification(id: string): Promise<boolean> {
  return setNotificationState([id], 'archive');
}

export async function deleteMultipleMobileNotifications(ids: string[]): Promise<boolean> {
  if (!ids?.length) return true;
  return setNotificationState(ids, 'archive');
}

export async function snoozeMobileNotification(id: string, minutes: number = 60): Promise<boolean> {
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 10080) return false;
  return setNotificationState([id], 'snooze', minutes);
}

export async function unsnoozeMobileNotification(id: string): Promise<boolean> {
  return setNotificationState([id], 'unsnooze');
}

// Ad-hoc events are administrator-only. Maintenance events come from the transaction trigger.
export async function createMobileNotification(payload: CreateMobileNotificationPayload): Promise<boolean> {
  if (!payload.title?.trim() || !payload.message?.trim() || !payload.eventKey?.trim()) return false;
  if (payload.broadcast ? Boolean(payload.staffId) : !payload.staffId?.trim()) return false;
  try {
    const { data, error } = await supabase.rpc('ecotrack_create_notification', {
      p_payload: {
        event_key: payload.eventKey,
        staff_id: payload.staffId || null,
        is_broadcast: payload.broadcast === true,
        title: payload.title,
        message: payload.message,
        type: payload.type || 'task_reminder',
        priority: payload.priority || 'medium',
        category: payload.category || 'task',
        related_report_id: payload.relatedReportId || null,
        aircon_id: payload.airconId || null,
        aircon_name: payload.airconName || null,
        aircon_type: payload.airconType || null,
        location: payload.location || null,
        due_date: payload.dueDate || null,
        verification_remarks: payload.verificationRemarks || null,
      },
    });
    return !error && typeof data === 'string' && data.length > 0;
  } catch (error) {
    console.warn('Unable to create notification:', error);
    return false;
  }
}
// Foreground-only reminders. This does not schedule push or background delivery.
export async function checkAndDispatchMaintenanceReminders(
  _staffName: string,
  reports: LiveMaintenanceReport[]
): Promise<void> {
  try {
    if (!reports?.length) return;
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return;

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const storageKey = `ECO_LAST_REMINDED_${todayStr}_${data.user.id}`;

    // Prevent duplicate spamming on multiple rapid re-renders (check once per hour per day)
    const lastChecked = await AsyncStorage.getItem(storageKey);
    const lastTimestamp = lastChecked ? parseInt(lastChecked, 10) : 0;
    const cooldownMs = 45 * 60 * 1000; // 45 minutes cooldown between automated popups

    if (Date.now() - lastTimestamp < cooldownMs) {
      return;
    }

    // Reports were fetched under server-enforced assignment access. Names are display data.
    const userReports = reports;

    const urgentRepairs = userReports.filter((r) => r.status === 'Needs Repair');
    const overdueTasks = userReports.filter(
      (r) => r.dueDate && r.dueDate < todayStr && r.status !== 'Completed' && r.status !== 'For Verification'
    );
    const dueTodayTasks = userReports.filter(
      (r) => r.dueDate === todayStr && r.status !== 'Completed' && r.status !== 'For Verification'
    );

    // 1. Dispatch urgent repair warning if any
    if (urgentRepairs.length > 0) {
      const topRepair = urgentRepairs[0];
      NotificationEmitter.trigger(
        `URGENT: Repair Needed (${topRepair.airconName || topRepair.controllerName || 'Name unavailable'})`,
        `${topRepair.title} at ${topRepair.location} requires immediate repair attention.`,
        true
      );
      await AsyncStorage.setItem(storageKey, Date.now().toString());
      return;
    }

    // 2. Dispatch overdue warning if any
    if (overdueTasks.length > 0) {
      const topOverdue = overdueTasks[0];
      NotificationEmitter.trigger(
        `Overdue Maintenance Alert`,
        `Task "${topOverdue.title}" at ${topOverdue.location} was due on ${topOverdue.dueDate}. Please update checklist.`,
        true
      );
      await AsyncStorage.setItem(storageKey, Date.now().toString());
      return;
    }

    // 3. Dispatch task due today reminder
    if (dueTodayTasks.length > 0) {
      const topDue = dueTodayTasks[0];
      NotificationEmitter.trigger(
        `Maintenance Due Today`,
        `You have ${dueTodayTasks.length} task${dueTodayTasks.length > 1 ? 's' : ''} scheduled today: "${topDue.title}" at ${topDue.location}.`,
        false
      );
      await AsyncStorage.setItem(storageKey, Date.now().toString());
    }
  } catch (e) {
    console.warn('Error running maintenance reminder engine:', e);
  }
}
