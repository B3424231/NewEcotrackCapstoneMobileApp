import { Colors as UiColors, type AppColors, Colors, Spacing } from '@/constants/theme';
import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  Animated,
  Dimensions,
  useColorScheme,
  Platform,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

import { useAuth } from '@/context/auth-context';
import { useSettings } from '@/context/settings-context';
import { FloatingBottomNavbar } from '@/components/floating-navbar';
import { LinearGradient } from 'expo-linear-gradient';
import { AppIcon, AppIconName } from '@/components/app-icon';
import { ICON_AIRCONSTATE, ICON_CHECKLIST } from '@/constants/custom-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  MobileNotificationItem,
  markMobileNotificationAsRead,
  markAllMobileNotificationsAsRead,
  deleteMobileNotification,
  deleteMultipleMobileNotifications,
  snoozeMobileNotification,
  unsnoozeMobileNotification,
} from '@/services/mobile-notifications';
import { useMobileNotifications } from '@/hooks/use-mobile-notifications';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const SCREEN_WIDTH = Dimensions.get('window').width;

// 2D Vector Icons
const ICON_2D_CRITICAL_RED =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZGMyNjI2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBvbHlnb24gcG9pbnRzPSI3Ljg2IDIgMTYuMTQgMiAyMiA3Ljg2IDIyIDE2LjE0IDE2LjE0IDIyIDcuODYgMjIgMiAxNi4xNCAyIDcuODYgNy44NiAyIi8+PGxpbmUgeDE9IjEyIiB5MT0iOCIgeDI9IjEyIiB5Mj0iMTIiLz48bGluZSB4MT0iMTIiIHkxPSIxNiIgeDI9IjEyLjAxIiB5Mj0iMTYiLz48L3N2Zz4=';
const ICON_2D_WARNING_AMBER =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZDk3NzA2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0ibTIxLjczIDE4LTgtMTRhMiAyIDAgMCAwLTMuNDggMGwtOCAxNEEyIDIgMCAwIDAgNCAyMWgxNmEyIDIgMCAwIDAgMS43My0zWiIvPjxsaW5lIHgxPSIxMiIgeTE9IjkiIHgyPSIxMiIgeTI9IjEzIi8+PGxpbmUgeDE9IjEyIiB5MT0iMTciIHgyPSIxMi4wMSIgeTI9IjE3Ii8+PC9zdmc+';
const ICON_2D_CHECK_GREEN =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMDU5NjY5IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiLz48cGF0aCBkPSJtOSAxMiAyIDIgNC00Ii8+PC9zdmc+';
const ICON_2D_INFO_BLUE =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMjU2M2ViIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiLz48bGluZSB4MT0iMTIiIHkxPSIxNiIgeDI9IjEyIiB5Mj0iMTIiLz48bGluZSB4MT0iMTIiIHkxPSI4IiB4Mj0iMTIuMDEiIHkyPSI4Ii8+PC9zdmc+';
const ICON_2D_TASK_PURPLE =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjN2MyZGE3IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTE2IDRoMmEyIDIgMCAwIDEgMiAydjE0YTIgMiAwIDAgMS0yIDJINmEyIDIgMCAwIDEtMi0yVjZhMiAyIDAgMCAxIDItMmgxNSIvPjxyZWN0IHg9IjgiIHk9IjIiIHdpZHRoPSI4IiBoZWlnaHQ9IjQiIHJ4PSIxIiByeT0iMSIvPjxwYXRoIGQ9Im05IDE0IDIgMiA0LTQiLz48L3N2Zz4=';

const ICON_PIN =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMDU5NjY5IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTIxIDEwYzg Ny05IDEzLTkgMTNzLTktNi05LTEzYTYgNiAwIDAgMSAxMiAwWiIvPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTAiIHI9IjMiLz48L3N2Zz4=';
const ICON_CHEVRON_RIGHT =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMDU5NjY5IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0ibTkgMTggNi02LTYtNiIvPjwvc3ZnPg==';

type FilterType = 'all' | 'tasks' | 'reminders' | 'urgent' | 'unread';

