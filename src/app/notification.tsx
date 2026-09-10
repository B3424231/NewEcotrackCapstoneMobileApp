import React, { useState, useRef, useEffect, useMemo } from 'react';
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
import { Colors, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useSettings } from '@/context/settings-context';
import { FloatingBottomNavbar } from '@/components/floating-navbar';
import { LinearGradient } from 'expo-linear-gradient';
import { AppIcon } from '@/components/app-icon';
import { ICON_AIRCONSTATE, ICON_CHECKLIST } from '@/constants/custom-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  MobileNotificationItem,
  fetchLiveMobileNotifications,
  deduplicateMobileNotifications,
  subscribeToMobileNotifications,
  markMobileNotificationAsRead,
  markAllMobileNotificationsAsRead,
  deleteMobileNotification,
  deleteMultipleMobileNotifications,
  snoozeMobileNotification,
  unsnoozeMobileNotification,
} from '@/services/mobile-notifications';
import Constants from 'expo-constants';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const SCREEN_WIDTH = Dimensions.get('window').width;

// Safe-resolve expo-notifications dynamically
let Notifications: any = null;
const isExpoGo =
  (Constants.executionEnvironment as string) === 'store-client' ||
  Constants.appOwnership === 'expo';

if (!isExpoGo) {
  try {
    Notifications = require('expo-notifications');
    if (Notifications && typeof Notifications.setNotificationHandler === 'function') {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });
    }
  } catch (_e) {
    // Not supported in this environment
  }
}

