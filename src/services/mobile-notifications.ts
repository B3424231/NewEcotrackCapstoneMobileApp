import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, LiveMaintenanceReport } from './supabase';
import { NotificationEmitter } from '@/utils/notification-emitter';

export type MobileNotificationType =
  | 'task_assigned'
  | 'task_reminder'
  | 'overdue_alert'
  | 'urgent_repair'
  | 'preventive_routine'
  | 'sensor_alert'
  | 'status_update'
  | 'system';

export type MobileNotificationPriority = 'critical' | 'urgent' | 'high' | 'medium' | 'low';

export type MobileNotificationCategory = 'task' | 'maintenance' | 'sensor' | 'system';

export interface MobileNotificationItem {
  id: string;
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
  location?: string;
  dueDate?: string;
  verificationRemarks?: string;
  isRead: boolean;
  isSnoozed?: boolean;
  snoozeUntil?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateMobileNotificationPayload {
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

// Convert raw DB row to MobileNotificationItem
function mapDbToNotificationItem(row: any): MobileNotificationItem {
  return {
    id: row.id,
    staffId: row.staff_id || undefined,
    staffName: row.staff_name || 'Maintenance Staff',
    title: row.title || 'System Notification',
    message: row.message || '',
    type: (row.type as MobileNotificationType) || 'task_reminder',
    priority: (row.priority as MobileNotificationPriority) || 'medium',
    category: (row.category as MobileNotificationCategory) || 'maintenance',
    relatedReportId: row.related_report_id || undefined,
    airconId: row.aircon_id || undefined,
    airconName: row.aircon_name || undefined,
    airconType: row.aircon_type || undefined,
    location: row.location || undefined,
    dueDate: row.due_date || undefined,
    verificationRemarks: row.verification_remarks || undefined,
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

  for (const item of items) {
    if (!item.id || seenIds.has(item.id)) continue;
    seenIds.add(item.id);

    // Create a semantic signature to catch identical notifications dispatched repeatedly
    // (e.g. rapid consecutive checklist toggles for the same report & status)
    const reportKey = item.relatedReportId || item.airconId || 'noreport';
    const typeKey = item.type || 'notype';
    const titleKey = (item.title || '').trim().toLowerCase();
    const sig = `${reportKey}__${typeKey}__${titleKey}`;

    if (seenSignatures.has(sig)) {
      // Duplicate notification for same report and status event: keep only the newest one
      continue;
    }
    seenSignatures.add(sig);
    deduplicated.push(item);
  }

  return deduplicated;
}

// Fetch live mobile notifications from Supabase
export async function fetchLiveMobileNotifications(staffName?: string): Promise<MobileNotificationItem[]> {
  try {
    let query = supabase
      .from('mobile_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(60);

    // If staffName is provided and not generic, filter for this staff or broadcast
    if (staffName && staffName.trim() && staffName !== 'All Staff') {
      query = query.or(`staff_name.eq.${staffName},staff_name.eq.All Staff,staff_name.is.null`);
    }

    const { data, error } = await query;

    if (!error && Array.isArray(data)) {
      const mapped = data.map(mapDbToNotificationItem);
      return deduplicateMobileNotifications(mapped);
    }

    if (error) {
      console.warn('Error fetching live mobile notifications from Supabase:', error.message);
    }

    return [];
  } catch (err) {
    console.warn('Error fetching live mobile notifications:', err);
    return [];
  }
}

// Clean up existing duplicate records in Supabase mobile_notifications table
export async function cleanDuplicateDbNotifications(): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('mobile_notifications')
      .select('*')
      .order('created_at', { ascending: false });

    if (error || !Array.isArray(data)) return 0;

    const seenSignatures = new Set<string>();
    const duplicateIds: string[] = [];

    for (const row of data) {
      const reportKey = row.related_report_id || row.aircon_id || 'noreport';
      const typeKey = row.type || 'notype';
      const titleKey = (row.title || '').trim().toLowerCase();
      const sig = `${reportKey}__${typeKey}__${titleKey}`;

      if (seenSignatures.has(sig)) {
        duplicateIds.push(row.id);
      } else {
        seenSignatures.add(sig);
      }
    }

    if (duplicateIds.length > 0) {
      await supabase.from('mobile_notifications').delete().in('id', duplicateIds);
      console.log(`Cleaned up ${duplicateIds.length} duplicate mobile notifications from DB`);
      return duplicateIds.length;
    }
    return 0;
  } catch (e) {
    console.warn('Error cleaning duplicate mobile notifications from DB:', e);
    return 0;
  }
}

// Real-time subscription to mobile_notifications table
export function subscribeToMobileNotifications(onUpdate: () => void) {
  const channelId = `mobile_notifs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const channel = supabase
    .channel(channelId)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'mobile_notifications',
      },
      () => {
        onUpdate();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// Mark single mobile notification as read / unread
export async function markMobileNotificationAsRead(id: string, isRead: boolean = true): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('mobile_notifications')
      .update({ is_read: isRead, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      console.warn('Failed to update notification read status in DB:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Error marking notification read:', e);
    return false;
  }
}

// Mark all notifications for staff as read
export async function markAllMobileNotificationsAsRead(staffName?: string): Promise<boolean> {
  try {
    let query = supabase
      .from('mobile_notifications')
      .update({ is_read: true, updated_at: new Date().toISOString() })
      .eq('is_read', false);

    if (staffName && staffName !== 'All Staff') {
      query = query.or(`staff_name.eq.${staffName},staff_name.eq.All Staff,staff_name.is.null`);
    }

    const { error } = await query;
    if (error) {
      console.warn('Failed to mark all notifications read in DB:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Error in markAllMobileNotificationsAsRead:', e);
    return false;
  }
}

// Delete notification
export async function deleteMobileNotification(id: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('mobile_notifications').delete().eq('id', id);
    if (error) {
      console.warn('Failed to delete notification in DB:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Error deleting mobile notification:', e);
    return false;
  }
}

// Delete multiple notifications in batch
export async function deleteMultipleMobileNotifications(ids: string[]): Promise<boolean> {
  try {
    if (!ids || ids.length === 0) return true;
    const { error } = await supabase.from('mobile_notifications').delete().in('id', ids);
    if (error) {
      console.warn('Failed to delete multiple notifications in DB:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Error deleting multiple mobile notifications:', e);
    return false;
  }
}

// Snooze notification reminder
export async function snoozeMobileNotification(id: string, minutes: number = 60): Promise<boolean> {
  try {
    const snoozeTime = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    const { error } = await supabase
      .from('mobile_notifications')
      .update({
        is_snoozed: true,
        snooze_until: snoozeTime,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) return false;
    return true;
  } catch (e) {
    console.error('Error snoozing notification:', e);
    return false;
  }
}

// Unsnooze / resume notification reminder
export async function unsnoozeMobileNotification(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('mobile_notifications')
      .update({
        is_snoozed: false,
        snooze_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) return false;
    return true;
  } catch (e) {
    console.error('Error unsnoozing notification:', e);
    return false;
  }
}

// Create a new mobile notification in Supabase
export async function createMobileNotification(payload: CreateMobileNotificationPayload): Promise<boolean> {
  try {
    const now = new Date();
    const notifId = `mob_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const { error } = await supabase.from('mobile_notifications').insert({
      id: notifId,
      staff_id: payload.staffId || null,
      staff_name: payload.staffName || 'Maintenance Staff',
      title: payload.title,
      message: payload.message,
      type: payload.type || 'task_reminder',
      priority: payload.priority || 'medium',
      category: payload.category || 'task',
      related_report_id: payload.relatedReportId || null,
      aircon_id: payload.airconId || null,
      aircon_name: payload.airconName || null,
      location: payload.location || null,
      due_date: payload.dueDate || null,
      is_read: false,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });

    if (error) {
      console.warn('Failed to insert mobile notification:', error.message);
      return false;
    }

    // Trigger immediate in-app tactile banner
    const isAlert = payload.priority === 'critical' || payload.priority === 'urgent' || payload.priority === 'high';
    NotificationEmitter.trigger(payload.title, payload.message, isAlert);

    return true;
  } catch (e) {
    console.error('Error creating mobile notification:', e);
    return false;
  }
}

// Proactive Maintenance Reminder Engine
// Runs periodically on app launch / refresh to guarantee technicians never miss upcoming, due, or overdue maintenance tasks
export async function checkAndDispatchMaintenanceReminders(
  staffName: string,
  reports: LiveMaintenanceReport[]
): Promise<void> {
  try {
    if (!reports || reports.length === 0) return;

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const storageKey = `ECO_LAST_REMINDED_${todayStr}_${staffName}`;

    // Prevent duplicate spamming on multiple rapid re-renders (check once per hour per day)
    const lastChecked = await AsyncStorage.getItem(storageKey);
    const lastTimestamp = lastChecked ? parseInt(lastChecked, 10) : 0;
    const cooldownMs = 45 * 60 * 1000; // 45 minutes cooldown between automated popups

    if (Date.now() - lastTimestamp < cooldownMs) {
      return;
    }

    // Find urgent, due today, or overdue tasks for this technician
    const userReports = reports.filter(
      (r) => !staffName || r.assignedWorker === staffName || r.assignedWorker === 'Maintenance Staff'
    );

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
        `URGENT: Repair Needed (${topRepair.airconId})`,
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