// Compute "remind at" time label for snooze options
function getSnoozeTimeLabel(minutes: number, now: number): string {
  const target = new Date(now + minutes * 60 * 1000);
  return target.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function NotificationScreen() {
  const { userId, userType, isAuthenticated } = useAuth();
  const { effectiveTheme, colors, triggerHaptic } = useSettings();
  const styles = themedStyles[effectiveTheme];

  // Modal states
  const [selectedNotificationSnapshot, setSelectedNotification] = useState<MobileNotificationItem | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [optionsNotification, setOptionsNotification] = useState<MobileNotificationItem | null>(null);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [snoozePickerVisible, setSnoozePickerVisible] = useState(false);
  const [snoozeTargetId, setSnoozeTargetId] = useState<string | null>(null);
  const [snoozeDurations, setSnoozeDurations] = useState<Record<string, number>>({});

  // Load remembered snooze durations from storage
  useEffect(() => {
    AsyncStorage.getItem('@ecotrack_snooze_durations').then((res) => {
      if (res) {
        try {
          setSnoozeDurations(JSON.parse(res));
        } catch {}
      }
    });
  }, []);

  // Multi-Select & Batch Delete State
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);

  // Custom Delete Confirmation Modal State
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteModalConfig, setDeleteModalConfig] = useState<{
    title: string;
    description: string;
    count: number;
    isClearAll?: boolean;
    onConfirm: () => Promise<void>;
  } | null>(null);

  // Animations
  const [detailsSlideAnim] = useState(() => new Animated.Value(SCREEN_HEIGHT));
  const [optionsSlideAnim] = useState(() => new Animated.Value(SCREEN_HEIGHT));
  const [pulseAnim] = useState(() => new Animated.Value(1));

  // Filter state
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');

  // Live Notifications State
  const { items: notifications, loading, refreshing, updating, error: loadError, refresh } =
    useMobileNotifications(isAuthenticated && userId ? `${userType}:${userId}` : undefined);
  const selectedNotification = notifications.find(item => item.id === selectedNotificationSnapshot?.id)
    || selectedNotificationSnapshot;
  if (selectedNotification !== selectedNotificationSnapshot) {
    // Retain the latest details if this notification leaves the refreshed feed.
    setSelectedNotification(selectedNotification);
  }
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Current snooze calculation for target notification
  const currentSnoozeItem = useMemo(() => {
    if (!snoozeTargetId) return null;
    return notifications.find((n) => n.id === snoozeTargetId) || null;
  }, [snoozeTargetId, notifications]);

  const isTargetSnoozed = Boolean(
    currentSnoozeItem?.isSnoozed &&
    currentSnoozeItem?.snoozeUntil &&
    new Date(currentSnoozeItem.snoozeUntil).getTime() > now
  );

  const activeSnoozeMinutes = useMemo(() => {
    if (!isTargetSnoozed || !snoozeTargetId) return null;
    if (snoozeDurations[snoozeTargetId]) {
      return snoozeDurations[snoozeTargetId];
    }
    if (currentSnoozeItem?.snoozeUntil) {
      const remaining = Math.max(1, Math.round((new Date(currentSnoozeItem.snoozeUntil).getTime() - now) / 60000));
      const SNOOZE_OPTIONS = [15, 30, 60, 120, 240, 480, 1440];
      return SNOOZE_OPTIONS.reduce((prev, curr) =>
        Math.abs(curr - remaining) < Math.abs(prev - remaining) ? curr : prev
      );
    }
    return null;
  }, [isTargetSnoozed, snoozeTargetId, snoozeDurations, currentSnoozeItem, now]);

  const currentSnoozeFormatted = useMemo(() => {
    if (!isTargetSnoozed || !currentSnoozeItem?.snoozeUntil) return null;
    return new Date(currentSnoozeItem.snoozeUntil).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [isTargetSnoozed, currentSnoozeItem]);

  const remainingMins = useMemo(() => {
    if (!isTargetSnoozed || !currentSnoozeItem?.snoozeUntil) return null;
    return Math.max(1, Math.round((new Date(currentSnoozeItem.snoozeUntil).getTime() - now) / 60000));
  }, [isTargetSnoozed, currentSnoozeItem, now]);

  // Pulse animation for beacon
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.25,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseAnim]);

  const onRefresh = () => { void refresh(); };

  // Selection Mode Actions
  const toggleSelectionMode = () => {
    if (isSelectionMode) {
      setIsSelectionMode(false);
      setSelectedIds([]);
    } else {
      setIsSelectionMode(true);
    }
  };

  const toggleSelectNotification = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Actions
  const handleToggleRead = async (note: MobileNotificationItem) => {
    if (updating) return;
    const nextRead = !note.isRead;
    if (!await markMobileNotificationAsRead(note.id, nextRead)) {
      Alert.alert('Unable to update notification', 'Please try again.');
      return;
    }
  };

  const handleMarkAllRead = async () => {
    if (updating) return;
    if (!await markAllMobileNotificationsAsRead()) {
      Alert.alert('Unable to update notifications', 'Please try again.');
      return;
    }
    setActiveFilter(prev => prev === 'unread' ? 'all' : prev);
  };

  const handleClearAll = () => {
    if (notifications.length === 0) return;
    setMenuVisible(false);
    const count = notifications.length;
    setDeleteModalConfig({
      title: 'Clear All Notifications',
      description: `Are you sure you want to clear all ${count} notification${count > 1 ? 's' : ''}?`,
      count,
      isClearAll: true,
      onConfirm: async () => {
        setIsDeletingSelected(true);
        const allIds = notifications.map((n) => n.id);
        if (!await deleteMultipleMobileNotifications(allIds)) {
          setIsDeletingSelected(false);
          Alert.alert('Unable to delete notifications', 'Please try again.');
          return;
        }
        setSelectedIds([]);
        setIsSelectionMode(false);
        setIsDeletingSelected(false);
      },
    });
    setDeleteModalVisible(true);
  };

  const handleDelete = async (id: string) => {
    if (!await deleteMobileNotification(id)) {
      Alert.alert('Unable to delete notification', 'Please try again.');
      return;
    }
    setSelectedIds((prev) => prev.filter((item) => item !== id));
    closeOptions();
  };

  const openSnoozePicker = (id: string) => {
    setSnoozeTargetId(id);
    closeOptions();
    setTimeout(() => setSnoozePickerVisible(true), 300);
  };

  const handleSnoozeWithDuration = async (minutes: number) => {
    if (!snoozeTargetId) return;
    if (!await snoozeMobileNotification(snoozeTargetId, minutes)) {
      Alert.alert('Unable to snooze notification', 'Please try again.');
      return;
    }
    triggerHaptic();

    const updatedMap = { ...snoozeDurations, [snoozeTargetId]: minutes };
    setSnoozeDurations(updatedMap);
    await AsyncStorage.setItem('@ecotrack_snooze_durations', JSON.stringify(updatedMap));

    setSnoozePickerVisible(false);
    setSnoozeTargetId(null);
  };

  const handleCancelSnooze = async (id: string) => {
    if (!await unsnoozeMobileNotification(id)) {
      Alert.alert('Unable to update notification', 'Please try again.');
      return;
    }
    triggerHaptic();

    const updatedMap = { ...snoozeDurations };
    delete updatedMap[id];
    setSnoozeDurations(updatedMap);
    await AsyncStorage.setItem('@ecotrack_snooze_durations', JSON.stringify(updatedMap));

    setSnoozePickerVisible(false);
    setSnoozeTargetId(null);
  };

  const handleOpenTask = (note: MobileNotificationItem) => {
    closeDetails();
    const cleanRepId = note.relatedReportId ? note.relatedReportId.replace(/^RWK-/i, 'REP-') : undefined;
    if (cleanRepId) {
      const isRepair = cleanRepId.startsWith('REP-') || note.type === 'urgent_repair';
      if (isRepair) {
        router.push({
          pathname: '/Maintenance' as any,
          params: {
            reportId: cleanRepId,
            repairId: cleanRepId,
            screen: 'REPAIR',
          },
        });
      } else {
        router.push({
          pathname: '/Maintenance' as any,
          params: { reportId: cleanRepId },
        });
      }
    } else {
      router.push('/Maintenance' as any);
    }
  };

  // Modal animations
  const openDetails = (note: MobileNotificationItem) => {
    if (!note.isRead) {
      handleToggleRead(note);
    }
    setSelectedNotification(note);
    setDetailsVisible(true);
    Animated.spring(detailsSlideAnim, {
      toValue: 0,
      tension: 50,
      friction: 8,
      useNativeDriver: true,
    }).start();
  };

  const closeDetails = () => {
    Animated.timing(detailsSlideAnim, {
      toValue: SCREEN_HEIGHT,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      setDetailsVisible(false);
      setSelectedNotification(null);
    });
  };

  const openOptions = (note: MobileNotificationItem) => {
    setOptionsNotification(note);
    setOptionsVisible(true);
    Animated.spring(optionsSlideAnim, {
      toValue: 0,
      tension: 50,
      friction: 8,
      useNativeDriver: true,
    }).start();
  };

  const closeOptions = () => {
    Animated.timing(optionsSlideAnim, {
      toValue: SCREEN_HEIGHT,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setOptionsVisible(false);
      setOptionsNotification(null);
    });
  };

  // Filter calculations
  const filteredNotifications = useMemo(() => {
    return notifications.filter((note) => {
      if (activeFilter === 'unread') return !note.isRead;
      if (activeFilter === 'tasks') {
        return note.type === 'task_assigned' || note.type === 'task_reminder' || !!note.relatedReportId;
      }
      if (activeFilter === 'reminders') {
        return note.type === 'task_reminder' || note.type === 'preventive_routine';
      }
      if (activeFilter === 'urgent') {
        return (
          note.priority === 'critical' ||
          note.priority === 'urgent' ||
          note.priority === 'high' ||
          note.type === 'urgent_repair' ||
          note.type === 'overdue_alert'
        );
      }
      return true;
    });
  }, [notifications, activeFilter]);

  const unreadItems = filteredNotifications.filter((n) => !n.isRead);
  const readItems = filteredNotifications.filter((n) => n.isRead);
  const totalUnreadCount = notifications.filter((n) => !n.isRead).length;

  const isAllSelected =
    filteredNotifications.length > 0 &&
    filteredNotifications.every((n) => selectedIds.includes(n.id));

  const handleSelectAll = () => {
    const allFilteredIds = filteredNotifications.map((n) => n.id);
    if (isAllSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(allFilteredIds);
    }
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    setDeleteModalConfig({
      title: 'Delete Notifications',
      description: `Are you sure you want to delete ${count} selected notification${count > 1 ? 's' : ''}?`,
      count,
      isClearAll: false,
      onConfirm: async () => {
        setIsDeletingSelected(true);
        const idsToDelete = [...selectedIds];
        if (!await deleteMultipleMobileNotifications(idsToDelete)) {
          setIsDeletingSelected(false);
          Alert.alert('Unable to delete notifications', 'Please try again.');
          return;
        }
        setSelectedIds([]);
        setIsSelectionMode(false);
        setIsDeletingSelected(false);
      },
    });
    setDeleteModalVisible(true);
  };

  const isDark = effectiveTheme === 'dark';

  // Priority Styling Mapping for Facebook-Style Notification Cards
  const getPriorityStyle = (note: MobileNotificationItem) => {
    const isVerifiedRepair =
      note.title?.toLowerCase().includes('verified') ||
      note.message?.toLowerCase().includes('verified') ||
      note.message?.toLowerCase().includes('repaired');

    if (isVerifiedRepair) {
      return {
        avatarBg: isDark ? 'rgba(16, 185, 129, 0.2)' : '#d1fae5',
        iconName: 'check-circle' as AppIconName,
        iconColor: isDark ? '#34d399' : '#059669',
        miniBadgeBg: '#10b981',
        miniBadgeIcon: 'check' as AppIconName,
        miniBadgeColor: '#ffffff',
        textColor: isDark ? '#34d399' : '#059669',
        tagLabel: '✓ VERIFIED',
        accentBorder: '#10b981',
      };
    }

    const isCritical = note.priority === 'critical' || note.type === 'urgent_repair';
    const isHighOrOverdue = note.priority === 'high' || note.type === 'overdue_alert';
    const isDueReminder = note.type === 'task_reminder';
    const isNewTask = note.type === 'task_assigned';

    if (isCritical) {
      return {
        avatarBg: isDark ? 'rgba(239, 68, 68, 0.2)' : '#fee2e2',
        iconName: 'alert-octagon' as AppIconName,
        iconColor: isDark ? '#f87171' : '#dc2626',
        miniBadgeBg: '#ef4444',
        miniBadgeIcon: 'alert' as AppIconName,
        miniBadgeColor: '#ffffff',
        textColor: isDark ? '#f87171' : '#dc2626',
        tagLabel: 'CRITICAL',
        accentBorder: '#ef4444',
      };
    }

    if (isHighOrOverdue) {
      return {
        avatarBg: isDark ? 'rgba(245, 158, 11, 0.2)' : '#fef3c7',
        iconName: 'alert' as AppIconName,
        iconColor: isDark ? '#fbbf24' : '#d97706',
        miniBadgeBg: '#f59e0b',
        miniBadgeIcon: 'clock' as AppIconName,
        miniBadgeColor: '#ffffff',
        textColor: isDark ? '#fbbf24' : '#d97706',
        tagLabel: note.type === 'overdue_alert' ? 'OVERDUE' : 'HIGH PRIORITY',
        accentBorder: '#f59e0b',
      };
    }

    if (isDueReminder) {
      return {
        avatarBg: isDark ? 'rgba(234, 179, 8, 0.2)' : '#fef3c7',
        iconName: 'calendar' as AppIconName,
        iconColor: isDark ? '#facc15' : '#b45309',
        miniBadgeBg: '#eab308',
        miniBadgeIcon: 'clock' as AppIconName,
        miniBadgeColor: '#ffffff',
        textColor: isDark ? '#facc15' : '#b45309',
        tagLabel: 'DUE TODAY',
        accentBorder: '#eab308',
      };
    }

    if (isNewTask) {
      return {
        avatarBg: isDark ? 'rgba(168, 85, 247, 0.2)' : '#f3e8ff',
        iconName: 'maintenance' as AppIconName,
        iconColor: isDark ? '#c084fc' : '#7e22ce',
        miniBadgeBg: '#9333ea',
        miniBadgeIcon: 'checklist' as AppIconName,
        miniBadgeColor: '#ffffff',
        textColor: isDark ? '#c084fc' : '#7e22ce',
        tagLabel: 'NEW TASK',
        accentBorder: '#9333ea',
      };
    }

    return {
      avatarBg: isDark ? 'rgba(255, 255, 255, 0.08)' : '#f1f5f9',
      iconName: 'bell' as AppIconName,
      iconColor: isDark ? '#cbd5e1' : '#64748b',
      miniBadgeBg: '#64748b',
      miniBadgeIcon: 'check' as AppIconName,
      miniBadgeColor: '#ffffff',
      textColor: isDark ? '#cbd5e1' : '#64748b',
      tagLabel: 'NOTICE',
      accentBorder: 'rgba(255, 255, 255, 0.1)',
    };
  };

  const formatTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return 'Recently';
      const diffSec = Math.floor((now - d.getTime()) / 1000);
      if (diffSec < 60) return 'Just now';
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m`;
      const diffHours = Math.floor(diffMin / 60);
      if (diffHours < 24) return `${diffHours}h`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays}d`;
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch (_e) {
      return 'Recently';
    }
  };

  const renderNotificationItem = (
    note: MobileNotificationItem,
    isUnread: boolean,
    isLast: boolean = false
  ) => {
    const cleanTitle = (note.title || '')
      .replace(/maintenance\s+rework\s+dispatched/gi, 'Corrective Repair Dispatched')
      .replace(/maintenance\s+rework/gi, 'Corrective Repair')
      .replace(/rework\s+dispatched/gi, 'Corrective repair dispatched')
      .replace(/rework/gi, 'Corrective Repair');

    const cleanMessage = (note.message || '')
      .replace(/maintenance\s+rework\s+dispatched/gi, 'Corrective Repair Dispatched')
      .replace(/maintenance\s+rework/gi, 'Corrective Repair')
      .replace(/rework\s+dispatched/gi, 'Corrective repair dispatched')
      .replace(/rework/gi, 'corrective repair');

    const cleanReportId = note.relatedReportId ? note.relatedReportId.replace(/^RWK-/i, 'REP-') : undefined;

    const styleInfo = getPriorityStyle({
      ...note,
      title: cleanTitle,
      message: cleanMessage,
    });
    const isSelected = selectedIds.includes(note.id);

    return (
      <Pressable
        key={note.id}
        onPress={() => {
          if (isSelectionMode) {
            toggleSelectNotification(note.id);
          } else if (cleanReportId) {
            handleOpenTask({ ...note, relatedReportId: cleanReportId });
          } else {
            openDetails({ ...note, title: cleanTitle, message: cleanMessage, relatedReportId: cleanReportId });
          }
        }}
        onLongPress={() => {
          if (!isSelectionMode) {
            setIsSelectionMode(true);
            setSelectedIds([note.id]);
          }
        }}
        style={({ pressed }) => [
          styles.fbNotificationRow,
          !isLast && (isDark ? styles.fbRowDividerDark : styles.fbRowDividerLight),
          isUnread
            ? (isDark ? styles.fbRowUnreadDark : styles.fbRowUnreadLight)
            : (isDark ? styles.fbRowReadDark : styles.fbRowReadLight),
          isSelectionMode && isSelected && (isDark ? styles.itemSelectedDark : styles.itemSelectedLight),
          pressed && styles.itemPressed,
        ]}
      >
        {/* Multi-Select Checkbox Column */}
        {isSelectionMode && (
          <View style={styles.selectCheckboxWrapper}>
            <View
              style={[
                styles.selectCheckbox,
                isDark ? styles.selectCheckboxDark : styles.selectCheckboxLight,
                isSelected && styles.selectCheckboxChecked,
              ]}
            >
              {isSelected && <ThemedText style={styles.selectCheckmark}>✓</ThemedText>}
            </View>
          </View>
        )}

        {/* Circular Avatar with mini overlay cutout badge */}
        <View style={styles.fbAvatarWrapper}>
          <View
            style={[
              styles.fbAvatarCircle,
              {
                backgroundColor: styleInfo.avatarBg,
              },
            ]}
          >
            <AppIcon name={styleInfo.iconName} size={22} color={styleInfo.iconColor} />
          </View>
          <View
            style={[
              styles.fbMiniBadge,
              {
                backgroundColor: styleInfo.miniBadgeBg,
                borderColor: isUnread
                  ? (isDark ? '#121826' : '#ecfdf5')
                  : (isDark ? '#121826' : '#ffffff'),
              },
            ]}
          >
            <AppIcon name={styleInfo.miniBadgeIcon} size={11} color={styleInfo.miniBadgeColor} />
          </View>
        </View>

        {/* Content Body: Title + message hierarchy */}
        <View style={styles.fbBody}>
          <ThemedText
            style={[styles.fbTitleBold, isDark ? { color: UiColors[effectiveTheme].onPrimary } : { color: UiColors[effectiveTheme].text }]}
            numberOfLines={2}
          >
            {cleanTitle}
          </ThemedText>
          {cleanMessage ? (
            <ThemedText
              style={[styles.fbMessageText, isDark ? { color: UiColors[effectiveTheme].textMuted } : { color: UiColors[effectiveTheme].textSecondary }]}
              numberOfLines={2}
            >
              {cleanMessage}
            </ThemedText>
          ) : null}

          {/* Metadata Row: relative time & location */}
          <View style={styles.fbMetaRow}>
            <ThemedText
              style={[
                styles.fbTimeText,
                isUnread ? styles.fbTimeUnread : (isDark ? { color: UiColors[effectiveTheme].textMuted } : { color: UiColors[effectiveTheme].textSecondary }),
              ]}
            >
              {formatTime(note.createdAt)}
            </ThemedText>
            {note.location ? (
              <ThemedText style={[styles.fbMetaDotText, isDark && { color: UiColors[effectiveTheme].textMuted }]} numberOfLines={1}>
                • {note.location}
              </ThemedText>
            ) : null}
            {note.controllerName || note.airconId ? (
              <ThemedText style={[styles.fbMetaDotText, isDark && { color: UiColors[effectiveTheme].textMuted }]} numberOfLines={1}>
                • AC Device: {note.controllerName || 'Name unavailable'}
              </ThemedText>
            ) : null}
            {note.airconName ? (
              <ThemedText style={[styles.fbMetaDotText, isDark && { color: UiColors[effectiveTheme].textMuted }]} numberOfLines={1}>
                • Aircon: {note.airconName}
              </ThemedText>
            ) : null}
            {note.dueDate ? (
              <ThemedText style={[styles.fbMetaDueText, isDark && { color: UiColors[effectiveTheme].warning }]}>
                • Due {note.dueDate}
              </ThemedText>
            ) : null}
          </View>

          {/* Admin Verification Remarks if present */}
          {note.verificationRemarks ? (
            <View style={[styles.fbVerificationChip, isDark ? styles.fbVerificationDark : styles.fbVerificationLight]}>
              <AppIcon name="shield" size={11} color={isDark ? '#c4b5fd' : '#7e22ce'} />
              <ThemedText style={[styles.fbVerificationText, isDark && { color: '#c4b5fd' }]} numberOfLines={1}>
                Admin: {note.verificationRemarks.replace(/rework/gi, 'corrective repair')}
              </ThemedText>
            </View>
          ) : null}

          {/* Keep report identifiers separate from the action labels. */}
          {cleanReportId ? (
            <View>
              <ThemedText
                style={[styles.fbReportId, isDark && { color: UiColors[effectiveTheme].textMuted }]}
                numberOfLines={1}
                accessibilityLabel={`Report ${cleanReportId}`}
              >
                #{cleanReportId}
              </ThemedText>
              <View style={styles.fbActionRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open checklist for report ${cleanReportId}`}
                  onPress={(e) => {
                    e.stopPropagation();
                    handleOpenTask({ ...note, relatedReportId: cleanReportId });
                  }}
                  style={({ pressed }) => [
                    styles.fbPrimaryActionBtn,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View style={styles.fbActionIcon}>
                    <AppIcon name="checklist" size={16} color={UiColors[effectiveTheme].onPrimary} />
                  </View>
                  <ThemedText style={styles.fbPrimaryActionBtnText}>
                    Checklist
                  </ThemedText>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`View details for report ${cleanReportId}`}
                  onPress={(e) => {
                    e.stopPropagation();
                    openDetails({ ...note, title: cleanTitle, message: cleanMessage, relatedReportId: cleanReportId });
                  }}
                  style={({ pressed }) => [
                    styles.fbSecondaryActionBtn,
                    isDark ? styles.fbSecondaryActionBtnDark : styles.fbSecondaryActionBtnLight,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <ThemedText style={[styles.fbSecondaryActionBtnText, isDark && { color: UiColors[effectiveTheme].textMuted }]}>
                    Details
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        {/* Right side: 3-dots menu button & unread indicator dot */}
        <View style={styles.fbRightActions}>
          <Pressable
            hitSlop={8}
            onPress={(e) => {
              e.stopPropagation();
              if (isSelectionMode) {
                toggleSelectNotification(note.id);
              } else {
                openOptions(note);
              }
            }}
            style={styles.fbMoreBtn}
          >
            <ThemedText style={[styles.fbMoreDots, isDark && { color: UiColors[effectiveTheme].textMuted }]}>•••</ThemedText>
          </Pressable>

          {isUnread && !isSelectionMode ? (
            <View style={[styles.fbUnreadDot, { backgroundColor: UiColors[effectiveTheme].primaryFill }]} />
          ) : (
            <View style={{ width: 9, height: 9 }} />
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <LinearGradient
      colors={[UiColors[effectiveTheme].background, UiColors[effectiveTheme].background]}
      style={[styles.container, { backgroundColor: colors.background }]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 0.35 }}
    >
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={styles.scrollContentContainer}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.emerald}
              colors={[colors.emerald]}
            />
          }
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Image
                source={require('@/assets/images/ecoTrack.png')}
                style={styles.headerLogo}
                contentFit="contain"
              />
              <View>
                <ThemedText type="smallBold" style={[styles.headerTitle, { color: colors.text }]}>
                  EcoTrack
                </ThemedText>
                <ThemedText style={{ fontSize: 12, color: colors.emerald, fontWeight: '700' }}>
                  Mobile Tasks & Reminders
                </ThemedText>
              </View>
            </View>

            {/* Header Right: Multi-Select & Batch Actions */}
            <View style={styles.headerRight}>
              {isSelectionMode ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Pressable
                    onPress={handleSelectAll}
                    style={({ pressed }) => [
                      styles.selectAllHeaderBtn,
                      isDark ? styles.selectAllHeaderBtnDark : styles.selectAllHeaderBtnLight,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <ThemedText style={[styles.selectAllHeaderText, isDark && { color: UiColors[effectiveTheme].emerald }]}>
                      {isAllSelected ? 'Deselect All' : 'Select All'}
                    </ThemedText>
                  </Pressable>

                  <Pressable
                    onPress={toggleSelectionMode}
                    style={({ pressed }) => [
                      styles.cancelSelectBtn,
                      isDark ? styles.cancelSelectBtnDark : styles.cancelSelectBtnLight,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <ThemedText style={[styles.cancelSelectText, isDark && { color: UiColors[effectiveTheme].textMuted }]}>Cancel</ThemedText>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => setMenuVisible(true)}
                  style={({ pressed }) => [
                    styles.headerThreeDotsBtn,
                    isDark ? styles.headerThreeDotsBtnDark : styles.headerThreeDotsBtnLight,
                    pressed && { opacity: 0.7 },
                  ]}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <View style={styles.threeDotsColumn}>
                    <View style={[styles.dotVertical, { backgroundColor: colors.text }]} />
                    <View style={[styles.dotVertical, { backgroundColor: colors.text }]} />
                    <View style={[styles.dotVertical, { backgroundColor: colors.text }]} />
                  </View>
                </Pressable>
              )}
            </View>
          </View>

          {/* Filter Pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScroll}
            style={styles.filterScrollView}
          >
            <Pressable
              onPress={() => setActiveFilter('all')}
              style={[
                styles.pillButton,
                activeFilter === 'all'
                  ? styles.pillActive
                  : isDark
                  ? styles.pillInactiveDark
                  : styles.pillInactiveLight,
              ]}
            >
              <ThemedText
                style={[
                  styles.pillText,
                  activeFilter === 'all'
                    ? styles.pillTextActive
                    : isDark
                    ? styles.pillTextInactiveDark
                    : styles.pillTextInactiveLight,
                ]}
              >
                All ({notifications.length})
              </ThemedText>
            </Pressable>

            <Pressable
              onPress={() => setActiveFilter('unread')}
              style={[
                styles.pillButton,
                activeFilter === 'unread'
                  ? styles.pillActive
                  : isDark
                  ? styles.pillInactiveDark
                  : styles.pillInactiveLight,
              ]}
            >
              <View style={styles.pillWithDot}>
                <ThemedText
                  style={[
                    styles.pillText,
                    activeFilter === 'unread'
                      ? styles.pillTextActive
                      : isDark
                      ? styles.pillTextInactiveDark
                      : styles.pillTextInactiveLight,
                  ]}
                >
                  Unread ({totalUnreadCount})
                </ThemedText>
                {totalUnreadCount > 0 && <View style={styles.filterUnreadBadgeDot} />}
              </View>
            </Pressable>

            <Pressable
              onPress={() => setActiveFilter('tasks')}
              style={[
                styles.pillButton,
                activeFilter === 'tasks'
                  ? styles.pillActive
                  : isDark
                  ? styles.pillInactiveDark
                  : styles.pillInactiveLight,
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <AppIcon
                  name="checklist"
                  size={12}
                  color={activeFilter === 'tasks' ? '#ffffff' : (isDark ? '#94a3b8' : '#475569')}
                />
                <ThemedText
                  style={[
                    styles.pillText,
                    activeFilter === 'tasks'
                      ? styles.pillTextActive
                      : isDark
                      ? styles.pillTextInactiveDark
                      : styles.pillTextInactiveLight,
                  ]}
                >
                  Tasks
                </ThemedText>
              </View>
            </Pressable>

            <Pressable
              onPress={() => setActiveFilter('reminders')}
              style={[
                styles.pillButton,
                activeFilter === 'reminders'
                  ? styles.pillActive
                  : isDark
                  ? styles.pillInactiveDark
                  : styles.pillInactiveLight,
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <AppIcon
                  name="clock"
                  size={12}
                  color={activeFilter === 'reminders' ? '#ffffff' : (isDark ? '#94a3b8' : '#475569')}
                />
                <ThemedText
                  style={[
                    styles.pillText,
                    activeFilter === 'reminders'
                      ? styles.pillTextActive
                      : isDark
                      ? styles.pillTextInactiveDark
                      : styles.pillTextInactiveLight,
                  ]}
                >
                  Reminders
                </ThemedText>
              </View>
            </Pressable>

            <Pressable
              onPress={() => setActiveFilter('urgent')}
              style={[
                styles.pillButton,
                activeFilter === 'urgent'
                  ? styles.pillActive
                  : isDark
                  ? styles.pillInactiveDark
                  : styles.pillInactiveLight,
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <AppIcon
                  name="alert-octagon"
                  size={12}
                  color={activeFilter === 'urgent' ? '#ffffff' : (isDark ? '#94a3b8' : '#475569')}
                />
                <ThemedText
                  style={[
                    styles.pillText,
                    activeFilter === 'urgent'
                      ? styles.pillTextActive
                      : isDark
                      ? styles.pillTextInactiveDark
                      : styles.pillTextInactiveLight,
                  ]}
                >
                  Urgent
                </ThemedText>
              </View>
            </Pressable>
          </ScrollView>

          {/* Loading Indicator */}
          {loading && notifications.length === 0 && (
            <DataListSkeleton label="Loading task reminders..." compact />
          )}

          {loadError && (
            <View style={[styles.loadingCard, isDark ? styles.cardDark : styles.cardLight]}>
              <ThemedText style={[styles.loadingSubtitle, isDark && { color: UiColors[effectiveTheme].textMuted }]}>
                {loadError}
              </ThemedText>
              <Pressable onPress={onRefresh} disabled={refreshing || updating}>
                <ThemedText style={{ color: UiColors[effectiveTheme].emerald, fontWeight: '700' }}>Retry</ThemedText>
              </Pressable>
            </View>
          )}

          {/* Empty State */}
          {!loading && !loadError && filteredNotifications.length === 0 && (
            <View style={styles.emptyContainer}>
              <Animated.View
                style={[
                  styles.emptyBeaconOuter,
                  isDark ? styles.beaconOuterDark : styles.beaconOuterLight,
                  { transform: [{ scale: pulseAnim }] },
                ]}
              />
              <View style={[styles.emptyBeaconInner, isDark ? styles.beaconInnerDark : styles.beaconInnerLight]}>
                <AppIcon name="check-circle" size={36} color={UiColors[effectiveTheme].emerald} />
              </View>
              <ThemedText style={[styles.emptyTitle, isDark && { color: UiColors[effectiveTheme].text }]}>
                All caught up!
              </ThemedText>
              <ThemedText style={[styles.emptySubtitle, isDark && { color: UiColors[effectiveTheme].textMuted }]}>
                No pending maintenance reminders or task alerts in this view.
              </ThemedText>
            </View>
          )}

          {/* Render Unread Section */}
          {!loading && unreadItems.length > 0 && (
            <View style={styles.groupSection}>
              <View style={styles.groupHeader}>
                <ThemedText style={[styles.groupTitle, isDark && { color: UiColors[effectiveTheme].textMuted }]}>
                  New ({unreadItems.length})
                </ThemedText>
              </View>
              <View style={[styles.fbListGroup, isDark ? styles.fbListGroupDark : styles.fbListGroupLight]}>
                {unreadItems.map((note, idx) =>
                  renderNotificationItem(note, true, idx === unreadItems.length - 1)
                )}
              </View>
            </View>
          )}

          {/* Render Read Section */}
          {!loading && readItems.length > 0 && (
            <View style={styles.groupSection}>
              <View style={styles.groupHeader}>
                <ThemedText style={[styles.groupTitle, isDark && { color: UiColors[effectiveTheme].textMuted }]}>
                  Earlier
                </ThemedText>
              </View>
              <View style={[styles.fbListGroup, isDark ? styles.fbListGroupDark : styles.fbListGroupLight]}>
                {readItems.map((note, idx) =>
                  renderNotificationItem(note, false, idx === readItems.length - 1)
                )}
              </View>
            </View>
          )}

          {/* Bottom Spacing */}
          <View style={{ height: isSelectionMode ? 190 : 110 }} />
        </ScrollView>

        {/* Floating Multi-Select Batch Action Bar */}
        {isSelectionMode && (
          <View style={[styles.selectionBarContainer, isDark ? styles.selectionBarDark : styles.selectionBarLight]}>
            <View style={styles.selectionBarLeft}>
              <ThemedText style={[styles.selectionCountText, isDark && { color: UiColors[effectiveTheme].text }]}>
                <ThemedText style={styles.selectionCountNumber}>{selectedIds.length}</ThemedText> of {filteredNotifications.length} selected
              </ThemedText>
            </View>

            <View style={styles.selectionBarRight}>
              <Pressable
                onPress={handleDeleteSelected}
                disabled={selectedIds.length === 0 || isDeletingSelected}
                style={({ pressed }) => [
                  styles.deleteSelectedBtn,
                  selectedIds.length === 0 && styles.deleteSelectedBtnDisabled,
                  pressed && selectedIds.length > 0 && { transform: [{ scale: 0.97 }] },
                ]}
              >
                {isDeletingSelected ? (
                  <ActivityIndicator size="small" color={UiColors[effectiveTheme].onPrimary} />
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <AppIcon name="trash" size={13} color={UiColors[effectiveTheme].onPrimary} />
                    <ThemedText style={styles.deleteSelectedText}>
                      Delete ({selectedIds.length})
                    </ThemedText>
                  </View>
                )}
              </Pressable>
            </View>
          </View>
        )}

        {/* Details Bottom Sheet Modal */}
        {detailsVisible && selectedNotification && (
          <View style={styles.modalOverlay}>
            <Pressable style={styles.modalBackdrop} onPress={closeDetails} />
            <Animated.View
              style={[
                styles.sheetContainer,
                isDark ? styles.sheetContainerDark : styles.sheetContainerLight,
                { transform: [{ translateY: detailsSlideAnim }] },
              ]}
            >
              <View style={[styles.sheetHandle, isDark && { backgroundColor: '#475569' }]} />

              <View style={styles.sheetHeader}>
                <ThemedText style={[styles.sheetTitle, isDark && { color: UiColors[effectiveTheme].text }]}>Notification Details</ThemedText>
                <Pressable onPress={closeDetails} style={[styles.closeBtn, isDark && { backgroundColor: UiColors[effectiveTheme].backgroundSelected, borderRadius: 12 }]}>
                  <ThemedText style={{ fontSize: 16, fontWeight: '700', color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary }}>
                    ✕
                  </ThemedText>
                </Pressable>
              </View>

              <ScrollView style={styles.sheetBody} showsVerticalScrollIndicator={false}>
                <View style={[styles.detailCard, isDark ? styles.detailCardDark : styles.detailCardLight]}>
                  <ThemedText style={[styles.detailCardTitle, isDark && { color: UiColors[effectiveTheme].text }]}>
                    {selectedNotification.title}
                  </ThemedText>
                  <ThemedText style={[styles.detailCardMessage, isDark && { color: UiColors[effectiveTheme].textMuted }]}>
                    {selectedNotification.message}
                  </ThemedText>
                </View>

                {selectedNotification.createdAt && (
                  <View style={[styles.detailRow, isDark ? styles.detailRowDark : styles.detailRowLight]}>
                    <ThemedText style={[styles.detailLabel, isDark && { color: UiColors[effectiveTheme].textMuted }]}>Date & Time:</ThemedText>
                    <ThemedText style={[styles.detailValue, isDark && { color: UiColors[effectiveTheme].text }]}>
                      {formatTime(selectedNotification.createdAt)}
                    </ThemedText>
                  </View>
                )}

                {selectedNotification.location && (
                  <View style={[styles.detailRow, isDark ? styles.detailRowDark : styles.detailRowLight]}>
                    <ThemedText style={[styles.detailLabel, isDark && { color: UiColors[effectiveTheme].textMuted }]}>Location:</ThemedText>
                    <ThemedText style={[styles.detailValue, isDark && { color: UiColors[effectiveTheme].text }]}>
                      {selectedNotification.location}
                    </ThemedText>
                  </View>
                )}

                {(selectedNotification.controllerName || selectedNotification.airconId) && (
                  <View style={[styles.detailRow, isDark ? styles.detailRowDark : styles.detailRowLight]}>
                    <ThemedText style={[styles.detailLabel, isDark && { color: UiColors[effectiveTheme].textMuted }]}>AC Device:</ThemedText>
                    <ThemedText style={[styles.detailValue, isDark && { color: UiColors[effectiveTheme].text }]}>
                      {selectedNotification.controllerName || 'Name unavailable'}
                    </ThemedText>
                  </View>
                )}

                {(selectedNotification.airconName || selectedNotification.airconId) && (
                  <View style={[styles.detailRow, isDark ? styles.detailRowDark : styles.detailRowLight]}>
                    <ThemedText style={[styles.detailLabel, isDark && { color: UiColors[effectiveTheme].textMuted }]}>Custom Aircon Name:</ThemedText>
                    <ThemedText style={[styles.detailValue, isDark && { color: UiColors[effectiveTheme].text }]}>
                      {selectedNotification.airconName || 'Name unavailable'}
                    </ThemedText>
                  </View>
                )}

                {selectedNotification.airconType && (
                  <View style={[styles.detailRow, isDark ? styles.detailRowDark : styles.detailRowLight]}>
                    <ThemedText style={[styles.detailLabel, isDark && { color: UiColors[effectiveTheme].textMuted }]}>Aircon Type:</ThemedText>
                    <ThemedText style={[styles.detailValue, isDark && { color: UiColors[effectiveTheme].text }]}>{selectedNotification.airconType}</ThemedText>
                  </View>
                )}

                {selectedNotification.protocolName && (
                  <View style={[styles.detailRow, isDark ? styles.detailRowDark : styles.detailRowLight]}>
                    <ThemedText style={[styles.detailLabel, isDark && { color: UiColors[effectiveTheme].textMuted }]}>IR Protocol:</ThemedText>
                    <ThemedText style={[styles.detailValue, isDark && { color: UiColors[effectiveTheme].text }]}>{selectedNotification.protocolName}</ThemedText>
                  </View>
                )}

                {selectedNotification.dueDate && (
                  <View style={[styles.detailRow, isDark ? styles.detailRowDark : styles.detailRowLight]}>
                    <ThemedText style={[styles.detailLabel, isDark && { color: UiColors[effectiveTheme].textMuted }]}>Due Date:</ThemedText>
                    <ThemedText style={[styles.detailValue, { color: isDark ? UiColors[effectiveTheme].warning : UiColors[effectiveTheme].warning, fontWeight: '700' }]}>
                      {selectedNotification.dueDate}
                    </ThemedText>
                  </View>
                )}

                <View style={[styles.detailRow, isDark ? styles.detailRowDark : styles.detailRowLight]}>
                  <ThemedText style={[styles.detailLabel, isDark && { color: UiColors[effectiveTheme].textMuted }]}>Assigned To:</ThemedText>
                  <ThemedText style={[styles.detailValue, isDark && { color: UiColors[effectiveTheme].text }]}>
                    {selectedNotification.staffName}
                  </ThemedText>
                </View>

                {selectedNotification.verificationRemarks && (
                  <View style={[styles.detailRow, isDark ? styles.notifVerificationDark : { backgroundColor: '#f5f3ff', padding: 10, borderRadius: 10 }]}>
                    <ThemedText style={[styles.detailLabel, { color: isDark ? '#c4b5fd' : UiColors[effectiveTheme].info }]}>Admin Remarks:</ThemedText>
                    <ThemedText style={[styles.detailValue, { color: isDark ? '#e0e7ff' : '#4338ca', fontWeight: '600' }]}>
                      {selectedNotification.verificationRemarks}
                    </ThemedText>
                  </View>
                )}

                {/* Redesigned Primary Action Button: Launch Maintenance Checklist */}
                {selectedNotification.relatedReportId && (
                  <Pressable
                    onPress={() => handleOpenTask(selectedNotification)}
                    style={({ pressed }) => [
                      styles.sheetActionBtn,
                      isDark ? styles.sheetActionBtnDark : styles.sheetActionBtnLight,
                      pressed && styles.sheetActionBtnPressed,
                    ]}
                  >
                    <View style={styles.sheetActionBtnContent}>
                      <View style={styles.sheetActionBtnIconBadge}>
                        <AppIcon name="checklist" size={18} color={UiColors[effectiveTheme].onPrimary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <ThemedText style={styles.sheetActionBtnTitle}>
                          Launch Maintenance Checklist
                        </ThemedText>
                        <ThemedText style={styles.sheetActionBtnSubtitle}>
                          Open Report #{selectedNotification.relatedReportId}
                        </ThemedText>
                      </View>
                      <ThemedText style={styles.sheetActionBtnArrow}>→</ThemedText>
                    </View>
                  </Pressable>
                )}
              </ScrollView>
            </Animated.View>
          </View>
        )}

        {/* Options Modal */}
        {optionsVisible && optionsNotification && (
          <View style={styles.modalOverlay}>
            <Pressable style={styles.modalBackdrop} onPress={closeOptions} />
            <Animated.View
              style={[
                styles.optionsContainer,
                isDark ? styles.optionsContainerDark : styles.optionsContainerLight,
                { transform: [{ translateY: optionsSlideAnim }] },
              ]}
            >
              <View style={[styles.sheetHandle, isDark && { backgroundColor: '#475569' }]} />
              <ThemedText style={[styles.optionsTitle, isDark && { color: UiColors[effectiveTheme].text }]}>Notification Options</ThemedText>

              <Pressable
                style={[styles.optionRow, isDark && { borderBottomColor: UiColors[effectiveTheme].border }]}
                onPress={() => {
                  handleToggleRead(optionsNotification);
                  closeOptions();
                }}
              >
                <ThemedText style={[styles.optionText, isDark && { color: UiColors[effectiveTheme].text }]}>
                  {optionsNotification.isRead ? 'Mark as Unread' : 'Mark as Read'}
                </ThemedText>
              </Pressable>

              <Pressable
                style={[styles.optionRow, isDark && { borderBottomColor: UiColors[effectiveTheme].border }]}
                onPress={() => openSnoozePicker(optionsNotification.id)}
              >
                <ThemedText style={[styles.optionText, isDark && { color: UiColors[effectiveTheme].text }]}>
                  {optionsNotification.isSnoozed ? '⏰ Change Snooze Time...' : '⏰ Snooze Reminder...'}
                </ThemedText>
              </Pressable>

              {optionsNotification.isSnoozed && (
                <Pressable
                  style={[styles.optionRow, isDark && { borderBottomColor: UiColors[effectiveTheme].border }]}
                  onPress={() => {
                    handleCancelSnooze(optionsNotification.id);
                    closeOptions();
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <AppIcon name="bell" size={14} color={UiColors[effectiveTheme].emerald} />
                    <ThemedText style={[styles.optionText, { color: UiColors[effectiveTheme].emerald }]}>
                      Resume Notification (Cancel Snooze)
                    </ThemedText>
                  </View>
                </Pressable>
              )}

              <Pressable
                style={[styles.optionRow, { borderBottomWidth: 0 }]}
                onPress={() => handleDelete(optionsNotification.id)}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <AppIcon name="trash" size={14} color={UiColors[effectiveTheme].error} />
                  <ThemedText style={[styles.optionText, { color: UiColors[effectiveTheme].error }]}>
                    Delete Notification
                  </ThemedText>
                </View>
              </Pressable>
            </Animated.View>
          </View>
        )}

        {/* Snooze Time Picker Modal */}
        <Modal
          visible={snoozePickerVisible}
          transparent
          animationType="fade"
          onRequestClose={() => { setSnoozePickerVisible(false); setSnoozeTargetId(null); }}
        >
          <Pressable
            style={styles.snoozeBackdrop}
            onPress={() => { setSnoozePickerVisible(false); setSnoozeTargetId(null); }}
          >
            <View
              style={[
                styles.snoozeCard,
                isDark ? styles.snoozeCardDark : styles.snoozeCardLight,
              ]}
            >
              <View style={styles.snoozeHeaderRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <AppIcon name="clock" size={16} color={isDark ? '#34d399' : '#059669'} />
                  <ThemedText style={[styles.snoozeTitle, isDark && { color: UiColors[effectiveTheme].text }]}>Snooze Reminder</ThemedText>
                </View>
                <ThemedText style={[styles.snoozeSubtitle, isDark && { color: UiColors[effectiveTheme].textMuted }]}>Choose when to be reminded again</ThemedText>
              </View>

              {/* Current Active Snooze Alert Banner */}
              {isTargetSnoozed && (
                <View style={[styles.currentSnoozeAlertBanner, isDark ? styles.currentSnoozeAlertDark : styles.currentSnoozeAlertLight]}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={styles.activeSnoozeDot} />
                      <ThemedText style={styles.currentSnoozeTag}>CURRENT SNOOZE ACTIVE</ThemedText>
                    </View>
                    <ThemedText style={[styles.currentSnoozeTimeText, isDark && { color: UiColors[effectiveTheme].text }]}>
                      Reminding at {currentSnoozeFormatted}
                      {remainingMins ? ` • ${remainingMins}m left` : ''}
                    </ThemedText>
                  </View>
                  <Pressable
                    onPress={() => snoozeTargetId && handleCancelSnooze(snoozeTargetId)}
                    style={({ pressed }) => [
                      styles.cancelSnoozeBtn,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <ThemedText style={styles.cancelSnoozeBtnText}>Cancel</ThemedText>
                  </Pressable>
                </View>
              )}

              {[
                { label: '15 minutes', minutes: 15 },
                { label: '30 minutes', minutes: 30 },
                { label: '1 hour', minutes: 60 },
                { label: '2 hours', minutes: 120 },
                { label: '4 hours', minutes: 240 },
                { label: '8 hours', minutes: 480 },
                { label: 'Tomorrow (24 hrs)', minutes: 1440 },
              ].map((opt, idx) => {
                const isOptionActive = isTargetSnoozed && opt.minutes === activeSnoozeMinutes;
                return (
                  <Pressable
                    key={opt.minutes}
                    onPress={() => handleSnoozeWithDuration(opt.minutes)}
                    style={({ pressed }) => [
                      styles.snoozeOptionRow,
                      { borderBottomColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border },
                      idx === 6 && { borderBottomWidth: 0 },
                      isOptionActive && (isDark ? styles.snoozeOptionRowActiveDark : styles.snoozeOptionRowActiveLight),
                      pressed && { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundSelected : UiColors[effectiveTheme].background },
                    ]}
                  >
                    <View style={[
                      styles.snoozeIconCircle,
                      isOptionActive
                        ? (isDark ? { backgroundColor: UiColors[effectiveTheme].accentSurface } : { backgroundColor: UiColors[effectiveTheme].accentSurface })
                        : { backgroundColor: isDark ? UiColors[effectiveTheme].warningSurface : UiColors[effectiveTheme].warningSurface },
                    ]}>
                      <AppIcon
                        name={opt.minutes === 1440 ? 'calendar' : 'clock'}
                        size={15}
                        color={isOptionActive ? '#10b981' : (isDark ? '#fbbf24' : '#d97706')}
                      />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <ThemedText style={[
                        styles.snoozeOptionLabel,
                        isDark && { color: UiColors[effectiveTheme].text },
                        isOptionActive && { color: UiColors[effectiveTheme].textSecondary, fontWeight: '800' },
                      ]}>
                        {opt.label}
                      </ThemedText>
                      <ThemedText style={[
                        styles.snoozeOptionHint,
                        isDark && { color: UiColors[effectiveTheme].textSecondary },
                        isOptionActive && { color: UiColors[effectiveTheme].textSecondary, fontWeight: '700' },
                      ]}>
                        {isOptionActive
                          ? `Currently set • Reminding at ${currentSnoozeFormatted || getSnoozeTimeLabel(opt.minutes, now)}`
                          : `Remind at ${getSnoozeTimeLabel(opt.minutes, now)}`}
                      </ThemedText>
                    </View>

                    {isOptionActive ? (
                      <View style={styles.activeSnoozeBadge}>
                        <View style={styles.activeSnoozeDotWhite} />
                        <ThemedText style={styles.activeSnoozeBadgeText}>CURRENT</ThemedText>
                      </View>
                    ) : (
                      <ThemedText style={{ color: isDark ? UiColors[effectiveTheme].textSecondary : UiColors[effectiveTheme].textMuted, fontSize: 16 }}>›</ThemedText>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Modal>

        {/* Three-Dots Header Dropdown Menu */}
        <Modal
          visible={menuVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setMenuVisible(false)}
        >
          <Pressable style={styles.menuBackdrop} onPress={() => setMenuVisible(false)}>
            <View
              style={[
                styles.menuDropdownCard,
                isDark ? styles.menuDropdownCardDark : styles.menuDropdownCardLight,
              ]}
            >
              {/* 1. Mark All as Read */}
              <Pressable
                onPress={() => {
                  setMenuVisible(false);
                  handleMarkAllRead();
                }}
                disabled={totalUnreadCount === 0 || updating}
                style={({ pressed }) => [
                  styles.menuRow,
                  { borderBottomColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border },
                  pressed && { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundSelected : UiColors[effectiveTheme].background },
                  (totalUnreadCount === 0 || updating) && { opacity: 0.4 },
                ]}
              >
                <View style={[styles.menuIconCircle, { backgroundColor: isDark ? UiColors[effectiveTheme].accentSurface : UiColors[effectiveTheme].accentSurface }]}>
                  <ThemedText style={{ color: UiColors[effectiveTheme].emerald, fontSize: 13, fontWeight: '800' }}>✓</ThemedText>
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <ThemedText style={[styles.menuRowTitle, isDark && { color: UiColors[effectiveTheme].text }]}>
                    Mark All as Read
                  </ThemedText>
                  <ThemedText style={[styles.menuRowDesc, isDark && { color: UiColors[effectiveTheme].textMuted }]}>
                    {totalUnreadCount > 0 ? `${totalUnreadCount} unread alert${totalUnreadCount > 1 ? 's' : ''}` : 'All caught up'}
                  </ThemedText>
                </View>
              </Pressable>

              {/* 2. Select Multiple */}
              <Pressable
                onPress={() => {
                  setMenuVisible(false);
                  toggleSelectionMode();
                }}
                disabled={filteredNotifications.length === 0}
                style={({ pressed }) => [
                  styles.menuRow,
                  { borderBottomColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border },
                  pressed && { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundSelected : UiColors[effectiveTheme].background },
                  filteredNotifications.length === 0 && { opacity: 0.4 },
                ]}
              >
                <View style={[styles.menuIconCircle, { backgroundColor: isDark ? 'rgba(59, 130, 246, 0.15)' : UiColors[effectiveTheme].infoSurface }]}>
                  <ThemedText style={{ color: UiColors[effectiveTheme].info, fontSize: 13, fontWeight: '800' }}>☑</ThemedText>
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <ThemedText style={[styles.menuRowTitle, isDark && { color: UiColors[effectiveTheme].text }]}>
                    Select Multiple
                  </ThemedText>
                  <ThemedText style={[styles.menuRowDesc, isDark && { color: UiColors[effectiveTheme].textMuted }]}>
                    Pick alerts to delete or mark
                  </ThemedText>
                </View>
              </Pressable>

              {/* 3. Clear All Notifications */}
              <Pressable
                onPress={() => {
                  setMenuVisible(false);
                  handleClearAll();
                }}
                disabled={notifications.length === 0}
                style={({ pressed }) => [
                  styles.menuRow,
                  { borderBottomWidth: 0 },
                  pressed && { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundSelected : UiColors[effectiveTheme].background },
                  notifications.length === 0 && { opacity: 0.4 },
                ]}
              >
                <View style={[styles.menuIconCircle, { backgroundColor: isDark ? UiColors[effectiveTheme].errorSurface : UiColors[effectiveTheme].errorSurface }]}>
                  <AppIcon name="trash" size={14} color={UiColors[effectiveTheme].error} />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <ThemedText style={[styles.menuRowTitle, { color: UiColors[effectiveTheme].error }]}>
                    Clear All Notifications
                  </ThemedText>
                  <ThemedText style={[styles.menuRowDesc, isDark && { color: UiColors[effectiveTheme].textMuted }]}>
                    Delete all alerts permanently
                  </ThemedText>
                </View>
              </Pressable>
            </View>
          </Pressable>
        </Modal>

        {/* Custom Delete Confirmation Dialog Modal */}
        <Modal
          visible={deleteModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => {
            if (!isDeletingSelected) setDeleteModalVisible(false);
          }}
        >
          <View style={styles.deleteModalOverlay}>
            <Pressable
              style={styles.deleteModalBackdrop}
              onPress={() => {
                if (!isDeletingSelected) setDeleteModalVisible(false);
              }}
            />
            <View
              style={[
                styles.deleteModalCard,
                isDark ? styles.deleteModalCardDark : styles.deleteModalCardLight,
              ]}
            >
              {/* Danger Glow Icon */}
              <View
                style={[
                  styles.deleteIconBadge,
                  { backgroundColor: isDark ? UiColors[effectiveTheme].errorSurface : UiColors[effectiveTheme].errorSurface },
                ]}
              >
                <AppIcon name="trash" size={28} color={UiColors[effectiveTheme].error} />
              </View>

              {/* Title */}
              <ThemedText style={[styles.deleteModalTitle, isDark && { color: UiColors[effectiveTheme].text }]}>
                {deleteModalConfig?.title || 'Delete Notifications'}
              </ThemedText>

              {/* Count Pill */}
              <View
                style={[
                  styles.deleteCountPill,
                  { backgroundColor: isDark ? UiColors[effectiveTheme].errorSurface : UiColors[effectiveTheme].errorSurface },
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <AppIcon name="alert-octagon" size={12} color={isDark ? '#f87171' : '#dc2626'} />
                  <ThemedText style={[styles.deleteCountPillText, { color: isDark ? UiColors[effectiveTheme].error : UiColors[effectiveTheme].error }]}>
                    {deleteModalConfig?.count || 0} {deleteModalConfig?.isClearAll ? 'Total' : 'Selected'} Alert{(deleteModalConfig?.count || 0) > 1 ? 's' : ''}
                  </ThemedText>
                </View>
              </View>

              {/* Message */}
              <ThemedText style={[styles.deleteModalMessage, isDark && { color: UiColors[effectiveTheme].textMuted }]}>
                {deleteModalConfig?.description || 'Are you sure you want to delete these notifications?'}
              </ThemedText>

              {/* Warning note */}
              <View
                style={[
                  styles.deleteWarningBox,
                  { backgroundColor: isDark ? 'rgba(15, 23, 42, 0.6)' : UiColors[effectiveTheme].background, borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border },
                ]}
              >
                <ThemedText style={[styles.deleteWarningBoxText, isDark && { color: UiColors[effectiveTheme].textMuted }]}>
                  This action is permanent and cannot be undone.
                </ThemedText>
              </View>

              {/* Action Buttons */}
              <View style={styles.deleteActionsRow}>
                <Pressable
                  onPress={() => setDeleteModalVisible(false)}
                  disabled={isDeletingSelected}
                  style={({ pressed }) => [
                    styles.deleteCancelBtn,
                    isDark ? styles.deleteCancelBtnDark : styles.deleteCancelBtnLight,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <ThemedText style={[styles.deleteCancelBtnText, isDark && { color: UiColors[effectiveTheme].textMuted }]}>
                    Cancel
                  </ThemedText>
                </Pressable>

                <Pressable
                  onPress={async () => {
                    if (deleteModalConfig?.onConfirm) {
                      await deleteModalConfig.onConfirm();
                      setDeleteModalVisible(false);
                    }
                  }}
                  disabled={isDeletingSelected}
                  style={({ pressed }) => [
                    styles.deleteConfirmBtn,
                    pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
                  ]}
                >
                  {isDeletingSelected ? (
                    <ActivityIndicator size="small" color={UiColors[effectiveTheme].onPrimary} />
                  ) : (
                    <ThemedText style={styles.deleteConfirmBtnText}>
                      Delete {deleteModalConfig?.count ? `(${deleteModalConfig.count})` : ''}
                    </ThemedText>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* Floating Bottom Navigation */}
        <FloatingBottomNavbar currentPage="notifications" />
      </SafeAreaView>
    </LinearGradient>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    flex: 1,
  },
  scrollContentContainer: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerLogo: {
    width: 36,
    height: 36,
    borderRadius: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  headerStatusBadgeLight: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.border,
  },
  headerStatusBadgeDark: {
    backgroundColor: colors.backgroundSelected,
    borderColor: colors.border,
  },
  headerStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.primaryFill,
  },
  headerStatusText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: colors.emerald,
  },
  markAllReadBtn: {
    backgroundColor: colors.primaryFill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  markAllReadText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.onPrimary,
    letterSpacing: 0.3,
  },
  filterScrollView: {
    marginBottom: 16,
  },
  filterScroll: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 16,
  },
  pillButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillActive: {
    backgroundColor: colors.primaryFill,
    borderColor: colors.emerald,
  },
  pillInactiveLight: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.border,
  },
  pillInactiveDark: {
    backgroundColor: colors.backgroundSelected,
    borderColor: colors.border,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  pillTextActive: {
    color: colors.onPrimary,
  },
  pillTextInactiveLight: {
    color: '#4b5563',
  },
  pillTextInactiveDark: {
    color: colors.textMuted,
  },
  pillWithDot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  filterUnreadBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ef4444',
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  loadingCard: {
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    width: '100%',
  },
  cardLight: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.panelBorder,
  },
  cardDark: {
    backgroundColor: colors.backgroundSelected,
    borderColor: colors.panelBorder,
  },
  loadingTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginTop: 12,
  },
  loadingSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyBeaconOuter: {
    position: 'absolute',
    top: 55,
    width: 76,
    height: 76,
    borderRadius: 38,
  },
  beaconOuterLight: {
    backgroundColor: colors.accentSurface,
  },
  beaconOuterDark: {
    backgroundColor: colors.accentSurface,
  },
  emptyBeaconInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
  },
  beaconInnerLight: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.border,
  },
  beaconInnerDark: {
    backgroundColor: colors.backgroundSelected,
    borderColor: colors.border,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 260,
  },
  groupSection: {
    marginBottom: 20,
  },
  groupHeader: {
    marginBottom: 10,
  },
  groupTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4b5563',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  notificationItem: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  itemUnreadLight: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.border,
  },
  itemUnreadDark: {
    backgroundColor: colors.backgroundSelected,
    borderColor: colors.border,
  },
  itemReadLight: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  itemReadDark: {
    backgroundColor: '#131d2e',
    borderColor: colors.border,
  },
  itemPressed: {
    opacity: 0.9,
  },
  avatarWrapper: {
    marginRight: 12,
    paddingTop: 2,
  },
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemBody: {
    flex: 1,
  },
  itemHeaderLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 8,
  },
  levelChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    flexShrink: 1,
  },
  levelChipText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  timeText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '500',
    flexShrink: 0,
    textAlign: 'right',
  },
  boldSubject: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  msgText: {
    fontSize: 13,
    color: '#4b5563',
    lineHeight: 18,
  },
  normalBody: {
    fontSize: 13,
    color: '#4b5563',
    lineHeight: 18,
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  metaItemLight: {
    backgroundColor: colors.backgroundSelected,
  },
  metaItemDark: {
    backgroundColor: '#0f172a',
  },
  metaEquipmentLight: {
    backgroundColor: colors.accentSurface,
    borderWidth: 0.5,
    borderColor: colors.border,
  },
  metaEquipmentDark: {
    backgroundColor: colors.accentSurface,
    borderWidth: 0.5,
    borderColor: colors.border,
  },
  metaStaffLight: {
    backgroundColor: colors.accentSurface,
  },
  metaStaffDark: {
    backgroundColor: colors.accentSurface,
  },
  metaText: {
    fontSize: 11,
    color: '#4b5563',
    fontWeight: '600',
    maxWidth: 200,
  },
  notifVerificationBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginTop: 6,
    borderWidth: 0.5,
  },
  notifVerificationLight: {
    backgroundColor: '#f5f3ff',
    borderColor: colors.border,
  },
  notifVerificationDark: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderColor: colors.border,
  },
  notifVerificationText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: colors.info,
    flex: 1,
  },
  dueBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  dueBadgeLight: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.border,
  },
  dueBadgeDark: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.border,
  },
  dueBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.warning,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    marginTop: 10,
    borderWidth: 1,
  },
  actionBtnLight: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.border,
  },
  actionBtnDark: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.border,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  actionBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    paddingVertical: 4,
  },
  actionBtnSecondaryLight: {},
  actionBtnSecondaryDark: {},
  actionBtnSecondaryText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.emerald,
  },
  rightActions: {
    alignItems: 'center',
    justifyContent: 'space-between',
    marginLeft: 8,
    paddingVertical: 2,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  moreDotButton: {
    padding: 4,
  },
  moreDotFallback: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '900',
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    zIndex: 9999,
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheetContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 34,
    maxHeight: SCREEN_HEIGHT * 0.75,
  },
  sheetContainerLight: {
    backgroundColor: colors.backgroundElement,
  },
  sheetContainerDark: {
    backgroundColor: colors.backgroundElement,
    borderTopWidth: 1.5,
    borderTopColor: colors.border,
  },
  sheetHandle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#d1d5db',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 14,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  closeBtn: {
    padding: 6,
  },
  sheetBody: {
    marginBottom: 10,
  },
  detailCard: {
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
  },
  detailCardLight: {
    backgroundColor: colors.background,
    borderColor: colors.panelBorder,
  },
  detailCardDark: {
    backgroundColor: '#0f172a',
    borderColor: colors.panelBorder,
  },
  detailCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
  },
  detailCardMessage: {
    fontSize: 14,
    color: '#4b5563',
    lineHeight: 20,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  detailRowLight: {
    borderBottomColor: colors.border,
  },
  detailRowDark: {
    borderBottomColor: colors.border,
  },
  detailLabel: {
    flexShrink: 1,
    maxWidth: '44%',
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  detailValue: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    color: colors.text,
    fontWeight: '600',
    maxWidth: '60%',
    textAlign: 'right',
  },

  // Redesigned Launch Maintenance Checklist Button
  sheetActionBtn: {
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 20,
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.35,
        shadowRadius: 10,
      },
      android: {
        elevation: 5,
      },
    }),
  },
  sheetActionBtnLight: {
    backgroundColor: colors.primaryFill,
  },
  sheetActionBtnDark: {
    backgroundColor: colors.primaryFill,
  },
  sheetActionBtnPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
  sheetActionBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sheetActionBtnIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetActionBtnTitle: {
    color: colors.onPrimary,
    fontSize: 14.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  sheetActionBtnSubtitle: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 11.5,
    fontWeight: '600',
    marginTop: 1,
  },
  sheetActionBtnArrow: {
    fontSize: 18,
    color: colors.onPrimary,
    fontWeight: '900',
    marginRight: 4,
  },

  optionsContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 34,
  },
  optionsContainerLight: {
    backgroundColor: colors.backgroundElement,
  },
  optionsContainerDark: {
    backgroundColor: colors.backgroundElement,
    borderTopWidth: 1.5,
    borderTopColor: colors.border,
  },
  optionsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 14,
    textAlign: 'center',
  },
  optionRow: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optionText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
  },

  // Snooze Time Picker Modal
  snoozeBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  snoozeCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  snoozeCardLight: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.panelBorder,
  },
  snoozeCardDark: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.panelBorder,
  },
  snoozeHeaderRow: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: 'center',
  },
  snoozeTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  snoozeSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  snoozeOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  snoozeIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snoozeOptionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  snoozeOptionHint: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  currentSnoozeAlertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 14,
    marginTop: 12,
    marginBottom: 6,
    borderRadius: 12,
    borderWidth: 1.2,
  },
  currentSnoozeAlertLight: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.border,
  },
  currentSnoozeAlertDark: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.border,
  },
  currentSnoozeTag: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.emerald,
    letterSpacing: 0.5,
  },
  currentSnoozeTimeText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
    marginTop: 2,
  },
  cancelSnoozeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.errorSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelSnoozeBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.error,
  },
  snoozeOptionRowActiveLight: {
    backgroundColor: colors.accentSurface,
    borderLeftWidth: 4,
    borderLeftColor: colors.emerald,
  },
  snoozeOptionRowActiveDark: {
    backgroundColor: colors.accentSurface,
    borderLeftWidth: 4,
    borderLeftColor: colors.emerald,
  },
  activeSnoozeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: colors.primaryFill,
  },
  activeSnoozeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primaryFill,
  },
  activeSnoozeDotWhite: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.backgroundElement,
  },
  activeSnoozeBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.onPrimary,
    letterSpacing: 0.3,
  },

  // Three-Dots Vertical Menu Button & Dropdown Styles
  headerThreeDotsBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  headerThreeDotsBtnLight: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.border,
  },
  headerThreeDotsBtnDark: {
    backgroundColor: colors.backgroundSelected,
    borderColor: colors.border,
  },
  threeDotsColumn: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3.5,
  },
  dotVertical: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  menuDropdownCard: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 95 : 78,
    right: 16,
    width: 260,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 4,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 10,
  },
  menuDropdownCardLight: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.panelBorder,
  },
  menuDropdownCardDark: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.panelBorder,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
  },
  menuIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuRowTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    fontFamily: 'Roboto',
  },
  menuRowDesc: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 1,
    fontFamily: 'Roboto',
  },

  // Selection Header Buttons
  selectModeBtn: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  selectModeBtnLight: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.border,
  },
  selectModeBtnDark: {
    backgroundColor: colors.backgroundSelected,
    borderColor: colors.border,
  },
  selectModeBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#374151',
  },
  selectAllHeaderBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 8,
    borderWidth: 1,
  },
  selectAllHeaderBtnLight: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.border,
  },
  selectAllHeaderBtnDark: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.border,
  },
  selectAllHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.emerald,
  },
  cancelSelectBtn: {
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 8,
    borderWidth: 1,
  },
  cancelSelectBtnLight: {
    backgroundColor: colors.backgroundSelected,
    borderColor: colors.border,
  },
  cancelSelectBtnDark: {
    backgroundColor: colors.backgroundSelected,
    borderColor: colors.border,
  },
  cancelSelectText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },

  // Card Selection Highlights
  itemSelectedLight: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.emerald,
    borderWidth: 1.5,
  },
  itemSelectedDark: {
    backgroundColor: '#0c281e',
    borderColor: colors.emerald,
    borderWidth: 1.5,
  },

  // Checkbox Styles
  selectCheckboxWrapper: {
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectCheckboxLight: {
    borderColor: colors.border,
    backgroundColor: colors.backgroundElement,
  },
  selectCheckboxDark: {
    borderColor: colors.border,
    backgroundColor: '#0f172a',
  },
  selectCheckboxChecked: {
    backgroundColor: colors.primaryFill,
    borderColor: colors.border,
  },
  selectCheckmark: {
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 14,
  },

  // Floating Selection Action Bar
  selectionBarContainer: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 104 : 92,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1.5,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 12,
    zIndex: 1100,
  },
  selectionBarLight: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.border,
  },
  selectionBarDark: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.border,
  },
  selectionBarLeft: {
    flex: 1,
  },
  selectionCountText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  selectionCountNumber: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.emerald,
  },
  selectionBarRight: {
    marginLeft: 10,
  },
  deleteSelectedBtn: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  deleteSelectedBtnDisabled: {
    backgroundColor: '#9ca3af',
    opacity: 0.5,
    shadowOpacity: 0,
    elevation: 0,
  },
  deleteSelectedText: {
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  // Custom Delete Confirmation Modal Styles
  deleteModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  deleteModalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  deleteModalCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 20,
    alignItems: 'center',
    borderWidth: 1.2,
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.35,
        shadowRadius: 20,
      },
      android: {
        elevation: 14,
      },
    }),
  },
  deleteModalCardLight: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.panelBorder,
  },
  deleteModalCardDark: {
    backgroundColor: colors.backgroundSelected,
    borderColor: colors.panelBorder,
  },
  deleteIconBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  deleteModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
    fontFamily: 'Roboto',
  },
  deleteCountPill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    marginBottom: 10,
  },
  deleteCountPillText: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  deleteModalMessage: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 14,
    paddingHorizontal: 4,
    fontFamily: 'Roboto',
  },
  deleteWarningBox: {
    width: '100%',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 18,
    alignItems: 'center',
  },
  deleteWarningBoxText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
    textAlign: 'center',
    fontFamily: 'Roboto',
  },
  deleteActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
  },
  deleteCancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  deleteCancelBtnLight: {
    backgroundColor: colors.backgroundSelected,
    borderColor: colors.border,
  },
  deleteCancelBtnDark: {
    backgroundColor: colors.backgroundSelected,
    borderColor: colors.border,
  },
  deleteCancelBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: colors.textSecondary,
    fontFamily: 'Roboto',
  },
  deleteConfirmBtn: {
    flex: 1.3,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  deleteConfirmBtnText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: colors.onPrimary,
    fontFamily: 'Roboto',
  },
  textWhite: {
    color: colors.onPrimary,
  },
  fbListGroup: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    marginBottom: 16,
  },
  fbListGroupLight: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.border,
  },
  fbListGroupDark: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.border,
  },
  fbNotificationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  fbRowDividerLight: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  fbRowDividerDark: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  fbRowUnreadLight: {
    backgroundColor: colors.accentSurface,
  },
  fbRowUnreadDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  fbRowReadLight: {
    backgroundColor: 'transparent',
  },
  fbRowReadDark: {
    backgroundColor: 'transparent',
  },
  fbAvatarWrapper: {
    position: 'relative',
    width: 46,
    height: 46,
    flexShrink: 0,
    marginTop: 2,
  },
  fbAvatarCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fbMiniBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  fbBody: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  fbMainText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'Roboto',
  },
  fbTitleBold: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  fbMessageText: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: 'Roboto',
    marginTop: 2,
  },
  fbMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 5,
  },
  fbTimeText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
    fontFamily: 'Roboto',
  },
  fbTimeUnread: {
    fontSize: 12,
    color: colors.emerald,
    fontWeight: '700',
    fontFamily: 'Roboto',
  },
  fbMetaDotText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
    fontFamily: 'Roboto',
    maxWidth: 160,
  },
  fbMetaDueText: {
    fontSize: 12,
    color: colors.warning,
    fontWeight: '700',
    fontFamily: 'Roboto',
  },
  fbVerificationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  fbVerificationLight: {
    backgroundColor: colors.infoSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fbVerificationDark: {
    backgroundColor: colors.infoSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fbVerificationText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'Roboto',
  },
  fbReportId: {
    marginTop: 8,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
    fontFamily: 'Roboto',
  },
  fbActionIcon: {
    flexShrink: 0,
  },
  fbActionRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 9,
  },
  fbPrimaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.primaryFill,
    minHeight: 44,
    flexBasis: 108,
    flexGrow: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    flexShrink: 1,
  },
  fbPrimaryActionBtnText: {
    flexShrink: 1,
    textAlign: 'center',
    lineHeight: 18,
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Roboto',
  },
  fbSecondaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    flexBasis: 76,
    flexGrow: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    flexShrink: 1,
  },
  fbSecondaryActionBtnLight: {
    backgroundColor: colors.backgroundSelected,
  },
  fbSecondaryActionBtnDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  fbSecondaryActionBtnText: {
    flexShrink: 1,
    textAlign: 'center',
    lineHeight: 18,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    fontFamily: 'Roboto',
  },
  fbRightActions: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 2,
    gap: 10,
    minHeight: 44,
  },
  fbMoreBtn: {
    padding: 4,
    borderRadius: 12,
  },
  fbMoreDots: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '900',
    letterSpacing: -1,
  },
  fbUnreadDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.primaryFill,
  },
});
const themedStyles = { light: createStyles(UiColors.light), dark: createStyles(UiColors.dark) };
import { DataListSkeleton } from '@/components/data-list-skeleton';
