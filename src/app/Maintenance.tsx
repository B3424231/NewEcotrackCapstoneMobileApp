import { AppState } from 'react-native';
import { useSessionPageSnapshot } from '@/hooks/use-session-page-snapshot';
import { getStatusPalette, Colors as UiColors, type AppColors, Spacing } from '@/constants/theme';

import { createReadScope } from '@/services/query-utils';
import { createRefreshCoordinator, type RefreshCoordinator } from '@/services/refresh-coordinator';
import { DataListSkeleton } from '@/components/data-list-skeleton';
import { isChecklistItemComplete, isRepairDone, isRepairAwaitingVerification, getMaintenancePhase } from '@/services/maintenance-status';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/app-icon';
import { MaintenancePhoto } from '@/components/maintenance-photo';
import { FloatingBottomNavbar } from '@/components/floating-navbar';
import { LocationIcon } from '@/components/location-icon';
import { ThemedText } from '@/components/themed-text';
import {
  ICON_AIRCONSTATE,
  ICON_CALENDAR,
  ICON_CAMERA,
  ICON_CHECKLIST,
  ICON_CHEVRON_RIGHT,
  ICON_SEARCH
} from '@/constants/custom-icons';

import { useAuth } from '@/context/auth-context';
import { useSettings } from '@/context/settings-context';
import { createMaintenanceMutationTracker, type MaintenanceMutationResult } from '@/services/maintenance-rpc';
import {
  fetchLiveMaintenanceReports,
  submitRepairAndSyncParent,
  subscribeToMaintenanceReports,
  updateLiveMaintenanceReport,
  uploadImageToSupabase,
  validateLiveMaintenanceItems,
} from '@/services/supabase';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const SCREEN_WIDTH = Dimensions.get('window').width;

// Status types
export type ChecklistStatus = 'Not Started' | 'In Progress' | 'Completed' | 'Needs Repair' | 'Under Repair' | 'For Verification';
export type ReportStatus = 'Pending' | 'In Progress' | 'For Verification' | 'Completed' | 'Needs Repair' | 'Under Repair';
export type PriorityLevel = 'Critical' | 'High' | 'Medium' | 'Low';

export const REPAIR_CHECKLIST_STATUSES: ChecklistStatus[] = ['Not Started', 'In Progress', 'Completed'];
export const STANDARD_CHECKLIST_STATUSES: ChecklistStatus[] = ['Not Started', 'In Progress', 'Completed', 'Needs Repair'];