async function setupNotificationChannels() {
  if (!Notifications) return;
  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync('alerts', {
        name: 'Alert Notifications',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#ef4444',
      });
      await Notifications.setNotificationChannelAsync('messages', {
        name: 'Maintenance Task Reminders',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 200, 100, 200],
        lightColor: '#10b981',
      });
    } catch (_e) {
      /* noop */
    }
  }
}

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
function getSnoozeTimeLabel(minutes: number): string {
  const now = new Date();
  const target = new Date(now.getTime() + minutes * 60 * 1000);
  return target.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function NotificationScreen() {
  const { userName } = useAuth();
  const { effectiveTheme, colors, triggerHaptic } = useSettings();
  const theme = effectiveTheme;

  // Setup notification channels
  useEffect(() => {
    setupNotificationChannels();
  }, []);

  // Modal states
  const [selectedNotification, setSelectedNotification] = useState<MobileNotificationItem | null>(null);
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
  const detailsSlideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const optionsSlideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Filter state
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');

  // Live Notifications State
  const [notifications, setNotifications] = useState<MobileNotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Current snooze calculation for target notification
  const currentSnoozeItem = useMemo(() => {
    if (!snoozeTargetId) return null;
    return notifications.find((n) => n.id === snoozeTargetId) || null;
  }, [snoozeTargetId, notifications]);

  const isTargetSnoozed = Boolean(
    currentSnoozeItem?.isSnoozed &&
    currentSnoozeItem?.snoozeUntil &&
    new Date(currentSnoozeItem.snoozeUntil).getTime() > Date.now()
  );

  const activeSnoozeMinutes = useMemo(() => {
    if (!isTargetSnoozed || !snoozeTargetId) return null;
    if (snoozeDurations[snoozeTargetId]) {
      return snoozeDurations[snoozeTargetId];
    }
    if (currentSnoozeItem?.snoozeUntil) {
      const remaining = Math.max(1, Math.round((new Date(currentSnoozeItem.snoozeUntil).getTime() - Date.now()) / 60000));
      const SNOOZE_OPTIONS = [15, 30, 60, 120, 240, 480, 1440];
      return SNOOZE_OPTIONS.reduce((prev, curr) =>
        Math.abs(curr - remaining) < Math.abs(prev - remaining) ? curr : prev
      );
    }
    return null;
  }, [isTargetSnoozed, snoozeTargetId, snoozeDurations, currentSnoozeItem]);

  const currentSnoozeFormatted = useMemo(() => {
    if (!isTargetSnoozed || !currentSnoozeItem?.snoozeUntil) return null;
    return new Date(currentSnoozeItem.snoozeUntil).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [isTargetSnoozed, currentSnoozeItem]);

  const remainingMins = useMemo(() => {
    if (!isTargetSnoozed || !currentSnoozeItem?.snoozeUntil) return null;
    return Math.max(1, Math.round((new Date(currentSnoozeItem.snoozeUntil).getTime() - Date.now()) / 60000));
  }, [isTargetSnoozed, currentSnoozeItem]);

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
  }, []);

  const loadNotifications = async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const data = await fetchLiveMobileNotifications(userName);
      const cleanData = deduplicateMobileNotifications(data || []);
      setNotifications(cleanData);
    } catch (e) {
      console.error('Error loading mobile notifications:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadNotifications(true);
    const unsubscribe = subscribeToMobileNotifications(() => {
      loadNotifications(false);
    });
    return () => {
      unsubscribe();
    };
  }, [userName]);

  const onRefresh = () => {
    setRefreshing(true);
    loadNotifications(false);
  };

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
    const nextRead = !note.isRead;
    setNotifications((prev) =>
      prev.map((n) => (n.id === note.id ? { ...n, isRead: nextRead } : n))
    );
    await markMobileNotificationAsRead(note.id, nextRead);
  };

  const handleMarkAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    await markAllMobileNotificationsAsRead(userName);
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
        setNotifications([]);
        setSelectedIds([]);
        setIsSelectionMode(false);
        await deleteMultipleMobileNotifications(allIds);
        setIsDeletingSelected(false);
      },
    });
    setDeleteModalVisible(true);
  };

  const handleDelete = async (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setSelectedIds((prev) => prev.filter((item) => item !== id));
    await deleteMobileNotification(id);
    closeOptions();
  };

  const openSnoozePicker = (id: string) => {
    setSnoozeTargetId(id);
    closeOptions();
    setTimeout(() => setSnoozePickerVisible(true), 300);
  };

  const handleSnoozeWithDuration = async (minutes: number) => {
    if (!snoozeTargetId) return;
    triggerHaptic();
    const snoozeTime = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    setNotifications((prev) =>
      prev.map((n) => (n.id === snoozeTargetId ? { ...n, isSnoozed: true, snoozeUntil: snoozeTime } : n))
    );

    const updatedMap = { ...snoozeDurations, [snoozeTargetId]: minutes };
    setSnoozeDurations(updatedMap);
    await AsyncStorage.setItem('@ecotrack_snooze_durations', JSON.stringify(updatedMap));

    await snoozeMobileNotification(snoozeTargetId, minutes);
    setSnoozePickerVisible(false);
    setSnoozeTargetId(null);
  };

  const handleCancelSnooze = async (id: string) => {
    triggerHaptic();
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isSnoozed: false, snoozeUntil: undefined } : n))
    );

    const updatedMap = { ...snoozeDurations };
    delete updatedMap[id];
    setSnoozeDurations(updatedMap);
    await AsyncStorage.setItem('@ecotrack_snooze_durations', JSON.stringify(updatedMap));

    await unsnoozeMobileNotification(id);
    setSnoozePickerVisible(false);
    setSnoozeTargetId(null);
  };

  const handleOpenTask = (note: MobileNotificationItem) => {
    closeDetails();
    if (note.relatedReportId) {
      const isRepair = note.relatedReportId.startsWith('REP-') || note.type === 'urgent_repair';
      if (isRepair) {
        router.push({
          pathname: '/Maintenance' as any,
          params: {
            reportId: note.relatedReportId,
            repairId: note.relatedReportId,
            screen: 'REPAIR',
          },
        });
      } else {
        router.push({
          pathname: '/Maintenance' as any,
          params: { reportId: note.relatedReportId },
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
        setNotifications((prev) => prev.filter((n) => !idsToDelete.includes(n.id)));
        setSelectedIds([]);
        setIsSelectionMode(false);
        await deleteMultipleMobileNotifications(idsToDelete);
        setIsDeletingSelected(false);
      },
    });
    setDeleteModalVisible(true);
  };

  const isDark = effectiveTheme === 'dark';

  // Priority Styling Mapping
  const getPriorityStyle = (note: MobileNotificationItem) => {
    const isVerifiedRepair =
      note.title?.toLowerCase().includes('verified') ||
      note.message?.toLowerCase().includes('verified') ||
      note.message?.toLowerCase().includes('repaired');

    if (isVerifiedRepair) {
      return {
        bg: isDark ? 'rgba(16, 185, 129, 0.2)' : '#d1fae5',
        border: isDark ? 'rgba(16, 185, 129, 0.45)' : '#6ee7b7',
        icon: ICON_2D_CHECK_GREEN,
        textColor: isDark ? '#34d399' : '#059669',
        badgeBg: isDark ? 'rgba(16, 185, 129, 0.15)' : '#ecfdf5',
        badgeBorder: isDark ? 'rgba(16, 185, 129, 0.35)' : '#a7f3d0',
        badgeText: isDark ? '#6ee7b7' : '#047857',
        tagLabel: '✓ REPAIRED & VERIFIED',
        accentBorder: '#10b981',
      };
    }

    const isCritical = note.priority === 'critical' || note.type === 'urgent_repair';
    const isHighOrOverdue = note.priority === 'high' || note.type === 'overdue_alert';
    const isDueReminder = note.type === 'task_reminder';
    const isNewTask = note.type === 'task_assigned';

    if (isCritical) {
      return {
        bg: isDark ? 'rgba(239, 68, 68, 0.2)' : '#fee2e2',
        border: isDark ? 'rgba(239, 68, 68, 0.45)' : '#fca5a5',
        icon: ICON_2D_CRITICAL_RED,
        textColor: isDark ? '#f87171' : '#dc2626',
        badgeBg: isDark ? 'rgba(239, 68, 68, 0.15)' : '#fef2f2',
        badgeBorder: isDark ? 'rgba(239, 68, 68, 0.35)' : '#fecaca',
        badgeText: isDark ? '#fca5a5' : '#b91c1c',
        tagLabel: 'CRITICAL DEFECT',
        accentBorder: '#ef4444',
      };
    }

    if (isHighOrOverdue) {
      return {
        bg: isDark ? 'rgba(245, 158, 11, 0.2)' : '#fef3c7',
        border: isDark ? 'rgba(245, 158, 11, 0.45)' : '#fcd34d',
        icon: ICON_2D_WARNING_AMBER,
        textColor: isDark ? '#fbbf24' : '#d97706',
        badgeBg: isDark ? 'rgba(245, 158, 11, 0.15)' : '#fffbeb',
        badgeBorder: isDark ? 'rgba(245, 158, 11, 0.35)' : '#fde68a',
        badgeText: isDark ? '#fde68a' : '#b45309',
        tagLabel: note.type === 'overdue_alert' ? 'OVERDUE' : 'HIGH PRIORITY',
        accentBorder: '#f59e0b',
      };
    }

    if (isDueReminder) {
      return {
        bg: isDark ? 'rgba(234, 179, 8, 0.2)' : '#fef3c7',
        border: isDark ? 'rgba(234, 179, 8, 0.45)' : '#fde68a',
        icon: ICON_2D_WARNING_AMBER,
        textColor: isDark ? '#facc15' : '#b45309',
        badgeBg: isDark ? 'rgba(234, 179, 8, 0.15)' : '#fffbeb',
        badgeBorder: isDark ? 'rgba(234, 179, 8, 0.35)' : '#fde68a',
        badgeText: isDark ? '#fef08a' : '#92400e',
        tagLabel: 'DUE TODAY',
        accentBorder: '#eab308',
      };
    }

    if (isNewTask) {
      return {
        bg: isDark ? 'rgba(168, 85, 247, 0.2)' : '#f3e8ff',
        border: isDark ? 'rgba(168, 85, 247, 0.45)' : '#d8b4fe',
        icon: ICON_2D_TASK_PURPLE,
        textColor: isDark ? '#c084fc' : '#7e22ce',
        badgeBg: isDark ? 'rgba(168, 85, 247, 0.15)' : '#faf5ff',
        badgeBorder: isDark ? 'rgba(168, 85, 247, 0.35)' : '#e9d5ff',
        badgeText: isDark ? '#e9d5ff' : '#6b21a8',
        tagLabel: 'NEW TASK',
        accentBorder: '#9333ea',
      };
    }

    return {
      bg: isDark ? 'rgba(16, 185, 129, 0.2)' : '#d1fae5',
      border: isDark ? 'rgba(16, 185, 129, 0.45)' : '#6ee7b7',
      icon: ICON_2D_CHECK_GREEN,
      textColor: isDark ? '#34d399' : '#059669',
      badgeBg: isDark ? 'rgba(16, 185, 129, 0.15)' : '#ecfdf5',
      badgeBorder: isDark ? 'rgba(16, 185, 129, 0.35)' : '#a7f3d0',
      badgeText: isDark ? '#6ee7b7' : '#047857',
      tagLabel: 'SCHEDULED',
      accentBorder: '#10b981',
    };
  };

  const formatTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return 'Recently';
      const datePart = d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      const timePart = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `${datePart} • ${timePart}`;
    } catch (_e) {
      return 'Recently';
    }
  };

  return (
    <LinearGradient
      colors={theme === 'dark' ? ['#0f172a', '#0a0f1d'] : ['#d1fae5', '#ffffff']}
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
                    <ThemedText style={[styles.selectAllHeaderText, isDark && { color: '#34d399' }]}>
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
                    <ThemedText style={[styles.cancelSelectText, isDark && { color: '#94a3b8' }]}>Cancel</ThemedText>
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
                    <View style={[styles.dotVertical, { backgroundColor: isDark ? '#cbd5e1' : '#1e293b' }]} />
                    <View style={[styles.dotVertical, { backgroundColor: isDark ? '#cbd5e1' : '#1e293b' }]} />
                    <View style={[styles.dotVertical, { backgroundColor: isDark ? '#cbd5e1' : '#1e293b' }]} />
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
            <View style={styles.loadingContainer}>
              <View style={[styles.loadingCard, isDark ? styles.cardDark : styles.cardLight]}>
                <ActivityIndicator size="large" color="#059669" />
                <ThemedText style={[styles.loadingTitle, isDark && { color: '#f1f5f9' }]}>
                  Syncing Task Reminders
                </ThemedText>
                <ThemedText style={[styles.loadingSubtitle, isDark && { color: '#94a3b8' }]}>
                  Checking upcoming maintenance and schedules...
                </ThemedText>
              </View>
            </View>
          )}

          {/* Empty State */}
          {!loading && filteredNotifications.length === 0 && (
            <View style={styles.emptyContainer}>
              <Animated.View
                style={[
                  styles.emptyBeaconOuter,
                  isDark ? styles.beaconOuterDark : styles.beaconOuterLight,
                  { transform: [{ scale: pulseAnim }] },
                ]}
              />
              <View style={[styles.emptyBeaconInner, isDark ? styles.beaconInnerDark : styles.beaconInnerLight]}>
                <Image
                  source={{ uri: ICON_2D_CHECK_GREEN }}
                  style={{ width: 36, height: 36 }}
                  contentFit="contain"
                />
              </View>
              <ThemedText style={[styles.emptyTitle, isDark && { color: '#f1f5f9' }]}>
                All caught up!
              </ThemedText>
              <ThemedText style={[styles.emptySubtitle, isDark && { color: '#94a3b8' }]}>
                No pending maintenance reminders or task alerts in this view.
              </ThemedText>
            </View>
          )}

          {/* Render Unread Section */}
          {!loading && unreadItems.length > 0 && (
            <View style={styles.groupSection}>
              <View style={styles.groupHeader}>
                <ThemedText style={[styles.groupTitle, isDark && { color: '#94a3b8' }]}>
                  New Alerts & Reminders ({unreadItems.length})
                </ThemedText>
              </View>
              {unreadItems.map((note) => {
                const styleInfo = getPriorityStyle(note);
                const isSelected = selectedIds.includes(note.id);
                return (
                  <Pressable
                    key={note.id}
                    onPress={() => {
                      if (isSelectionMode) {
                        toggleSelectNotification(note.id);
                      } else {
                        openDetails(note);
                      }
                    }}
                    onLongPress={() => {
                      if (!isSelectionMode) {
                        setIsSelectionMode(true);
                        setSelectedIds([note.id]);
                      }
                    }}
                    style={({ pressed }) => [
                      styles.notificationItem,
                      isDark ? styles.itemUnreadDark : styles.itemUnreadLight,
                      { borderLeftColor: styleInfo.accentBorder, borderLeftWidth: 4 },
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

                    {/* Left Icon */}
                    <View style={styles.avatarWrapper}>
                      <View
                        style={[
                          styles.avatarCircle,
                          {
                            backgroundColor: styleInfo.bg,
                            borderColor: styleInfo.border,
                            borderWidth: 1.5,
                          },
                        ]}
                      >
                        <Image
                          source={{ uri: styleInfo.icon }}
                          style={{ width: 22, height: 22 }}
                          contentFit="contain"
                        />
                      </View>
                    </View>

                    {/* Content Body */}
                    <View style={styles.itemBody}>
                      <View style={styles.itemHeaderLine}>
                        <View
                          style={[
                            styles.levelChip,
                            {
                              backgroundColor: styleInfo.badgeBg,
                              borderColor: styleInfo.badgeBorder,
                            },
                          ]}
                        >
                          <ThemedText
                            style={[
                              styles.levelChipText,
                              { color: styleInfo.badgeText },
                            ]}
                          >
                            {styleInfo.tagLabel}
                          </ThemedText>
                        </View>
                        <ThemedText style={[styles.timeText, isDark && { color: '#94a3b8' }]}>
                          {formatTime(note.createdAt)}
                        </ThemedText>
                      </View>

                      <ThemedText style={[styles.boldSubject, { color: styleInfo.textColor }]}>
                        {note.title}
                      </ThemedText>

                      <ThemedText style={[styles.normalBody, isDark && { color: '#cbd5e1' }]} numberOfLines={3}>
                        {note.message}
                      </ThemedText>

                      {/* Equipment, Location & Due Date Meta Row */}
                      {(note.airconName || note.location || note.dueDate || note.staffName) && (
                        <View style={styles.cardMetaRow}>
                          {note.airconName && (
                            <View style={[styles.metaItem, isDark ? styles.metaEquipmentDark : styles.metaEquipmentLight]}>
                              <Image
                                source={{ uri: ICON_AIRCONSTATE }}
                                style={{ width: 11, height: 11, tintColor: isDark ? '#34d399' : '#059669' }}
                                contentFit="contain"
                              />
                              <ThemedText style={[styles.metaText, isDark && { color: '#34d399' }]} numberOfLines={1}>
                                {note.airconName}{note.airconType ? ` • ${note.airconType}` : ''}
                              </ThemedText>
                            </View>
                          )}
                          {note.location && (
                            <View style={[styles.metaItem, isDark ? styles.metaItemDark : styles.metaItemLight]}>
                              <Image
                                source={{ uri: ICON_PIN }}
                                style={{ width: 12, height: 12, tintColor: isDark ? '#34d399' : '#059669' }}
                                contentFit="contain"
                              />
                              <ThemedText style={[styles.metaText, isDark && { color: '#cbd5e1' }]} numberOfLines={1}>
                                {note.location}
                              </ThemedText>
                            </View>
                          )}
                          {note.dueDate && (
                            <View style={[styles.dueBadge, isDark ? styles.dueBadgeDark : styles.dueBadgeLight]}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                <AppIcon name="calendar" size={11} color={isDark ? '#fbbf24' : '#d97706'} />
                                <ThemedText style={[styles.dueBadgeText, isDark && { color: '#fbbf24' }]}>
                                  Due: {note.dueDate}
                                </ThemedText>
                              </View>
                            </View>
                          )}
                          {note.staffName && note.staffName !== 'Maintenance Staff' && (
                            <View style={[styles.metaItem, isDark ? styles.metaStaffDark : styles.metaStaffLight]}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                <AppIcon name="user" size={11} color={isDark ? '#34d399' : '#047857'} />
                                <ThemedText style={[styles.metaText, { color: isDark ? '#34d399' : '#047857' }]} numberOfLines={1}>
                                  {note.staffName}
                                </ThemedText>
                              </View>
                            </View>
                          )}
                        </View>
                      )}

                      {/* Admin Verification Remarks snippet if present */}
                      {note.verificationRemarks ? (
                        <View style={[styles.notifVerificationBanner, isDark ? styles.notifVerificationDark : styles.notifVerificationLight]}>
                          <AppIcon name="shield" size={13} color={isDark ? '#c4b5fd' : '#7e22ce'} />
                          <ThemedText style={[styles.notifVerificationText, isDark && { color: '#c4b5fd' }]} numberOfLines={2}>
                            Admin Remarks: {note.verificationRemarks}
                          </ThemedText>
                        </View>
                      ) : null}

                      {/* Quick Direct Link Button (Redesigned) */}
                      {note.relatedReportId && (
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            handleOpenTask(note);
                          }}
                          style={({ pressed }) => [
                            styles.actionBtn,
                            isDark ? styles.actionBtnDark : styles.actionBtnLight,
                            pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
                          ]}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                            <Image
                              source={{ uri: ICON_CHECKLIST }}
                              style={{ width: 14, height: 14, tintColor: isDark ? '#34d399' : '#059669' }}
                              contentFit="contain"
                            />
                            <ThemedText style={[styles.actionBtnText, isDark && { color: '#34d399' }]}>
                              Launch Checklist #{note.relatedReportId}
                            </ThemedText>
                          </View>
                          <ThemedText style={{ fontSize: 13, color: isDark ? '#34d399' : '#059669', fontWeight: '800' }}>→</ThemedText>
                        </Pressable>
                      )}
                    </View>

                    {/* Right Dot & Options */}
                    <View style={styles.rightActions}>
                      {!isSelectionMode && (
                        <View
                          style={[
                            styles.unreadDot,
                            { backgroundColor: styleInfo.accentBorder },
                          ]}
                        />
                      )}
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
                        style={styles.moreDotButton}
                      >
                        <ThemedText style={[styles.moreDotFallback, isDark && { color: '#64748b' }]}>•••</ThemedText>
                      </Pressable>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Render Read Section */}
          {!loading && readItems.length > 0 && (
            <View style={styles.groupSection}>
              <View style={styles.groupHeader}>
                <ThemedText style={[styles.groupTitle, isDark && { color: '#94a3b8' }]}>Earlier Reminders</ThemedText>
              </View>
              {readItems.map((note) => {
                const styleInfo = getPriorityStyle(note);
                const isSelected = selectedIds.includes(note.id);
                return (
                  <Pressable
                    key={note.id}
                    onPress={() => {
                      if (isSelectionMode) {
                        toggleSelectNotification(note.id);
                      } else {
                        openDetails(note);
                      }
                    }}
                    onLongPress={() => {
                      if (!isSelectionMode) {
                        setIsSelectionMode(true);
                        setSelectedIds([note.id]);
                      }
                    }}
                    style={({ pressed }) => [
                      styles.notificationItem,
                      isDark ? styles.itemReadDark : styles.itemReadLight,
                      { borderLeftColor: styleInfo.accentBorder, borderLeftWidth: 3 },
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

                    {/* Left Icon */}
                    <View style={styles.avatarWrapper}>
                      <View
                        style={[
                          styles.avatarCircle,
                          {
                            backgroundColor: styleInfo.bg,
                            borderColor: styleInfo.border,
                            borderWidth: 1,
                            opacity: 0.8,
                          },
                        ]}
                      >
                        <Image
                          source={{ uri: styleInfo.icon }}
                          style={{ width: 20, height: 20 }}
                          contentFit="contain"
                        />
                      </View>
                    </View>

                    {/* Content Body */}
                    <View style={styles.itemBody}>
                      <View style={styles.itemHeaderLine}>
                        <View
                          style={[
                            styles.levelChip,
                            {
                              backgroundColor: styleInfo.badgeBg,
                              borderColor: styleInfo.badgeBorder,
                            },
                          ]}
                        >
                          <ThemedText
                            style={[
                              styles.levelChipText,
                              { color: styleInfo.badgeText },
                            ]}
                          >
                            {styleInfo.tagLabel}
                          </ThemedText>
                        </View>
                        <ThemedText style={[styles.timeText, isDark && { color: '#64748b' }]}>
                          {formatTime(note.createdAt)}
                        </ThemedText>
                      </View>

                      <ThemedText style={styles.msgText}>
                        <ThemedText style={[styles.boldSubject, { color: isDark ? '#f1f5f9' : '#374151' }]}>
                          {note.title}
                        </ThemedText>{' '}
                        <ThemedText style={[styles.normalBody, isDark && { color: '#94a3b8' }]}>{note.message}</ThemedText>
                      </ThemedText>

                      {/* Equipment & Location Meta Row */}
                      {(note.airconName || note.location || note.dueDate) && (
                        <View style={styles.cardMetaRow}>
                          {note.airconName && (
                            <View style={[styles.metaItem, isDark ? styles.metaEquipmentDark : styles.metaEquipmentLight]}>
                              <Image
                                source={{ uri: ICON_AIRCONSTATE }}
                                style={{ width: 10, height: 10, tintColor: isDark ? '#34d399' : '#059669' }}
                                contentFit="contain"
                              />
                              <ThemedText style={[styles.metaText, isDark && { color: '#34d399' }]} numberOfLines={1}>
                                {note.airconName}{note.airconType ? ` • ${note.airconType}` : ''}
                              </ThemedText>
                            </View>
                          )}
                          {note.location && (
                            <View style={[styles.metaItem, isDark ? styles.metaItemDark : styles.metaItemLight]}>
                              <Image
                                source={{ uri: ICON_PIN }}
                                style={{ width: 11, height: 11, tintColor: isDark ? '#34d399' : '#059669' }}
                                contentFit="contain"
                              />
                              <ThemedText style={[styles.metaText, isDark && { color: '#94a3b8' }]} numberOfLines={1}>
                                {note.location}
                              </ThemedText>
                            </View>
                          )}
                          {note.dueDate && (
                            <View style={[styles.dueBadge, isDark ? styles.dueBadgeDark : styles.dueBadgeLight]}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                <AppIcon name="calendar" size={11} color={isDark ? '#fbbf24' : '#d97706'} />
                                <ThemedText style={[styles.dueBadgeText, isDark && { color: '#fbbf24' }]}>
                                  Due: {note.dueDate}
                                </ThemedText>
                              </View>
                            </View>
                          )}
                        </View>
                      )}

                      {/* Admin Remarks snippet if present */}
                      {note.verificationRemarks ? (
                        <View style={[styles.notifVerificationBanner, isDark ? styles.notifVerificationDark : styles.notifVerificationLight]}>
                          <AppIcon name="shield" size={12} color={isDark ? '#c4b5fd' : '#7e22ce'} />
                          <ThemedText style={[styles.notifVerificationText, isDark && { color: '#c4b5fd' }]} numberOfLines={1}>
                            Admin Remarks: {note.verificationRemarks}
                          </ThemedText>
                        </View>
                      ) : null}

                      {/* Quick Direct Link Button (Redesigned) */}
                      {note.relatedReportId && (
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            handleOpenTask(note);
                          }}
                          style={({ pressed }) => [
                            styles.actionBtnSecondary,
                            isDark ? styles.actionBtnSecondaryDark : styles.actionBtnSecondaryLight,
                            pressed && { opacity: 0.8 },
                          ]}
                        >
                          <ThemedText style={[styles.actionBtnSecondaryText, isDark && { color: '#34d399' }]}>
                            Launch Checklist (#{note.relatedReportId})
                          </ThemedText>
                          <ThemedText style={{ fontSize: 12, color: isDark ? '#34d399' : '#059669', fontWeight: '800' }}>→</ThemedText>
                        </Pressable>
                      )}
                    </View>

                    {/* Options */}
                    <View style={styles.rightActions}>
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
                        style={styles.moreDotButton}
                      >
                        <ThemedText style={[styles.moreDotFallback, isDark && { color: '#64748b' }]}>•••</ThemedText>
                      </Pressable>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Bottom Spacing */}
          <View style={{ height: isSelectionMode ? 190 : 110 }} />
        </ScrollView>

        {/* Floating Multi-Select Batch Action Bar */}
        {isSelectionMode && (
          <View style={[styles.selectionBarContainer, isDark ? styles.selectionBarDark : styles.selectionBarLight]}>
            <View style={styles.selectionBarLeft}>
              <ThemedText style={[styles.selectionCountText, isDark && { color: '#f1f5f9' }]}>
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
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <AppIcon name="trash" size={13} color="#ffffff" />
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
                <ThemedText style={[styles.sheetTitle, isDark && { color: '#f1f5f9' }]}>Notification Details</ThemedText>
                <Pressable onPress={closeDetails} style={[styles.closeBtn, isDark && { backgroundColor: '#1e293b', borderRadius: 12 }]}>
                  <ThemedText style={{ fontSize: 16, fontWeight: '700', color: isDark ? '#94a3b8' : '#6b7280' }}>
                    ✕
                  </ThemedText>
                </Pressable>
              </View>

              <ScrollView style={styles.sheetBody} showsVerticalScrollIndicator={false}>
                <View style={[styles.detailCard, isDark ? styles.detailCardDark : styles.detailCardLight]}>
                  <ThemedText style={[styles.detailCardTitle, isDark && { color: '#f1f5f9' }]}>
                    {selectedNotification.title}
                  </ThemedText>
                  <ThemedText style={[styles.detailCardMessage, isDark && { color: '#cbd5e1' }]}>
                    {selectedNotification.message}
                  </ThemedText>
                </View>

                {selectedNotification.createdAt && (
                  <View style={[styles.detailRow, isDark ? styles.detailRowDark : styles.detailRowLight]}>
                    <ThemedText style={[styles.detailLabel, isDark && { color: '#94a3b8' }]}>Date & Time:</ThemedText>
                    <ThemedText style={[styles.detailValue, isDark && { color: '#f1f5f9' }]}>
                      {formatTime(selectedNotification.createdAt)}
                    </ThemedText>
                  </View>
                )}

                {selectedNotification.location && (
                  <View style={[styles.detailRow, isDark ? styles.detailRowDark : styles.detailRowLight]}>
                    <ThemedText style={[styles.detailLabel, isDark && { color: '#94a3b8' }]}>Location:</ThemedText>
                    <ThemedText style={[styles.detailValue, isDark && { color: '#f1f5f9' }]}>
                      {selectedNotification.location}
                    </ThemedText>
                  </View>
                )}

                {selectedNotification.airconName && (
                  <View style={[styles.detailRow, isDark ? styles.detailRowDark : styles.detailRowLight]}>
                    <ThemedText style={[styles.detailLabel, isDark && { color: '#94a3b8' }]}>Equipment:</ThemedText>
                    <ThemedText style={[styles.detailValue, isDark && { color: '#f1f5f9' }]}>
                      {selectedNotification.airconName}{selectedNotification.airconType ? ` (${selectedNotification.airconType})` : ''}
                    </ThemedText>
                  </View>
                )}

                {selectedNotification.dueDate && (
                  <View style={[styles.detailRow, isDark ? styles.detailRowDark : styles.detailRowLight]}>
                    <ThemedText style={[styles.detailLabel, isDark && { color: '#94a3b8' }]}>Due Date:</ThemedText>
                    <ThemedText style={[styles.detailValue, { color: isDark ? '#fbbf24' : '#d97706', fontWeight: '700' }]}>
                      {selectedNotification.dueDate}
                    </ThemedText>
                  </View>
                )}

                <View style={[styles.detailRow, isDark ? styles.detailRowDark : styles.detailRowLight]}>
                  <ThemedText style={[styles.detailLabel, isDark && { color: '#94a3b8' }]}>Assigned To:</ThemedText>
                  <ThemedText style={[styles.detailValue, isDark && { color: '#f1f5f9' }]}>
                    {selectedNotification.staffName}
                  </ThemedText>
                </View>

                {selectedNotification.verificationRemarks && (
                  <View style={[styles.detailRow, isDark ? styles.notifVerificationDark : { backgroundColor: '#f5f3ff', padding: 10, borderRadius: 10 }]}>
                    <ThemedText style={[styles.detailLabel, { color: isDark ? '#c4b5fd' : '#6b21a8' }]}>Admin Remarks:</ThemedText>
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
                        <Image
                          source={{ uri: ICON_CHECKLIST }}
                          style={{ width: 18, height: 18, tintColor: '#ffffff' }}
                          contentFit="contain"
                        />
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
              <ThemedText style={[styles.optionsTitle, isDark && { color: '#f1f5f9' }]}>Notification Options</ThemedText>

              <Pressable
                style={[styles.optionRow, isDark && { borderBottomColor: '#1e293b' }]}
                onPress={() => {
                  handleToggleRead(optionsNotification);
                  closeOptions();
                }}
              >
                <ThemedText style={[styles.optionText, isDark && { color: '#f1f5f9' }]}>
                  {optionsNotification.isRead ? 'Mark as Unread' : 'Mark as Read'}
                </ThemedText>
              </Pressable>

              <Pressable
                style={[styles.optionRow, isDark && { borderBottomColor: '#1e293b' }]}
                onPress={() => openSnoozePicker(optionsNotification.id)}
              >
                <ThemedText style={[styles.optionText, isDark && { color: '#f1f5f9' }]}>
                  {optionsNotification.isSnoozed ? '⏰ Change Snooze Time...' : '⏰ Snooze Reminder...'}
                </ThemedText>
              </Pressable>

              {optionsNotification.isSnoozed && (
                <Pressable
                  style={[styles.optionRow, isDark && { borderBottomColor: '#1e293b' }]}
                  onPress={() => {
                    handleCancelSnooze(optionsNotification.id);
                    closeOptions();
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <AppIcon name="bell" size={14} color="#10b981" />
                    <ThemedText style={[styles.optionText, { color: '#10b981' }]}>
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
                  <AppIcon name="trash" size={14} color="#dc2626" />
                  <ThemedText style={[styles.optionText, { color: '#dc2626' }]}>
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
                  <ThemedText style={[styles.snoozeTitle, isDark && { color: '#f1f5f9' }]}>Snooze Reminder</ThemedText>
                </View>
                <ThemedText style={[styles.snoozeSubtitle, isDark && { color: '#94a3b8' }]}>Choose when to be reminded again</ThemedText>
              </View>

              {/* Current Active Snooze Alert Banner */}
              {isTargetSnoozed && (
                <View style={[styles.currentSnoozeAlertBanner, isDark ? styles.currentSnoozeAlertDark : styles.currentSnoozeAlertLight]}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={styles.activeSnoozeDot} />
                      <ThemedText style={styles.currentSnoozeTag}>CURRENT SNOOZE ACTIVE</ThemedText>
                    </View>
                    <ThemedText style={[styles.currentSnoozeTimeText, isDark && { color: '#f1f5f9' }]}>
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
                      { borderBottomColor: isDark ? '#1e293b' : '#f1f5f9' },
                      idx === 6 && { borderBottomWidth: 0 },
                      isOptionActive && (isDark ? styles.snoozeOptionRowActiveDark : styles.snoozeOptionRowActiveLight),
                      pressed && { backgroundColor: isDark ? '#1e293b' : '#f8fafc' },
                    ]}
                  >
                    <View style={[
                      styles.snoozeIconCircle,
                      isOptionActive
                        ? (isDark ? { backgroundColor: 'rgba(16, 185, 129, 0.25)' } : { backgroundColor: '#d1fae5' })
                        : { backgroundColor: isDark ? 'rgba(245, 158, 11, 0.15)' : '#fffbeb' },
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
                        isDark && { color: '#f1f5f9' },
                        isOptionActive && { color: '#10b981', fontWeight: '800' },
                      ]}>
                        {opt.label}
                      </ThemedText>
                      <ThemedText style={[
                        styles.snoozeOptionHint,
                        isDark && { color: '#64748b' },
                        isOptionActive && { color: '#10b981', fontWeight: '700' },
                      ]}>
                        {isOptionActive
                          ? `Currently set • Reminding at ${currentSnoozeFormatted || getSnoozeTimeLabel(opt.minutes)}`
                          : `Remind at ${getSnoozeTimeLabel(opt.minutes)}`}
                      </ThemedText>
                    </View>

                    {isOptionActive ? (
                      <View style={styles.activeSnoozeBadge}>
                        <View style={styles.activeSnoozeDotWhite} />
                        <ThemedText style={styles.activeSnoozeBadgeText}>CURRENT</ThemedText>
                      </View>
                    ) : (
                      <ThemedText style={{ color: isDark ? '#475569' : '#cbd5e1', fontSize: 16 }}>›</ThemedText>
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
                disabled={totalUnreadCount === 0}
                style={({ pressed }) => [
                  styles.menuRow,
                  { borderBottomColor: isDark ? '#334155' : '#f1f5f9' },
                  pressed && { backgroundColor: isDark ? '#1e293b' : '#f8fafc' },
                  totalUnreadCount === 0 && { opacity: 0.4 },
                ]}
              >
                <View style={[styles.menuIconCircle, { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.15)' : '#ecfdf5' }]}>
                  <ThemedText style={{ color: '#059669', fontSize: 13, fontWeight: '800' }}>✓</ThemedText>
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <ThemedText style={[styles.menuRowTitle, isDark && { color: '#f1f5f9' }]}>
                    Mark All as Read
                  </ThemedText>
                  <ThemedText style={[styles.menuRowDesc, isDark && { color: '#94a3b8' }]}>
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
                  { borderBottomColor: isDark ? '#334155' : '#f1f5f9' },
                  pressed && { backgroundColor: isDark ? '#1e293b' : '#f8fafc' },
                  filteredNotifications.length === 0 && { opacity: 0.4 },
                ]}
              >
                <View style={[styles.menuIconCircle, { backgroundColor: isDark ? 'rgba(59, 130, 246, 0.15)' : '#eff6ff' }]}>
                  <ThemedText style={{ color: '#3b82f6', fontSize: 13, fontWeight: '800' }}>☑</ThemedText>
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <ThemedText style={[styles.menuRowTitle, isDark && { color: '#f1f5f9' }]}>
                    Select Multiple
                  </ThemedText>
                  <ThemedText style={[styles.menuRowDesc, isDark && { color: '#94a3b8' }]}>
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
                  pressed && { backgroundColor: isDark ? '#1e293b' : '#f8fafc' },
                  notifications.length === 0 && { opacity: 0.4 },
                ]}
              >
                <View style={[styles.menuIconCircle, { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#fee2e2' }]}>
                  <AppIcon name="trash" size={14} color="#dc2626" />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <ThemedText style={[styles.menuRowTitle, { color: '#dc2626' }]}>
                    Clear All Notifications
                  </ThemedText>
                  <ThemedText style={[styles.menuRowDesc, isDark && { color: '#94a3b8' }]}>
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
                  { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#fee2e2' },
                ]}
              >
                <AppIcon name="trash" size={28} color="#ef4444" />
              </View>

              {/* Title */}
              <ThemedText style={[styles.deleteModalTitle, isDark && { color: '#f8fafc' }]}>
                {deleteModalConfig?.title || 'Delete Notifications'}
              </ThemedText>

              {/* Count Pill */}
              <View
                style={[
                  styles.deleteCountPill,
                  { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.18)' : '#fee2e2' },
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <AppIcon name="alert-octagon" size={12} color={isDark ? '#f87171' : '#dc2626'} />
                  <ThemedText style={[styles.deleteCountPillText, { color: isDark ? '#f87171' : '#dc2626' }]}>
                    {deleteModalConfig?.count || 0} {deleteModalConfig?.isClearAll ? 'Total' : 'Selected'} Alert{(deleteModalConfig?.count || 0) > 1 ? 's' : ''}
                  </ThemedText>
                </View>
              </View>

              {/* Message */}
              <ThemedText style={[styles.deleteModalMessage, isDark && { color: '#94a3b8' }]}>
                {deleteModalConfig?.description || 'Are you sure you want to delete these notifications?'}
              </ThemedText>

              {/* Warning note */}
              <View
                style={[
                  styles.deleteWarningBox,
                  { backgroundColor: isDark ? 'rgba(15, 23, 42, 0.6)' : '#f8fafc', borderColor: isDark ? '#334155' : '#e2e8f0' },
                ]}
              >
                <ThemedText style={[styles.deleteWarningBoxText, isDark && { color: '#cbd5e1' }]}>
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
                  <ThemedText style={[styles.deleteCancelBtnText, isDark && { color: '#cbd5e1' }]}>
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
                    <ActivityIndicator size="small" color="#ffffff" />
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

const styles = StyleSheet.create({
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
    color: '#0b291d',
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  headerStatusBadgeLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
  },
  headerStatusBadgeDark: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
  },
  headerStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#10b981',
  },
  headerStatusText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: '#059669',
  },
  markAllReadBtn: {
    backgroundColor: '#059669',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  markAllReadText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
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
    backgroundColor: '#059669',
    borderColor: '#059669',
  },
  pillInactiveLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
  },
  pillInactiveDark: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  pillTextActive: {
    color: '#ffffff',
  },
  pillTextInactiveLight: {
    color: '#4b5563',
  },
  pillTextInactiveDark: {
    color: '#cbd5e1',
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
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
  },
  cardDark: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
  },
  loadingTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginTop: 12,
  },
  loadingSubtitle: {
    fontSize: 13,
    color: '#6b7280',
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
    backgroundColor: '#d1fae5',
  },
  beaconOuterDark: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
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
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  beaconInnerDark: {
    backgroundColor: '#1e293b',
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#6b7280',
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  itemUnreadLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
  },
  itemUnreadDark: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
  },
  itemReadLight: {
    backgroundColor: '#f9fafb',
    borderColor: '#f3f4f6',
  },
  itemReadDark: {
    backgroundColor: '#131d2e',
    borderColor: '#1e293b',
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
    color: '#9ca3af',
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
    backgroundColor: '#f3f4f6',
  },
  metaItemDark: {
    backgroundColor: '#0f172a',
  },
  metaEquipmentLight: {
    backgroundColor: '#ecfdf5',
    borderWidth: 0.5,
    borderColor: '#a7f3d0',
  },
  metaEquipmentDark: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 0.5,
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  metaStaffLight: {
    backgroundColor: '#f0fdf4',
  },
  metaStaffDark: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
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
    borderColor: '#ddd6fe',
  },
  notifVerificationDark: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderColor: 'rgba(139, 92, 246, 0.35)',
  },
  notifVerificationText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#6b21a8',
    flex: 1,
  },
  dueBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  dueBadgeLight: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  dueBadgeDark: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: 'rgba(245, 158, 11, 0.35)',
  },
  dueBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#b45309',
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
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  actionBtnDark: {
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    borderColor: 'rgba(16, 185, 129, 0.45)',
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#047857',
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
    color: '#059669',
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
    color: '#9ca3af',
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
    backgroundColor: '#ffffff',
  },
  sheetContainerDark: {
    backgroundColor: '#151e32',
    borderTopWidth: 1.5,
    borderTopColor: 'rgba(16, 185, 129, 0.35)',
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
    color: '#111827',
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
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
  },
  detailCardDark: {
    backgroundColor: '#0f172a',
    borderColor: '#334155',
  },
  detailCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
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
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  detailRowLight: {
    borderBottomColor: '#f3f4f6',
  },
  detailRowDark: {
    borderBottomColor: '#1e293b',
  },
  detailLabel: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '600',
  },
  detailValue: {
    fontSize: 14,
    color: '#111827',
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
        shadowColor: '#10b981',
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
    backgroundColor: '#059669',
  },
  sheetActionBtnDark: {
    backgroundColor: '#10b981',
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
    color: '#ffffff',
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
    color: '#ffffff',
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
    backgroundColor: '#ffffff',
  },
  optionsContainerDark: {
    backgroundColor: '#151e32',
    borderTopWidth: 1.5,
    borderTopColor: 'rgba(16, 185, 129, 0.35)',
  },
  optionsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 14,
    textAlign: 'center',
  },
  optionRow: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
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
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
  },
  snoozeCardDark: {
    backgroundColor: '#151e32',
    borderColor: '#334155',
  },
  snoozeHeaderRow: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    alignItems: 'center',
  },
  snoozeTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
  },
  snoozeSubtitle: {
    fontSize: 12,
    color: '#64748b',
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
    color: '#0f172a',
  },
  snoozeOptionHint: {
    fontSize: 11,
    color: '#94a3b8',
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
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  currentSnoozeAlertDark: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderColor: '#059669',
  },
  currentSnoozeTag: {
    fontSize: 10,
    fontWeight: '800',
    color: '#10b981',
    letterSpacing: 0.5,
  },
  currentSnoozeTimeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 2,
  },
  cancelSnoozeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  cancelSnoozeBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ef4444',
  },
  snoozeOptionRowActiveLight: {
    backgroundColor: '#ecfdf5',
    borderLeftWidth: 4,
    borderLeftColor: '#10b981',
  },
  snoozeOptionRowActiveDark: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderLeftWidth: 4,
    borderLeftColor: '#10b981',
  },
  activeSnoozeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#10b981',
  },
  activeSnoozeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
  },
  activeSnoozeDotWhite: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#ffffff',
  },
  activeSnoozeBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#ffffff',
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
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
  },
  headerThreeDotsBtnDark: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 10,
  },
  menuDropdownCardLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
  },
  menuDropdownCardDark: {
    backgroundColor: '#151e32',
    borderColor: '#334155',
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
    color: '#0f172a',
    fontFamily: 'Roboto',
  },
  menuRowDesc: {
    fontSize: 11,
    color: '#64748b',
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
    backgroundColor: '#ffffff',
    borderColor: '#d1d5db',
  },
  selectModeBtnDark: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
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
    backgroundColor: '#ecfdf5',
    borderColor: '#10b981',
  },
  selectAllHeaderBtnDark: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  selectAllHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#059669',
  },
  cancelSelectBtn: {
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 8,
    borderWidth: 1,
  },
  cancelSelectBtnLight: {
    backgroundColor: '#f3f4f6',
    borderColor: '#e5e7eb',
  },
  cancelSelectBtnDark: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
  },
  cancelSelectText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6b7280',
  },

  // Card Selection Highlights
  itemSelectedLight: {
    backgroundColor: '#f0fdf4',
    borderColor: '#10b981',
    borderWidth: 1.5,
  },
  itemSelectedDark: {
    backgroundColor: '#0c281e',
    borderColor: '#10b981',
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
    borderColor: '#9ca3af',
    backgroundColor: '#ffffff',
  },
  selectCheckboxDark: {
    borderColor: '#475569',
    backgroundColor: '#0f172a',
  },
  selectCheckboxChecked: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  selectCheckmark: {
    color: '#ffffff',
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
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 12,
    zIndex: 1100,
  },
  selectionBarLight: {
    backgroundColor: '#ffffff',
    borderColor: '#10b981',
  },
  selectionBarDark: {
    backgroundColor: '#151e32',
    borderColor: '#10b981',
  },
  selectionBarLeft: {
    flex: 1,
  },
  selectionCountText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1f2937',
  },
  selectionCountNumber: {
    fontSize: 14,
    fontWeight: '800',
    color: '#10b981',
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
    shadowColor: '#ef4444',
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
    color: '#ffffff',
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
        shadowColor: '#000',
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
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
  },
  deleteModalCardDark: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
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
    color: '#0f172a',
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
    color: '#64748b',
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
    color: '#94a3b8',
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
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
  },
  deleteCancelBtnDark: {
    backgroundColor: '#334155',
    borderColor: '#475569',
  },
  deleteCancelBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#64748b',
    fontFamily: 'Roboto',
  },
  deleteConfirmBtn: {
    flex: 1.3,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  deleteConfirmBtnText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#ffffff',
    fontFamily: 'Roboto',
  },
});