export interface MaintenanceItem {
  id: string;
  title: string;
  description: string;
  status: ChecklistStatus;
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

export interface MaintenanceReport {
  id: string;
  airconId: string;
  airconName?: string;
  airconType?: string;
  controllerId?: string;
  controllerName?: string;
  protocolName?: string;
  roomId?: string;
  location: string;
  title: string;
  description?: string;
  type: string;
  assignedWorker: string;
  staffId?: string;
  priority: PriorityLevel;
  dueDate: string;
  createdDate?: string;
  status: ReportStatus;
  lastUpdated?: string;
  updatedAt?: string | null;
  items: MaintenanceItem[];
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
  isRepaired?: boolean;
  isVerified?: boolean;
  allChildRepairsDone?: boolean;
}

function formatMaintenanceTimestamp(timestamp: string = new Date().toISOString()): string {
  const date = new Date(timestamp);
  return date.toLocaleString([], {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function MaintenanceScreen() {
  const { userId, userName } = useAuth();
  const { effectiveTheme, colors } = useSettings();
  const styles = themedStyles[effectiveTheme];
  const params = useLocalSearchParams<{ reportId?: string; screen?: string; repairId?: string }>();

  // Reports state
  const fetchUser = userId || userName;
  const { data: reports, loading, error: fetchError, setData: setReports, commit, startLoading, fail, isCurrent: isSessionCurrent } =
    useSessionPageSnapshot<MaintenanceReport[]>(fetchUser ? `maintenance:${fetchUser}` : undefined, () => []);
  const [refreshing, setRefreshing] = useState(false);
  const refreshRef = useRef<RefreshCoordinator | null>(null);
  const requestedReportId = params?.reportId;
  const [activeFilter, setActiveFilter] = useState<'All' | 'Pending' | 'In Progress' | 'For Verification' | 'Needs Repair' | 'Completed'>('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Selected Report & Navigation state
  // currentScreen: 'DASHBOARD' | 'DETAILS' | 'SUCCESS' | 'REPAIR'
  const [currentScreen, setCurrentScreen] = useState<'DASHBOARD' | 'DETAILS' | 'SUCCESS' | 'REPAIR'>('DASHBOARD');
  const [selectedReportId, setSelectedReportId] = useState<string>('');
  const [editingReportId, setEditingReportId] = useState<string>('');
  const [activeRepairId, setActiveRepairId] = useState<string | null>(null);
  const itemEditorSnapshot = useRef<MaintenanceReport | null>(null);
  const confirmationSnapshot = useRef<MaintenanceReport | null>(null);
  const mutationAttempts = useRef(createMaintenanceMutationTracker());
  const [handledRouteParams, setHandledRouteParams] = useState<string | null>(null);

  const mutationContext = (report: MaintenanceReport, changes: unknown) => {
    return mutationAttempts.current(report.id, report.updatedAt, changes);
  };

  const rememberSavedVersion = (reportId: string, result: MaintenanceMutationResult) => {
    if (result.updated) setReports(previous => previous.map(report => report.id === reportId
      ? { ...report, updatedAt: result.updated, status: (result.status as ReportStatus) || report.status } : report));
    if (result.updatedParentId) void loadReports();
  };

  const fetchReports = useCallback(async (isCurrent: () => boolean) => {
    if (!isSessionCurrent()) return;
    startLoading();
    const scope = createReadScope();
    try {
      const live = await fetchLiveMaintenanceReports(userName, scope);
      scope.assertSuccessful();
      if (!isCurrent() || !isSessionCurrent()) return;
      commit(previous => (live || []).map(report => {
        const saved = previous.find(existing => existing.id === report.id);
        return saved && Date.parse(saved.updatedAt || '') > Date.parse(report.updatedAt || '') ? saved : report;
      }));
      if (live && live.length > 0) {
        setSelectedReportId((prev) => {
          if (prev && live.some((r) => r.id === prev)) return prev;
          if (requestedReportId) {
            const matched = live.find((r) => r.id === requestedReportId);
            if (matched) return matched.id;
          }
          return live[0].id;
        });
      }
    } catch (e) {
      console.error('Error fetching live maintenance reports:', e);
      if (isCurrent() && isSessionCurrent()) fail('Unable to refresh maintenance. Pull down to try again.');
    } finally {
      if (isCurrent() && isSessionCurrent()) setRefreshing(false);
    }
  }, [userName, requestedReportId, setSelectedReportId, commit, startLoading, fail, isSessionCurrent]);

  const loadReports = () => refreshRef.current?.refresh() ?? Promise.resolve();

  const onRefresh = () => {
    setRefreshing(true);
    loadReports();
  };

  useEffect(() => {
    const refresh = createRefreshCoordinator(fetchReports, 150, AppState);
    refreshRef.current = refresh;
    void refresh.refresh();
    const unsubscribe = subscribeToMaintenanceReports(() => refresh.schedule());
    return () => {
      refresh.dispose();
      if (refreshRef.current === refresh) refreshRef.current = null;
      unsubscribe();
    };
  }, [fetchReports]);

  const routeKey = params?.reportId || params?.repairId || params?.screen
    ? `${params.reportId || ''}_${params.repairId || ''}_${params.screen || ''}`
    : null;

  // Apply each route once when reports arrive, before committing a stale screen.
  if (reports.length > 0 && routeKey && handledRouteParams !== routeKey) {
    setHandledRouteParams(routeKey);
    if (params?.repairId) {
      const targetRepairId = params.repairId.toLowerCase();
      const matchedRepair = reports.find((r) => (r.id || '').toLowerCase() === targetRepairId);
      const parentReport = matchedRepair?.parentReportId
        ? reports.find((r) => (r.id || '').toLowerCase() === (matchedRepair.parentReportId || '').toLowerCase())
        : reports.find((r) => r.items?.some((it) => (it.linkedRepairId || '').toLowerCase() === targetRepairId));

      if (parentReport) {
        setSelectedReportId(parentReport.id);
        setActiveRepairId(params.repairId);
        setCurrentScreen('REPAIR');
      } else if (matchedRepair) {
        setSelectedReportId(matchedRepair.id);
        setActiveRepairId(params.repairId);
        setCurrentScreen('REPAIR');
      }
    } else if (params?.reportId) {
      const matched = reports.find((r) => r.id === params.reportId);
      if (matched) {
        setSelectedReportId(matched.id);
        if (params?.screen === 'REPAIR' && params?.repairId) {
          setActiveRepairId(params.repairId);
          setCurrentScreen('REPAIR');
        } else {
          setCurrentScreen('DETAILS');
        }
      }
    }
  }

  // Currently expanded checklist item for editing remarks / photos / defect
  const [expandedItem, setExpandedItem] = useState<MaintenanceItem | null>(null);
  const [itemRemarks, setItemRemarks] = useState('');
  const [itemProblemDesc, setItemProblemDesc] = useState('');
  const [itemPhotoUris, setItemPhotoUris] = useState<string[]>([]);
  const [itemStatus, setItemStatus] = useState<ChecklistStatus>('Not Started');
  const [itemModalVisible, setItemModalVisible] = useState(false);

  // Quick Dropdown Picker modal for items
  const [dropdownItem, setDropdownItem] = useState<MaintenanceItem | null>(null);
  const [dropdownVisible, setDropdownVisible] = useState(false);

  // Submit Confirmation Dialog state
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [confirmRepairModalVisible, setConfirmRepairModalVisible] = useState(false);
  const [pendingRepairToSubmit, setPendingRepairToSubmit] = useState<MaintenanceReport | null>(null);
  const [repairSuccessModalVisible, setRepairSuccessModalVisible] = useState(false);
  const [submittedRepairInfo, setSubmittedRepairInfo] = useState<{
    id: string;
    aircon: string;
    location: string;
    parentId?: string | null;
    isRepair?: boolean;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Animated values
  const [progressAnim] = useState(() => new Animated.Value(0.5));

  const activeReport = reports.find((r) => r.id === selectedReportId) || reports[0];
  const isCurrentRepair = Boolean(
    activeReport?.type?.toLowerCase().includes('repair') ||
    activeReport?.type?.toLowerCase().includes('corrective') ||
    (activeReport?.id ? activeReport.id.startsWith('REP-') : false)
  );

  // Option B: Identify child repair orders that belong to an existing parent maintenance report
  const isChildRepairReport = (rep: MaintenanceReport) => {
    const isRepair = rep.id.startsWith('REP-') || rep.type?.toLowerCase().includes('repair');
    if (!isRepair) return false;
    if (rep.parentReportId && reports.some((r) => r.id === rep.parentReportId)) return true;
    if (reports.some((r) => r.items?.some((it) => it.linkedRepairId === rep.id))) return true;
    return false;
  };

  // Calculate statistics across top-level reports (Option B: excluding child repair orders)
  const topLevelReports = reports.filter((rep) => !isChildRepairReport(rep));
  const pendingCount = topLevelReports.filter((r) => r.status === 'Pending').length;
  const inProgressCount = topLevelReports.filter((r) => r.status === 'In Progress').length;
  const forVerificationCount = topLevelReports.filter((r) => r.status === 'For Verification').length;
  const completedCount = topLevelReports.filter((r) => r.status === 'Completed').length;
  // Calculate total repairs needing attention across all reports (matching individual card defect/repair counts)
  const needsRepairCount = topLevelReports.reduce((total, rep) => {
    const repItems = rep.items || [];
    const repNeedsRepair = repItems.filter(
      (i) => i.status !== 'For Verification' && !i.isRepaired && !i.repaired && (i.status === 'Needs Repair' || i.status === 'Under Repair' || Boolean(i.linkedRepairId))
    ).length;
    if (repNeedsRepair > 0) {
      return total + repNeedsRepair;
    }
    return (rep.status === 'Needs Repair' || rep.status === 'Under Repair') ? total + 1 : total;
  }, 0);

  // Calculate active report progress
  const activeReportItems = activeReport?.items || [];
  const totalItems = activeReportItems.length;
  const completedItems = activeReportItems.filter(isChecklistItemComplete).length;
  const inProgressItems = activeReportItems.filter((i) => i.status === 'In Progress').length;
  const notStartedItems = activeReportItems.filter((i) => i.status === 'Not Started').length;
  const needsRepairItems = isCurrentRepair
    ? 0
    : activeReportItems.filter((i) => i.status !== 'For Verification' && !i.isRepaired && !i.repaired && (i.status === 'Needs Repair' || i.status === 'Under Repair' || Boolean(i.linkedRepairId))).length;
  const progressRatio = totalItems > 0 ? completedItems / totalItems : 0;
  const progressPercentage = Math.round(progressRatio * 100);

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progressRatio,
      duration: 350,
      useNativeDriver: false,
    }).start();
  }, [progressRatio]);

  // Open Details Screen
  const handleOpenReport = (reportId: string) => {
    setSelectedReportId(reportId);
    setActiveRepairId(null);
    setCurrentScreen('DETAILS');
  };

  // Open Targeted Repair Screen for a specific item repair task (Image 3)
  const handleOpenRepairPage = (repairId: string) => {
    setActiveRepairId(repairId);
    setCurrentScreen('REPAIR');
  };

  // Quick Status change from dropdown
  const handleQuickStatusChange = (itemId: string, newStatus: ChecklistStatus) => {
    if (isSubmitting) return;
    const targetRep = reports.find((r) => r.id === selectedReportId);
    if (!targetRep) return;
    const selectedItem = targetRep.items.find((item) => item.id === itemId);
    if (!selectedItem || selectedItem.linkedRepairId || selectedItem.status === 'Under Repair') return;
    if (newStatus === 'Needs Repair') {
      setDropdownVisible(false);
      handleOpenItemEditor(selectedItem, targetRep.id);
      alert('Add the required problem description before marking this item Needs Repair.');
      return;
    }
    const itemUpdatedAt = new Date().toISOString();

    const updatedItems = targetRep.items.map((it) => {
      if (it.id !== itemId) return it;
      return { ...it, status: newStatus, updatedAt: itemUpdatedAt };
    });

    const isTargetRepair = Boolean(
      targetRep.type?.toLowerCase().includes('repair') ||
      targetRep.type?.toLowerCase().includes('corrective') ||
      (targetRep.id ? targetRep.id.startsWith('REP-') : false)
    );

    // Determine overall report status
    const repairItems = !isTargetRepair ? updatedItems.filter((it) => it.status === 'Needs Repair') : [];
    const anyRepair = repairItems.length > 0;
    const anyActive = updatedItems.some(
      (it) => it.status === 'In Progress' || it.status === 'Completed' || (!isTargetRepair && it.status === 'Needs Repair')
    );
    const overallStatus: ReportStatus = anyRepair
      ? (updatedItems.some(it => it.status === 'Under Repair') ? 'Under Repair' : 'Needs Repair')
      : anyActive
        ? 'In Progress'
        : 'Pending';

    const updatedIssue = anyRepair ? {
      component: repairItems.map((i) => i.title).join(', '),
      notes: repairItems.length === 1
        ? (repairItems[0].problemDescription || repairItems[0].remarks || 'Maintenance defect requires repair')
        : repairItems.map((i) => `${i.title}: ${i.problemDescription || i.remarks || 'Defect reported'}`).join(' • '),
      photoUri: repairItems.find((i) => i.photoUri)?.photoUri || null,
      reported_by: userName || 'Maintenance Staff',
      reported_at: new Date().toISOString(),
    } : null;

    setReports((prev) =>
      prev.map((rep) => {
        if (rep.id !== selectedReportId) return rep;
        return {
          ...rep,
          items: updatedItems,
          status: overallStatus,
          issue: updatedIssue,
          lastUpdated: formatMaintenanceTimestamp(itemUpdatedAt),
        };
      })
    );
    setDropdownVisible(false);

    setIsSubmitting(true);
    // Persist item progress quietly; final submission remains explicit.
    updateLiveMaintenanceReport(selectedReportId, {
      saveMode: 'item',
      ...mutationContext(targetRep, { saveMode: 'item', status: overallStatus, items: updatedItems }),
      status: overallStatus,
      items: updatedItems,
      workerName: userName,
      location: targetRep.location,
      airconId: targetRep.airconId,
      existingTimeline: targetRep.timeline,
    }).then((result) => {
      if (result.success) rememberSavedVersion(targetRep.id, result);
      if (!result.success) {
        alert(result.error || 'The status update could not be saved.');
        loadReports();
      }
    }).catch((err) => {
      console.warn('Background Supabase status update error:', err);
      loadReports();
    }).finally(() => setIsSubmitting(false));
  };

  // Flexible interactive checkbox toggle for tasks and subtasks
  const handleToggleTaskCheck = (taskId: string, targetRepId?: string) => {
    if (isSubmitting) return;
    const reportId = targetRepId || selectedReportId;
    const targetRep = reports.find((r) => r.id === reportId);
    if (!targetRep) return;

    if (targetRep.status === 'Completed') {
      alert('This maintenance report has been verified and completed.');
      return;
    }
    if (targetRep.status === 'For Verification') {
      alert('This maintenance report has already been submitted for verification and is locked awaiting admin review.');
      return;
    }

    const currentItem = targetRep.items.find((it) => it.id === taskId);
    if (!currentItem || currentItem.linkedRepairId || currentItem.status === 'Under Repair') return;

    const nextStatus: ChecklistStatus = currentItem.status === 'Completed' ? 'In Progress' : 'Completed';
    const itemUpdatedAt = new Date().toISOString();

    const updatedItems = targetRep.items.map((it) => {
      if (it.id !== taskId) return it;
      return { ...it, status: nextStatus, updatedAt: itemUpdatedAt };
    });

    const isTargetRepair = Boolean(
      targetRep.type?.toLowerCase().includes('repair') ||
      targetRep.type?.toLowerCase().includes('corrective') ||
      (targetRep.id ? targetRep.id.startsWith('REP-') : false)
    );

    const anyRepair = !isTargetRepair && updatedItems.some((it) => it.status === 'Needs Repair');
    const anyActive = updatedItems.some(
      (it) => it.status === 'In Progress' || it.status === 'Completed' || (!isTargetRepair && it.status === 'Needs Repair')
    );
    const overallStatus: ReportStatus = anyRepair
      ? (updatedItems.some(it => it.status === 'Under Repair') ? 'Under Repair' : 'Needs Repair')
      : anyActive
        ? 'In Progress'
        : 'Pending';

    setReports((prev) =>
      prev.map((rep) => {
        if (rep.id !== reportId) return rep;
        return {
          ...rep,
          items: updatedItems,
          status: overallStatus,
          issue: anyRepair ? rep.issue : null,
          lastUpdated: formatMaintenanceTimestamp(itemUpdatedAt),
        };
      })
    );

    setIsSubmitting(true);
    updateLiveMaintenanceReport(reportId, {
      saveMode: 'item',
      ...mutationContext(targetRep, { saveMode: 'item', status: overallStatus, items: updatedItems }),
      status: overallStatus,
      items: updatedItems,
      workerName: userName,
      location: targetRep.location,
      airconId: targetRep.airconId,
      existingTimeline: targetRep.timeline,
    }).then((result) => {
      if (result.success) {
        rememberSavedVersion(targetRep.id, result);
      } else {
        alert(result.error || 'The checklist update could not be saved.');
        loadReports();
      }
    }).catch((err) => {
      console.warn('Background Supabase toggle task error:', err);
      loadReports();
    }).finally(() => setIsSubmitting(false));
  };

  // Open Item Detail & Edit Modal (Screen 4 / Screen 7)
  const handleOpenItemEditor = (item: MaintenanceItem, reportId?: string) => {
    itemEditorSnapshot.current = reports.find(report => report.id === (reportId || selectedReportId)) || null;
    setExpandedItem(item);
    setEditingReportId(reportId || selectedReportId);
    // If item is Under Repair, has linkedRepairId, or was flagged Needs Repair,
    // ensure the modal shows 'Needs Repair' selected, NEVER defaulting to 'Not Started'!
    if (item.status === 'For Verification') {
      setItemStatus('For Verification');
    } else if (item.status === 'Under Repair' || item.status === 'Needs Repair' || Boolean(item.linkedRepairId)) {
      setItemStatus('Needs Repair');
    } else {
      setItemStatus(item.status);
    }
    setItemRemarks(item.remarks || '');
    setItemProblemDesc(item.problemDescription || '');
    const initialPhotos = Array.isArray(item.photoUris) && item.photoUris.length > 0
      ? [...item.photoUris]
      : (item.photoUri ? [item.photoUri] : []);
    setItemPhotoUris(initialPhotos);
    setItemModalVisible(true);
  };

  // Save Item Detail & Remarks
  const handleSaveItemUpdate = async () => {
    if (!expandedItem) return;
    if (isSubmitting) return;
    const targetReportId = editingReportId || selectedReportId;
    // Keep the version and tasks shown when the editor opened. Realtime refresh
    // must not silently rebase a draft over another worker's changes.
    const targetRep = itemEditorSnapshot.current?.id === targetReportId ? itemEditorSnapshot.current : null;
    if (!targetRep) return;

    if (itemStatus === 'Needs Repair' && !itemProblemDesc.trim()) {
      alert('Describe the problem before marking this checklist item Needs Repair.');
      return;
    }

    setIsSubmitting(true);
    try {
    // Upload newly selected images (data URLs or file uris)
    const uploadedPhotos = await Promise.all(
      itemPhotoUris.map(async (uri, idx) => {
        if (uri && (uri.startsWith('data:image') || uri.startsWith('file:'))) {
          try {
            return await uploadImageToSupabase(
              uri,
              'photos',
              `proof_${targetReportId}_${expandedItem.id}_${idx}`
            );
          } catch (e) {
            throw new Error('Photo upload failed. Please try again before saving this checklist.');
          }
        }
        return uri;
      })
    );

    const primaryPhoto = uploadedPhotos[0] || null;

    const itemUpdatedAt = new Date().toISOString();
    const updatedItems = targetRep.items.map((it) => {
      if (it.id !== expandedItem.id) return it;
      const resolvedStatus = it.linkedRepairId
        ? (isChecklistItemComplete(it) ? 'Completed' : it.status === 'For Verification' ? 'For Verification' : 'Under Repair')
        : itemStatus;
      return {
        ...it,
        status: resolvedStatus,
        remarks: itemRemarks.trim(),
        problemDescription: (itemStatus === 'Needs Repair' || resolvedStatus === 'Under Repair' || resolvedStatus === 'For Verification') ? itemProblemDesc.trim() : undefined,
        photoUri: primaryPhoto,
        photoUris: uploadedPhotos,
        updatedAt: itemUpdatedAt,
        linkedRepairId: it.linkedRepairId || expandedItem.linkedRepairId || null,
      };
    });

    const repairItems = updatedItems.filter((it) => it.status === 'Needs Repair' || it.status === 'Under Repair');
    const anyRepair = repairItems.length > 0;
    const anyActive = updatedItems.some(
      (it) => it.status === 'In Progress' || it.status === 'Completed' || it.status === 'Needs Repair' || it.status === 'Under Repair'
    );
    const overallStatus: ReportStatus = anyRepair
      ? (updatedItems.some(it => it.status === 'Under Repair') ? 'Under Repair' : 'Needs Repair')
      : anyActive
        ? 'In Progress'
        : 'Pending';

    const updatedIssue = anyRepair ? {
      component: repairItems.map((i) => i.title).join(', '),
      notes: repairItems.length === 1
        ? (repairItems[0].problemDescription || repairItems[0].remarks || 'Maintenance defect requires repair')
        : repairItems.map((i) => `${i.title}: ${i.problemDescription || i.remarks || 'Defect reported'}`).join(' • '),
      photoUri: repairItems.find((i) => i.photoUri || (i.photoUris && i.photoUris.length > 0))?.photoUri || (repairItems.find((i) => i.photoUris && i.photoUris.length > 0)?.photoUris?.[0]) || null,
      photoUris: repairItems.flatMap((i) => i.photoUris || (i.photoUri ? [i.photoUri] : [])),
      reported_by: userName || 'Maintenance Staff',
      reported_at: new Date().toISOString(),
    } : null;

    const result = await updateLiveMaintenanceReport(targetReportId, {
      saveMode: 'item',
      ...mutationContext(targetRep, { saveMode: 'item', status: overallStatus, items: updatedItems }),
      status: overallStatus,
      items: updatedItems,
      workerName: userName,
      location: targetRep.location,
      airconId: targetRep.airconId,
      existingTimeline: targetRep.timeline,
    });

    if (!result.success) {
      alert(result.error || 'The checklist update could not be saved. Please try again.');
      return;
    }

    rememberSavedVersion(targetReportId, result);

    setReports((prev) =>
      prev.map((rep) => {
        if (rep.id !== targetReportId) return rep;
        return {
          ...rep,
          items: updatedItems,
          status: (result.status as ReportStatus) || overallStatus,
          issue: updatedIssue,
          lastUpdated: formatMaintenanceTimestamp(itemUpdatedAt),
        };
      })
    );

    setItemModalVisible(false);
    setExpandedItem(null);
    setEditingReportId('');
    setItemPhotoUris([]);
    setItemRemarks('');
    setItemProblemDesc('');

    } catch (error) {
      console.error('Error saving maintenance checklist item:', error);
      alert('The checklist update could not be saved. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Photo attachments using ImagePicker (multiple selection from gallery)
  const handlePickPhotos = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        alert('Permission to access photos is required for maintenance proof.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const newUrls = result.assets.map((asset) =>
          asset.base64
            ? `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`
            : asset.uri
        );
        setItemPhotoUris((prev) => [...prev, ...newUrls]);
      }
    } catch (e) {
      console.warn('Pick photos error:', e);
    }
  };

  // Take photo directly using device camera
  const handleTakePhoto = async () => {
    try {
      const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
      if (!permissionResult.granted) {
        alert('Permission to access camera is required for taking photos.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const dataUrl = asset.base64
          ? `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`
          : asset.uri;
        setItemPhotoUris((prev) => [...prev, dataUrl]);
      }
    } catch (e) {
      console.warn('Take photo error:', e);
    }
  };

  const handleRemovePhoto = (indexToRemove: number) => {
    setItemPhotoUris((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleClearAllPhotos = () => {
    setItemPhotoUris([]);
  };

  // Submit update confirmation to Supabase
  const handleConfirmSubmit = async () => {
    const activeReport = confirmationSnapshot.current;
    if (!activeReport || isSubmitting) return;

    if (activeReport.status === 'For Verification' || activeReport.status === 'Completed') {
      setConfirmModalVisible(false);
      alert(activeReport.status === 'Completed'
        ? 'This maintenance report has already been completed and verified.'
        : 'This maintenance report has already been submitted for verification.');
      return;
    }

    const validationError = validateLiveMaintenanceItems(activeReport.items);
    if (validationError) {
      alert(validationError);
      return;
    }
    const hasWorkerUpdate = activeReport.items.some((item) =>
      item.status !== 'Not Started' || Boolean(item.remarks?.trim()) || Boolean(item.problemDescription?.trim())
    );
    if (!hasWorkerUpdate) {
      alert('Update at least one checklist item before submitting this maintenance report.');
      return;
    }
    setIsSubmitting(true);
    try {
      const now = new Date();
      const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dateString = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const formattedTimestamp = `${dateString} — ${timeString}`;

      const allDone = activeReport.items.length > 0 && activeReport.items.every(isChecklistItemComplete);
      const anyRepair = activeReport.items.some((it) => it.status === 'Needs Repair');
      const anyActive = activeReport.items.some(
        (it) => it.status === 'In Progress' || it.status === 'Completed' || it.status === 'Needs Repair'
      );
      const overallStatus: ReportStatus = anyRepair
        ? 'Needs Repair'
        : allDone
          ? 'For Verification'
          : anyActive
            ? 'In Progress'
            : 'Pending';

      // Persist to Supabase maintenance_reports table
      const res = await updateLiveMaintenanceReport(activeReport.id, {
        ...mutationContext(activeReport, { status: overallStatus, items: activeReport.items }),
        status: overallStatus,
        items: activeReport.items,
        workerName: userName,
        location: activeReport.location,
        airconId: activeReport.airconId,
        existingTimeline: activeReport.timeline,
      });

      if (!res.success) {
        console.warn('Failed to submit maintenance update to Supabase:', res.error);
        alert(res.error || 'The maintenance update could not be submitted. Please try again.');
        return;
      }

      rememberSavedVersion(activeReport.id, res);

      setReports((prev) =>
        prev.map((rep) => {
          if (rep.id !== activeReport.id) return rep;
          return {
            ...rep,
            status: (res.status as ReportStatus) || overallStatus,
            lastUpdated: formattedTimestamp,
            issue: anyRepair ? rep.issue : null,
          };
        })
      );

      setSubmittedRepairInfo({
        id: activeReport.id,
        aircon: activeReport.airconName || activeReport.controllerName || 'Name unavailable',
        location: activeReport.location || 'Assigned Area',
        parentId: activeReport.parentReportId || null,
        isRepair: isCurrentRepair,
      });

      setConfirmModalVisible(false);
      setRepairSuccessModalVisible(true);
      setCurrentScreen('SUCCESS');
    } catch (e) {
      console.error('Error submitting maintenance update to Supabase:', e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isDark = effectiveTheme === 'dark';

  // Helper to determine if report has an unresolved defect
  const hasActiveDefect = (rep?: MaintenanceReport | null) => {
    if (!rep) return false;
    if (rep.status === 'Completed') return false;
    if (rep.status === 'Needs Repair') return true;
    return rep.items ? rep.items.some((i) => i.status === 'Needs Repair') : false;
  };

  // Helper to determine if report is a Corrective Repair Task dispatched by supervisor (Image 1 output)
  const isCorrectiveRepair = (rep?: MaintenanceReport | null) => {
    if (!rep) return false;
    return rep.type === 'Corrective Repair' || (rep.id ? rep.id.startsWith('REP-') : false);
  };

  // Helper to check if an explicitly defined corrective repair task exists
  const getDispatchedRepairInfo = (rep?: MaintenanceReport | null) => {
    if (!rep) return { hasDispatchedRepair: false, repairId: null as string | null, linkedRepairReport: null as MaintenanceReport | null };

    // Case 1: The report itself is a corrective repair task created by admin
    if (isCorrectiveRepair(rep)) {
      return {
        hasDispatchedRepair: false,
        repairId: null as string | null,
        linkedRepairReport: null as MaintenanceReport | null,
      };
    }

    // If report is already completed/verified and all its tasks are done, do not attach or display active repair order
    const allRepTasksDone = rep.items && rep.items.length > 0 && rep.items.every(isChecklistItemComplete);
    if (allRepTasksDone && (rep.status === 'Completed' || rep.isVerified)) {
      return { hasDispatchedRepair: false, repairId: null as string | null, linkedRepairReport: null as MaintenanceReport | null };
    }

    // Case 2: Only attach if explicitly defined on the report object (explicit relationship)
    // No fuzzy guessing and NO timeline string regex scraping!
    const linkedReport = reports.find(
      (r) =>
        (rep.linkedRepairId && r.id.toLowerCase() === rep.linkedRepairId.toLowerCase()) ||
        (r.parentReportId && r.parentReportId.toLowerCase() === rep.id.toLowerCase() && (isCorrectiveRepair(r) || r.id.startsWith('REP-')))
    );

    const repairId = rep.linkedRepairId || linkedReport?.id || null;

    if (repairId && linkedReport) {
      return {
        hasDispatchedRepair: true,
        repairId,
        linkedRepairReport: linkedReport,
      };
    }

    return { hasDispatchedRepair: false, repairId: null as string | null, linkedRepairReport: null as MaintenanceReport | null };
  };

  // Flexible Order Classification helper for any maintenance type
  const getOrderClassification = (rep?: MaintenanceReport | null) => {
    if (!rep) {
      return {
        kind: 'order' as const,
        tag: 'MAINTENANCE WORK ORDER',
        tagIcon: 'checklist',
        title: 'Maintenance Work Order',
        accentColor: '#10b981',
        instructionsLabel: 'Work Scope & Maintenance Instructions *:',
        instructionsText: 'Scheduled maintenance and diagnostic inspection.',
        submitButtonText: 'Submit for Admin Verification',
        isRepair: false,
      };
    }

    const isEmergency = rep.type?.toLowerCase().includes('emergency') || rep.priority === 'Critical';
    const isRepair =
      rep.type?.toLowerCase().includes('repair') ||
      rep.type?.toLowerCase().includes('corrective') ||
      (rep.id ? rep.id.startsWith('REP-') : false);

    if (isRepair) {
      const displayType = rep.type && rep.type !== 'Preventive Maintenance' ? rep.type.toUpperCase() : 'CORRECTIVE MAINTENANCE';
      return {
        kind: 'repair' as const,
        tag: isEmergency ? 'EMERGENCY MAINTENANCE DISPATCH' : `${displayType} DISPATCH`,
        tagIcon: isEmergency ? 'alert' : 'gear',
        title: rep.title.startsWith('Repair') ? rep.title : `Repair Order: ${rep.title}`,
        accentColor: isEmergency ? '#f43f5e' : '#e11d48',
        instructionsLabel: 'Scope of Work & Repair Instructions *:',
        instructionsText:
          rep.description ||
          'Diagnose and repair component defect. Inspect AC device, verify electrical connections, and validate operational safety.',
        submitButtonText: 'Submit Repair',
        isRepair: true,
      };
    }

    // Any other type: Preventive, Routine, Inspection, Cleaning, Overhaul, etc.
    const normType = rep.type ? rep.type.trim() : 'Maintenance';
    return {
      kind: 'order' as const,
      tag: `${normType.toUpperCase()} DISPATCH`,
      tagIcon: 'checklist',
      title: rep.title || `${normType} Work Order`,
      accentColor: rep.priority === 'High' ? '#f59e0b' : '#059669',
      instructionsLabel: 'Work Scope & Maintenance Instructions *:',
      instructionsText: rep.description || 'Perform scheduled checklist procedures, safety inspection, and telemetry checks.',
      submitButtonText: 'Submit for Verification',
      isRepair: false,
    };
  };

  // Direct Submission for Admin Verification
  const handleSubmitForVerification = async (targetRepId?: string) => {
    const reportId = targetRepId || selectedReportId;
    const targetRep = pendingRepairToSubmit?.id === reportId ? pendingRepairToSubmit : reports.find((r) => r.id === reportId);
    if (!targetRep || isSubmitting) return;

    if (targetRep.status === 'For Verification' || targetRep.status === 'Completed') {
      alert(targetRep.status === 'Completed'
        ? 'This report has already been completed and verified by the administrator.'
        : 'This report has already been submitted for verification.');
      return;
    }

    // Completion & Verification Invariant:
    // A report cannot become Completed or Submitted for Verification while its own required tasks are unfinished!
    const allTasksDone = targetRep.items.length > 0 && targetRep.items.every(isChecklistItemComplete);
    if (!allTasksDone) {
      alert('Cannot submit for verification: All required checklist tasks must be completed first.');
      return;
    }
    const validationError = validateLiveMaintenanceItems(targetRep.items);
    if (validationError) {
      alert(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      const now = new Date();
      const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dateString = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const formattedTimestamp = `${dateString} — ${timeString}`;

      const finalizedItems = targetRep.items;

      const classification = getOrderClassification(targetRep);
      let customTimelineTitle = `Checklist completed & submitted for admin verification by ${userName || 'Maintenance Staff'}`;
      if (classification.kind === 'repair') {
        customTimelineTitle = `Corrective repair completed & submitted for admin verification by ${userName || 'Maintenance Staff'}`;
      }

      const isRepair = reportId.startsWith('REP-') || targetRep.type?.toLowerCase().includes('repair');

      if (isRepair) {
        const syncRes = await submitRepairAndSyncParent(reportId, userName, mutationContext(targetRep, { submitRepair: true }));
        if (!syncRes.success) {
          console.warn('Failed to submit repair to Supabase:', syncRes.error);
          alert(syncRes.error || 'The repair order could not be submitted. Please try again.');
          return;
        }

        setSubmittedRepairInfo({
          id: reportId,
          aircon: targetRep.airconName || targetRep.controllerName || 'Name unavailable',
          location: targetRep.location || 'Assigned Area',
          parentId: targetRep.parentReportId || null,
          isRepair: true,
        });

        // Reload all live reports from Supabase so both child repair and parent reports have their updated statuses, tasks, and completion counts
        await loadReports();
        setConfirmRepairModalVisible(false);
        setConfirmModalVisible(false);
        setRepairSuccessModalVisible(true);
        setSelectedReportId(reportId);
        setCurrentScreen('SUCCESS');
        return;
      }

      const res = await updateLiveMaintenanceReport(reportId, {
        ...mutationContext(targetRep, { status: 'For Verification', items: finalizedItems }),
        status: 'For Verification',
        items: finalizedItems,
        workerName: userName,
        location: targetRep.location,
        airconId: targetRep.airconId,
        existingTimeline: targetRep.timeline,
        customTimelineTitle,
      });

      if (!res.success) {
        console.warn('Failed to submit verification to Supabase:', res.error);
        alert(res.error || 'The maintenance report could not be submitted for verification. Please try again.');
        return;
      }

      rememberSavedVersion(reportId, res);

      setReports((prev) =>
        prev.map((rep) => {
          if (rep.id !== reportId) return rep;
          return {
            ...rep,
            items: finalizedItems,
            status: 'For Verification',
            lastUpdated: formattedTimestamp,
            issue: null,
          };
        })
      );

      setSubmittedRepairInfo({
        id: reportId,
        aircon: targetRep.airconName || targetRep.controllerName || 'Name unavailable',
        location: targetRep.location || 'Assigned Area',
        parentId: targetRep.parentReportId || null,
        isRepair: false,
      });

      setConfirmRepairModalVisible(false);
      setConfirmModalVisible(false);
      setRepairSuccessModalVisible(true);
      setSelectedReportId(reportId);
      setCurrentScreen('SUCCESS');
    } catch (e) {
      console.error('Error submitting verification:', e);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Presentation helpers share the same status roles as the desktop app.
  const getMetricCardStyle = (_filterType: string, active: boolean) => ({
    cardBg: active ? colors.accentSurface : colors.backgroundElement,
    border: active ? colors.emerald : colors.border,
    countColor: colors.text,
    labelColor: colors.textSecondary,
  });
  const getStatusColor = (status: ChecklistStatus | ReportStatus) => getStatusPalette(status, colors);
  const getPriorityColor = (priority: PriorityLevel) => {
    const tone = priority === 'Critical' || priority === 'High' ? 'error'
      : priority === 'Medium' ? 'warning' : 'info';
    return { bg: colors[`${tone}Surface`], text: colors[tone], border: colors[tone] };
  };

  // Filtered reports list for dashboard (Option B: child repairs are accessed via parent checklist items)
  const visibleReports = reports.filter((rep) => !isChildRepairReport(rep));
  const filteredReports = visibleReports.filter((rep) => {
    if (activeFilter !== 'All') {
      if (activeFilter === 'Needs Repair') {
        const repItems = rep.items || [];
        const hasRepairs =
          rep.status === 'Needs Repair' ||
          rep.status === 'Under Repair' ||
          repItems.some((i) => i.status !== 'For Verification' && !i.isRepaired && !i.repaired && (i.status === 'Needs Repair' || i.status === 'Under Repair' || Boolean(i.linkedRepairId)));
        if (!hasRepairs) return false;
      } else if (rep.status !== activeFilter) {
        return false;
      }
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        (rep.id || '').toLowerCase().includes(q) ||
        (rep.airconId || '').toLowerCase().includes(q) ||
        (rep.airconName || '').toLowerCase().includes(q) ||
        (rep.controllerName || '').toLowerCase().includes(q) ||
        (rep.location || '').toLowerCase().includes(q) ||
        (rep.title || '').toLowerCase().includes(q) ||
        (rep.assignedWorker && rep.assignedWorker.toLowerCase().includes(q)) ||
        (rep.description && rep.description.toLowerCase().includes(q)) ||
        (rep.parentReportId && rep.parentReportId.toLowerCase().includes(q)) ||
        (rep.linkedRepairId && rep.linkedRepairId.toLowerCase().includes(q)) ||
        (rep.type && rep.type.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const defaultRepairInfo = getDispatchedRepairInfo(activeReport);
  const hasDispatchedRepair = Boolean(activeRepairId || defaultRepairInfo.hasDispatchedRepair);
  const repairId = activeRepairId || defaultRepairInfo.repairId;
  const targetRepair = repairId
    ? reports.find((report) => report.id.toLowerCase() === repairId.toLowerCase())
    : null;
  const linkedRepairReport = targetRepair;
  const repairItems = targetRepair?.items || [];
  const repairDoneCount = repairItems.filter(isChecklistItemComplete).length;
  const repairPercentage = repairItems.length ? Math.round(repairDoneCount / repairItems.length * 100) : 0;
  const repairPhase = getMaintenancePhase(targetRepair);
  const isRepairReady = repairPhase === 'Ready to submit';
  const isRepairVerified = targetRepair ? isRepairDone(targetRepair) : false;
  const isRepairSubmitted = targetRepair
    ? !isRepairVerified && (isRepairAwaitingVerification(targetRepair) || targetRepair.status === 'For Verification')
    : false;

  return (
    <LinearGradient
      colors={[UiColors[effectiveTheme].background, UiColors[effectiveTheme].background]}
      style={[styles.container, { backgroundColor: colors.background }]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 0.35 }}
    >
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* ========================================================================= */}
        {/* SCREEN 1: MAINTENANCE DASHBOARD                                            */}
        {/* ========================================================================= */}
        {currentScreen === 'DASHBOARD' && (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
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
                <Image source={require('@/assets/images/ecoTrack.png')} style={styles.headerLogo} contentFit="contain" />
                <View>
                  <ThemedText style={[styles.headerTitle, { color: colors.text }]}>EcoTrack</ThemedText>
                  <ThemedText style={[styles.headerSubtitle, { color: colors.textSecondary }]}>Maintenance Module</ThemedText>
                </View>
              </View>
            </View>

            {/* Workflow Notice Banner */}
            <View style={[styles.workflowNotice, { backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement, borderColor: UiColors[effectiveTheme].panelBorder }]}>
              <AppIcon name="checklist" size={16} color={colors.emerald} />
              <ThemedText style={[styles.workflowNoticeText, { color: colors.textSecondary }]}>
                View assigned maintenance, update checklists and submit progress.
              </ThemedText>
            </View>

            {/* Top Summary Metrics */}
            <View style={styles.summaryContainer}>
              <ThemedText style={[styles.sectionHeaderTitle, { color: colors.text }]}>MAINTENANCE OVERVIEW</ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.summaryScrollGrid}>
                {/* Pending */}
                {(() => {
                  const s = getMetricCardStyle('Pending', activeFilter === 'Pending');
                  return (
                    <Pressable
                      onPress={() => setActiveFilter('Pending')}
                      style={[styles.summaryCard, { backgroundColor: s.cardBg, borderColor: UiColors[effectiveTheme].panelBorder }]}
                    >
                      <View style={[styles.summaryBadgeDot, { backgroundColor: getStatusPalette('Pending', colors).text }]} />
                      <ThemedText style={[styles.summaryCount, { color: s.countColor }]}>{pendingCount}</ThemedText>
                      <ThemedText style={[styles.summaryLabel, { color: s.labelColor }]}>Pending</ThemedText>
                    </Pressable>
                  );
                })()}

                {/* In Progress */}
                {(() => {
                  const s = getMetricCardStyle('In Progress', activeFilter === 'In Progress');
                  return (
                    <Pressable
                      onPress={() => setActiveFilter('In Progress')}
                      style={[styles.summaryCard, { backgroundColor: s.cardBg, borderColor: UiColors[effectiveTheme].panelBorder }]}
                    >
                      <View style={[styles.summaryBadgeDot, { backgroundColor: getStatusPalette('In Progress', colors).text }]} />
                      <ThemedText style={[styles.summaryCount, { color: s.countColor }]}>{inProgressCount}</ThemedText>
                      <ThemedText style={[styles.summaryLabel, { color: s.labelColor }]}>In Progress</ThemedText>
                    </Pressable>
                  );
                })()}

                {/* For Verification */}
                {(() => {
                  const s = getMetricCardStyle('For Verification', activeFilter === 'For Verification');
                  return (
                    <Pressable
                      onPress={() => setActiveFilter('For Verification')}
                      style={[styles.summaryCard, { backgroundColor: s.cardBg, borderColor: UiColors[effectiveTheme].panelBorder }]}
                    >
                      <View style={[styles.summaryBadgeDot, { backgroundColor: getStatusPalette('For Verification', colors).text }]} />
                      <ThemedText style={[styles.summaryCount, { color: s.countColor }]}>{forVerificationCount}</ThemedText>
                      <ThemedText style={[styles.summaryLabel, { color: s.labelColor }]} numberOfLines={1}>Verification</ThemedText>
                    </Pressable>
                  );
                })()}

                {/* Needs Repair */}
                {(() => {
                  const s = getMetricCardStyle('Needs Repair', activeFilter === 'Needs Repair');
                  return (
                    <Pressable
                      onPress={() => setActiveFilter('Needs Repair')}
                      style={[styles.summaryCard, { backgroundColor: s.cardBg, borderColor: UiColors[effectiveTheme].panelBorder }]}
                    >
                      <View style={[styles.summaryBadgeDot, { backgroundColor: getStatusPalette('Needs Repair', colors).text }]} />
                      <ThemedText style={[styles.summaryCount, { color: s.countColor }]}>{needsRepairCount}</ThemedText>
                      <ThemedText style={[styles.summaryLabel, { color: s.labelColor }]} numberOfLines={1}>Repairs</ThemedText>
                    </Pressable>
                  );
                })()}

                {/* Completed */}
                {(() => {
                  const s = getMetricCardStyle('Completed', activeFilter === 'Completed');
                  return (
                    <Pressable
                      onPress={() => setActiveFilter('Completed')}
                      style={[styles.summaryCard, { backgroundColor: s.cardBg, borderColor: UiColors[effectiveTheme].panelBorder }]}
                    >
                      <View style={[styles.summaryBadgeDot, { backgroundColor: getStatusPalette('Completed', colors).text }]} />
                      <ThemedText style={[styles.summaryCount, { color: s.countColor }]}>{completedCount}</ThemedText>
                      <ThemedText style={[styles.summaryLabel, { color: s.labelColor }]}>Completed</ThemedText>
                    </Pressable>
                  );
                })()}
              </ScrollView>
            </View>

            {/* Search Bar */}
            <View style={[styles.searchBarContainer, { backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement, borderColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].inputBorder : UiColors[effectiveTheme].inputBorder }]}>
              <AppIcon name="search" size={16} color={colors.textSecondary} style={styles.searchIcon} />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Search report ID, AC unit, room, or type..."
                placeholderTextColor={colors.textSecondary}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.length > 0 && (
                <Pressable onPress={() => setSearchQuery('')} style={styles.searchClearBtn}>
                  <ThemedText style={[styles.searchClearText, { color: colors.textSecondary }]}>✕</ThemedText>
                </Pressable>
              )}
            </View>

            {/* Filter Tabs */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterTabsRow}
            >
              {(['All', 'Pending', 'In Progress', 'For Verification', 'Needs Repair', 'Completed'] as const).map((filter) => {
                const isSelected = activeFilter === filter;
                return (
                  <Pressable
                    key={filter}
                    onPress={() => setActiveFilter(filter)}
                    style={[
                      styles.filterChip,
                      { backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement, borderColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border },
                      isSelected && { backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].primaryFill : UiColors[effectiveTheme].primaryFill, borderColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }
                    ]}
                  >
                    <ThemedText style={[styles.filterChipText, { color: effectiveTheme === 'dark' ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary }, isSelected && styles.filterChipTextActive]}>
                      {filter}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>

            {fetchError && <ThemedText style={{ color: colors.textSecondary, marginBottom: 12 }}>{fetchError}</ThemedText>}
            {/* Report Cards List */}
            <View style={styles.reportsList}>
              <View style={styles.listHeaderRow}>
                <ThemedText style={[styles.sectionHeaderTitle, { color: colors.text }]}>ASSIGNED REPORTS ({filteredReports.length})</ThemedText>
              </View>

              {loading && reports.length === 0 ? (
                <DataListSkeleton label="Loading assigned maintenance reports..." />
              ) : (
                filteredReports.map((report) => {
                  const repItems = report.items || [];
                  const repTotal = repItems.length;
                  const repDone = repItems.filter(isChecklistItemComplete).length;
                  const repRatio = repTotal > 0 ? repDone / repTotal : 0;
                  const repPct = Math.round(repRatio * 100);
                  const statusStyle = getStatusColor(report.status);
                  const priorityStyle = getPriorityColor(report.priority);
                  const repNeedsRepairCount = repItems.filter(
                    (i) => i.status !== 'For Verification' && !i.isRepaired && !i.repaired && (i.status === 'Needs Repair' || i.status === 'Under Repair' || Boolean(i.linkedRepairId))
                  ).length;

                  return (
                    <View key={report.id} style={[styles.reportCard, { backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement, borderColor: UiColors[effectiveTheme].panelBorder }]}>
                      {/* Top Row: Report ID and Status Badge */}
                      <View style={styles.cardHeaderRow}>
                        <View style={styles.reportIdPill}>
                          <ThemedText style={styles.reportIdText} numberOfLines={1} ellipsizeMode="middle">#{report.id}</ThemedText>
                        </View>
                        <View style={styles.statusBadgeWrapper}>
                          <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg, borderColor: statusStyle.border }]}>
                            <View style={[styles.statusDot, { backgroundColor: statusStyle.text }]} />
                            <ThemedText style={[styles.statusBadgeText, { color: statusStyle.text }]}>
                              {report.status === 'For Verification' ? 'For Verification (Needs Admin)' : report.status}
                            </ThemedText>
                          </View>
                          {(report.status === 'Needs Repair' || report.status === 'Under Repair' || repNeedsRepairCount > 0) && (
                            <View
                              style={[
                                styles.statusBadgeCount,
                                {
                                  backgroundColor: isDark ? '#ef4444' : '#dc2626',
                                  borderColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                                },
                              ]}
                            >
                              <ThemedText style={styles.statusBadgeCountText}>
                                {repNeedsRepairCount > 0 ? repNeedsRepairCount : 1}
                              </ThemedText>
                            </View>
                          )}
                        </View>
                      </View>

                      {/* Friendly Connected Repair Badge */}
                      {(() => {
                        const { hasDispatchedRepair, repairId } = getDispatchedRepairInfo(report);
                        const itemWithRepair = report.items?.find((i) => i.linkedRepairId);
                        const effectiveRepairId = repairId || itemWithRepair?.linkedRepairId || null;
                        const isRepairActive = Boolean(hasDispatchedRepair || effectiveRepairId);

                        const isRepairedAlready = isCorrectiveRepair(report)
                          ? isRepairDone(report)
                          : report.allChildRepairsDone === true && repNeedsRepairCount === 0;


                        if (!isRepairedAlready && !isRepairActive) return null;

                        return (
                          <View style={styles.cardBadgesRow}>

                            {isRepairActive && !isRepairedAlready && (
                              <View
                                style={[
                                  styles.cardCountBadge,
                                  {
                                    backgroundColor: isDark ? UiColors[effectiveTheme].errorSurface : UiColors[effectiveTheme].errorSurface,
                                    borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                                  },
                                ]}
                              >
                                <AppIcon name="gear" size={11} color={isDark ? '#fb7185' : '#e11d48'} />
                                <ThemedText
                                  style={[
                                    styles.cardCountBadgeText,
                                    {
                                      color: isDark ? UiColors[effectiveTheme].error : UiColors[effectiveTheme].error,
                                      fontWeight: '800',
                                    },
                                  ]}
                                >
                                  {repNeedsRepairCount > 1 ? `${repNeedsRepairCount} Repair Orders` : 'Repair Order'}
                                </ThemedText>
                              </View>
                            )}

                            {isRepairedAlready ? (
                              <View
                                style={[
                                  styles.cardCountBadge,
                                  {
                                    backgroundColor: isDark ? UiColors[effectiveTheme].accentSurface : UiColors[effectiveTheme].accentSurface,
                                    borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                                  },
                                ]}
                              >
                                <AppIcon name="check" size={11} color={isDark ? '#34d399' : '#047857'} />
                                <ThemedText
                                  style={[
                                    styles.cardCountBadgeText,
                                    {
                                      color: isDark ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].text,
                                      fontWeight: '800',
                                    },
                                  ]}
                                >
                                  Repaired Already
                                </ThemedText>
                              </View>
                            ) : null}
                          </View>
                        );
                      })()}

                      {/* Complete — Awaiting Admin Verification Notice */}
                      {report.status === 'For Verification' ? (
                        <View style={[styles.verificationNoticeCard, { backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].warningSurface : UiColors[effectiveTheme].warningSurface, borderColor: UiColors[effectiveTheme].panelBorder }]}>
                          <AppIcon name="shield" size={15} color={colors.warning} />
                          <View style={{ flex: 1 }}>
                            <ThemedText style={[styles.verificationNoticeHeader, { color: effectiveTheme === 'dark' ? UiColors[effectiveTheme].warning : UiColors[effectiveTheme].warning }]}>
                              Complete — Needs Admin Verification
                            </ThemedText>
                            <ThemedText style={[styles.verificationNoticeContent, { color: effectiveTheme === 'dark' ? UiColors[effectiveTheme].textSecondary : UiColors[effectiveTheme].warning }]}>
                              Checklist completed (100%). Submitted for administrator review and approval.
                            </ThemedText>
                          </View>
                        </View>
                      ) : null}

                      {/* AC Unit, Aircon Type, Work Type Badge, and Room Location */}
                      <View style={styles.acInfoRow}>
                        <View style={styles.acHeaderLine}>
                          <View style={styles.acTitleGroup}>
                            <View style={styles.acIconCircle}>
                              <AppIcon name="snowflake" size={14} color={colors.emerald} />
                            </View>
                            <ThemedText style={[styles.acTitleText, { color: colors.text }]}>
                              {report.controllerName || 'AC Device name unavailable'}
                            </ThemedText>
                          </View>
                          {report.type ? (
                            <View style={[
                              styles.reportTypeBadge,
                              {
                                backgroundColor: isDark ? UiColors[effectiveTheme].accentSurface : UiColors[effectiveTheme].accentSurface,
                                borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                              }
                            ]}>
                              <ThemedText style={[styles.reportTypeBadgeText, { color: isDark ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].text }]} numberOfLines={1}>
                                {report.type}
                              </ThemedText>
                            </View>
                          ) : null}
                        </View>

                        <ThemedText style={[styles.airconTypeTagText, { color: colors.textSecondary }]}>
                          Aircon: {report.airconName || 'Name unavailable'}
                        </ThemedText>

                        {/* Equipment Model & Aircon Type Row */}
                        <View style={styles.acMetaTagsRow}>
                          {report.airconType ? (
                            <View style={[styles.airconTypeTag, { backgroundColor: effectiveTheme === 'dark' ? '#0f172a' : UiColors[effectiveTheme].accentSurface, borderColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}>
                              <AppIcon name="gear" size={11} color={effectiveTheme === 'dark' ? '#34d399' : '#047857'} />
                              <ThemedText style={[styles.airconTypeTagText, { color: effectiveTheme === 'dark' ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].text }]}>
                                {report.airconType}
                              </ThemedText>
                            </View>
                          ) : null}

                          <View style={[styles.locationBadgeRow, { backgroundColor: effectiveTheme === 'dark' ? '#0f172a' : UiColors[effectiveTheme].background, borderColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}>
                            <LocationIcon size={12} color={UiColors[effectiveTheme].emerald} />
                            <ThemedText style={[styles.locationBadgeText, { color: colors.textSecondary }]}>
                              {report.location}
                            </ThemedText>
                          </View>
                        </View>
                      </View>

                      {/* Description UI Card (Work Scope) */}
                      <View style={[styles.descriptionCardBox, { backgroundColor: effectiveTheme === 'dark' ? '#0f172a' : UiColors[effectiveTheme].background, borderColor: UiColors[effectiveTheme].panelBorder }]}>
                        <View style={styles.descriptionBoxHeader}>
                          <AppIcon name="checklist" size={12} color={colors.textSecondary} />
                          <ThemedText style={styles.descriptionBoxLabel}>WORK SCOPE / DESCRIPTION</ThemedText>
                        </View>
                        <ThemedText style={[styles.descriptionBoxText, { color: colors.text }]} numberOfLines={3}>
                          {report.description || report.title || 'Scheduled preventive maintenance and diagnostic inspection for assigned AC unit.'}
                        </ThemedText>
                      </View>

                      {/* Admin Verification Remarks banner if present */}
                      {report.verificationRemarks ? (
                        <View style={[styles.verificationRemarksCard, { backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].warningSurface : UiColors[effectiveTheme].warningSurface, borderColor: UiColors[effectiveTheme].panelBorder }]}>
                          <AppIcon name="shield" size={14} color={effectiveTheme === 'dark' ? '#c4b5fd' : '#6b21a8'} />
                          <View style={{ flex: 1 }}>
                            <ThemedText style={[styles.verificationRemarksHeader, { color: effectiveTheme === 'dark' ? UiColors[effectiveTheme].textSecondary : UiColors[effectiveTheme].warning }]}>
                              Admin Verification Remarks
                            </ThemedText>
                            <ThemedText style={[styles.verificationRemarksContent, { color: effectiveTheme === 'dark' ? UiColors[effectiveTheme].textSecondary : UiColors[effectiveTheme].textSecondary }]}>
                              {report.verificationRemarks}
                            </ThemedText>
                          </View>
                        </View>
                      ) : null}

                      {/* Meta info tags */}
                      <View style={styles.metaTagsRow}>
                        <View style={[styles.priorityTag, { backgroundColor: priorityStyle.bg }]}>
                          <ThemedText style={[styles.priorityTagText, { color: priorityStyle.text }]}>
                            ● {report.priority} Priority
                          </ThemedText>
                        </View>
                        <View style={styles.dueTag}>
                          <AppIcon name="calendar" size={14} color={colors.textSecondary} style={styles.calendarIcon} />
                          <ThemedText style={[styles.dueTagText, { color: colors.textSecondary }]}>Due: {report.dueDate}</ThemedText>
                        </View>
                      </View>

                      {/* Progress Section */}
                      <View style={styles.cardProgressSection}>
                        <View style={styles.cardProgressLabelRow}>
                          <ThemedText style={[styles.cardProgressText, { color: colors.text }]}>
                            Checklist Progress ({repDone}/{repTotal} completed)
                          </ThemedText>
                          <ThemedText style={styles.cardProgressPct}>{repPct}%</ThemedText>
                        </View>
                        <View style={[styles.progressBarTrack, { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundSelected : UiColors[effectiveTheme].backgroundSelected }]}>
                          <View
                            style={[
                              styles.progressBarFill,
                              {
                                width: `${repPct}%`,
                                backgroundColor: repPct === 100 ? UiColors[effectiveTheme].primaryFill : UiColors[effectiveTheme].primaryFill,
                              },
                            ]}
                          />
                        </View>
                      </View>

                      {/* Card Button */}
                      <Pressable
                        onPress={() => handleOpenReport(report.id)}
                        style={[
                          styles.viewButton,
                          {
                            backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].primaryFill : UiColors[effectiveTheme].accentSurface,
                            borderColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border
                          }
                        ]}
                      >
                        <ThemedText style={[styles.viewButtonText, { color: effectiveTheme === 'dark' ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].text }]}>Open Maintenance Checklist</ThemedText>
                        <AppIcon name="chevron-right" size={14} color={effectiveTheme === 'dark' ? '#34d399' : '#059669'} style={styles.viewButtonIcon} />
                      </Pressable>
                    </View>
                  );
                }))}

              {!loading && !fetchError && filteredReports.length === 0 && (
                <View
                  style={[
                    styles.emptyState,
                    {
                      backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement,
                      borderColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.emptyIconCircle,
                      {
                        backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].accentSurface : UiColors[effectiveTheme].accentSurface,
                      },
                    ]}
                  >
                    <AppIcon name="checklist" size={26} color={colors.emerald} />
                  </View>
                  <ThemedText style={[styles.emptyTitle, { color: colors.text }]}>
                    No Maintenance Reports
                  </ThemedText>
                  <ThemedText style={[styles.emptyStateText, { color: colors.textSecondary }]}>
                    {activeFilter === 'All'
                      ? 'You have no assigned maintenance reports at this time.'
                      : `No reports found matching status "${activeFilter}".`}
                  </ThemedText>
                  {activeFilter !== 'All' && (
                    <Pressable
                      onPress={() => setActiveFilter('All')}
                      style={[
                        styles.emptyActionBtn,
                        {
                          backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].backgroundSelected : UiColors[effectiveTheme].backgroundSelected,
                          borderColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                        },
                      ]}
                    >
                      <ThemedText
                        style={[
                          styles.emptyActionBtnText,
                          { color: effectiveTheme === 'dark' ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].emerald },
                        ]}
                      >
                        Show All Reports
                      </ThemedText>
                    </Pressable>
                  )}
                </View>
              )}
            </View>
          </ScrollView>
        )}

        {/* ========================================================================= */}
        {/* SCREEN 2 & 3: MAINTENANCE REPORT DETAILS & CHECKLIST                       */}
        {/* ========================================================================= */}
        {currentScreen === 'DETAILS' && (
          activeReport ? (
            <View style={{ flex: 1 }}>
              <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                {/* Details Top Bar / Back Button */}
                <View style={styles.detailsTopBar}>
                  <Pressable onPress={() => setCurrentScreen('DASHBOARD')} style={styles.backButton}>
                    <ThemedText style={[styles.backButtonIcon, { color: colors.emerald }]}>‹</ThemedText>
                    <ThemedText style={[styles.backButtonText, { color: colors.emerald }]}>Back to Maintenance</ThemedText>
                  </Pressable>
                  <View style={styles.reportPillLarge}>
                    <ThemedText style={styles.reportPillLargeText} numberOfLines={1} ellipsizeMode="middle">{activeReport.id}</ThemedText>
                  </View>
                </View>

                {/* Screen Title */}
                <View style={styles.detailsHeaderBlock}>
                  <ThemedText style={[styles.detailsMainTitle, { color: colors.text }]}>Maintenance Report</ThemedText>
                  <ThemedText style={[styles.detailsMainSubtitle, { color: colors.textSecondary }]}>{activeReport.title}</ThemedText>
                </View>

                <View style={[styles.workflowPhase,{backgroundColor:getMaintenancePhase(activeReport) === 'Ready to submit' ? colors.warningSurface : getStatusPalette(activeReport.status,colors).bg}]}>
                  <ThemedText style={{color:getMaintenancePhase(activeReport) === 'Ready to submit' ? colors.warning : getStatusPalette(activeReport.status,colors).text,fontWeight:'700',fontSize:13}}>{getMaintenancePhase(activeReport)}</ThemedText>
                </View>
                {/* SCREEN 2: Aircon Information Card */}
                <View style={styles.airconInfoCard}>
                  <View style={styles.cardSectionHeader}>
                    <ThemedText style={[styles.cardSectionTitle, { color: colors.text }]}>AIRCON & EQUIPMENT INFORMATION</ThemedText>
                  </View>
                  <View style={styles.infoGrid}>
                    <View style={[styles.infoRow, { borderBottomColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}>
                      <ThemedText style={[styles.infoKey, { color: colors.textSecondary }]}>AC Device:</ThemedText>
                      <ThemedText style={[styles.infoValueBold, { color: colors.text }]}>{activeReport.controllerName || 'Name unavailable'}</ThemedText>
                    </View>
                    <View style={[styles.infoRow, { borderBottomColor: UiColors[effectiveTheme].border }]}>
                      <ThemedText style={[styles.infoKey, { color: colors.textSecondary }]}>Custom Aircon Name:</ThemedText>
                      <ThemedText style={[styles.infoValue, { color: colors.text }]}>{activeReport.airconName || 'Name unavailable'}</ThemedText>
                    </View>
                    <View style={[styles.infoRow, { borderBottomColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}>
                      <ThemedText style={[styles.infoKey, { color: colors.textSecondary }]}>Aircon Type:</ThemedText>
                      <ThemedText style={[styles.infoValue, { color: colors.text, fontWeight: '700' }]}>
                        {activeReport.airconType || '—'}
                      </ThemedText>
                    </View>
                    {activeReport.protocolName ? (
                      <View style={[styles.infoRow, { borderBottomColor: UiColors[effectiveTheme].border }]}>
                        <ThemedText style={[styles.infoKey, { color: colors.textSecondary }]}>IR Protocol:</ThemedText>
                        <ThemedText style={[styles.infoValue, { color: colors.text }]}>{activeReport.protocolName}</ThemedText>
                      </View>
                    ) : null}
                    <View style={[styles.infoRow, { borderBottomColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}>
                      <ThemedText style={[styles.infoKey, { color: colors.textSecondary }]}>Location:</ThemedText>
                      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
                        <LocationIcon size={12} color={UiColors[effectiveTheme].emerald} />
                        <ThemedText style={[styles.infoValue, { color: colors.text }]}>{activeReport.location}</ThemedText>
                      </View>
                    </View>
                    <View style={[styles.infoRow, { borderBottomColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}>
                      <ThemedText style={[styles.infoKey, { color: colors.textSecondary }]}>Maintenance Type:</ThemedText>
                      <ThemedText style={[styles.infoValue, { color: colors.text }]}>{activeReport.type}</ThemedText>
                    </View>
                    <View style={[styles.infoRow, { borderBottomColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}>
                      <ThemedText style={[styles.infoKey, { color: colors.textSecondary }]}>Latest Update:</ThemedText>
                      <ThemedText style={[styles.infoValue, { color: colors.text }]}>{activeReport.lastUpdated || 'Not updated yet'}</ThemedText>
                    </View>
                    <View style={[styles.infoRow, { borderBottomColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}>
                      <ThemedText style={[styles.infoKey, { color: colors.textSecondary }]}>Assigned Worker:</ThemedText>
                      <ThemedText style={[styles.infoValue, { color: colors.text }]}>{activeReport.assignedWorker}</ThemedText>
                    </View>
                    <View style={[styles.infoRow, { borderBottomColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}>
                      <ThemedText style={[styles.infoKey, { color: colors.textSecondary }]}>Priority:</ThemedText>
                      <View style={[styles.priorityPillSmall, { backgroundColor: getPriorityColor(activeReport.priority).bg }]}>
                        <ThemedText style={[styles.priorityPillSmallText, { color: getPriorityColor(activeReport.priority).text }]}>
                          {activeReport.priority}
                        </ThemedText>
                      </View>
                    </View>
                    <View style={[styles.infoRow, { borderBottomColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}>
                      <ThemedText style={[styles.infoKey, { color: colors.textSecondary }]}>Due Date:</ThemedText>
                      <ThemedText style={[styles.infoValue, { color: colors.text }]}>{activeReport.dueDate}</ThemedText>
                    </View>
                    <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
                      <ThemedText style={[styles.infoKey, { color: colors.textSecondary }]}>Created Date:</ThemedText>
                      <ThemedText style={[styles.infoValue, { color: colors.text }]}>{activeReport.createdDate || 'Scheduled'}</ThemedText>
                    </View>
                  </View>

                  {/* Admin Verification Remarks if verified */}
                  {activeReport.verificationRemarks ? (
                    <View style={[styles.detailsVerificationBanner, { backgroundColor: effectiveTheme === 'dark' ? '#1e1b4b' : '#f5f3ff', borderColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}>
                      <AppIcon name="shield" size={15} color={effectiveTheme === 'dark' ? '#c4b5fd' : '#6b21a8'} />
                      <View style={{ flex: 1 }}>
                        <ThemedText style={[styles.detailsVerificationTitle, { color: effectiveTheme === 'dark' ? '#c4b5fd' : UiColors[effectiveTheme].text }]}>
                          Facility Administrator Remarks
                        </ThemedText>
                        <ThemedText style={[styles.detailsVerificationText, { color: effectiveTheme === 'dark' ? '#e0e7ff' : '#4338ca' }]}>
                          {activeReport.verificationRemarks}
                        </ThemedText>
                      </View>
                    </View>
                  ) : null}

                  {/* Awaiting Admin Verification Banner */}
                  {activeReport.status === 'For Verification' && (
                    <View style={[styles.detailsPendingVerificationBanner, { backgroundColor: effectiveTheme === 'dark' ? 'rgba(147, 51, 234, 0.15)' : UiColors[effectiveTheme].infoSurface, borderColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}>
                      <AppIcon name="shield" size={16} color={colors.warning} />
                      <View style={{ flex: 1 }}>
                        <ThemedText style={[styles.detailsPendingVerificationTitle, { color: effectiveTheme === 'dark' ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}>
                          Awaiting Admin Verification
                        </ThemedText>
                        <ThemedText style={[styles.detailsPendingVerificationText, { color: effectiveTheme === 'dark' ? '#e9d5ff' : UiColors[effectiveTheme].info }]}>
                          Checklist complete. Submitted for administrator approval.
                        </ThemedText>
                      </View>
                    </View>
                  )}
                </View>

                <View style={styles.airconInfoCard}>
                  <View style={styles.cardSectionHeader}>
                    <ThemedText style={[styles.cardSectionTitle, { color: colors.text }]}>SCOPE / DESCRIPTION</ThemedText>
                  </View>
                  <ThemedText style={[styles.scopeDescriptionText, { color: colors.text }]}>
                    {activeReport.description || activeReport.title || 'No description provided.'}
                  </ThemedText>
                </View>

                {/* Maintenance Progress Section */}
                <View style={[styles.progressCard, { backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement, borderColor: UiColors[effectiveTheme].panelBorder }]}>
                  <View style={styles.progressCardHeader}>
                    <ThemedText style={[styles.cardSectionTitle, { color: colors.text }]}>Maintenance progress</ThemedText>
                    <ThemedText style={styles.progressPercentageText}>{progressPercentage}%</ThemedText>
                  </View>

                  <ThemedText style={{color:getMaintenancePhase(activeReport) === 'Ready to submit' ? colors.warning : colors.textSecondary,fontSize:13,marginTop:8}}>{getMaintenancePhase(activeReport)}</ThemedText>
                  <ThemedText style={[styles.progressCountText, { color: colors.textSecondary }]}>
                    {completedItems} of {totalItems} completed
                  </ThemedText>

                  {/* Progress Bar */}
                  <View style={[styles.largeProgressBarTrack, { backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].backgroundSelected : UiColors[effectiveTheme].backgroundSelected }]}>
                    <Animated.View
                      style={[
                        styles.largeProgressBarFill,
                        {
                          width: progressAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0%', '100%'],
                          }),
                          backgroundColor: progressPercentage === 100 ? UiColors[effectiveTheme].primaryFill : UiColors[effectiveTheme].primaryFill,
                        },
                      ]}
                    />
                  </View>

                  {/* Status Chips Summary */}
                  <View style={styles.statusChipsRow}>
                    <View style={[styles.statusChipItem, { backgroundColor: effectiveTheme === 'dark' ? '#0f172a' : UiColors[effectiveTheme].background }]}>
                      <ThemedText style={[styles.statusChipNum, { color: UiColors[effectiveTheme].emerald }]}>{completedItems}</ThemedText>
                      <ThemedText style={[styles.statusChipLabel, { color: colors.textSecondary }]}>Done</ThemedText>
                    </View>
                    <View style={[styles.statusChipItem, { backgroundColor: effectiveTheme === 'dark' ? '#0f172a' : UiColors[effectiveTheme].background }]}>
                      <ThemedText style={[styles.statusChipNum, { color: UiColors[effectiveTheme].warning }]}>{inProgressItems}</ThemedText>
                      <ThemedText style={[styles.statusChipLabel, { color: colors.textSecondary }]}>In Progress</ThemedText>
                    </View>
                    <View style={[styles.statusChipItem, { backgroundColor: effectiveTheme === 'dark' ? '#0f172a' : UiColors[effectiveTheme].background }]}>
                      <ThemedText style={[styles.statusChipNum, { color: UiColors[effectiveTheme].textSecondary }]}>{notStartedItems}</ThemedText>
                      <ThemedText style={[styles.statusChipLabel, { color: colors.textSecondary }]}>Not Started</ThemedText>
                    </View>
                    {!isCurrentRepair && needsRepairItems > 0 && (
                      <View style={[styles.statusChipItem, { backgroundColor: effectiveTheme === 'dark' ? '#0f172a' : UiColors[effectiveTheme].background }]}>
                        <ThemedText style={[styles.statusChipNum, { color: UiColors[effectiveTheme].error }]}>{needsRepairItems}</ThemedText>
                        <ThemedText style={[styles.statusChipLabel, { color: colors.textSecondary }]}>Repair work</ThemedText>
                      </View>
                    )}
                  </View>
                </View>

                {/* SCREEN 3: Maintenance Checklist Section */}
                <View style={styles.checklistSection}>
                  <View style={styles.checklistSectionHeader}>
                    <AppIcon name="checklist" size={18} color={isDark ? '#34d399' : '#064e3b'} style={styles.checklistIcon} />
                    <ThemedText style={[styles.checklistSectionTitle, { color: colors.text }]}>MAINTENANCE CHECKLIST</ThemedText>
                  </View>
                  <ThemedText style={[styles.checklistHint, { color: colors.textSecondary }]}>
                    Tap a task for notes, photos or status. Open its linked order to continue a repair.
                  </ThemedText>

                  <View style={styles.checklistItemsList}>
                    {activeReport.items.map((item, index) => {
                      const linkedRepair = reports.find(r => r.id.toLowerCase() === item.linkedRepairId?.toLowerCase());
                      // Service reconciliation also covers repairs assigned to other workers.
                      const repairDone = linkedRepair ? isRepairDone(linkedRepair) : item.repaired === true;
                      const isAwaitingVerification = !repairDone && (isRepairAwaitingVerification(linkedRepair) || item.status === 'For Verification');
                      const isUnderRepair = !repairDone && !isAwaitingVerification && (item.status === 'Under Repair' || Boolean(item.linkedRepairId));
                      const isItemChecked = isChecklistItemComplete(item) && !isUnderRepair && (!linkedRepair || repairDone);
                      const isItemRepaired = isItemChecked && Boolean(item.isRepaired || item.repaired);
                      const statusStyle = getStatusColor(isAwaitingVerification ? 'For Verification' : isUnderRepair ? 'Under Repair' : item.status);
                      const photoCount = Array.isArray(item.photoUris) && item.photoUris.length > 0
                        ? item.photoUris.length
                        : (item.photoUri ? 1 : 0);
                      const displayRemarks = item.remarks || item.problemDescription;

                      return (
                        <View key={item.id} style={styles.checklistItemCard}>
                          <View style={styles.checklistItemMain}>
                            <Pressable accessibilityRole="checkbox" accessibilityLabel={`Mark ${item.title} done`}
                              accessibilityState={{checked:isItemChecked,disabled:Boolean(item.linkedRepairId) || activeReport.status === 'Completed' || activeReport.status === 'For Verification'}}
                              disabled={Boolean(item.linkedRepairId) || activeReport.status === 'Completed' || activeReport.status === 'For Verification'}
                              onPress={() => handleToggleTaskCheck(item.id, activeReport.id)}
                              style={[styles.interactiveCheckBtn,{backgroundColor:isItemChecked ? colors.primaryFill : colors.backgroundSelected,borderColor:colors.border}]}>
                              <ThemedText style={{color:isItemChecked ? colors.onPrimary : colors.text,fontWeight:'700'}}>{isItemChecked ? '✓' : index+1}</ThemedText>
                            </Pressable>
                            <Pressable accessibilityRole="button" accessibilityLabel={`View ${item.title}`} onPress={() => handleOpenItemEditor(item,activeReport.id)} style={styles.itemTextContainer}>
                              <ThemedText style={styles.itemTitle}>{item.title}</ThemedText>
                              <View style={[styles.inlineStatusPill,{backgroundColor:statusStyle.bg,borderColor:colors.border}]}>
                                <ThemedText style={[styles.inlineStatusPillText,{color:statusStyle.text}]}>{isAwaitingVerification ? 'For verification' : isUnderRepair ? 'Under repair' : isItemRepaired ? 'Repaired' : isItemChecked ? 'Done' : item.status}</ThemedText>
                              </View>
                            </Pressable>
                          </View>
                          {item.linkedRepairId ? (
                            <Pressable accessibilityRole="button" accessibilityLabel={`Open repair ${item.linkedRepairId}`} onPress={() => handleOpenRepairPage(item.linkedRepairId!)} style={styles.repairTaskLinkBtn}>
                              <ThemedText style={styles.repairTaskLinkBtnText}>Open repair</ThemedText>
                              <ThemedText style={[styles.repairTaskLinkBtnText,{color:colors.info,flexShrink:1}]}>{item.linkedRepairId} ↗</ThemedText>
                            </Pressable>
                          ) : null}
                          {photoCount > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={`View ${photoCount} photos for ${item.title}`} onPress={() => handleOpenItemEditor(item,activeReport.id)} style={styles.checklistPhotoAction}>
                            <AppIcon name="camera" size={16} color={colors.textSecondary}/><ThemedText style={{color:colors.textSecondary,fontSize:13}}>{photoCount} {photoCount === 1 ? 'photo' : 'photos'}</ThemedText>
                          </Pressable> : null}
                          {displayRemarks ? <View style={styles.remarksSnippet}><ThemedText style={styles.remarksSnippetText}>{displayRemarks}</ThemedText></View> : null}
                        </View>
                      );
                    })}
                  </View>
                </View>

                {/* SCREEN 5: Submit Maintenance Update Button or Verification Status Card */}
                <View style={styles.submitSection}>
                  {activeReport.status === 'For Verification' ? (
                    <View
                      style={[
                        styles.verifiedRepairBox,
                        {
                          backgroundColor: isDark ? 'rgba(147, 51, 234, 0.16)' : UiColors[effectiveTheme].infoSurface,
                          borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                        },
                      ]}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
                        <View
                          style={[
                            styles.verifiedIconBadge,
                            {
                              backgroundColor: isDark ? UiColors[effectiveTheme].infoSurface : '#ede9fe',
                              borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                            },
                          ]}
                        >
                          <AppIcon name="shield" size={17} color={colors.warning} />
                        </View>
                        <ThemedText style={[styles.verifiedRepairBoxTitle, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}>
                          Submitted for Verification
                        </ThemedText>
                      </View>
                      <ThemedText style={[styles.verifiedRepairBoxSubtitle, { color: isDark ? '#e9d5ff' : UiColors[effectiveTheme].text }]}>
                        Checklist complete. Awaiting administrator approval.
                      </ThemedText>
                    </View>
                  ) : activeReport.status === 'Completed' ? (
                    <View
                      style={[
                        styles.verifiedRepairBox,
                        {
                          backgroundColor: isDark ? UiColors[effectiveTheme].accentSurface : UiColors[effectiveTheme].accentSurface,
                          borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                        },
                      ]}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
                        <View
                          style={[
                            styles.verifiedIconBadge,
                            {
                              backgroundColor: isDark ? UiColors[effectiveTheme].accentSurface : UiColors[effectiveTheme].accentSurface,
                              borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                            },
                          ]}
                        >
                          <AppIcon name="check" size={16} color={isDark ? '#34d399' : '#047857'} />
                        </View>
                        <ThemedText style={[styles.verifiedRepairBoxTitle, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}>
                          Verified & Completed by Admin
                        </ThemedText>
                      </View>
                      <ThemedText style={[styles.verifiedRepairBoxSubtitle, { color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].text }]}>
                        Maintenance approved by the administrator.
                      </ThemedText>
                    </View>
                  ) : (
                    <>
                      <Pressable
                        disabled={isSubmitting}
                        accessibilityState={{ disabled: isSubmitting, busy: isSubmitting }}
                        onPress={() => {
                          confirmationSnapshot.current = activeReport;
                          setConfirmModalVisible(true);
                        }}
                        style={({ pressed }) => [
                          styles.submitRepairBtn,
                          pressed && { opacity: 0.88, transform: [{ scale: 0.985 }] },
                        ]}
                      >
                        <LinearGradient
                          colors={[colors.primaryFill, colors.primaryFill]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.submitRepairGradient}
                        >
                          <View style={styles.submitBtnInner}>
                            <AppIcon
                              name={progressPercentage === 100 ? 'check' : 'checklist'}
                              size={18}
                              color={UiColors[effectiveTheme].onPrimary}
                            />
                            <ThemedText style={styles.submitBtnTextPrimary}>
                              {isSubmitting ? 'Saving item…' : progressPercentage === 100 ? 'Submit for Verification' : 'Save Progress'}
                            </ThemedText>
                          </View>
                        </LinearGradient>
                      </Pressable>
                      <ThemedText style={[styles.submitDisclaimer, { color: colors.textSecondary }]}>
                        {progressPercentage === 100
                          ? 'Notifies administrator for review & sign-off.'
                          : 'Synchronizes updates to desktop dashboard.'}
                      </ThemedText>
                    </>
                  )}
                </View>
              </ScrollView>
            </View>
          ) : (
            <View style={{ flex: 1, padding: 32, alignItems: 'center', justifyContent: 'center' }}>
              {loading ? (
                <>
                  <ActivityIndicator size="large" color={UiColors[effectiveTheme].emerald} />
                  <ThemedText style={{ marginTop: 14, fontSize: 14, color: colors.textSecondary }}>
                    Loading maintenance report...
                  </ThemedText>
                </>
              ) : (
                <View
                  style={[
                    styles.emptyState,
                    {
                      backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement,
                      borderColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                      width: '100%',
                      maxWidth: 340,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.emptyIconCircle,
                      {
                        backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].accentSurface : UiColors[effectiveTheme].accentSurface,
                      },
                    ]}
                  >
                    <AppIcon name="search" size={24} color={colors.emerald} />
                  </View>
                  <ThemedText style={[styles.emptyTitle, { color: colors.text }]}>
                    Report Not Found
                  </ThemedText>
                  <ThemedText style={[styles.emptyStateText, { color: colors.textSecondary, marginBottom: 16 }]}>
                    The requested maintenance report could not be found or has been removed.
                  </ThemedText>
                  <Pressable
                    onPress={() => setCurrentScreen('DASHBOARD')}
                    style={[
                      styles.viewButton,
                      {
                        backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].primaryFill : UiColors[effectiveTheme].accentSurface,
                        borderColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                        width: '100%',
                        justifyContent: 'center',
                      },
                    ]}
                  >
                    <ThemedText
                      style={[
                        styles.viewButtonText,
                        { color: effectiveTheme === 'dark' ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].text },
                      ]}
                    >
                      Back to Maintenance
                    </ThemedText>
                  </Pressable>
                </View>
              )}
            </View>
          )
        )}

        {/* ========================================================================= */}
        {/* REPAIR PAGE (Dedicated Full Page for Corrective Repair Order)              */}
        {/* ========================================================================= */}
        {currentScreen === 'REPAIR' && activeReport && (
          !hasDispatchedRepair || !repairId || !targetRepair ? (
              <View style={{ flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' }}>
                <View style={[styles.emptyState, { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement, borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border, width: '100%', maxWidth: 360 }]}>
                  <View style={[styles.emptyIconCircle, { backgroundColor: isDark ? UiColors[effectiveTheme].errorSurface : UiColors[effectiveTheme].errorSurface }]}>
                    <AppIcon name="gear" size={28} color={isDark ? '#f87171' : '#dc2626'} />
                  </View>
                  <ThemedText style={[styles.emptyTitle, { color: colors.text, textAlign: 'center' }]}>
                    {repairId ? `Repair ${repairId} unavailable` : 'No Dispatched Repair Task'}
                  </ThemedText>
                  <ThemedText style={[styles.emptyStateText, { color: colors.textSecondary, textAlign: 'center', marginBottom: 20 }]}>
                    {repairId
                      ? 'Repair record unavailable. Refresh or contact your administrator.'
                      : 'No repair task has been assigned yet.'}
                  </ThemedText>
                  <Pressable
                    onPress={() => {
                      setActiveRepairId(null);
                      setCurrentScreen('DETAILS');
                    }}
                    style={[styles.emptyActionBtn, { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundSelected : UiColors[effectiveTheme].backgroundSelected, borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}
                  >
                    <ThemedText style={[styles.emptyActionBtnText, { color: colors.emerald }]}>
                      Back to Checklist
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
          ) : (
            <View style={{ flex: 1 }}>
              <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                {/* Top Back Navigation & Report ID Header */}
                <View style={styles.detailsTopBar}>
                  <Pressable onPress={() => { setActiveRepairId(null); setCurrentScreen('DETAILS'); }} style={styles.backButton}>
                    <ThemedText style={[styles.backButtonIcon, { color: colors.emerald }]}>‹</ThemedText>
                    <ThemedText style={[styles.backButtonText, { color: colors.emerald }]}>Back to Checklist</ThemedText>
                  </Pressable>

                  <View
                    style={[
                      styles.reportPillLarge,
                      {
                        backgroundColor: isRepairVerified
                          ? (isDark ? 'rgba(16, 185, 129, 0.2)' : '#ecfdf5')
                          : isRepairSubmitted
                          ? (isDark ? 'rgba(168, 85, 247, 0.2)' : '#f3e8ff')
                          : (isDark ? 'rgba(244, 63, 94, 0.2)' : '#ffe4e6'),
                      },
                    ]}
                  >
                    <ThemedText
                      style={[
                        styles.reportPillLargeText,
                        {
                          color: isRepairVerified
                            ? (isDark ? '#34d399' : '#047857')
                            : isRepairSubmitted
                            ? (colors.warning)
                            : (isDark ? '#fda4af' : '#be123c'),
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {isRepairVerified
                        ? `✓ #${repairId} VERIFIED`
                        : isRepairSubmitted
                        ? `⏱ #${repairId} FOR VERIFICATION`
                        : `#${repairId}`}
                    </ThemedText>
                  </View>
                </View>

                {/* Screen Title Block */}
                <View style={styles.detailsHeaderBlock}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <AppIcon
                      name={isRepairVerified ? 'check' : isRepairSubmitted ? 'clock' : 'gear'}
                      size={16}
                      color={
                        isRepairVerified
                          ? (isDark ? '#34d399' : '#059669')
                          : isRepairSubmitted
                          ? (colors.warning)
                          : (isDark ? '#fb7185' : '#e11d48')
                      }
                    />
                    <ThemedText
                      style={{
                        fontSize: 12,
                        fontWeight: '900',
                        color: isRepairVerified
                          ? (isDark ? '#34d399' : '#059669')
                          : isRepairSubmitted
                          ? (colors.warning)
                          : (isDark ? '#fb7185' : '#e11d48'),
                        letterSpacing: 0.8,
                        textTransform: 'uppercase',
                      }}
                    >
                      {isRepairVerified
                        ? 'CORRECTIVE REPAIR VERIFIED & APPROVED BY ADMIN'
                        : isRepairSubmitted
                        ? 'CORRECTIVE REPAIR AWAITING ADMIN VERIFICATION'
                        : 'CORRECTIVE REPAIR DISPATCH'}
                    </ThemedText>
                  </View>
                  <ThemedText style={[styles.detailsMainTitle, { color: colors.text }]}>Repair Order #{repairId}</ThemedText>
                  <ThemedText style={[styles.detailsMainSubtitle, { color: colors.textSecondary }]}>
                    {targetRepair.controllerName || activeReport.controllerName || 'AC Device name unavailable'} · {targetRepair.airconName || activeReport.airconName || 'Aircon name unavailable'} — {targetRepair.location || activeReport.location}
                  </ThemedText>
                </View>

                <View style={[styles.workflowPhase,{backgroundColor:isRepairVerified ? colors.successSurface : isRepairReady || isRepairSubmitted ? colors.warningSurface : colors.infoSurface}]}>
                  <ThemedText style={{color:isRepairVerified ? colors.success : isRepairReady || isRepairSubmitted ? colors.warning : colors.info,fontWeight:'700',fontSize:13}}>{repairPhase}</ThemedText>
                </View>
                {/* Supervisor Scope & Instructions Box */}
                <View
                  style={[
                    styles.pageInstructionCard,
                    {
                      backgroundColor: colors.backgroundElement,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.pageInstructionLabel,
                      {
                        color: colors.textSecondary
                      },
                    ]}
                  >
                    {isRepairVerified
                      ? '✓ SCOPE OF WORK & REPAIR APPROVED BY ADMIN'
                      : isRepairSubmitted
                      ? '⏱ SCOPE OF WORK & REPAIR SUBMITTED FOR SIGN-OFF'
                      : 'SCOPE OF WORK & REPAIR INSTRUCTIONS *'}
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.pageInstructionText,
                      {
                        color: colors.textSecondary
                      },
                    ]}
                  >
                    {isRepairVerified
                      ? `"Corrective repair #${repairId} was verified and approved by the Facility Administrator. Component defect resolved and operational safety restored."`
                      : `"${targetRepair.description || 'Diagnose and repair component defect. Inspect AC device, verify electrical connections, and validate operational safety.'}"`}
                  </ThemedText>

                  <View style={styles.pageMetaGrid}>
                    <View style={styles.pageMetaItem}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <AppIcon name="user" size={12} color={colors.textSecondary} />
                        <ThemedText style={[styles.pageMetaKey, { color: colors.textSecondary }]}>Assigned To:</ThemedText>
                      </View>
                      <ThemedText style={[styles.pageMetaVal, { color: colors.text }]}>{targetRepair.assignedWorker || activeReport.assignedWorker}</ThemedText>
                    </View>
                    <View style={styles.pageMetaItem}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <AppIcon name="calendar" size={12} color={colors.textSecondary} />
                        <ThemedText style={[styles.pageMetaKey, { color: colors.textSecondary }]}>Due Date:</ThemedText>
                      </View>
                      <ThemedText style={[styles.pageMetaVal, { color: colors.text }]}>{targetRepair.dueDate || activeReport.dueDate}</ThemedText>
                    </View>
                    <View style={styles.pageMetaItem}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <AppIcon
                          name={isRepairVerified ? 'check' : isRepairSubmitted ? 'clock' : 'alert-octagon'}
                          size={12}
                          color={
                            isRepairVerified
                              ? (isDark ? '#34d399' : '#059669')
                              : isRepairSubmitted
                              ? (colors.warning)
                              : (isDark ? '#fb7185' : '#e11d48')
                          }
                        />
                        <ThemedText style={[styles.pageMetaKey, { color: colors.textSecondary }]}>
                          {isRepairVerified ? 'Status:' : isRepairSubmitted ? 'Status:' : 'Priority:'}
                        </ThemedText>
                      </View>
                      <ThemedText
                        style={[
                          styles.pageMetaVal,
                          {
                            color: colors.textSecondary
                          },
                        ]}
                      >
                        {isRepairVerified ? 'Repaired Already' : isRepairSubmitted ? 'For Verification' : (targetRepair.priority || activeReport.priority || 'Critical')}
                      </ThemedText>
                    </View>
                  </View>
                </View>

                <View style={styles.progressCard}>
                  <View style={styles.progressCardHeader}>
                    <ThemedText style={styles.cardSectionTitle}>Repair progress</ThemedText>
                    <ThemedText style={styles.progressPercentageText}>{repairPercentage}%</ThemedText>
                  </View>
                  <ThemedText style={styles.progressCountText}>{repairDoneCount} of {repairItems.length} done</ThemedText>
                  <View style={styles.largeProgressBarTrack} accessibilityRole="progressbar" accessibilityLabel="Repair progress"
                    accessibilityValue={{ min: 0, max: Math.max(repairItems.length, 1), now: repairDoneCount }}>
                    <View style={[styles.largeProgressBarFill, { width: `${repairPercentage}%`, backgroundColor: colors.emerald }]} />
                  </View>
                </View>

                {/* Repair Tasks Checklist Section */}
                <View style={styles.checklistSection}>
                  <View style={styles.checklistSectionHeader}>
                    <AppIcon
                      name="checklist"
                      size={18}
                      color={
                        isRepairVerified
                          ? (isDark ? '#34d399' : '#059669')
                          : isRepairSubmitted
                          ? (colors.warning)
                          : (isDark ? '#fb7185' : '#e11d48')
                      }
                      style={styles.checklistIcon}
                    />
                    <ThemedText style={[styles.checklistSectionTitle, { color: colors.text }]}>
                      {isRepairVerified
                        ? 'VERIFIED REPAIR ACTION STEPS'
                        : isRepairSubmitted
                        ? 'REPAIR ACTION STEPS SUBMITTED'
                        : 'REPAIR ACTION STEPS & TELEMETRY'}
                    </ThemedText>
                  </View>
                  <ThemedText style={[styles.checklistHint, { color: colors.textSecondary }]}>
                    {isRepairVerified
                      ? 'All corrective repair tasks were verified and completed.'
                      : isRepairSubmitted
                      ? 'All corrective repair tasks have been completed and submitted for verification.'
                      : 'Execute corrective repair steps. Tap any item to attach photo proof or record telemetry notes.'}
                  </ThemedText>

                  <View style={styles.checklistItemsList}>
                    {repairItems.map((item, index) => {
                      const statusStyle = getStatusColor(item.status);
                      const isDone = isRepairVerified || item.status === 'Completed';

                      return (
                        <View
                          key={item.id}
                          style={[
                            styles.checklistItemCard,
                            {
                              backgroundColor: isDark ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          <View style={styles.checklistItemMain}>
                            <Pressable
                              onPress={() => handleToggleTaskCheck(item.id, targetRepair.id)}
                              style={[
                                styles.interactiveCheckBtn,
                                {
                                  backgroundColor: isDone ? UiColors[effectiveTheme].primaryFill : (isDark ? '#0f172a' : '#f1f5f9'),
                                  borderColor: isDone ? UiColors[effectiveTheme].emerald : (isDark ? '#334155' : '#cbd5e1'),
                                },
                              ]}
                            >
                              {isDone ? (
                                <ThemedText style={{ color: UiColors[effectiveTheme].onPrimary, fontWeight: '900', fontSize: 13 }}>✓</ThemedText>
                              ) : (
                                <ThemedText style={{ color: colors.textSecondary, fontWeight: '800', fontSize: 11 }}>{index + 1}</ThemedText>
                              )}
                            </Pressable>
                            <Pressable onPress={() => handleOpenItemEditor(item, targetRepair.id)} style={styles.itemTextContainer}>
                              <ThemedText
                                style={[
                                  styles.itemTitle,
                                  { color: colors.text },
                                ]}
                              >
                                {item.title || 'Maintenance Task'}
                              </ThemedText>
                              {Boolean(item.description && item.description.trim()) ? (
                                <ThemedText style={[styles.itemDescription, { color: colors.textSecondary }]} numberOfLines={2}>
                                  {item.description}
                                </ThemedText>
                              ) : null}

                              {Boolean(item.remarks && item.remarks.trim()) ? (
                                <View style={[
                                  styles.remarksSnippet,
                                  {
                                    backgroundColor: isDark ? 'rgba(15, 23, 42, 0.85)' : UiColors[effectiveTheme].background,
                                    borderLeftColor: isDone ? (isDark ? '#34d399' : '#10b981') : (isDark ? '#fb7185' : '#e11d48'),
                                    borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                                    borderWidth: isDark ? 1 : 0,
                                    borderLeftWidth: 3,
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 6,
                                  }
                                ]}>
                                  <AppIcon name="chat" size={12} color={isDark ? '#94a3b8' : '#64748b'} />
                                  <ThemedText style={[styles.remarksSnippetText, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].textSecondary, flex: 1 }]} numberOfLines={1}>
                                    {item.remarks}
                                  </ThemedText>
                                </View>
                              ) : null}

                              {Boolean((item.photoUris && item.photoUris.length > 0) || (item.photoUri && item.photoUri.trim())) ? (
                                <View style={[
                                  styles.photoAttachedBadge,
                                  {
                                    backgroundColor: isDark ? UiColors[effectiveTheme].infoSurface : UiColors[effectiveTheme].infoSurface,
                                    borderWidth: isDark ? 1 : 0,
                                    borderColor: isDark ? UiColors[effectiveTheme].border : 'transparent',
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 4,
                                  }
                                ]}>
                                  <AppIcon name="camera" size={11} color={isDark ? '#38bdf8' : '#0369a1'} />
                                  <ThemedText style={[styles.photoAttachedText, { color: isDark ? UiColors[effectiveTheme].info : '#0369a1' }]}>
                                    {(item.photoUris && item.photoUris.length > 1)
                                      ? `${item.photoUris.length} Photos`
                                      : 'Photo attached'}
                                  </ThemedText>
                                </View>
                              ) : null}
                            </Pressable>
                          </View>

                          {/* Output Only Status Badge */}
                          <View style={styles.dropdownBtnContainer}>
                            <View
                              style={[
                                styles.checklistStatusBadge,
                                isDone
                                  ? {
                                      backgroundColor: isDark ? UiColors[effectiveTheme].accentSurface : UiColors[effectiveTheme].accentSurface,
                                      borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                                    }
                                  : {
                                      backgroundColor: statusStyle.bg,
                                      borderColor: statusStyle.border,
                                    },
                              ]}
                            >
                              <View
                                style={[
                                  styles.statusDot,
                                  {
                                    backgroundColor: isDone
                                      ? (isDark ? '#34d399' : '#059669')
                                      : statusStyle.text,
                                  },
                                ]}
                              />
                              <ThemedText
                                style={[
                                  styles.checklistStatusBadgeText,
                                  {
                                    color: isDone
                                      ? (isDark ? '#34d399' : '#047857')
                                      : statusStyle.text,
                                  },
                                ]}
                              >
                                {isDone ? 'Done' : item.status}
                              </ThemedText>
                            </View>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>

                {/* Submit Completed Repair Button or Verification Status Card */}
                <View style={styles.submitSection}>
                  {isRepairVerified ? (
                    <View
                      style={[
                        styles.verifiedRepairBox,
                        {
                          backgroundColor: isDark ? UiColors[effectiveTheme].accentSurface : UiColors[effectiveTheme].accentSurface,
                          borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                        },
                      ]}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
                        <View
                          style={[
                            styles.verifiedIconBadge,
                            {
                              backgroundColor: isDark ? UiColors[effectiveTheme].accentSurface : UiColors[effectiveTheme].accentSurface,
                              borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                            },
                          ]}
                        >
                          <AppIcon name="check" size={16} color={isDark ? '#34d399' : '#047857'} />
                        </View>
                        <ThemedText style={[styles.verifiedRepairBoxTitle, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}>
                          Repaired Already — Verified by Admin
                        </ThemedText>
                      </View>
                      <ThemedText style={[styles.verifiedRepairBoxSubtitle, { color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].text }]}>
                        Repair approved by the administrator.
                      </ThemedText>
                    </View>
                  ) : isRepairSubmitted ? (
                    <View
                      style={[
                        styles.verifiedRepairBox,
                        {
                          backgroundColor: isDark ? 'rgba(147, 51, 234, 0.16)' : UiColors[effectiveTheme].infoSurface,
                          borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                        },
                      ]}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
                        <View
                          style={[
                            styles.verifiedIconBadge,
                            {
                              backgroundColor: isDark ? UiColors[effectiveTheme].infoSurface : '#ede9fe',
                              borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                            },
                          ]}
                        >
                          <AppIcon name="shield" size={17} color={colors.warning} />
                        </View>
                        <ThemedText style={[styles.verifiedRepairBoxTitle, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}>
                          Submitted for Verification — Awaiting Admin Sign-Off
                        </ThemedText>
                      </View>
                      <ThemedText style={[styles.verifiedRepairBoxSubtitle, { color: isDark ? '#e9d5ff' : UiColors[effectiveTheme].text }]}>
                        Repair complete. Awaiting administrator approval.
                      </ThemedText>
                    </View>
                  ) : (
                    <>
                      <ThemedText style={{color:colors.textSecondary,fontSize:13}}>{isRepairReady ? 'Checklist complete. Submit for administrator review.' : 'Complete every repair step before submitting.'}</ThemedText>
                      <Pressable accessibilityRole="button" accessibilityLabel="Submit repair for verification" disabled={!isRepairReady || isSubmitting}
                        onPress={() => { setPendingRepairToSubmit(targetRepair); setConfirmRepairModalVisible(true); }}
                        style={[styles.submitButton,(!isRepairReady || isSubmitting) && {opacity:0.5}]}>
                        <ThemedText style={{color:colors.onPrimary,fontWeight:'700',fontSize:15}}>Submit for verification</ThemedText>
                      </Pressable>
                    </>
                  )}
                </View>
              </ScrollView>
            </View>
          )
        )}

        {/* ========================================================================= */}
        {/* SCREEN 6: SUCCESSFUL SUBMISSION SCREEN                                     */}
        {/* ========================================================================= */}
        {currentScreen === 'SUCCESS' && (
          activeReport ? (
            <ScrollView contentContainerStyle={styles.successScreenContent} showsVerticalScrollIndicator={false}>
              <View style={[styles.successCard, { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement, borderColor: UiColors[effectiveTheme].panelBorder }]}>
                {/* Success Icon Badge */}
                <View style={[styles.successIconCircle, { backgroundColor: isDark ? (activeReport.status === 'For Verification' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(16, 185, 129, 0.2)') : (activeReport.status === 'For Verification' ? '#f3e8ff' : '#d1fae5') }]}>
                  <AppIcon
                    name={activeReport.status === 'For Verification' ? 'shield' : 'check'}
                    size={24}
                    color={isDark ? (activeReport.status === 'For Verification' ? colors.warning : '#34d399') : (activeReport.status === 'For Verification' ? colors.warning : '#059669')}
                  />
                </View>

                <ThemedText style={[styles.successTitle, { color: colors.text }]}>
                  {activeReport.status === 'For Verification'
                    ? 'Submitted for Admin Verification'
                    : 'Maintenance Update Submitted'}
                </ThemedText>
                <ThemedText style={[styles.successMessage, { color: colors.textSecondary }]}>
                  {activeReport.status === 'For Verification'
                    ? 'All tasks complete. Report submitted for administrator approval.'
                    : 'Report updated and synced with the desktop dashboard.'}
                </ThemedText>

                <View style={[styles.successDivider, { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundSelected : UiColors[effectiveTheme].backgroundSelected }]} />

                {/* Submitted Details Box */}
                <View style={[styles.successDetailsBox, { backgroundColor: isDark ? '#0f172a' : UiColors[effectiveTheme].background }]}>
                  <View style={styles.successDetailRow}>
                    <ThemedText style={[styles.successDetailKey, { color: colors.textSecondary }]}>Report ID:</ThemedText>
                    <ThemedText style={[styles.successDetailValBold, { color: colors.text }]}>{activeReport.id}</ThemedText>
                  </View>
                  <View style={styles.successDetailRow}>
                    <ThemedText style={[styles.successDetailKey, { color: colors.textSecondary }]}>Aircon Unit:</ThemedText>
                    <ThemedText style={[styles.successDetailVal, { color: colors.text }]}>
                      {activeReport.controllerName || 'AC Device name unavailable'} · {activeReport.airconName || 'Aircon name unavailable'} — {activeReport.location}
                    </ThemedText>
                  </View>
                  <View style={styles.successDetailRow}>
                    <ThemedText style={[styles.successDetailKey, { color: colors.textSecondary }]}>Last Updated:</ThemedText>
                    <ThemedText style={[styles.successDetailVal, { color: colors.text }]}>{activeReport.lastUpdated || 'Just now'}</ThemedText>
                  </View>
                  <View style={styles.successDetailRow}>
                    <ThemedText style={[styles.successDetailKey, { color: colors.textSecondary }]}>Overall Status:</ThemedText>
                    <View
                      style={[
                        styles.statusBadge,
                        {
                          backgroundColor: getStatusColor(activeReport.status).bg,
                          borderColor: getStatusColor(activeReport.status).border,
                        },
                      ]}
                    >
                      <ThemedText
                        style={[styles.statusBadgeText, { color: getStatusColor(activeReport.status).text }]}
                      >
                        {activeReport.status}
                      </ThemedText>
                    </View>
                  </View>
                  <View style={styles.successDetailRow}>
                    <ThemedText style={[styles.successDetailKey, { color: colors.textSecondary }]}>Completion:</ThemedText>
                    <ThemedText style={[styles.successDetailValBold, { color: colors.emerald }]}>
                      {completedItems} of {totalItems} items ({progressPercentage}%)
                    </ThemedText>
                  </View>
                </View>

                {/* Sync confirmation */}
                <View style={[styles.syncConfirmedBadge, { backgroundColor: isDark ? (activeReport.status === 'For Verification' ? 'rgba(168, 85, 247, 0.15)' : 'rgba(16, 185, 129, 0.15)') : (activeReport.status === 'For Verification' ? '#f3e8ff' : '#ecfdf5'), borderColor: isDark ? (activeReport.status === 'For Verification' ? 'rgba(168, 85, 247, 0.35)' : 'rgba(16, 185, 129, 0.35)') : (activeReport.status === 'For Verification' ? '#d8b4fe' : '#a7f3d0') }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                    <AppIcon
                      name={activeReport.status === 'For Verification' ? 'shield' : 'check'}
                      size={14}
                      color={isDark ? colors.warning : (activeReport.status === 'For Verification' ? colors.warning : '#047857')}
                    />
                    <ThemedText style={[styles.syncConfirmedText, { color: isDark ? UiColors[effectiveTheme].info : (activeReport.status === 'For Verification' ? colors.warning : '#047857') }]}>
                      {activeReport.status === 'For Verification'
                        ? 'Sent to Desktop Admin for Verification'
                        : 'Live sync sent to Desktop Admin'}
                    </ThemedText>
                  </View>
                </View>

                {/* Back to Checklist or Maintenance Dashboard Button */}
                <View style={{ gap: 10, width: '100%' }}>
                  {Boolean(activeReport.parentReportId) && (
                    <Pressable
                      onPress={() => {
                        setSelectedReportId(activeReport.parentReportId!);
                        setActiveRepairId(null);
                        setCurrentScreen('DETAILS');
                      }}
                      style={[styles.successBackButton, { backgroundColor: isDark ? UiColors[effectiveTheme].primaryFill : UiColors[effectiveTheme].primaryFill }]}
                    >
                      <ThemedText style={styles.successBackButtonText}>Return to Checklist ({activeReport.parentReportId})</ThemedText>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => {
                      setActiveRepairId(null);
                      setCurrentScreen('DASHBOARD');
                    }}
                    style={[
                      styles.successBackButton,
                      activeReport.parentReportId
                        ? { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundSelected : UiColors[effectiveTheme].backgroundSelected, borderWidth: 1, borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }
                        : { backgroundColor: isDark ? UiColors[effectiveTheme].primaryFill : UiColors[effectiveTheme].primaryFill }
                    ]}
                  >
                    <ThemedText style={[styles.successBackButtonText, activeReport.parentReportId && { color: colors.text }]}>
                      Back to Maintenance Dashboard
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
            </ScrollView>
          ) : (
            <View style={{ flex: 1, padding: 32, alignItems: 'center', justifyContent: 'center' }}>
              <View
                style={[
                  styles.emptyState,
                  {
                    backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement,
                    borderColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                    width: '100%',
                    maxWidth: 340,
                  },
                ]}
              >
                <ThemedText style={[styles.emptyStateText, { color: colors.textSecondary, marginBottom: 16 }]}>
                  No maintenance report available.
                </ThemedText>
                <Pressable
                  onPress={() => setCurrentScreen('DASHBOARD')}
                  style={[
                    styles.viewButton,
                    {
                      backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].primaryFill : UiColors[effectiveTheme].accentSurface,
                      borderColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                      width: '100%',
                      justifyContent: 'center',
                    },
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.viewButtonText,
                      { color: effectiveTheme === 'dark' ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].text },
                    ]}
                  >
                    Back to Maintenance
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          )
        )}

        {/* ========================================================================= */}
        {/* SCREEN 4 & SCREEN 7: EXPANDED ITEM EDIT MODAL / DRAWER                      */}
        {/* ========================================================================= */}
        <Modal visible={itemModalVisible} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.expandedModalContent, { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement, borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}>
              <View style={[styles.modalHeader, { borderBottomColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}>
                <View style={{ flex: 1 }}>
                  <ThemedText style={[styles.modalCategoryLabel, { color: isDark ? UiColors[effectiveTheme].textSecondary : UiColors[effectiveTheme].textSecondary }]}>MAINTENANCE CHECKLIST ITEM</ThemedText>
                  <ThemedText style={[styles.modalItemTitle, { color: colors.text }]}>{expandedItem?.title}</ThemedText>
                </View>
                <Pressable onPress={() => setItemModalVisible(false)} style={[styles.modalCloseBtn, { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundSelected : UiColors[effectiveTheme].backgroundSelected }]}>
                  <ThemedText style={[styles.modalCloseText, { color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary }]}>✕</ThemedText>
                </Pressable>
              </View>

              <ScrollView style={{ maxHeight: SCREEN_HEIGHT * 0.65 }} showsVerticalScrollIndicator={false}>
                {/* Active Dispatched Repair Order Notice inside Modal */}
                {expandedItem && expandedItem.linkedRepairId ? (
                  <View style={[styles.modalRepairBanner, { backgroundColor: isDark ? UiColors[effectiveTheme].infoSurface : UiColors[effectiveTheme].infoSurface, borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                      <AppIcon name="gear" size={13} color={isDark ? '#38bdf8' : '#0284c7'} />
                      <ThemedText style={{ fontSize: 12, fontWeight: '700', color: isDark ? UiColors[effectiveTheme].info : UiColors[effectiveTheme].info }}>
                        Dispatched Repair: #{expandedItem.linkedRepairId}
                      </ThemedText>
                    </View>
                    <Pressable
                      onPress={() => {
                        const rId = expandedItem.linkedRepairId!;
                        setItemModalVisible(false);
                        handleOpenRepairPage(rId);
                      }}
                      style={[styles.modalRepairBtn, { backgroundColor: isDark ? '#0284c7' : '#0284c7' }]}
                    >
                      <ThemedText style={{ fontSize: 11, fontWeight: '800', color: UiColors[effectiveTheme].onPrimary }}>Open Repair Page →</ThemedText>
                    </Pressable>
                  </View>
                ) : null}

                {/* Status Selector Chips */}
                <View style={styles.modalFieldBlock}>
                  <ThemedText style={[styles.modalFieldLabel, { color: colors.text }]}>Status:</ThemedText>
                  <View style={styles.statusSelectGrid}>
                    {(expandedItem?.status === 'For Verification' ? (['For Verification'] as ChecklistStatus[]) : isCurrentRepair ? REPAIR_CHECKLIST_STATUSES : STANDARD_CHECKLIST_STATUSES).map((st) => {
                      const isSelected = itemStatus === st || (st === 'Needs Repair' && (itemStatus === 'Under Repair' || Boolean(expandedItem?.linkedRepairId)));
                      const stStyle = getStatusColor(st);
                      return (
                        <Pressable
                          key={st}
                          onPress={() => setItemStatus(st)}
                          disabled={expandedItem?.status === 'For Verification'}
                          style={[
                            styles.statusSelectOption,
                            {
                              backgroundColor: isSelected ? stStyle.bg : isDark ? '#0f172a' : UiColors[effectiveTheme].background,
                              borderColor: isSelected ? stStyle.text : isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                            },
                          ]}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            {st === 'Needs Repair' && (
                              <AppIcon name="alert-octagon" size={12} color={isSelected ? stStyle.text : (isDark ? '#f87171' : '#dc2626')} />
                            )}
                            <ThemedText
                              style={[
                                styles.statusSelectOptionText,
                                { color: isSelected ? stStyle.text : isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary },
                                isSelected && { fontWeight: '800' },
                              ]}
                            >
                              {st}
                            </ThemedText>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                {/* SCREEN 7: Needs Repair Specific Problem Description Field */}
                {(itemStatus === 'Needs Repair' || itemStatus === 'Under Repair' || Boolean(expandedItem?.linkedRepairId)) && (
                  <View style={[styles.needsRepairAlertBlock, { backgroundColor: isDark ? UiColors[effectiveTheme].errorSurface : UiColors[effectiveTheme].errorSurface, borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}>
                    <ThemedText style={[styles.needsRepairLabel, { color: isDark ? UiColors[effectiveTheme].error : UiColors[effectiveTheme].error }]}>Describe the Problem (Required):</ThemedText>
                    <ThemedText style={[styles.needsRepairSubLabel, { color: isDark ? UiColors[effectiveTheme].error : '#7f1d1d' }]}>
                      Describe defect, unstable readings, or component replacement details for desktop admin.
                    </ThemedText>
                    <TextInput
                      style={[styles.needsRepairInput, { backgroundColor: isDark ? '#0f172a' : UiColors[effectiveTheme].backgroundElement, color: isDark ? UiColors[effectiveTheme].error : UiColors[effectiveTheme].error, borderColor: isDark ? UiColors[effectiveTheme].inputBorder : UiColors[effectiveTheme].inputBorder }]}
                      placeholder="e.g. AC device relay is giving inconsistent switching and may require replacement."
                      placeholderTextColor={isDark ? '#ef4444' : '#f87171'}
                      multiline
                      numberOfLines={3}
                      value={itemProblemDesc}
                      onChangeText={setItemProblemDesc}
                    />
                  </View>
                )}

                {/* Worker Remarks Field */}
                <View style={styles.modalFieldBlock}>
                  <ThemedText style={[styles.modalFieldLabel, { color: colors.text }]}>Worker Remarks (Optional):</ThemedText>
                  <TextInput
                    style={[styles.remarksInput, { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].background, borderColor: isDark ? UiColors[effectiveTheme].inputBorder : UiColors[effectiveTheme].inputBorder, color: colors.text }]}
                    placeholder="e.g. AC device inspected and operational telemetry is within normal range."
                    placeholderTextColor={colors.textSecondary}
                    multiline
                    numberOfLines={3}
                    value={itemRemarks}
                    onChangeText={setItemRemarks}
                  />
                </View>

                {/* Photo Proof Attachment Field (Multiple Insertion) */}
                <View style={styles.modalFieldBlock}>
                  <View style={styles.photoFieldHeaderRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <ThemedText style={[styles.modalFieldLabel, { color: colors.text, marginBottom: 0 }]}>
                        Photo Proof:
                      </ThemedText>
                      {itemPhotoUris.length > 0 && (
                        <View style={[styles.photoCountPill, { backgroundColor: isDark ? UiColors[effectiveTheme].accentSurface : UiColors[effectiveTheme].accentSurface, borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}>
                          <ThemedText style={[styles.photoCountPillText, { color: isDark ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].emerald }]}>
                            {itemPhotoUris.length} {itemPhotoUris.length === 1 ? 'image' : 'images'}
                          </ThemedText>
                        </View>
                      )}
                    </View>
                    {itemPhotoUris.length > 0 && (
                      <Pressable onPress={handleClearAllPhotos} hitSlop={8}>
                        <ThemedText style={[styles.photoClearAllText, { color: isDark ? UiColors[effectiveTheme].error : UiColors[effectiveTheme].error }]}>
                          Clear All
                        </ThemedText>
                      </Pressable>
                    )}
                  </View>

                  {itemPhotoUris.length > 0 ? (
                    <View style={styles.photoListContainer}>
                      {/* Horizontal Scroll of Attached Images */}
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoScrollContent}>
                        {itemPhotoUris.map((uri, idx) => (
                          <View key={`photo_${idx}_${uri.slice(-10)}`} style={[styles.photoThumbnailCard, { borderColor: UiColors[effectiveTheme].panelBorder, backgroundColor: isDark ? '#0f172a' : UiColors[effectiveTheme].background }]}>
                            <MaintenancePhoto uri={uri} style={styles.photoThumbnailImage} />
                            {/* Photo Index Badge */}
                            <View style={styles.photoIndexBadge}>
                              <ThemedText style={styles.photoIndexBadgeText}>#{idx + 1}</ThemedText>
                            </View>
                            {/* Remove Single Photo Button */}
                            <Pressable onPress={() => handleRemovePhoto(idx)} style={styles.photoThumbnailDeleteBtn} hitSlop={6}>
                              <ThemedText style={styles.photoThumbnailDeleteText}>✕</ThemedText>
                            </Pressable>
                          </View>
                        ))}

                        {/* Add More Tile */}
                        <Pressable
                          onPress={handlePickPhotos}
                          style={[
                            styles.photoAddMoreTile,
                            {
                              borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                              backgroundColor: isDark ? UiColors[effectiveTheme].accentSurface : UiColors[effectiveTheme].accentSurface,
                            },
                          ]}
                        >
                          <View style={[styles.photoAddMoreIconCircle, { backgroundColor: isDark ? UiColors[effectiveTheme].accentSurface : '#dcfce7' }]}>
                            <ThemedText style={[styles.photoAddMorePlusText, { color: UiColors[effectiveTheme].emerald }]}>+</ThemedText>
                          </View>
                          <ThemedText style={[styles.photoAddMoreTileText, { color: isDark ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].emerald }]}>
                            Add More
                          </ThemedText>
                        </Pressable>
                      </ScrollView>

                      {/* Action Buttons Below Gallery */}
                      <View style={styles.photoActionBar}>
                        <Pressable
                          onPress={handlePickPhotos}
                          style={[styles.photoActionSecondaryBtn, { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundSelected : UiColors[effectiveTheme].backgroundSelected, borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}
                        >
                          <AppIcon name="camera" size={14} color={colors.text} />
                          <ThemedText style={[styles.photoActionBtnText, { color: colors.text }]}>Choose More</ThemedText>
                        </Pressable>
                        <Pressable
                          onPress={handleTakePhoto}
                          style={[styles.photoActionSecondaryBtn, { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundSelected : UiColors[effectiveTheme].backgroundSelected, borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}
                        >
                          <AppIcon name="camera" size={13} color={colors.text} />
                          <ThemedText style={[styles.photoActionBtnText, { color: colors.text }]}>Take Photo</ThemedText>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    /* Zero State: Dual Selection Buttons */
                    <View style={styles.photoEmptyContainer}>
                      <View style={styles.photoEmptyButtonsRow}>
                        <Pressable
                          onPress={handlePickPhotos}
                          style={[styles.photoPickerBtnPrimary, { backgroundColor: isDark ? UiColors[effectiveTheme].accentSurface : UiColors[effectiveTheme].accentSurface, borderColor: UiColors[effectiveTheme].border }]}
                        >
                          <AppIcon name="camera" size={18} color={UiColors[effectiveTheme].emerald} style={styles.cameraIcon} />
                          <View style={{ alignItems: 'flex-start' }}>
                            <ThemedText style={[styles.photoPickerBtnText, { color: UiColors[effectiveTheme].emerald }]}>Select Photos</ThemedText>
                            <ThemedText style={[styles.photoPickerSubText, { color: isDark ? UiColors[effectiveTheme].textSecondary : UiColors[effectiveTheme].text }]}>Multiple allowed</ThemedText>
                          </View>
                        </Pressable>
                        <Pressable
                          onPress={handleTakePhoto}
                          style={[styles.photoPickerBtnCamera, { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundSelected : UiColors[effectiveTheme].background, borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}
                        >
                          <AppIcon name="camera" size={18} color={isDark ? '#cbd5e1' : '#475569'} />
                          <ThemedText style={[styles.photoCameraBtnText, { color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary }]}>Camera</ThemedText>
                        </Pressable>
                      </View>
                      <ThemedText style={[styles.photoHelpNotice, { color: colors.textSecondary }]}>
                        Choose multiple photos or take a photo.
                      </ThemedText>
                    </View>
                  )}
                </View>
              </ScrollView>

              {/* Modal Save Button */}
              <View style={styles.modalActionsRow}>
                <Pressable onPress={() => {
                  setItemModalVisible(false);
                  setExpandedItem(null);
                  setItemPhotoUris([]);
                  setItemRemarks('');
                  setItemProblemDesc('');
                }} style={[styles.modalCancelBtn, { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundSelected : UiColors[effectiveTheme].backgroundSelected }]}>
                  <ThemedText style={[styles.modalCancelBtnText, { color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary }]}>Cancel</ThemedText>
                </Pressable>
                <Pressable onPress={handleSaveItemUpdate} style={[styles.modalSaveBtn, isSubmitting && { opacity: 0.65 }]} disabled={isSubmitting}>
                  {isSubmitting ? (
                    <ActivityIndicator color={UiColors[effectiveTheme].onPrimary} size="small" />
                  ) : (
                    <ThemedText style={styles.modalSaveBtnText}>Save Update</ThemedText>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* ========================================================================= */}
        {/* QUICK STATUS DROPDOWN PICKER MODAL (Theme Adaptive)                         */}
        {/* ========================================================================= */}
        <Modal visible={dropdownVisible} animationType="fade" transparent onRequestClose={() => setDropdownVisible(false)}>
          <SafeAreaView style={styles.dropdownOverlay}>
            <Pressable accessibilityLabel="Close status picker" onPress={() => setDropdownVisible(false)} style={StyleSheet.absoluteFill} />
            <View style={[styles.dropdownModalContent, { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement, borderWidth: isDark ? 1.5 : 0, borderColor: isDark ? UiColors[effectiveTheme].border : 'transparent' }]}>
              <ThemedText style={[styles.dropdownModalTitle, { color: colors.text }]}>Select Item Status</ThemedText>
              <ThemedText style={[styles.dropdownModalSubTitle, { color: colors.textSecondary }]}>{dropdownItem?.title}</ThemedText>

              <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 8 }}>
              {(isCurrentRepair ? REPAIR_CHECKLIST_STATUSES : STANDARD_CHECKLIST_STATUSES).map((st) => {
                const isSelected = dropdownItem?.status === st;
                const stStyle = getStatusColor(st);
                return (
                  <Pressable
                    key={st}
                    onPress={() => dropdownItem && handleQuickStatusChange(dropdownItem.id, st)}
                    style={[
                      styles.dropdownOptionRow,
                      { backgroundColor: stStyle.bg },
                      isSelected && { borderWidth: 1.5, borderColor: stStyle.text },
                    ]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {st === 'Needs Repair' && <AppIcon name="alert-octagon" size={12} color={stStyle.text} />}
                      <ThemedText style={[styles.dropdownOptionText, { color: stStyle.text }]}>
                        {st}
                      </ThemedText>
                    </View>
                    {isSelected && <ThemedText style={{ color: stStyle.text, fontWeight: '800' }}>✓</ThemedText>}
                  </Pressable>
                );
              })}
              </ScrollView>
            </View>
          </SafeAreaView>
        </Modal>

        {/* ========================================================================= */}
        {/* SCREEN 5: SUBMIT CONFIRMATION DIALOG (Theme Adaptive)                      */}
        {/* ========================================================================= */}
        <Modal visible={confirmModalVisible} animationType="fade" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.confirmModalContent, { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement, borderWidth: isDark ? 1.5 : 0, borderColor: isDark ? UiColors[effectiveTheme].border : 'transparent' }]}>
              <View style={[styles.confirmIconCircle, { backgroundColor: isDark ? (completedItems === totalItems ? 'rgba(168, 85, 247, 0.2)' : 'rgba(16, 185, 129, 0.2)') : (completedItems === totalItems ? '#f3e8ff' : '#d1fae5') }]}>
                <AppIcon
                  name={completedItems === totalItems ? 'shield' : 'checklist'}
                  size={26}
                  color={completedItems === totalItems ? (isDark ? colors.warning : colors.warning) : (isDark ? '#34d399' : '#059669')}
                />
              </View>

              <ThemedText style={[styles.confirmTitle, { color: colors.text }]}>
                {completedItems === totalItems ? 'Submit for Admin Verification?' : 'Submit Maintenance Update?'}
              </ThemedText>
              <ThemedText style={[styles.confirmDesc, { color: colors.textSecondary }]}>
                {completedItems === totalItems
                  ? 'All tasks are complete. Submit for administrator approval?'
                  : 'Send your checklist updates to the desktop dashboard?'}
              </ThemedText>

              {/* Breakdown Grid */}
              <View style={styles.confirmBreakdownGrid}>
                <View style={[styles.breakdownItem, { backgroundColor: isDark ? UiColors[effectiveTheme].accentSurface : UiColors[effectiveTheme].accentSurface }]}>
                  <ThemedText style={[styles.breakdownNum, { color: isDark ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].emerald }]}>{completedItems}</ThemedText>
                  <ThemedText style={[styles.breakdownLabel, { color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary }]}>Completed</ThemedText>
                </View>
                <View style={[styles.breakdownItem, { backgroundColor: isDark ? UiColors[effectiveTheme].warningSurface : UiColors[effectiveTheme].warningSurface }]}>
                  <ThemedText style={[styles.breakdownNum, { color: isDark ? UiColors[effectiveTheme].warning : UiColors[effectiveTheme].warning }]}>{inProgressItems}</ThemedText>
                  <ThemedText style={[styles.breakdownLabel, { color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary }]}>In Progress</ThemedText>
                </View>
                <View style={[styles.breakdownItem, { backgroundColor: isDark ? '#0f172a' : UiColors[effectiveTheme].backgroundSelected }]}>
                  <ThemedText style={[styles.breakdownNum, { color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary }]}>{notStartedItems}</ThemedText>
                  <ThemedText style={[styles.breakdownLabel, { color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary }]}>Not Started</ThemedText>
                </View>
                {!isCurrentRepair && (
                  <View style={[styles.breakdownItem, { backgroundColor: isDark ? UiColors[effectiveTheme].errorSurface : UiColors[effectiveTheme].errorSurface }]}>
                    <ThemedText style={[styles.breakdownNum, { color: isDark ? UiColors[effectiveTheme].error : UiColors[effectiveTheme].error }]}>{needsRepairItems}</ThemedText>
                    <ThemedText style={[styles.breakdownLabel, { color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary }]}>Needs Repair</ThemedText>
                  </View>
                )}
              </View>

              {/* Action Buttons */}
              <View style={styles.confirmActionsRow}>
                <Pressable
                  onPress={() => setConfirmModalVisible(false)}
                  style={[styles.confirmCancelBtn, { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundSelected : UiColors[effectiveTheme].backgroundSelected }]}
                  disabled={isSubmitting}
                >
                  <ThemedText style={[styles.confirmCancelBtnText, { color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary }]}>Cancel</ThemedText>
                </Pressable>
                <Pressable
                  onPress={handleConfirmSubmit}
                  style={[
                    styles.confirmSubmitBtn,
                    completedItems === totalItems && { backgroundColor: colors.warning },
                  ]}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <ActivityIndicator color={UiColors[effectiveTheme].onPrimary} size="small" />
                  ) : (
                    <ThemedText style={styles.confirmSubmitBtnText}>
                      {completedItems === totalItems ? 'Submit for Verification' : 'Submit Update'}
                    </ThemedText>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* ========================================================================= */}
        {/* SCREEN 4: REPAIR SUBMISSION CONFIRMATION MODAL                            */}
        {/* ========================================================================= */}
        <Modal
          visible={confirmRepairModalVisible}
          animationType="fade"
          transparent
          onRequestClose={() => !isSubmitting && setConfirmRepairModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View
              style={[
                styles.confirmModalContent,
                {
                  backgroundColor: isDark ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement,
                  borderWidth: isDark ? 1.5 : 1,
                  borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                },
              ]}
            >
              <View
                style={[
                  styles.confirmIconCircle,
                  { backgroundColor: isDark ? UiColors[effectiveTheme].errorSurface : UiColors[effectiveTheme].errorSurface },
                ]}
              >
                <AppIcon
                  name="shield"
                  size={26}
                  color={isDark ? '#fb7185' : '#e11d48'}
                />
              </View>

              <ThemedText style={[styles.confirmTitle, { color: colors.text, textAlign: 'center' }]}>
                Submit Repair for Sign-Off?
              </ThemedText>
              <ThemedText style={[styles.confirmDesc, { color: colors.textSecondary }]}>
                All repair tasks are complete. Submit for administrator approval?
              </ThemedText>

              {/* Repair Target Info Card */}
              {pendingRepairToSubmit && (
                <View
                  style={{
                    width: '100%',
                    backgroundColor: isDark ? '#0f172a' : UiColors[effectiveTheme].background,
                    borderRadius: 14,
                    padding: 12,
                    marginBottom: 14,
                    borderWidth: 1,
                    borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                    gap: 6,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <ThemedText style={{ fontSize: 12, color: colors.textSecondary, fontWeight: '600' }}>
                      Repair Order:
                    </ThemedText>
                    <ThemedText style={{ fontSize: 12, color: colors.text, fontWeight: '800' }}>
                      #{pendingRepairToSubmit.id}
                    </ThemedText>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <ThemedText style={{ fontSize: 12, color: colors.textSecondary, fontWeight: '600' }}>
                      Aircon Unit:
                    </ThemedText>
                    <ThemedText
                      style={{ fontSize: 12, color: colors.text, fontWeight: '700', maxWidth: '65%' }}
                      numberOfLines={1}
                    >
                      {pendingRepairToSubmit.airconName || pendingRepairToSubmit.controllerName || 'Name unavailable'}
                    </ThemedText>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <ThemedText style={{ fontSize: 12, color: colors.textSecondary, fontWeight: '600' }}>
                      Location:
                    </ThemedText>
                    <ThemedText
                      style={{ fontSize: 12, color: colors.textSecondary, fontWeight: '600', maxWidth: '65%' }}
                      numberOfLines={1}
                    >
                      {pendingRepairToSubmit.location}
                    </ThemedText>
                  </View>
                </View>
              )}

              {/* Tasks Breakdown Grid */}
              {pendingRepairToSubmit && (() => {
                const pItems = pendingRepairToSubmit.items || [];
                const repCount = pItems.filter(isChecklistItemComplete).length;
                const totCount = pItems.length;
                return (
                  <View style={styles.confirmBreakdownGrid}>
                    <View
                      style={[
                        styles.breakdownItem,
                        { backgroundColor: isDark ? UiColors[effectiveTheme].accentSurface : UiColors[effectiveTheme].accentSurface, flex: 1 },
                      ]}
                    >
                      <ThemedText style={[styles.breakdownNum, { color: isDark ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].emerald }]}>
                        {repCount} / {totCount}
                      </ThemedText>
                      <ThemedText style={[styles.breakdownLabel, { color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary }]}>
                        Repaired Tasks
                      </ThemedText>
                    </View>
                    <View
                      style={[
                        styles.breakdownItem,
                        { backgroundColor: isDark ? UiColors[effectiveTheme].errorSurface : UiColors[effectiveTheme].errorSurface, flex: 1 },
                      ]}
                    >
                      <ThemedText style={[styles.breakdownNum, { color: isDark ? UiColors[effectiveTheme].error : UiColors[effectiveTheme].error }]}>
                        Sign-Off
                      </ThemedText>
                      <ThemedText style={[styles.breakdownLabel, { color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary }]}>
                        Admin Inspection
                      </ThemedText>
                    </View>
                  </View>
                );
              })()}

              {/* Actions Row */}
              <View style={styles.confirmActionsRow}>
                <Pressable
                  onPress={() => setConfirmRepairModalVisible(false)}
                  style={[styles.confirmCancelBtn, { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundSelected : UiColors[effectiveTheme].backgroundSelected }]}
                  disabled={isSubmitting}
                >
                  <ThemedText style={[styles.confirmCancelBtnText, { color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary }]}>
                    Cancel
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => {
                    if (pendingRepairToSubmit) {
                      handleSubmitForVerification(pendingRepairToSubmit.id);
                    }
                  }}
                  style={[styles.confirmSubmitBtn, { backgroundColor: '#e11d48' }]}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <ActivityIndicator color={UiColors[effectiveTheme].onPrimary} size="small" />
                  ) : (
                    <ThemedText style={styles.confirmSubmitBtnText}>
                      Submit Repair
                    </ThemedText>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* ========================================================================= */}
        {/* POST-SUBMISSION CONFIRMATION SUCCESS MODAL                                */}
        {/* ========================================================================= */}
        <Modal
          visible={repairSuccessModalVisible}
          animationType="fade"
          transparent
          onRequestClose={() => setRepairSuccessModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View
              style={[
                styles.confirmModalContent,
                {
                  backgroundColor: isDark ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement,
                  borderWidth: isDark ? 1.5 : 1,
                  borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                },
              ]}
            >
              <View
                style={[
                  styles.confirmIconCircle,
                  { backgroundColor: isDark ? UiColors[effectiveTheme].infoSurface : UiColors[effectiveTheme].infoSurface },
                ]}
              >
                <AppIcon
                  name="shield"
                  size={28}
                  color={isDark ? colors.warning : colors.warning}
                />
              </View>

              <ThemedText style={[styles.confirmTitle, { color: colors.text, textAlign: 'center' }]}>
                {submittedRepairInfo?.isRepair
                  ? 'Repair Submitted for Verification'
                  : 'Submitted for Admin Verification'}
              </ThemedText>
              <ThemedText
                style={[styles.confirmDesc, { color: colors.textSecondary, textAlign: 'center', marginBottom: 16 }]}
              >
                {submittedRepairInfo?.isRepair
                  ? `Corrective repair order #${submittedRepairInfo?.id} was successfully submitted. The Facility Administrator has been notified for final inspection and sign-off.`
                  : 'Report submitted. The administrator has been notified.'}
              </ThemedText>

              {/* Submitted Details Box */}
              {submittedRepairInfo && (
                <View
                  style={{
                    width: '100%',
                    backgroundColor: isDark ? '#0f172a' : UiColors[effectiveTheme].background,
                    borderRadius: 14,
                    padding: 12,
                    marginBottom: 16,
                    borderWidth: 1,
                    borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                    gap: 8,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <ThemedText style={{ fontSize: 12, color: colors.textSecondary, fontWeight: '600' }}>
                      Report ID:
                    </ThemedText>
                    <ThemedText style={{ fontSize: 12, color: colors.text, fontWeight: '800' }}>
                      #{submittedRepairInfo.id}
                    </ThemedText>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <ThemedText style={{ fontSize: 12, color: colors.textSecondary, fontWeight: '600' }}>
                      Aircon Unit:
                    </ThemedText>
                    <ThemedText
                      style={{ fontSize: 12, color: colors.text, fontWeight: '700', maxWidth: '65%' }}
                      numberOfLines={1}
                    >
                      {submittedRepairInfo.aircon}
                    </ThemedText>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <ThemedText style={{ fontSize: 12, color: colors.textSecondary, fontWeight: '600' }}>
                      Location:
                    </ThemedText>
                    <ThemedText
                      style={{ fontSize: 12, color: colors.textSecondary, fontWeight: '600', maxWidth: '65%' }}
                      numberOfLines={1}
                    >
                      {submittedRepairInfo.location}
                    </ThemedText>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <ThemedText style={{ fontSize: 12, color: colors.textSecondary, fontWeight: '600' }}>
                      Status:
                    </ThemedText>
                    <View
                      style={[
                        styles.statusBadge,
                        {
                          backgroundColor: isDark ? UiColors[effectiveTheme].infoSurface : UiColors[effectiveTheme].infoSurface,
                          borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                        },
                      ]}
                    >
                      <ThemedText
                        style={[styles.statusBadgeText, { color: isDark ? UiColors[effectiveTheme].info : UiColors[effectiveTheme].info, fontSize: 11 }]}
                      >
                        For Verification
                      </ThemedText>
                    </View>
                  </View>
                </View>
              )}

              {/* Navigation Action Buttons */}
              <View style={styles.repairSuccessActions}>
                {Boolean(submittedRepairInfo?.parentId) && (
                  <Pressable
                    onPress={() => {
                      setRepairSuccessModalVisible(false);
                      setSelectedReportId(submittedRepairInfo!.parentId!);
                      setActiveRepairId(null);
                      setCurrentScreen('DETAILS');
                    }}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.repairSuccessActionBtn,
                      { backgroundColor: isDark ? UiColors[effectiveTheme].primaryFill : UiColors[effectiveTheme].primaryFill },
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    <ThemedText style={[styles.confirmSubmitBtnText, styles.repairSuccessActionText]}>
                      Return to Checklist
                    </ThemedText>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => {
                    setRepairSuccessModalVisible(false);
                    setActiveRepairId(null);
                    setCurrentScreen('DASHBOARD');
                  }}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.repairSuccessActionBtn,
                    {
                      backgroundColor: submittedRepairInfo?.parentId ? (isDark ? '#1e293b' : '#f1f5f9') : (isDark ? '#10b981' : '#059669'),
                    },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.confirmCancelBtnText,
                      styles.repairSuccessActionText,
                      submittedRepairInfo?.parentId
                        ? { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].textSecondary }
                        : { color: UiColors[effectiveTheme].onPrimary, fontWeight: '800' },
                    ]}
                  >
                    Back to Maintenance Dashboard
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* Global Floating Bottom Navbar with Maintenance Tab Active */}
        <FloatingBottomNavbar currentPage="maintenance" />
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
    paddingBottom: 110,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerLogo: {
    width: 36,
    height: 36,
    borderRadius: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    lineHeight: 18,
    fontFamily: 'Roboto',
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.text,
    fontWeight: '700',
    fontFamily: 'Roboto',
  },
  workerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundElement,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  workerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primaryFill,
  },
  workerBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.text,
    fontFamily: 'Roboto',
  },

  // Workflow Notice
  workflowNotice: {
    marginHorizontal: Spacing.four,
    marginTop: 4,
    backgroundColor: colors.backgroundElement,
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  workflowNoticeIcon: {
    fontSize: 20,
  },
  workflowNoticeText: {
    flex: 1,
    fontSize: 11.5,
    color: colors.textSecondary,
    lineHeight: 16,
    fontFamily: 'Roboto',
  },

  // Overview / Summary Cards
  summaryContainer: {
    marginTop: 16,
    paddingHorizontal: Spacing.four,
  },
  sectionHeaderTitle: {
    fontSize: 11.5,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: 0.8,
    marginBottom: 8,
    fontFamily: 'Roboto',
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  summaryScrollGrid: {
    flexDirection: 'row',
    gap: 10,
    paddingRight: 16,
  },
  summaryCard: {
    minWidth: 100,
    flex: 1,
    backgroundColor: colors.backgroundElement,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.panelBorder,
    position: 'relative',
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: {
        elevation: 1.5,
      },
    }),
  },
  summaryCardActive: {
    borderColor: colors.emerald,
    backgroundColor: colors.accentSurface,
  },
  summaryCardActivePurple: {
    borderColor: colors.panelBorder,
    backgroundColor: colors.infoSurface,
  },
  summaryCardActiveRed: {
    borderColor: colors.panelBorder,
    backgroundColor: colors.errorSurface,
  },
  summaryBadgeDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  summaryCount: {
    fontSize: 24,
    fontWeight: '900',
    color: colors.text,
    fontFamily: 'Roboto',
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    marginTop: 2,
    fontFamily: 'Roboto',
  },

  // Search Bar
  searchBarContainer: {
    marginHorizontal: Spacing.four,
    marginTop: 16,
    backgroundColor: colors.backgroundElement,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  searchIcon: {
    width: 18,
    height: 18,
    tintColor: colors.textMuted,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    fontFamily: 'Roboto',
    padding: 0,
  },
  searchClearBtn: {
    padding: 4,
  },
  searchClearText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '700',
  },

  // Filter Chips
  filterTabsRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.four,
    marginTop: 12,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: colors.backgroundElement,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.primaryFill,
    borderColor: colors.border,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    fontFamily: 'Roboto',
  },
  filterChipTextActive: {
    color: colors.onPrimary,
  },

  // Reports List
  reportsList: {
    paddingHorizontal: Spacing.four,
    marginTop: 18,
    gap: 14,
  },
  listHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reportCard: {
    backgroundColor: colors.backgroundElement,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.2,
    borderColor: colors.panelBorder,
    gap: 10,
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  reportIdPill: {
    backgroundColor: colors.backgroundSelected,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 7,
    alignSelf: 'flex-start',
    flexShrink: 1,
    maxWidth: '65%',
  },
  reportIdText: {
    fontSize: 12,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: 0.5,
    fontFamily: 'Roboto',
    includeFontPadding: false,
  },
  reportTypeBadge: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 7,
    flexShrink: 1,
  },
  reportTypeBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.text,
    fontFamily: 'Roboto',
    includeFontPadding: false,
  },
  statusBadgeWrapper: {
    position: 'relative',
    alignSelf: 'flex-start',
  },
  statusBadgeCount: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.8,
    zIndex: 10,
    elevation: 4,
  },
  statusBadgeCountText: {
    fontSize: 10,
    fontWeight: '900',
    color: colors.onPrimary,
    lineHeight: 12,
    textAlign: 'center',
    includeFontPadding: false,
    fontFamily: 'Roboto',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    flexShrink: 0,
    alignSelf: 'flex-start',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    flexShrink: 0,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'Roboto',
    includeFontPadding: false,
    letterSpacing: 0.2,
  },
  acInfoRow: {
    gap: 6,
    marginTop: 2,
  },
  acHeaderLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  acTitleGroup: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  acIconCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.infoSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acTitleText: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '900',
    color: colors.text,
    fontFamily: 'Roboto',
  },
  acMetaTagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  airconTypeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accentSurface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  airconTypeTagText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.text,
    fontFamily: 'Roboto',
  },
  locationBadgeRow: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  locationBadgeText: {
    flexShrink: 1,
    fontSize: 11.5,
    fontWeight: '700',
    color: colors.textSecondary,
    fontFamily: 'Roboto',
  },
  verificationRemarksCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.panelBorder,
    backgroundColor: '#f5f3ff',
    padding: 10,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    marginVertical: 2,
  },
  verificationRemarksHeader: {
    fontSize: 10.5,
    fontWeight: '800',
    color: colors.info,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontFamily: 'Roboto',
  },
  verificationRemarksContent: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4338ca',
    marginTop: 2,
    fontFamily: 'Roboto',
  },
  defectAlertCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.panelBorder,
    backgroundColor: colors.errorSurface,
    padding: 10,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    marginVertical: 2,
  },
  defectAlertHeader: {
    fontSize: 10.5,
    fontWeight: '800',
    color: colors.error,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontFamily: 'Roboto',
  },
  defectAlertContent: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.error,
    marginTop: 2,
    fontFamily: 'Roboto',
  },
  assignedTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: colors.backgroundSelected,
    borderWidth: 1,
    borderColor: colors.border,
  },
  assignedTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    fontFamily: 'Roboto',
  },
  detailsVerificationBanner: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#f5f3ff',
    padding: 12,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    marginTop: 12,
  },
  detailsVerificationTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontFamily: 'Roboto',
  },
  detailsVerificationText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#4338ca',
    marginTop: 3,
    lineHeight: 18,
    fontFamily: 'Roboto',
  },
  detailsDefectBanner: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.errorSurface,
    padding: 12,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    marginTop: 12,
  },
  detailsDefectTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.error,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontFamily: 'Roboto',
  },
  detailsDefectText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.error,
    marginTop: 3,
    lineHeight: 18,
    fontFamily: 'Roboto',
  },
  detailsDefectMeta: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.error,
    marginTop: 4,
    fontFamily: 'Roboto',
  },
  descriptionCardBox: {
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.panelBorder,
    padding: 10,
    gap: 4,
    marginVertical: 2,
  },
  descriptionBoxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  descriptionBoxLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.6,
    fontFamily: 'Roboto',
  },
  descriptionBoxText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 18,
    fontFamily: 'Roboto',
  },
  metaTagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  priorityTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  priorityTagText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  dueTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  calendarIcon: {
    width: 13,
    height: 13,
    tintColor: colors.textSecondary,
  },
  dueTagText: {
    fontSize: 11.5,
    color: colors.textSecondary,
    fontWeight: '600',
    fontFamily: 'Roboto',
  },
  cardProgressSection: {
    marginTop: 4,
    gap: 4,
  },
  cardProgressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardProgressText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: colors.textSecondary,
    fontFamily: 'Roboto',
  },
  cardProgressPct: {
    fontSize: 11.5,
    fontWeight: '800',
    color: colors.emerald,
    fontFamily: 'Roboto',
  },
  progressBarTrack: {
    height: 7,
    backgroundColor: colors.backgroundSelected,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  viewButton: {
    backgroundColor: colors.primaryFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 6,
    gap: 6,
  },
  viewButtonText: {
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  viewButtonIcon: {
    width: 14,
    height: 14,
    tintColor: colors.emerald,
  },
  emptyState: {
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    marginVertical: 12,
  },
  emptyIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
    textAlign: 'center',
    fontFamily: 'Roboto',
  },
  emptyStateText: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    fontFamily: 'Roboto',
  },
  emptyActionBtn: {
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  emptyActionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Roboto',
  },

  // Details Screen Top Bar
  detailsTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundElement,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  backButtonIcon: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.text,
    lineHeight: 18,
  },
  backButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.text,
    fontFamily: 'Roboto',
  },
  reportPillLarge: {
    backgroundColor: colors.backgroundSelected,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    flexShrink: 1,
    maxWidth: '52%',
  },
  reportPillLargeText: {
    fontSize: 12,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: 0.5,
    fontFamily: 'Roboto',
  },
  detailsHeaderBlock: {
    paddingHorizontal: Spacing.four,
    marginBottom: 10,
  },
  detailsMainTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: colors.text,
    fontFamily: 'Roboto',
  },
  detailsMainSubtitle: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '700',
    fontFamily: 'Roboto',
    marginTop: 2,
  },

  // SCREEN 2: Aircon Information Card
  airconInfoCard: {
    marginHorizontal: Spacing.four,
    backgroundColor: colors.backgroundElement,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 14,
  },
  cardSectionHeader: {
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 6,
  },
  cardSectionTitle: {
    fontSize: 11.5,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: 0.8,
    fontFamily: 'Roboto',
  },
  infoGrid: {
    gap: 8,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 6,
  },
  infoKey: {
    flexShrink: 0,
    maxWidth: '48%',
    fontSize: 12.5,
    color: colors.textSecondary,
    fontWeight: '600',
    fontFamily: 'Roboto',
  },
  infoValue: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: 12.5,
    color: colors.text,
    fontWeight: '700',
    fontFamily: 'Roboto',
  },
  scopeDescriptionText: {
    fontSize: 14,
    lineHeight: 22,
    fontFamily: 'Roboto',
  },
  infoValueBold: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: 13,
    color: colors.text,
    fontWeight: '900',
    fontFamily: 'Roboto',
  },
  priorityPillSmall: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  priorityPillSmallText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },

  // Maintenance Progress Card
  progressCard: {
    marginHorizontal: Spacing.four,
    backgroundColor: colors.backgroundElement,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 14,
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  progressCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressPercentageText: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.emerald,
    fontFamily: 'Roboto',
  },
  progressCountText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
    marginTop: 2,
    marginBottom: 8,
    fontFamily: 'Roboto',
  },
  largeProgressBarTrack: {
    height: 6,
    backgroundColor: colors.backgroundSelected,
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 12,
  },
  largeProgressBarFill: {
    height: '100%',
    borderRadius: 6,
  },
  statusChipsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  statusChipItem: {
    alignItems: 'center',
  },
  statusChipNum: {
    fontSize: 14,
    fontWeight: '900',
    fontFamily: 'Roboto',
  },
  statusChipLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    fontFamily: 'Roboto',
  },

  // SCREEN 3: Checklist Section
  checklistSection: {
    marginHorizontal: Spacing.four,
    marginBottom: 16,
  },
  checklistSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  checklistIcon: {
    width: 18,
    height: 18,
  },
  checklistSectionTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: 0.8,
    fontFamily: 'Roboto',
  },
  checklistHint: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 12,
    lineHeight: 15,
    fontFamily: 'Roboto',
  },
  checklistItemsList: {
    gap: 10,
  },
  checklistItemCard: {
    backgroundColor: colors.backgroundElement,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 10,
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 4,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  checklistItemCardDanger: {
    borderColor: colors.panelBorder,
    backgroundColor: '#fffdfd',
  },
  checklistItemMain: {
    flexDirection: 'row',
    gap: 12,
  },
  itemIndexCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.backgroundSelected,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  itemIndexNumber: {
    fontSize: 11,
    fontWeight: '900',
    color: colors.textSecondary,
  },
  itemTextContainer: {
    flex: 1,
    gap: 3,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    fontFamily: 'Roboto',
    lineHeight: 22,
  },
  itemTitleDanger: {
    color: colors.error,
  },
  itemDescription: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
    fontFamily: 'Roboto',
  },
  remarksSnippet: {
    backgroundColor: colors.background,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 4,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
  },
  remarksSnippetText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontFamily: 'Roboto',
  },
  defectSnippet: {
    backgroundColor: colors.errorSurface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 4,
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
  },
  defectSnippetText: {
    fontSize: 11,
    color: colors.error,
    fontWeight: '700',
    fontFamily: 'Roboto',
  },
  photoAttachedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.infoSurface,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 4,
  },
  photoAttachedText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0369a1',
  },
  dropdownBtnContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  statusDropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  statusDropdownBtnText: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  statusDropdownArrow: {
    fontSize: 9,
    fontWeight: '900',
  },
  checklistStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: 'flex-start',
    flexShrink: 1,
  },
  checklistStatusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'Roboto',
    letterSpacing: 0.2,
  },

  // Submit Section
  submitSection: {
    marginHorizontal: Spacing.four,
    marginTop: 8,
    marginBottom: 20,
    alignItems: 'center',
    gap: 8,
  },
  submitButton: {
    backgroundColor: colors.primaryFill,
    width: '100%',
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.35,
        shadowRadius: 10,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  submitButtonText: {
    color: colors.onPrimary,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.5,
    fontFamily: 'Roboto',
  },
  submitDisclaimer: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    fontFamily: 'Roboto',
    marginTop: 2,
  },
  submitRepairBtn: {
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.22,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  submitRepairGradient: {
    width: '100%',
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  submitBtnTextPrimary: {
    color: colors.onPrimary,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.4,
    fontFamily: 'Roboto',
  },
  verifiedRepairBox: {
    width: '100%',
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifiedIconBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifiedRepairBoxTitle: {
    fontSize: 15,
    fontWeight: '900',
    fontFamily: 'Roboto',
    textAlign: 'center',
  },
  verifiedRepairBoxSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Roboto',
    textAlign: 'center',
    lineHeight: 17,
  },

  // SCREEN 6: Success Screen
  successScreenContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: 30,
    paddingBottom: 110,
  },
  successCard: {
    backgroundColor: colors.backgroundElement,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.panelBorder,
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  successIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.accentSurface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: colors.border,
  },
  successIconText: {
    fontSize: 32,
    fontWeight: '900',
    color: colors.emerald,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 6,
    fontFamily: 'Roboto',
  },
  successMessage: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
    fontFamily: 'Roboto',
  },
  successDivider: {
    height: 1,
    backgroundColor: colors.backgroundSelected,
    width: '100%',
    marginBottom: 16,
  },
  successDetailsBox: {
    width: '100%',
    backgroundColor: colors.background,
    borderRadius: 14,
    padding: 14,
    gap: 8,
    marginBottom: 14,
  },
  successDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  successDetailKey: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
    fontFamily: 'Roboto',
  },
  successDetailVal: {
    fontSize: 12,
    color: colors.text,
    fontWeight: '700',
    fontFamily: 'Roboto',
  },
  successDetailValBold: {
    fontSize: 12.5,
    color: colors.text,
    fontWeight: '900',
    fontFamily: 'Roboto',
  },
  syncConfirmedBadge: {
    backgroundColor: colors.accentSurface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  syncConfirmedText: {
    fontSize: 11.5,
    color: colors.text,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  successBackButton: {
    backgroundColor: colors.primaryFill,
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successBackButtonText: {
    color: colors.onPrimary,
    fontSize: 14,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },

  // Modal Common Overlay
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },

  // SCREEN 4 & SCREEN 7: Expanded Modal
  expandedModalContent: {
    width: '100%',
    maxWidth: 500,
    backgroundColor: colors.backgroundElement,
    borderRadius: 24,
    padding: 20,
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 10,
    marginBottom: 12,
  },
  modalCategoryLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.8,
    fontFamily: 'Roboto',
  },
  modalItemTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.text,
    fontFamily: 'Roboto',
  },
  modalCloseBtn: {
    padding: 6,
    backgroundColor: colors.backgroundSelected,
    borderRadius: 12,
  },
  modalCloseText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '900',
  },
  modalFieldBlock: {
    marginBottom: 14,
  },
  modalFieldLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
    marginBottom: 6,
    fontFamily: 'Roboto',
  },
  modalFieldDesc: {
    fontSize: 12.5,
    color: colors.textSecondary,
    lineHeight: 17,
    fontFamily: 'Roboto',
  },
  statusSelectGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusSelectOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.background,
    borderWidth: 1.5,
  },
  statusSelectOptionText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    fontFamily: 'Roboto',
  },
  needsRepairAlertBlock: {
    backgroundColor: colors.errorSurface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  needsRepairLabel: {
    fontSize: 12,
    fontWeight: '900',
    color: colors.error,
    marginBottom: 2,
    fontFamily: 'Roboto',
  },
  needsRepairSubLabel: {
    fontSize: 11,
    color: '#7f1d1d',
    marginBottom: 6,
    fontFamily: 'Roboto',
  },
  needsRepairInput: {
    backgroundColor: colors.backgroundElement,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    padding: 10,
    fontSize: 12.5,
    color: colors.error,
    fontFamily: 'Roboto',
    textAlignVertical: 'top',
  },
  remarksInput: {
    backgroundColor: colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    padding: 10,
    fontSize: 12.5,
    color: colors.text,
    fontFamily: 'Roboto',
    textAlignVertical: 'top',
  },
  photoFieldHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  photoCountPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
  },
  photoCountPillText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  photoClearAllText: {
    fontSize: 11.5,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  photoListContainer: {
    gap: 10,
  },
  photoScrollContent: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 4,
  },
  photoThumbnailCard: {
    width: 105,
    height: 105,
    borderRadius: 12,
    borderWidth: 1.2,
    overflow: 'hidden',
    position: 'relative',
  },
  photoThumbnailImage: {
    width: '100%',
    height: '100%',
  },
  photoIndexBadge: {
    position: 'absolute',
    bottom: 5,
    left: 5,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  photoIndexBadgeText: {
    color: colors.onPrimary,
    fontSize: 10,
    fontWeight: '800',
  },
  photoThumbnailDeleteBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    zIndex: 10,
  },
  photoThumbnailDeleteText: {
    color: colors.onPrimary,
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 13,
  },
  photoAddMoreTile: {
    width: 105,
    height: 105,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  photoAddMoreIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAddMorePlusText: {
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 20,
  },
  photoAddMoreTileText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  photoActionBar: {
    flexDirection: 'row',
    gap: 8,
  },
  photoActionSecondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 9,
    borderWidth: 1,
  },
  photoActionBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    fontFamily: 'Roboto',
  },
  photoEmptyContainer: {
    gap: 8,
  },
  photoEmptyButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  photoPickerBtnPrimary: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  photoPickerBtnText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: colors.emerald,
    fontFamily: 'Roboto',
  },
  photoPickerSubText: {
    fontSize: 10.5,
    fontWeight: '600',
    fontFamily: 'Roboto',
  },
  photoPickerBtnCamera: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  photoCameraBtnText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Roboto',
  },
  photoHelpNotice: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: 2,
    fontFamily: 'Roboto',
  },
  cameraIcon: {
    width: 20,
    height: 20,
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.backgroundSelected,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  modalSaveBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.primaryFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSaveBtnText: {
    fontSize: 13,
    fontWeight: '900',
    color: colors.onPrimary,
    fontFamily: 'Roboto',
  },

  // Dropdown Picker Modal
  dropdownOverlay: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    padding: 20, backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  dropdownModalContent: {
    width: '100%', maxHeight: '90%',
    maxWidth: 360,
    backgroundColor: colors.backgroundElement,
    borderRadius: 20,
    padding: 20,
    gap: 8,
  },
  dropdownModalTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: colors.text,
    textAlign: 'center',
    fontFamily: 'Roboto',
  },
  dropdownModalSubTitle: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 6,
    fontFamily: 'Roboto',
  },
  dropdownOptionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  dropdownOptionText: {
    fontSize: 13,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },

  // SCREEN 5: Confirm Modal
  confirmModalContent: {
    width: SCREEN_WIDTH - 48,
    maxWidth: 400,
    backgroundColor: colors.backgroundElement,
    borderRadius: 24,
    padding: 22,
    alignItems: 'center',
  },
  confirmIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accentSurface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  confirmIconText: {
    fontSize: 26,
  },
  confirmTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: colors.text,
    marginBottom: 6,
    fontFamily: 'Roboto',
  },
  confirmDesc: {
    fontSize: 12.5,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 17,
    marginBottom: 14,
    fontFamily: 'Roboto',
  },
  confirmBreakdownGrid: {
    flexDirection: 'row',
    width: '100%',
    gap: 6,
    marginBottom: 18,
  },
  breakdownItem: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
  },
  breakdownNum: {
    fontSize: 16,
    fontWeight: '900',
    fontFamily: 'Roboto',
  },
  breakdownLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.textSecondary,
    marginTop: 2,
    textAlign: 'center',
    fontFamily: 'Roboto',
  },
  confirmActionsRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
  },
  repairSuccessActions: {
    width: '100%',
    gap: 10,
    flexShrink: 0,
  },
  repairSuccessActionBtn: {
    width: '100%',
    minHeight: 48,
    flexShrink: 0,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  repairSuccessActionText: {
    width: '100%',
    textAlign: 'center',
    lineHeight: 20,
  },
  confirmCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.backgroundSelected,
    alignItems: 'center',
  },
  confirmCancelBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  confirmSubmitBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.primaryFill,
    alignItems: 'center',
  },
  confirmSubmitBtnText: {
    fontSize: 13,
    fontWeight: '900',
    color: colors.onPrimary,
    fontFamily: 'Roboto',
  },
  detailsPendingVerificationBanner: {
    borderRadius: 14,
    borderWidth: 1.2,
    padding: 12,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    marginTop: 10,
  },
  detailsPendingVerificationTitle: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: 'Roboto',
  },
  detailsPendingVerificationText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 3,
    lineHeight: 17,
    fontFamily: 'Roboto',
  },

  // Corrective Maintenance Dispatch card banners (Dashboard)
  correctiveDispatchCardTop: {
    borderRadius: 14,
    borderWidth: 1.2,
    padding: 10,
    marginBottom: 10,
    gap: 4,
  },
  correctiveDispatchTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  correctiveDispatchHeader: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontFamily: 'Roboto',
  },
  parentReportBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  parentReportBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  correctiveDispatchSubText: {
    fontSize: 11.5,
    fontWeight: '600',
    lineHeight: 16,
    fontFamily: 'Roboto',
  },

  verificationNoticeCard: {
    borderRadius: 14,
    borderWidth: 1.2,
    padding: 10,
    marginBottom: 10,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  verificationNoticeHeader: {
    fontSize: 11.5,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: 'Roboto',
  },
  verificationNoticeContent: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 15,
    fontFamily: 'Roboto',
    marginTop: 2,
  },

  linkedDispatchedCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 8,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  linkedDispatchedText: {
    fontSize: 11,
    fontWeight: '700',
    flex: 1,
    fontFamily: 'Roboto',
  },

  // Image 1: Corrective Maintenance Dispatch Card in Details Screen
  correctiveDetailsCard: {
    marginHorizontal: Spacing.four,
    borderRadius: 22,
    borderWidth: 2,
    padding: 16,
    marginBottom: 14,
    gap: 12,
  },
  correctiveDetailsTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  correctiveDetailsTagText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontFamily: 'Roboto',
  },
  correctiveDetailsMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  correctiveDetailsTitle: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
    fontFamily: 'Roboto',
  },
  correctiveLinkedPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  correctiveLinkedPillText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  correctiveUnitBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  correctiveUnitBoxText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Roboto',
  },
  correctiveScopeBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  correctiveScopeLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: 'Roboto',
  },
  correctiveScopeText: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'Roboto',
  },
  correctiveStepsContainer: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  correctiveStepsHeader: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: 'Roboto',
    marginBottom: 2,
  },
  correctiveStepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  correctiveStepNumberCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  correctiveStepNumberText: {
    fontSize: 11,
    fontWeight: '900',
    fontFamily: 'Roboto',
  },
  correctiveStepItemText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Roboto',
  },

  criticalPriorityPillSmall: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  criticalPriorityPillSmallText: {
    fontSize: 9.5,
    fontWeight: '900',
    color: colors.onPrimary,
    fontFamily: 'Roboto',
  },
  fieldDisplayContainer: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    gap: 4,
  },
  fieldDisplayLabel: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: 'Roboto',
  },
  fieldDisplayValue: {
    fontSize: 12.5,
    fontWeight: '700',
    fontFamily: 'Roboto',
  },
  correctiveMetaGrid: {
    gap: 8,
  },
  correctivePriorityDateRow: {
    flexDirection: 'row',
    gap: 8,
  },
  correctiveMetaCol: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    gap: 4,
  },
  criticalPriorityPill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  criticalPriorityPillText: {
    fontSize: 11,
    fontWeight: '900',
    color: colors.onPrimary,
    fontFamily: 'Roboto',
  },

  // Linked parent / child action banner
  linkedParentActionCard: {
    marginHorizontal: Spacing.four,
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 12,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  linkedParentActionTextCol: {
    flex: 1,
  },
  linkedParentActionTitle: {
    fontSize: 11.5,
    fontWeight: '800',
    textTransform: 'uppercase',
    fontFamily: 'Roboto',
  },
  linkedParentActionSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
    fontFamily: 'Roboto',
  },
  linkedParentActionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  linkedParentActionBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.onPrimary,
    fontFamily: 'Roboto',
  },



  // Flexible Dispatch Card in Details Screen
  dispatchDetailsCard: {
    marginHorizontal: Spacing.four,
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 16,
    marginBottom: 14,
    gap: 12,
  },
  dispatchDetailsTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  dispatchDetailsTagText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontFamily: 'Roboto',
  },
  dispatchDetailsMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  dispatchDetailsTitle: {
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: -0.3,
    fontFamily: 'Roboto',
    flex: 1,
  },
  reportIdPillBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 16,
    borderWidth: 1,
  },
  reportIdPillBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  priorityBadgeSmall: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
  },
  priorityBadgeSmallText: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  linkedPillSmall: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 1,
  },
  linkedPillSmallText: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  dispatchUnitBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  dispatchScopeBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  dispatchScopeLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: 'Roboto',
  },
  dispatchScopeText: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'Roboto',
    fontStyle: 'italic',
  },
  dispatchMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  dispatchMetaCol: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    gap: 4,
  },
  dispatchTasksContainer: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    gap: 6,
  },
  dispatchTasksHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    flexWrap: 'wrap',
    gap: 4,
  },
  dispatchTasksHeader: {
    fontSize: 10.5,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: 'Roboto',
  },
  dispatchTaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  interactiveCheckBtn: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dispatchTaskName: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Roboto',
  },
  dispatchPhotoPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: colors.infoSurface,
  },
  dispatchEditBtn: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dispatchTaskStatusPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  dispatchTaskStatusText: {
    fontSize: 9.5,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  dispatchCardActionsRow: {
    marginTop: 6,
  },
  dispatchSubmitVerificationBtn: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dispatchSubmitVerificationBtnText: {
    fontSize: 12,
    fontWeight: '900',
    color: colors.onPrimary,
    fontFamily: 'Roboto',
  },

  // Connected Repair Count Badges on Dashboard Card
  cardBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    marginBottom: 4,
  },
  cardCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4.5,
    borderRadius: 8,
    borderWidth: 1,
  },
  cardCountBadgeText: {
    fontSize: 11,
    fontFamily: 'Roboto',
  },

  // Connected Cards on Details Screen
  connectedCardsContainer: {
    marginHorizontal: Spacing.four,
    marginBottom: 12,
    gap: 10,
  },
  connectedCard: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 14,
    gap: 8,
  },
  connectedCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  connectedCardTag: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontFamily: 'Roboto',
  },
  connectedCardPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  connectedCardPillText: {
    fontSize: 10,
    fontWeight: '900',
    color: colors.onPrimary,
    fontFamily: 'Roboto',
  },
  connectedCardInstructions: {
    fontSize: 12,
    fontFamily: 'Roboto',
    lineHeight: 17,
    fontStyle: 'italic',
  },
  connectedCardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 2,
  },
  connectedCardMetaText: {
    fontSize: 10.5,
    fontWeight: '700',
    fontFamily: 'Roboto',
  },
  connectedCardBtn: {
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  connectedCardBtnText: {
    fontSize: 12,
    fontWeight: '900',
    color: colors.onPrimary,
    fontFamily: 'Roboto',
  },

  // Dedicated Repair Page Styles
  pageInstructionCard: {
    marginHorizontal: Spacing.four,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
    gap: 8,
  },
  pageInstructionLabel: {
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontFamily: 'Roboto',
  },
  pageInstructionText: {
    fontSize: 12.5,
    fontFamily: 'Roboto',
    lineHeight: 18,
    fontStyle: 'italic',
  },
  pageMetaGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 6,
    flexWrap: 'wrap',
  },
  pageMetaItem: {
    gap: 2,
  },
  pageMetaKey: {
    fontSize: 9.5,
    fontWeight: '700',
    fontFamily: 'Roboto',
  },
  pageMetaVal: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  inlineStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
    borderWidth: 1,
    gap: 4,
    alignSelf: 'flex-start',
    flexShrink: 1,
  },
  inlineStatusPillText: {
    fontSize: 10.5,
    fontWeight: '700',
    fontFamily: 'Roboto',
  },
  inlinePhotoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
  },
  inlinePhotoPillText: {
    fontSize: 10.5,
    fontWeight: '700',
    fontFamily: 'Roboto',
  },
  checklistPhotoAction: { flexDirection:'row', alignItems:'center', gap:8, minHeight:44 },
  workflowPhase: { alignSelf:'flex-start',marginHorizontal:16,marginBottom:12,paddingHorizontal:10,paddingVertical:6,borderRadius:6 },
  repairTaskLinkBtn: {
    flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,
    paddingHorizontal:12,paddingVertical:10,minHeight:44,borderRadius:8,borderWidth:1,borderColor:colors.border,

  },
  repairTaskLinkBtnText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  modalRepairBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
    gap: 8,
  },
  modalRepairBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
  },
});
const themedStyles = { light: createStyles(UiColors.light), dark: createStyles(UiColors.dark) };
