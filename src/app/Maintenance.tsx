import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useSettings } from '@/context/settings-context';
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
export type ChecklistStatus = 'Not Started' | 'In Progress' | 'Completed' | 'Needs Repair' | 'Under Repair';
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
  reworkInstructions?: string | null;
  isRepaired?: boolean;
  isVerified?: boolean;
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
  const { userName } = useAuth();
  const { effectiveTheme, colors } = useSettings();
  const params = useLocalSearchParams<{ reportId?: string; screen?: string; repairId?: string }>();

  // Reports state
  const [reports, setReports] = useState<MaintenanceReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'All' | 'Pending' | 'In Progress' | 'For Verification' | 'Needs Repair' | 'Completed'>('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Selected Report & Navigation state
  // currentScreen: 'DASHBOARD' | 'DETAILS' | 'SUCCESS' | 'REWORK' | 'REPAIR'
  const [currentScreen, setCurrentScreen] = useState<'DASHBOARD' | 'DETAILS' | 'SUCCESS' | 'REWORK' | 'REPAIR'>('DASHBOARD');
  const [selectedReportId, setSelectedReportId] = useState<string>('');
  const [editingReportId, setEditingReportId] = useState<string>('');
  const [activeRepairId, setActiveRepairId] = useState<string | null>(null);

  const loadReports = async () => {
    try {
      const live = await fetchLiveMaintenanceReports(userName);
      setReports(live || []);
      if (live && live.length > 0) {
        if (params?.reportId) {
          const matched = live.find((r) => r.id === params.reportId);
          setSelectedReportId(matched ? matched.id : live[0].id);
        } else {
          setSelectedReportId((prev) => (prev && live.some((r) => r.id === prev) ? prev : live[0].id));
        }
      }
    } catch (e) {
      console.error('Error fetching live maintenance reports:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadReports();
  };

  useEffect(() => {
    loadReports();
    const unsubscribe = subscribeToMaintenanceReports(() => {
      loadReports();
    });
    return () => {
      unsubscribe();
    };
  }, [userName]);

  useEffect(() => {
    if (params?.repairId && reports.length > 0) {
      const matchedRepair = reports.find((r) => r.id.toLowerCase() === params.repairId!.toLowerCase());
      const parentReport = matchedRepair?.parentReportId
        ? reports.find((r) => r.id.toLowerCase() === matchedRepair.parentReportId!.toLowerCase())
        : reports.find((r) => r.items?.some((it) => it.linkedRepairId?.toLowerCase() === params.repairId!.toLowerCase()));

      if (parentReport) {
        setSelectedReportId(parentReport.id);
        setActiveRepairId(params.repairId);
        setCurrentScreen('REPAIR');
      } else if (matchedRepair) {
        setSelectedReportId(matchedRepair.id);
        setActiveRepairId(params.repairId);
        setCurrentScreen('REPAIR');
      }
    } else if (params?.reportId && reports.length > 0) {
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
  }, [params?.reportId, params?.repairId, params?.screen, reports]);

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
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Animated values
  const progressAnim = useRef(new Animated.Value(0.5)).current;

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
  const needsRepairCount = topLevelReports.filter((r) => r.status === 'Needs Repair' || r.status === 'Under Repair').length;

  // Calculate active report progress
  const activeReportItems = activeReport?.items || [];
  const totalItems = activeReportItems.length;
  const completedItems = activeReportItems.filter((i) => i.status === 'Completed').length;
  const inProgressItems = activeReportItems.filter((i) => i.status === 'In Progress').length;
  const notStartedItems = activeReportItems.filter((i) => i.status === 'Not Started').length;
  const needsRepairItems = isCurrentRepair
    ? 0
    : activeReportItems.filter((i) => !i.isRepaired && !i.repaired && (i.status === 'Needs Repair' || i.status === 'Under Repair' || Boolean(i.linkedRepairId))).length;
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
    const targetRep = reports.find((r) => r.id === selectedReportId);
    if (!targetRep) return;
    const selectedItem = targetRep.items.find((item) => item.id === itemId);
    if (!selectedItem) return;
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
    const allDone = updatedItems.every((it) => it.status === 'Completed');
    const anyActive = updatedItems.some(
      (it) => it.status === 'In Progress' || it.status === 'Completed' || (!isTargetRepair && it.status === 'Needs Repair')
    );
    const overallStatus: ReportStatus = anyRepair
      ? 'Needs Repair'
      : allDone
        ? 'For Verification'
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

    // Persist status change directly to Supabase
    updateLiveMaintenanceReport(selectedReportId, {
      status: overallStatus,
      items: updatedItems,
      workerName: userName,
      location: targetRep.location,
      airconId: targetRep.airconId,
      existingTimeline: targetRep.timeline,
    }).then((result) => {
      if (!result.success) {
        alert(result.error || 'The status update could not be saved.');
        loadReports();
      }
    }).catch((err) => {
      console.warn('Background Supabase status update error:', err);
      loadReports();
    });
  };

  // Flexible interactive checkbox toggle for tasks and subtasks
  const handleToggleTaskCheck = (taskId: string, targetRepId?: string) => {
    const reportId = targetRepId || selectedReportId;
    const targetRep = reports.find((r) => r.id === reportId);
    if (!targetRep) return;

    const currentItem = targetRep.items.find((it) => it.id === taskId);
    if (!currentItem) return;

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
    const allDone = updatedItems.length > 0 && updatedItems.every((it) => it.status === 'Completed' || it.repaired || it.isRepaired);
    const anyActive = updatedItems.some(
      (it) => it.status === 'In Progress' || it.status === 'Completed' || (!isTargetRepair && it.status === 'Needs Repair')
    );
    const overallStatus: ReportStatus = anyRepair
      ? 'Needs Repair'
      : allDone
        ? 'For Verification'
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

    updateLiveMaintenanceReport(reportId, {
      status: overallStatus,
      items: updatedItems,
      workerName: userName,
      location: targetRep.location,
      airconId: targetRep.airconId,
      existingTimeline: targetRep.timeline,
    }).then((result) => {
      if (!result.success) {
        alert(result.error || 'The checklist update could not be saved.');
        loadReports();
      }
    }).catch((err) => {
      console.warn('Background Supabase toggle task error:', err);
      loadReports();
    });
  };

  // Open Item Detail & Edit Modal (Screen 4 / Screen 7)
  const handleOpenItemEditor = (item: MaintenanceItem, reportId?: string) => {
    setExpandedItem(item);
    setEditingReportId(reportId || selectedReportId);
    // If item is Under Repair, has linkedRepairId, or was flagged Needs Repair,
    // ensure the modal shows 'Needs Repair' selected, NEVER defaulting to 'Not Started'!
    if (item.status === 'Under Repair' || item.status === 'Needs Repair' || Boolean(item.linkedRepairId)) {
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
    const targetRep = reports.find((r) => r.id === targetReportId);
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
            console.warn('Photo upload failed:', e);
            return uri;
          }
        }
        return uri;
      })
    );

    const primaryPhoto = uploadedPhotos[0] || null;

    const itemUpdatedAt = new Date().toISOString();
    const updatedItems = targetRep.items.map((it) => {
      if (it.id !== expandedItem.id) return it;
      const resolvedStatus = (itemStatus === 'Needs Repair' && (it.linkedRepairId || expandedItem.linkedRepairId || it.status === 'Under Repair'))
        ? 'Under Repair'
        : itemStatus;
      return {
        ...it,
        status: resolvedStatus,
        remarks: itemRemarks.trim(),
        problemDescription: (itemStatus === 'Needs Repair' || resolvedStatus === 'Under Repair') ? itemProblemDesc.trim() : undefined,
        photoUri: primaryPhoto,
        photoUris: uploadedPhotos,
        updatedAt: itemUpdatedAt,
        linkedRepairId: it.linkedRepairId || expandedItem.linkedRepairId || null,
      };
    });

    const repairItems = updatedItems.filter((it) => it.status === 'Needs Repair' || it.status === 'Under Repair');
    const anyRepair = repairItems.length > 0;
    const allDone = updatedItems.length > 0 && updatedItems.every((it) => it.status === 'Completed' || it.repaired || it.isRepaired);
    const anyActive = updatedItems.some(
      (it) => it.status === 'In Progress' || it.status === 'Completed' || it.status === 'Needs Repair' || it.status === 'Under Repair'
    );
    const overallStatus: ReportStatus = anyRepair
      ? 'Needs Repair'
      : allDone
        ? 'For Verification'
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

    setReports((prev) =>
      prev.map((rep) => {
        if (rep.id !== targetReportId) return rep;
        return {
          ...rep,
          items: updatedItems,
          status: overallStatus,
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
    if (!activeReport) return;
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

      const allDone = activeReport.items.length > 0 && activeReport.items.every((it) => it.status === 'Completed');
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

      setReports((prev) =>
        prev.map((rep) => {
          if (rep.id !== activeReport.id) return rep;
          return {
            ...rep,
            status: overallStatus,
            lastUpdated: formattedTimestamp,
            issue: anyRepair ? rep.issue : null,
          };
        })
      );

      setConfirmModalVisible(false);
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
    const allRepTasksDone = rep.items && rep.items.length > 0 && rep.items.every((i) => i.status === 'Completed' || i.repaired || i.isRepaired);
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

  // Helper to determine if report has supervisor rework requested (Image 2 output)
  const hasReworkRequest = (rep?: MaintenanceReport | null) => {
    if (!rep) return false;
    if (rep.reworkInstructions && rep.reworkInstructions.trim().length > 0) return true;
    return Array.isArray(rep.timeline) && rep.timeline.some(
      (t: any) => typeof t?.title === 'string' && (t.title.includes('Supervisor requested rework') || t.title.includes('rework:'))
    );
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
        isRework: false,
        isRepair: false,
      };
    }

    const isRework = hasReworkRequest(rep);
    if (isRework) {
      return {
        kind: 'rework' as const,
        tag: 'QUALITY CONTROL & REWORK',
        tagIcon: 'refresh',
        title: 'Request Maintenance Rework',
        accentColor: '#f59e0b',
        instructionsLabel: 'Supervisor Rework Instructions *:',
        instructionsText: rep.reworkInstructions || 'Checklist items require rework and re-inspection.',
        submitButtonText: 'Submit Rework',
        isRework: true,
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
          'Diagnose and repair component defect. Inspect parts, calibrate telemetry sensors, and validate operational safety.',
        submitButtonText: 'Submit Repair',
        isRework: false,
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
      isRework: false,
      isRepair: false,
    };
  };

  // Direct Submission for Admin Verification (for any order or rework)
  const handleSubmitForVerification = async (targetRepId?: string) => {
    const reportId = targetRepId || selectedReportId;
    const targetRep = reports.find((r) => r.id === reportId);
    if (!targetRep) return;

    // Completion & Verification Invariant:
    // A report cannot become Completed or Submitted for Verification while its own required tasks are unfinished!
    const allTasksDone = targetRep.items.length > 0 && targetRep.items.every((it) => it.status === 'Completed' || it.repaired || it.isRepaired);
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
      if (classification.kind === 'rework') {
        customTimelineTitle = `Rework completed & submitted for admin verification by ${userName || 'Maintenance Staff'}`;
      } else if (classification.kind === 'repair') {
        customTimelineTitle = `Corrective repair completed & submitted for admin verification by ${userName || 'Maintenance Staff'}`;
      }

      const isRepair = reportId.startsWith('REP-') || targetRep.type?.toLowerCase().includes('repair');

      if (isRepair) {
        const syncRes = await submitRepairAndSyncParent(reportId, userName);
        if (!syncRes.success) {
          console.warn('Failed to submit repair to Supabase:', syncRes.error);
          alert(syncRes.error || 'The repair order could not be submitted. Please try again.');
          return;
        }

        // Reload all live reports from Supabase so both child repair and parent reports have their updated statuses, tasks, and completion counts
        await loadReports();
        setConfirmModalVisible(false);
        setSelectedReportId(reportId);
        setCurrentScreen('SUCCESS');
        return;
      }

      const res = await updateLiveMaintenanceReport(reportId, {
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

      setConfirmModalVisible(false);
      setSelectedReportId(reportId);
      setCurrentScreen('SUCCESS');
    } catch (e) {
      console.error('Error submitting verification:', e);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Summary Metric Card dynamic theme styling with high-contrast active state
  const getMetricCardStyle = (filterType: string, active: boolean) => {
    if (!active) {
      return {
        cardBg: isDark ? '#151e32' : '#ffffff',
        border: isDark ? '#334155' : '#e2e8f0',
        countColor: isDark ? '#f8fafc' : '#0f172a',
        labelColor: isDark ? '#94a3b8' : '#64748b',
      };
    }
    switch (filterType) {
      case 'In Progress':
        return {
          cardBg: isDark ? 'rgba(217, 119, 6, 0.22)' : '#fffbeb',
          border: isDark ? '#f59e0b' : '#d97706',
          countColor: isDark ? '#fbbf24' : '#b45309',
          labelColor: isDark ? '#fde68a' : '#92400e',
        };
      case 'For Verification':
        return {
          cardBg: isDark ? 'rgba(147, 51, 234, 0.22)' : '#faf5ff',
          border: isDark ? '#a855f7' : '#9333ea',
          countColor: isDark ? '#c084fc' : '#7e22ce',
          labelColor: isDark ? '#e9d5ff' : '#6b21a8',
        };
      case 'Needs Repair':
        return {
          cardBg: isDark ? 'rgba(220, 38, 38, 0.22)' : '#fef2f2',
          border: isDark ? '#ef4444' : '#dc2626',
          countColor: isDark ? '#f87171' : '#b91c1c',
          labelColor: isDark ? '#fca5a5' : '#991b1b',
        };
      case 'Pending':
      case 'Completed':
      default:
        return {
          cardBg: isDark ? 'rgba(16, 185, 129, 0.22)' : '#ecfdf5',
          border: isDark ? '#10b981' : '#059669',
          countColor: isDark ? '#34d399' : '#065f46',
          labelColor: isDark ? '#a7f3d0' : '#047857',
        };
    }
  };

  // Status Badge styling helper
  const getStatusColor = (status: ChecklistStatus | ReportStatus) => {
    if (isDark) {
      switch (status) {
        case 'Completed':
          return { bg: 'rgba(16, 185, 129, 0.2)', text: '#34d399', border: 'rgba(16, 185, 129, 0.45)' };
        case 'In Progress':
          return { bg: 'rgba(245, 158, 11, 0.2)', text: '#fbbf24', border: 'rgba(245, 158, 11, 0.45)' };
        case 'Needs Repair':
          return { bg: 'rgba(239, 68, 68, 0.2)', text: '#f87171', border: 'rgba(239, 68, 68, 0.45)' };
        case 'Under Repair':
          return { bg: 'rgba(56, 189, 248, 0.2)', text: '#38bdf8', border: 'rgba(56, 189, 248, 0.45)' };
        case 'For Verification':
          return { bg: 'rgba(168, 85, 247, 0.2)', text: '#c084fc', border: 'rgba(168, 85, 247, 0.45)' };
        case 'Pending':
        case 'Not Started':
        default:
          return { bg: 'rgba(148, 163, 184, 0.15)', text: '#cbd5e1', border: 'rgba(148, 163, 184, 0.3)' };
      }
    }
    switch (status) {
      case 'Completed':
        return { bg: '#d1fae5', text: '#059669', border: '#a7f3d0' };
      case 'In Progress':
        return { bg: '#fef3c7', text: '#d97706', border: '#fde68a' };
      case 'Needs Repair':
        return { bg: '#fee2e2', text: '#dc2626', border: '#fca5a5' };
      case 'Under Repair':
        return { bg: '#e0f2fe', text: '#0284c7', border: '#bae6fd' };
      case 'For Verification':
        return { bg: '#f3e8ff', text: '#9333ea', border: '#e9d5ff' };
      case 'Pending':
      case 'Not Started':
      default:
        return { bg: '#f1f5f9', text: '#64748b', border: '#e2e8f0' };
    }
  };

  const getPriorityColor = (priority: PriorityLevel) => {
    switch (priority) {
      case 'Critical':
        return {
          bg: isDark ? 'rgba(244, 63, 94, 0.25)' : '#ffe4e6',
          text: isDark ? '#fb7185' : '#e11d48',
          border: isDark ? 'rgba(244, 63, 94, 0.5)' : '#fda4af',
        };
      case 'High':
        return {
          bg: isDark ? 'rgba(239, 68, 68, 0.22)' : '#fee2e2',
          text: isDark ? '#f87171' : '#dc2626',
          border: isDark ? 'rgba(239, 68, 68, 0.5)' : '#fca5a5',
        };
      case 'Medium':
        return {
          bg: isDark ? 'rgba(245, 158, 11, 0.22)' : '#fef3c7',
          text: isDark ? '#fbbf24' : '#d97706',
          border: isDark ? 'rgba(245, 158, 11, 0.5)' : '#fde68a',
        };
      case 'Low':
      default:
        return {
          bg: isDark ? 'rgba(56, 189, 248, 0.22)' : '#e0f2fe',
          text: isDark ? '#38bdf8' : '#0284c7',
          border: isDark ? 'rgba(56, 189, 248, 0.5)' : '#bae6fd',
        };
    }
  };

  // Filtered reports list for dashboard (Option B: child repairs are accessed via parent checklist items)
  const visibleReports = reports.filter((rep) => !isChildRepairReport(rep));
  const filteredReports = visibleReports.filter((rep) => {
    if (activeFilter !== 'All' && rep.status !== activeFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        rep.id.toLowerCase().includes(q) ||
        rep.airconId.toLowerCase().includes(q) ||
        rep.location.toLowerCase().includes(q) ||
        rep.title.toLowerCase().includes(q) ||
        (rep.assignedWorker && rep.assignedWorker.toLowerCase().includes(q)) ||
        (rep.description && rep.description.toLowerCase().includes(q)) ||
        (rep.parentReportId && rep.parentReportId.toLowerCase().includes(q)) ||
        (rep.linkedRepairId && rep.linkedRepairId.toLowerCase().includes(q)) ||
        (rep.reworkInstructions && rep.reworkInstructions.toLowerCase().includes(q)) ||
        (rep.type && rep.type.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <LinearGradient
      colors={effectiveTheme === 'dark' ? ['#0f172a', '#0a0f1d'] : ['#d1fae5', '#ffffff']}
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
                  <ThemedText style={[styles.headerSubtitle, { color: colors.emerald }]}>Maintenance Module</ThemedText>
                </View>
              </View>
            </View>

            {/* Workflow Notice Banner */}
            <View style={[styles.workflowNotice, { backgroundColor: effectiveTheme === 'dark' ? '#151e32' : '#ffffff', borderColor: effectiveTheme === 'dark' ? '#334155' : '#e2e8f0' }]}>
              <AppIcon name="checklist" size={16} color={colors.emerald} />
              <ThemedText style={[styles.workflowNoticeText, { color: colors.textSecondary }]}>
                Assigned maintenance reports from the desktop dashboard. View, update checklists, and submit progress.
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
                      style={[styles.summaryCard, { backgroundColor: s.cardBg, borderColor: s.border }]}
                    >
                      <View style={[styles.summaryBadgeDot, { backgroundColor: '#64748b' }]} />
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
                      style={[styles.summaryCard, { backgroundColor: s.cardBg, borderColor: s.border }]}
                    >
                      <View style={[styles.summaryBadgeDot, { backgroundColor: '#d97706' }]} />
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
                      style={[styles.summaryCard, { backgroundColor: s.cardBg, borderColor: s.border }]}
                    >
                      <View style={[styles.summaryBadgeDot, { backgroundColor: '#9333ea' }]} />
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
                      style={[styles.summaryCard, { backgroundColor: s.cardBg, borderColor: s.border }]}
                    >
                      <View style={[styles.summaryBadgeDot, { backgroundColor: '#dc2626' }]} />
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
                      style={[styles.summaryCard, { backgroundColor: s.cardBg, borderColor: s.border }]}
                    >
                      <View style={[styles.summaryBadgeDot, { backgroundColor: '#059669' }]} />
                      <ThemedText style={[styles.summaryCount, { color: s.countColor }]}>{completedCount}</ThemedText>
                      <ThemedText style={[styles.summaryLabel, { color: s.labelColor }]}>Completed</ThemedText>
                    </Pressable>
                  );
                })()}
              </ScrollView>
            </View>

            {/* Search Bar */}
            <View style={[styles.searchBarContainer, { backgroundColor: effectiveTheme === 'dark' ? '#151e32' : '#ffffff', borderColor: effectiveTheme === 'dark' ? '#334155' : '#e2e8f0' }]}>
              <Image source={{ uri: ICON_SEARCH }} style={[styles.searchIcon, { tintColor: colors.textSecondary }]} contentFit="contain" />
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
                      { backgroundColor: effectiveTheme === 'dark' ? '#151e32' : '#ffffff', borderColor: effectiveTheme === 'dark' ? '#334155' : '#e2e8f0' },
                      isSelected && { backgroundColor: effectiveTheme === 'dark' ? '#059669' : '#0b291d', borderColor: effectiveTheme === 'dark' ? '#059669' : '#0b291d' }
                    ]}
                  >
                    <ThemedText style={[styles.filterChipText, { color: effectiveTheme === 'dark' ? '#94a3b8' : '#475569' }, isSelected && styles.filterChipTextActive]}>
                      {filter}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Report Cards List */}
            <View style={styles.reportsList}>
              <View style={styles.listHeaderRow}>
                <ThemedText style={[styles.sectionHeaderTitle, { color: colors.text }]}>ASSIGNED REPORTS ({filteredReports.length})</ThemedText>
              </View>

              {loading && reports.length === 0 ? (
                <View style={{ paddingVertical: 40, alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator size="large" color="#059669" />
                  <ThemedText style={{ marginTop: 12, fontSize: 13, color: '#6b7280', fontWeight: '600' }}>
                    Loading maintenance reports from database...
                  </ThemedText>
                </View>
              ) : (
                filteredReports.map((report) => {
                  const repItems = report.items || [];
                  const repTotal = repItems.length;
                  const repDone = repItems.filter((i) => i.status === 'Completed').length;
                  const repRatio = repTotal > 0 ? repDone / repTotal : 0;
                  const repPct = Math.round(repRatio * 100);
                  const statusStyle = getStatusColor(report.status);
                  const priorityStyle = getPriorityColor(report.priority);
                  const repNeedsRepairCount = repItems.filter(
                    (i) => !i.isRepaired && !i.repaired && (i.status === 'Needs Repair' || i.status === 'Under Repair' || Boolean(i.linkedRepairId))
                  ).length;

                  return (
                    <View key={report.id} style={[styles.reportCard, { backgroundColor: effectiveTheme === 'dark' ? '#151e32' : '#ffffff', borderColor: effectiveTheme === 'dark' ? '#334155' : '#e2e8f0' }]}>
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
                                  borderColor: effectiveTheme === 'dark' ? '#151e32' : '#ffffff',
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

                      {/* Friendly Connected Rework & Repair Badges with Counts */}
                      {(() => {
                        const reworkCount = hasReworkRequest(report) ? 1 : 0;
                        const { hasDispatchedRepair, repairId, linkedRepairReport } = getDispatchedRepairInfo(report);
                        const isRepairedAlready = Boolean(
                          (isCorrectiveRepair(report) && (report.isVerified || (report.status === 'Completed' && repItems.length > 0 && repItems.every((i) => i.status === 'Completed')))) ||
                          (hasDispatchedRepair && linkedRepairReport && (linkedRepairReport.isRepaired || linkedRepairReport.isVerified || (linkedRepairReport.status === 'Completed' && (linkedRepairReport.items?.length === 0 || linkedRepairReport.items?.every((i) => i.status === 'Completed')))))
                        );

                        if (reworkCount === 0 && !isRepairedAlready) return null;

                        return (
                          <View style={styles.cardBadgesRow}>

                            {reworkCount > 0 && (
                              <View
                                style={[
                                  styles.cardCountBadge,
                                  {
                                    backgroundColor: isDark ? 'rgba(245, 158, 11, 0.16)' : '#fef3c7',
                                    borderColor: isDark ? '#f59e0b' : '#fde68a',
                                  },
                                ]}
                              >
                                <AppIcon name="refresh" size={11} color={isDark ? '#fbbf24' : '#b45309'} />
                                <ThemedText
                                  style={[
                                    styles.cardCountBadgeText,
                                    {
                                      color: isDark ? '#fbbf24' : '#b45309',
                                      fontWeight: '800',
                                    },
                                  ]}
                                >
                                  {reworkCount} {reworkCount === 1 ? 'Rework' : 'Reworks'}
                                </ThemedText>
                              </View>
                            )}

                            {isRepairedAlready ? (
                              <View
                                style={[
                                  styles.cardCountBadge,
                                  {
                                    backgroundColor: isDark ? 'rgba(16, 185, 129, 0.16)' : '#ecfdf5',
                                    borderColor: isDark ? '#10b981' : '#a7f3d0',
                                  },
                                ]}
                              >
                                <AppIcon name="check" size={11} color={isDark ? '#34d399' : '#047857'} />
                                <ThemedText
                                  style={[
                                    styles.cardCountBadgeText,
                                    {
                                      color: isDark ? '#34d399' : '#047857',
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
                        <View style={[styles.verificationNoticeCard, { backgroundColor: effectiveTheme === 'dark' ? 'rgba(147, 51, 234, 0.16)' : '#faf5ff', borderColor: effectiveTheme === 'dark' ? 'rgba(168, 85, 247, 0.45)' : '#e9d5ff' }]}>
                          <AppIcon name="shield" size={15} color={effectiveTheme === 'dark' ? '#c084fc' : '#7e22ce'} />
                          <View style={{ flex: 1 }}>
                            <ThemedText style={[styles.verificationNoticeHeader, { color: effectiveTheme === 'dark' ? '#c084fc' : '#7e22ce' }]}>
                              Complete — Needs Admin Verification
                            </ThemedText>
                            <ThemedText style={[styles.verificationNoticeContent, { color: effectiveTheme === 'dark' ? '#e9d5ff' : '#6b21a8' }]}>
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
                              <Image source={{ uri: ICON_AIRCONSTATE }} style={{ width: 14, height: 14, tintColor: colors.emerald }} contentFit="contain" />
                            </View>
                            <ThemedText style={[styles.acTitleText, { color: colors.text }]}>
                              {report.airconName || report.airconId}
                            </ThemedText>
                          </View>
                          {report.type ? (
                            <View style={[
                              styles.reportTypeBadge,
                              {
                                backgroundColor: isDark ? 'rgba(16, 185, 129, 0.15)' : '#ecfdf5',
                                borderColor: isDark ? 'rgba(16, 185, 129, 0.35)' : '#a7f3d0',
                              }
                            ]}>
                              <ThemedText style={[styles.reportTypeBadgeText, { color: isDark ? '#34d399' : '#047857' }]} numberOfLines={1}>
                                {report.type}
                              </ThemedText>
                            </View>
                          ) : null}
                        </View>

                        {/* Equipment Model & Aircon Type Row */}
                        <View style={styles.acMetaTagsRow}>
                          {report.airconType ? (
                            <View style={[styles.airconTypeTag, { backgroundColor: effectiveTheme === 'dark' ? '#0f172a' : '#ecfdf5', borderColor: effectiveTheme === 'dark' ? '#1e293b' : '#a7f3d0' }]}>
                              <AppIcon name="gear" size={11} color={effectiveTheme === 'dark' ? '#34d399' : '#047857'} />
                              <ThemedText style={[styles.airconTypeTagText, { color: effectiveTheme === 'dark' ? '#34d399' : '#047857' }]}>
                                {report.airconType}
                              </ThemedText>
                            </View>
                          ) : null}

                          <View style={[styles.locationBadgeRow, { backgroundColor: effectiveTheme === 'dark' ? '#0f172a' : '#f8fafc', borderColor: effectiveTheme === 'dark' ? '#1e293b' : '#e2e8f0' }]}>
                            <LocationIcon size={12} color="#059669" />
                            <ThemedText style={[styles.locationBadgeText, { color: colors.textSecondary }]}>
                              {report.location}
                            </ThemedText>
                          </View>
                        </View>
                      </View>

                      {/* Description UI Card (Work Scope) */}
                      <View style={[styles.descriptionCardBox, { backgroundColor: effectiveTheme === 'dark' ? '#0f172a' : '#f8fafc', borderColor: effectiveTheme === 'dark' ? '#1e293b' : '#e2e8f0' }]}>
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
                        <View style={[styles.verificationRemarksCard, { backgroundColor: effectiveTheme === 'dark' ? '#1e1b4b' : '#f5f3ff', borderColor: effectiveTheme === 'dark' ? '#3730a3' : '#ddd6fe' }]}>
                          <AppIcon name="shield" size={14} color={effectiveTheme === 'dark' ? '#c4b5fd' : '#6b21a8'} />
                          <View style={{ flex: 1 }}>
                            <ThemedText style={[styles.verificationRemarksHeader, { color: effectiveTheme === 'dark' ? '#c4b5fd' : '#6b21a8' }]}>
                              Admin Verification Remarks
                            </ThemedText>
                            <ThemedText style={[styles.verificationRemarksContent, { color: effectiveTheme === 'dark' ? '#e0e7ff' : '#4338ca' }]}>
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
                          <Image source={{ uri: ICON_CALENDAR }} style={styles.calendarIcon} contentFit="contain" />
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
                        <View style={[styles.progressBarTrack, { backgroundColor: isDark ? '#1e293b' : '#e2e8f0' }]}>
                          <View
                            style={[
                              styles.progressBarFill,
                              {
                                width: `${repPct}%`,
                                backgroundColor: repPct === 100 ? '#059669' : '#10b981',
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
                            backgroundColor: effectiveTheme === 'dark' ? '#064e3b' : '#f0fdf4',
                            borderColor: effectiveTheme === 'dark' ? '#059669' : '#bbf7d0'
                          }
                        ]}
                      >
                        <ThemedText style={[styles.viewButtonText, { color: effectiveTheme === 'dark' ? '#34d399' : '#065f46' }]}>Open Maintenance Checklist</ThemedText>
                        <Image source={{ uri: ICON_CHEVRON_RIGHT }} style={[styles.viewButtonIcon, { tintColor: effectiveTheme === 'dark' ? '#34d399' : '#059669' }]} contentFit="contain" />
                      </Pressable>
                    </View>
                  );
                }))}

              {!loading && filteredReports.length === 0 && (
                <View
                  style={[
                    styles.emptyState,
                    {
                      backgroundColor: effectiveTheme === 'dark' ? '#151e32' : '#ffffff',
                      borderColor: effectiveTheme === 'dark' ? '#334155' : '#e2e8f0',
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.emptyIconCircle,
                      {
                        backgroundColor: effectiveTheme === 'dark' ? 'rgba(16, 185, 129, 0.15)' : '#ecfdf5',
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
                          backgroundColor: effectiveTheme === 'dark' ? '#1e293b' : '#f1f5f9',
                          borderColor: effectiveTheme === 'dark' ? '#334155' : '#e2e8f0',
                        },
                      ]}
                    >
                      <ThemedText
                        style={[
                          styles.emptyActionBtnText,
                          { color: effectiveTheme === 'dark' ? '#34d399' : '#059669' },
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

                {/* CONNECTED REWORK CARD (Only if supervisor requested rework) */}
                {(() => {
                  const hasRework = hasReworkRequest(activeReport);
                  if (!hasRework) return null;

                  return (
                    <View style={styles.connectedCardsContainer}>
                      <View style={[styles.connectedCard, { backgroundColor: isDark ? 'rgba(245, 158, 11, 0.12)' : '#fffbeb', borderColor: isDark ? 'rgba(245, 158, 11, 0.45)' : '#fde68a' }]}>
                        <View style={styles.connectedCardHeader}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                            <AppIcon name="refresh" size={14} color={isDark ? '#fbbf24' : '#b45309'} />
                            <ThemedText style={[styles.connectedCardTag, { color: isDark ? '#fbbf24' : '#b45309' }]}>
                              QUALITY CONTROL & REWORK
                            </ThemedText>
                          </View>
                          <View style={[styles.connectedCardPill, { backgroundColor: '#f59e0b' }]}>
                            <ThemedText style={styles.connectedCardPillText}>{activeReport.priority || 'High'}</ThemedText>
                          </View>
                        </View>

                        <ThemedText style={[styles.connectedCardInstructions, { color: isDark ? '#fef3c7' : '#78350f' }]} numberOfLines={2}>
                          "{activeReport.reworkInstructions || 'Supervisor flagged items requiring rework and re-inspection.'}"
                        </ThemedText>

                        <View style={styles.connectedCardMetaRow}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <AppIcon name="user" size={11} color={isDark ? '#fde68a' : '#92400e'} />
                            <ThemedText style={[styles.connectedCardMetaText, { color: isDark ? '#fde68a' : '#92400e' }]}>
                              Assigned: {activeReport.assignedWorker}
                            </ThemedText>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <AppIcon name="calendar" size={11} color={isDark ? '#fde68a' : '#92400e'} />
                            <ThemedText style={[styles.connectedCardMetaText, { color: isDark ? '#fde68a' : '#92400e' }]}>
                              Due: {activeReport.dueDate}
                            </ThemedText>
                          </View>
                        </View>

                        <Pressable
                          onPress={() => setCurrentScreen('REWORK')}
                          style={[styles.connectedCardBtn, { backgroundColor: '#f59e0b' }]}
                        >
                          <ThemedText style={styles.connectedCardBtnText}>
                            Open Rework Page →
                          </ThemedText>
                        </Pressable>
                      </View>
                    </View>
                  );
                })()}

                {/* SCREEN 2: Aircon Information Card */}
                <View style={[styles.airconInfoCard, { backgroundColor: effectiveTheme === 'dark' ? '#151e32' : '#ffffff', borderColor: effectiveTheme === 'dark' ? '#334155' : '#e2e8f0' }]}>
                  <View style={styles.cardSectionHeader}>
                    <ThemedText style={[styles.cardSectionTitle, { color: colors.text }]}>AIRCON & EQUIPMENT INFORMATION</ThemedText>
                  </View>
                  <View style={styles.infoGrid}>
                    <View style={[styles.infoRow, { borderBottomColor: effectiveTheme === 'dark' ? '#1e293b' : '#f1f5f9' }]}>
                      <ThemedText style={[styles.infoKey, { color: colors.textSecondary }]}>Aircon Sensor:</ThemedText>
                      <ThemedText style={[styles.infoValueBold, { color: colors.text }]}>{activeReport.airconName || activeReport.airconId}</ThemedText>
                    </View>
                    <View style={[styles.infoRow, { borderBottomColor: effectiveTheme === 'dark' ? '#1e293b' : '#f1f5f9' }]}>
                      <ThemedText style={[styles.infoKey, { color: colors.textSecondary }]}>Aircon Type:</ThemedText>
                      <ThemedText style={[styles.infoValue, { color: colors.emerald, fontWeight: '700' }]}>
                        {activeReport.airconType || 'Split Type (Inverter)'}
                      </ThemedText>
                    </View>
                    <View style={[styles.infoRow, { borderBottomColor: effectiveTheme === 'dark' ? '#1e293b' : '#f1f5f9' }]}>
                      <ThemedText style={[styles.infoKey, { color: colors.textSecondary }]}>Location:</ThemedText>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <LocationIcon size={12} color="#059669" />
                        <ThemedText style={[styles.infoValue, { color: colors.text }]}>{activeReport.location}</ThemedText>
                      </View>
                    </View>
                    <View style={[styles.infoRow, { borderBottomColor: effectiveTheme === 'dark' ? '#1e293b' : '#f1f5f9' }]}>
                      <ThemedText style={[styles.infoKey, { color: colors.textSecondary }]}>Maintenance Type:</ThemedText>
                      <ThemedText style={[styles.infoValue, { color: colors.text }]}>{activeReport.type}</ThemedText>
                    </View>
                    <View style={[styles.infoRow, { borderBottomColor: effectiveTheme === 'dark' ? '#1e293b' : '#f1f5f9' }]}>
                      <ThemedText style={[styles.infoKey, { color: colors.textSecondary }]}>Latest Update:</ThemedText>
                      <ThemedText style={[styles.infoValue, { color: colors.text }]}>{activeReport.lastUpdated || 'Not updated yet'}</ThemedText>
                    </View>
                    <View style={[styles.infoRow, { borderBottomColor: effectiveTheme === 'dark' ? '#1e293b' : '#f1f5f9', alignItems: 'flex-start' }]}>
                      <ThemedText style={[styles.infoKey, { color: colors.textSecondary, marginTop: 2 }]}>Scope / Description:</ThemedText>
                      <View style={styles.scopeScrollBox}>
                        <ScrollView
                          style={styles.scopeScrollView}
                          nestedScrollEnabled={true}
                          showsVerticalScrollIndicator={true}
                          persistentScrollbar={true}
                        >
                          <ThemedText style={[styles.infoValue, { color: colors.text, textAlign: 'right', lineHeight: 20 }]}>
                            {activeReport.description || activeReport.title || 'Scheduled preventive inspection'}
                          </ThemedText>
                        </ScrollView>
                      </View>
                    </View>
                    <View style={[styles.infoRow, { borderBottomColor: effectiveTheme === 'dark' ? '#1e293b' : '#f1f5f9' }]}>
                      <ThemedText style={[styles.infoKey, { color: colors.textSecondary }]}>Assigned Worker:</ThemedText>
                      <ThemedText style={[styles.infoValue, { color: colors.text }]}>{activeReport.assignedWorker}</ThemedText>
                    </View>
                    <View style={[styles.infoRow, { borderBottomColor: effectiveTheme === 'dark' ? '#1e293b' : '#f1f5f9' }]}>
                      <ThemedText style={[styles.infoKey, { color: colors.textSecondary }]}>Priority:</ThemedText>
                      <View style={[styles.priorityPillSmall, { backgroundColor: getPriorityColor(activeReport.priority).bg }]}>
                        <ThemedText style={[styles.priorityPillSmallText, { color: getPriorityColor(activeReport.priority).text }]}>
                          {activeReport.priority}
                        </ThemedText>
                      </View>
                    </View>
                    <View style={[styles.infoRow, { borderBottomColor: effectiveTheme === 'dark' ? '#1e293b' : '#f1f5f9' }]}>
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
                    <View style={[styles.detailsVerificationBanner, { backgroundColor: effectiveTheme === 'dark' ? '#1e1b4b' : '#f5f3ff', borderColor: effectiveTheme === 'dark' ? '#3730a3' : '#ddd6fe' }]}>
                      <AppIcon name="shield" size={15} color={effectiveTheme === 'dark' ? '#c4b5fd' : '#6b21a8'} />
                      <View style={{ flex: 1 }}>
                        <ThemedText style={[styles.detailsVerificationTitle, { color: effectiveTheme === 'dark' ? '#c4b5fd' : '#6b21a8' }]}>
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
                    <View style={[styles.detailsPendingVerificationBanner, { backgroundColor: effectiveTheme === 'dark' ? 'rgba(147, 51, 234, 0.15)' : '#f3e8ff', borderColor: effectiveTheme === 'dark' ? 'rgba(168, 85, 247, 0.4)' : '#d8b4fe' }]}>
                      <AppIcon name="clock" size={16} color={effectiveTheme === 'dark' ? '#c084fc' : '#7e22ce'} />
                      <View style={{ flex: 1 }}>
                        <ThemedText style={[styles.detailsPendingVerificationTitle, { color: effectiveTheme === 'dark' ? '#c084fc' : '#7e22ce' }]}>
                          Awaiting Admin Verification
                        </ThemedText>
                        <ThemedText style={[styles.detailsPendingVerificationText, { color: effectiveTheme === 'dark' ? '#e9d5ff' : '#6b21a8' }]}>
                          All checklist tasks are completed (100%). This report has been submitted and is awaiting administrator verification and sign-off.
                        </ThemedText>
                      </View>
                    </View>
                  )}
                </View>

                {/* Maintenance Progress Section */}
                <View style={[styles.progressCard, { backgroundColor: effectiveTheme === 'dark' ? '#151e32' : '#ffffff', borderColor: effectiveTheme === 'dark' ? '#334155' : '#e2e8f0' }]}>
                  <View style={styles.progressCardHeader}>
                    <ThemedText style={[styles.cardSectionTitle, { color: colors.text }]}>MAINTENANCE PROGRESS</ThemedText>
                    <ThemedText style={styles.progressPercentageText}>{progressPercentage}%</ThemedText>
                  </View>

                  <ThemedText style={[styles.progressCountText, { color: colors.textSecondary }]}>
                    {completedItems} of {totalItems} completed
                  </ThemedText>

                  {/* Progress Bar */}
                  <View style={[styles.largeProgressBarTrack, { backgroundColor: effectiveTheme === 'dark' ? '#1e293b' : '#e2e8f0' }]}>
                    <Animated.View
                      style={[
                        styles.largeProgressBarFill,
                        {
                          width: progressAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0%', '100%'],
                          }),
                          backgroundColor: progressPercentage === 100 ? '#059669' : '#10b981',
                        },
                      ]}
                    />
                  </View>

                  {/* Status Chips Summary */}
                  <View style={styles.statusChipsRow}>
                    <View style={[styles.statusChipItem, { backgroundColor: effectiveTheme === 'dark' ? '#0f172a' : '#f8fafc' }]}>
                      <ThemedText style={[styles.statusChipNum, { color: '#059669' }]}>{completedItems}</ThemedText>
                      <ThemedText style={[styles.statusChipLabel, { color: colors.textSecondary }]}>Done</ThemedText>
                    </View>
                    <View style={[styles.statusChipItem, { backgroundColor: effectiveTheme === 'dark' ? '#0f172a' : '#f8fafc' }]}>
                      <ThemedText style={[styles.statusChipNum, { color: '#d97706' }]}>{inProgressItems}</ThemedText>
                      <ThemedText style={[styles.statusChipLabel, { color: colors.textSecondary }]}>In Progress</ThemedText>
                    </View>
                    <View style={[styles.statusChipItem, { backgroundColor: effectiveTheme === 'dark' ? '#0f172a' : '#f8fafc' }]}>
                      <ThemedText style={[styles.statusChipNum, { color: '#64748b' }]}>{notStartedItems}</ThemedText>
                      <ThemedText style={[styles.statusChipLabel, { color: colors.textSecondary }]}>Not Started</ThemedText>
                    </View>
                    {!isCurrentRepair && needsRepairItems > 0 && (
                      <View style={[styles.statusChipItem, { backgroundColor: effectiveTheme === 'dark' ? '#0f172a' : '#f8fafc' }]}>
                        <ThemedText style={[styles.statusChipNum, { color: '#dc2626' }]}>{needsRepairItems}</ThemedText>
                        <ThemedText style={[styles.statusChipLabel, { color: colors.textSecondary }]}>Needs Repair</ThemedText>
                      </View>
                    )}
                  </View>
                </View>

                {/* SCREEN 3: Maintenance Checklist Section */}
                <View style={styles.checklistSection}>
                  <View style={styles.checklistSectionHeader}>
                    <Image source={{ uri: ICON_CHECKLIST }} style={[styles.checklistIcon, { tintColor: isDark ? '#34d399' : '#064e3b' }]} contentFit="contain" />
                    <ThemedText style={[styles.checklistSectionTitle, { color: colors.text }]}>MAINTENANCE CHECKLIST</ThemedText>
                  </View>
                  <ThemedText style={[styles.checklistHint, { color: colors.textSecondary }]}>
                    Tap any item to add remarks, attach photo proof, or report repairs. Use dropdown to update status.
                  </ThemedText>

                  <View style={styles.checklistItemsList}>
                    {activeReport.items.map((item, index) => {
                      const isUnderRepair = item.status === 'Under Repair' || Boolean(item.linkedRepairId);
                      const isItemRepaired = Boolean(
                        item.isRepaired ||
                        item.repaired ||
                        (activeReport.isRepaired && (item.status === 'Needs Repair' || isUnderRepair || item.problemDescription || (activeReport.issue?.component && item.title.toLowerCase().trim() === activeReport.issue.component.toLowerCase().trim())))
                      );
                      const isNeedsRepair = (item.status === 'Needs Repair' || item.status === 'Under Repair') && !isItemRepaired;
                      const statusStyle = getStatusColor(isUnderRepair ? 'Under Repair' : item.status);
                      const isItemChecked = isItemRepaired || item.status === 'Completed';
                      const photoCount = Array.isArray(item.photoUris) && item.photoUris.length > 0
                        ? item.photoUris.length
                        : (item.photoUri ? 1 : 0);
                      const displayRemarks = item.remarks || item.problemDescription;

                      return (
                        <View
                          key={item.id}
                          style={[
                            styles.checklistItemCard,
                            { backgroundColor: effectiveTheme === 'dark' ? '#151e32' : '#ffffff', borderColor: effectiveTheme === 'dark' ? '#334155' : '#e2e8f0' },
                            isUnderRepair && !isItemRepaired && (isDark
                              ? { backgroundColor: 'rgba(14, 165, 233, 0.08)', borderColor: 'rgba(56, 189, 248, 0.45)' }
                              : { backgroundColor: '#f0f9ff', borderColor: '#bae6fd' }
                            ),
                            isNeedsRepair && !isUnderRepair && !isItemRepaired && (isDark
                              ? { backgroundColor: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(239, 68, 68, 0.45)' }
                              : styles.checklistItemCardDanger
                            ),
                            isItemRepaired && (isDark
                              ? { backgroundColor: 'rgba(16, 185, 129, 0.12)', borderColor: 'rgba(16, 185, 129, 0.45)' }
                              : { backgroundColor: '#ecfdf5', borderColor: '#a7f3d0' }
                            ),
                          ]}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                            {/* Left Area: Index Circle + Title + Inline Badges + Remarks */}
                            <Pressable
                              onPress={() => handleOpenItemEditor(item, activeReport.id)}
                              style={{ flex: 1, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}
                            >
                              <Pressable
                                onPress={() => handleToggleTaskCheck(item.id, activeReport.id)}
                                style={[
                                  styles.itemIndexCircle,
                                  {
                                    backgroundColor: isItemChecked ? '#10b981' : (effectiveTheme === 'dark' ? '#0f172a' : '#f1f5f9'),
                                    borderWidth: isDark ? 1 : 0,
                                    borderColor: isItemChecked ? '#10b981' : (isDark ? '#334155' : 'transparent'),
                                  },
                                ]}
                              >
                                {isItemChecked ? (
                                  <ThemedText style={{ color: '#ffffff', fontWeight: '900', fontSize: 13 }}>✓</ThemedText>
                                ) : (
                                  <ThemedText style={[styles.itemIndexNumber, { color: colors.text }]}>{index + 1}</ThemedText>
                                )}
                              </Pressable>

                              <View style={{ flex: 1 }}>
                                {/* Title and Pills Row (Image 3) */}
                                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
                                  <ThemedText
                                    style={[
                                      styles.itemTitle,
                                      { color: colors.text },
                                      isUnderRepair && !isItemRepaired && { color: isDark ? '#38bdf8' : '#0369a1' },
                                      isNeedsRepair && !isUnderRepair && !isItemRepaired && { color: isDark ? '#f87171' : '#dc2626' },
                                      isItemRepaired && { color: isDark ? '#34d399' : '#059669', fontWeight: '800' },
                                    ]}
                                  >
                                    {item.title}
                                  </ThemedText>

                                  {/* Status Pill matching Image 3 */}
                                  <View
                                    style={[
                                      styles.inlineStatusPill,
                                      {
                                        backgroundColor: isItemRepaired
                                          ? (isDark ? 'rgba(16, 185, 129, 0.16)' : '#ecfdf5')
                                          : statusStyle.bg,
                                        borderColor: isItemRepaired
                                          ? (isDark ? 'rgba(16, 185, 129, 0.45)' : '#a7f3d0')
                                          : statusStyle.border,
                                      },
                                    ]}
                                  >
                                    <View
                                      style={[
                                        styles.statusDot,
                                        {
                                          backgroundColor: isItemRepaired
                                            ? (isDark ? '#34d399' : '#059669')
                                            : statusStyle.text,
                                        },
                                      ]}
                                    />
                                    <ThemedText
                                      style={[
                                        styles.inlineStatusPillText,
                                        {
                                          color: isItemRepaired
                                            ? (isDark ? '#34d399' : '#047857')
                                            : statusStyle.text,
                                        },
                                      ]}
                                    >
                                      {isUnderRepair
                                        ? `Under Repair${item.linkedRepairId ? ` (${item.linkedRepairId})` : ''}`
                                        : isItemRepaired
                                          ? 'Repaired'
                                          : item.status}
                                    </ThemedText>
                                  </View>

                                  {/* Photos Pill (Image 3) */}
                                  {photoCount > 0 && (
                                    <View
                                      style={[
                                        styles.inlinePhotoPill,
                                        {
                                          backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : '#e0f2fe',
                                          borderColor: isDark ? 'rgba(56, 189, 248, 0.4)' : '#bae6fd',
                                        },
                                      ]}
                                    >
                                      <AppIcon name="camera" size={11} color={isDark ? '#38bdf8' : '#0284c7'} />
                                      <ThemedText
                                        style={[
                                          styles.inlinePhotoPillText,
                                          { color: isDark ? '#38bdf8' : '#0284c7' },
                                        ]}
                                      >
                                        {photoCount} {photoCount === 1 ? 'Photo' : 'Photos'}
                                      </ThemedText>
                                    </View>
                                  )}
                                </View>

                                {/* Worker Remarks / Defect Quote below Title (Image 3) */}
                                {displayRemarks ? (
                                  <ThemedText
                                    style={{
                                      fontSize: 12.5,
                                      color: isDark ? '#94a3b8' : '#64748b',
                                      fontStyle: 'italic',
                                      marginTop: 2,
                                    }}
                                    numberOfLines={1}
                                  >
                                    "{displayRemarks}"
                                  </ThemedText>
                                ) : (
                                  <ThemedText style={[styles.itemDescription, { color: colors.textSecondary }]} numberOfLines={1}>
                                    {item.description || 'Tap to update status or attach proof'}
                                  </ThemedText>
                                )}
                              </View>
                            </Pressable>

                            {/* Right Area: Repair Task Link Button (Image 3) + Chevron */}
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center' }}>
                              {item.linkedRepairId ? (
                                <Pressable
                                  onPress={() => handleOpenRepairPage(item.linkedRepairId!)}
                                  style={[
                                    styles.repairTaskLinkBtn,
                                    {
                                      backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : '#e0f2fe',
                                      borderColor: isDark ? '#38bdf8' : '#0284c7',
                                    },
                                  ]}
                                  hitSlop={6}
                                >
                                  <ThemedText
                                    style={[
                                      styles.repairTaskLinkBtnText,
                                      { color: isDark ? '#38bdf8' : '#0284c7' },
                                    ]}
                                  >
                                    {item.linkedRepairId}
                                  </ThemedText>
                                  <ThemedText style={{ fontSize: 11, fontWeight: '900', color: isDark ? '#38bdf8' : '#0284c7' }}>
                                    ↗
                                  </ThemedText>
                                </Pressable>
                              ) : null}

                              <Pressable
                                onPress={() => handleOpenItemEditor(item, activeReport.id)}
                                hitSlop={8}
                                style={{ padding: 4 }}
                              >
                                <ThemedText style={{ fontSize: 16, color: colors.textSecondary, fontWeight: '600' }}>
                                  ›
                                </ThemedText>
                              </Pressable>
                            </View>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>

                {/* SCREEN 5: Submit Maintenance Update Button */}
                <View style={styles.submitSection}>
                  <Pressable
                    onPress={() => setConfirmModalVisible(true)}
                    style={({ pressed }) => [
                      styles.submitRepairBtn,
                      pressed && { opacity: 0.88, transform: [{ scale: 0.985 }] },
                    ]}
                  >
                    <LinearGradient
                      colors={
                        progressPercentage === 100
                          ? ['#10b981', '#059669']
                          : isDark
                          ? ['#334155', '#1e293b']
                          : ['#0284c7', '#0369a1']
                      }
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.submitRepairGradient}
                    >
                      <View style={styles.submitBtnInner}>
                        <AppIcon
                          name={progressPercentage === 100 ? 'check' : 'checklist'}
                          size={18}
                          color="#ffffff"
                        />
                        <ThemedText style={styles.submitBtnTextPrimary}>
                          {progressPercentage === 100 ? 'Submit for Verification' : 'Save Progress'}
                        </ThemedText>
                      </View>
                    </LinearGradient>
                  </Pressable>
                  <ThemedText style={[styles.submitDisclaimer, { color: colors.textSecondary }]}>
                    {progressPercentage === 100
                      ? 'Notifies administrator for review & sign-off.'
                      : 'Synchronizes updates to desktop dashboard.'}
                  </ThemedText>
                </View>
              </ScrollView>
            </View>
          ) : (
            <View style={{ flex: 1, padding: 32, alignItems: 'center', justifyContent: 'center' }}>
              {loading ? (
                <>
                  <ActivityIndicator size="large" color="#059669" />
                  <ThemedText style={{ marginTop: 14, fontSize: 14, color: colors.textSecondary }}>
                    Loading maintenance report...
                  </ThemedText>
                </>
              ) : (
                <View
                  style={[
                    styles.emptyState,
                    {
                      backgroundColor: effectiveTheme === 'dark' ? '#151e32' : '#ffffff',
                      borderColor: effectiveTheme === 'dark' ? '#334155' : '#e2e8f0',
                      width: '100%',
                      maxWidth: 340,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.emptyIconCircle,
                      {
                        backgroundColor: effectiveTheme === 'dark' ? 'rgba(16, 185, 129, 0.15)' : '#ecfdf5',
                      },
                    ]}
                  >
                    <Image source={{ uri: ICON_SEARCH }} style={{ width: 24, height: 24, tintColor: colors.emerald }} contentFit="contain" />
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
                        backgroundColor: effectiveTheme === 'dark' ? '#064e3b' : '#f0fdf4',
                        borderColor: effectiveTheme === 'dark' ? '#059669' : '#bbf7d0',
                        width: '100%',
                        justifyContent: 'center',
                      },
                    ]}
                  >
                    <ThemedText
                      style={[
                        styles.viewButtonText,
                        { color: effectiveTheme === 'dark' ? '#34d399' : '#065f46' },
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
        {/* REWORK PAGE (Dedicated Full Page for Quality Control & Rework)             */}
        {/* ========================================================================= */}
        {currentScreen === 'REWORK' && activeReport && (
          <View style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
              {/* Top Back Navigation & Report ID Header */}
              <View style={styles.detailsTopBar}>
                <Pressable onPress={() => setCurrentScreen('DETAILS')} style={styles.backButton}>
                  <ThemedText style={[styles.backButtonIcon, { color: colors.emerald }]}>‹</ThemedText>
                  <ThemedText style={[styles.backButtonText, { color: colors.emerald }]}>Back to Checklist</ThemedText>
                </Pressable>

                <View style={[styles.reportPillLarge, { backgroundColor: isDark ? 'rgba(245, 158, 11, 0.2)' : '#fef3c7' }]}>
                  <ThemedText style={[styles.reportPillLargeText, { color: isDark ? '#fbbf24' : '#b45309' }]} numberOfLines={1}>
                    {activeReport.id}
                  </ThemedText>
                </View>
              </View>

              {/* Screen Title Block */}
              <View style={styles.detailsHeaderBlock}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <AppIcon name="refresh" size={16} color={isDark ? '#fbbf24' : '#b45309'} />
                  <ThemedText style={{ fontSize: 12, fontWeight: '900', color: isDark ? '#fbbf24' : '#b45309', letterSpacing: 0.8, textTransform: 'uppercase' }}>
                    QUALITY CONTROL & REWORK
                  </ThemedText>
                </View>
                <ThemedText style={[styles.detailsMainTitle, { color: colors.text }]}>Maintenance Rework</ThemedText>
                <ThemedText style={[styles.detailsMainSubtitle, { color: colors.textSecondary }]}>
                  {activeReport.airconName || activeReport.airconId} — {activeReport.location}
                </ThemedText>
              </View>

              {/* Supervisor Scope & Instructions Box */}
              <View style={[styles.pageInstructionCard, { backgroundColor: isDark ? 'rgba(245, 158, 11, 0.12)' : '#fffbeb', borderColor: isDark ? 'rgba(245, 158, 11, 0.45)' : '#fde68a' }]}>
                <ThemedText style={[styles.pageInstructionLabel, { color: isDark ? '#fbbf24' : '#b45309' }]}>
                  SUPERVISOR REWORK INSTRUCTIONS *
                </ThemedText>
                <ThemedText style={[styles.pageInstructionText, { color: isDark ? '#fef3c7' : '#78350f' }]}>
                  "{activeReport.reworkInstructions || 'Checklist items require rework and re-inspection. Please verify disassembly, part cleaning, and test run.'}"
                </ThemedText>

                <View style={styles.pageMetaGrid}>
                  <View style={styles.pageMetaItem}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <AppIcon name="user" size={12} color={colors.textSecondary} />
                      <ThemedText style={[styles.pageMetaKey, { color: colors.textSecondary }]}>Assigned To:</ThemedText>
                    </View>
                    <ThemedText style={[styles.pageMetaVal, { color: colors.text }]}>{activeReport.assignedWorker}</ThemedText>
                  </View>
                  <View style={styles.pageMetaItem}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <AppIcon name="calendar" size={12} color={colors.textSecondary} />
                      <ThemedText style={[styles.pageMetaKey, { color: colors.textSecondary }]}>Due Date:</ThemedText>
                    </View>
                    <ThemedText style={[styles.pageMetaVal, { color: colors.text }]}>{activeReport.dueDate}</ThemedText>
                  </View>
                  <View style={styles.pageMetaItem}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <AppIcon name="alert-octagon" size={12} color={isDark ? '#fbbf24' : '#d97706'} />
                      <ThemedText style={[styles.pageMetaKey, { color: colors.textSecondary }]}>Priority:</ThemedText>
                    </View>
                    <ThemedText style={[styles.pageMetaVal, { color: isDark ? '#fbbf24' : '#d97706' }]}>{activeReport.priority || 'High'}</ThemedText>
                  </View>
                </View>
              </View>

              {/* Rework Tasks Checklist Section */}
              <View style={styles.checklistSection}>
                <View style={styles.checklistSectionHeader}>
                  <Image source={{ uri: ICON_CHECKLIST }} style={[styles.checklistIcon, { tintColor: isDark ? '#fbbf24' : '#d97706' }]} contentFit="contain" />
                  <ThemedText style={[styles.checklistSectionTitle, { color: colors.text }]}>REWORK TASKS & RE-INSPECTION</ThemedText>
                </View>
                <ThemedText style={[styles.checklistHint, { color: colors.textSecondary }]}>
                  Check each task as you complete rework. Tap any item to add photo proof or updated remarks.
                </ThemedText>

                <View style={styles.checklistItemsList}>
                  {activeReport.items.map((item, index) => {
                    const statusStyle = getStatusColor(item.status);
                    const isDone = item.status === 'Completed';

                    return (
                      <View
                        key={item.id}
                        style={[
                          styles.checklistItemCard,
                          {
                            backgroundColor: isDark ? '#151e32' : '#ffffff',
                            borderColor: isDone ? '#10b981' : (isDark ? '#334155' : '#e2e8f0'),
                          },
                        ]}
                      >
                        <Pressable onPress={() => handleOpenItemEditor(item, activeReport.id)} style={styles.checklistItemMain}>
                          <Pressable
                            onPress={() => handleToggleTaskCheck(item.id, activeReport.id)}
                            style={[
                              styles.interactiveCheckBtn,
                              {
                                backgroundColor: isDone ? '#10b981' : (isDark ? '#0f172a' : '#f1f5f9'),
                                borderColor: isDone ? '#10b981' : (isDark ? '#334155' : '#cbd5e1'),
                              },
                            ]}
                          >
                            {isDone ? (
                              <ThemedText style={{ color: '#ffffff', fontWeight: '900', fontSize: 13 }}>✓</ThemedText>
                            ) : (
                              <ThemedText style={{ color: colors.textSecondary, fontWeight: '800', fontSize: 11 }}>{index + 1}</ThemedText>
                            )}
                          </Pressable>

                          <View style={styles.itemTextContainer}>
                            <ThemedText
                              style={[
                                styles.itemTitle,
                                { color: colors.text, textDecorationLine: isDone ? 'line-through' : 'none' },
                              ]}
                            >
                              {item.title}
                            </ThemedText>
                            <ThemedText style={[styles.itemDescription, { color: colors.textSecondary }]} numberOfLines={2}>
                              {item.description}
                            </ThemedText>

                            {item.remarks && (
                              <View style={[
                                styles.remarksSnippet,
                                {
                                  backgroundColor: isDark ? 'rgba(15, 23, 42, 0.85)' : '#f8fafc',
                                  borderLeftColor: isDark ? '#fbbf24' : '#f59e0b',
                                  borderColor: isDark ? '#334155' : '#e2e8f0',
                                  borderWidth: isDark ? 1 : 0,
                                  borderLeftWidth: 3,
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  gap: 6,
                                }
                              ]}>
                                <AppIcon name="chat" size={12} color={isDark ? '#fbbf24' : '#d97706'} />
                                <ThemedText style={[styles.remarksSnippetText, { color: isDark ? '#e2e8f0' : '#334155', flex: 1 }]} numberOfLines={1}>
                                  {item.remarks}
                                </ThemedText>
                              </View>
                            )}

                            {((item.photoUris && item.photoUris.length > 0) || item.photoUri) && (
                              <View style={[
                                styles.photoAttachedBadge,
                                {
                                  backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : '#e0f2fe',
                                  borderWidth: isDark ? 1 : 0,
                                  borderColor: isDark ? 'rgba(56, 189, 248, 0.35)' : 'transparent',
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  gap: 4,
                                }
                              ]}>
                                <AppIcon name="camera" size={11} color={isDark ? '#38bdf8' : '#0369a1'} />
                                <ThemedText style={[styles.photoAttachedText, { color: isDark ? '#38bdf8' : '#0369a1' }]}>
                                  {(item.photoUris && item.photoUris.length > 1)
                                    ? `${item.photoUris.length} Photos`
                                    : 'Photo attached'}
                                </ThemedText>
                              </View>
                            )}
                          </View>
                        </Pressable>

                        {/* Output Only Status Badge */}
                        <View style={styles.dropdownBtnContainer}>
                          <View
                            style={[
                              styles.checklistStatusBadge,
                              { backgroundColor: statusStyle.bg, borderColor: statusStyle.border },
                            ]}
                          >
                            <View style={[styles.statusDot, { backgroundColor: statusStyle.text }]} />
                            <ThemedText style={[styles.checklistStatusBadgeText, { color: statusStyle.text }]}>
                              {item.status}
                            </ThemedText>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* Submit Completed Rework Button */}
              <View style={styles.submitSection}>
                <Pressable
                  onPress={() => handleSubmitForVerification(activeReport.id)}
                  style={({ pressed }) => [
                    styles.submitRepairBtn,
                    pressed && { opacity: 0.88, transform: [{ scale: 0.985 }] },
                  ]}
                  disabled={isSubmitting}
                >
                  <LinearGradient
                    colors={['#f59e0b', '#d97706']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.submitRepairGradient}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <View style={styles.submitBtnInner}>
                        <AppIcon name="check" size={18} color="#ffffff" />
                        <ThemedText style={styles.submitBtnTextPrimary}>
                          Submit Rework
                        </ThemedText>
                      </View>
                    )}
                  </LinearGradient>
                </Pressable>
                <ThemedText style={[styles.submitDisclaimer, { color: colors.textSecondary }]}>
                  Notifies administrator for sign-off.
                </ThemedText>
              </View>
            </ScrollView>
          </View>
        )}

        {/* ========================================================================= */}
        {/* REPAIR PAGE (Dedicated Full Page for Corrective Repair Order)              */}
        {/* ========================================================================= */}
        {currentScreen === 'REPAIR' && activeReport && (() => {
          const explicitRepairReport = activeRepairId
            ? reports.find((r) => r.id.toLowerCase() === activeRepairId.toLowerCase())
            : null;

          const defaultInfo = getDispatchedRepairInfo(activeReport);
          const hasDispatchedRepair = Boolean(activeRepairId || defaultInfo.hasDispatchedRepair);
          const repairId = activeRepairId || defaultInfo.repairId;
          const targetRepair = explicitRepairReport || defaultInfo.linkedRepairReport || activeReport;

          if (!hasDispatchedRepair || !repairId) {
            return (
              <View style={{ flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' }}>
                <View style={[styles.emptyState, { backgroundColor: isDark ? '#151e32' : '#ffffff', borderColor: isDark ? '#334155' : '#e2e8f0', width: '100%', maxWidth: 360 }]}>
                  <View style={[styles.emptyIconCircle, { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#fee2e2' }]}>
                    <AppIcon name="gear" size={28} color={isDark ? '#f87171' : '#dc2626'} />
                  </View>
                  <ThemedText style={[styles.emptyTitle, { color: colors.text, textAlign: 'center' }]}>
                    No Dispatched Repair Task
                  </ThemedText>
                  <ThemedText style={[styles.emptyStateText, { color: colors.textSecondary, textAlign: 'center', marginBottom: 20 }]}>
                    The administrator or supervisor has not yet created or dispatched a corrective repair task for this report.
                  </ThemedText>
                  <Pressable
                    onPress={() => {
                      setActiveRepairId(null);
                      setCurrentScreen('DETAILS');
                    }}
                    style={[styles.emptyActionBtn, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', borderColor: isDark ? '#334155' : '#cbd5e1' }]}
                  >
                    <ThemedText style={[styles.emptyActionBtnText, { color: colors.emerald }]}>
                      Back to Checklist
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
            );
          }

          const linkedRepairReport = explicitRepairReport || defaultInfo.linkedRepairReport;
          const repairItems = targetRepair.items || [];
          const isRepairVerified = Boolean(
            targetRepair.isRepaired ||
            targetRepair.isVerified ||
            (targetRepair.status === 'Completed' && (repairItems.length === 0 || repairItems.every((i) => i.status === 'Completed' || i.repaired || i.isRepaired))) ||
            targetRepair.timeline?.some((tl: any) => typeof tl?.title === 'string' && tl.title.toLowerCase().includes('verified and approved by admin'))
          );

          return (
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
                            : (isDark ? '#fda4af' : '#be123c'),
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {isRepairVerified ? `✓ #${repairId} VERIFIED` : `#${repairId}`}
                    </ThemedText>
                  </View>
                </View>

                {/* Screen Title Block */}
                <View style={styles.detailsHeaderBlock}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <AppIcon
                      name={isRepairVerified ? 'check' : 'gear'}
                      size={16}
                      color={isRepairVerified ? (isDark ? '#34d399' : '#059669') : (isDark ? '#fb7185' : '#e11d48')}
                    />
                    <ThemedText
                      style={{
                        fontSize: 12,
                        fontWeight: '900',
                        color: isRepairVerified
                          ? (isDark ? '#34d399' : '#059669')
                          : (isDark ? '#fb7185' : '#e11d48'),
                        letterSpacing: 0.8,
                        textTransform: 'uppercase',
                      }}
                    >
                      {isRepairVerified ? 'CORRECTIVE REPAIR VERIFIED & APPROVED BY ADMIN' : 'CORRECTIVE REPAIR DISPATCH'}
                    </ThemedText>
                  </View>
                  <ThemedText style={[styles.detailsMainTitle, { color: colors.text }]}>Repair Order #{repairId}</ThemedText>
                  <ThemedText style={[styles.detailsMainSubtitle, { color: colors.textSecondary }]}>
                    {targetRepair.airconName || targetRepair.airconId || activeReport.airconName || activeReport.airconId} — {targetRepair.location || activeReport.location}
                  </ThemedText>
                </View>

                {/* Supervisor Scope & Instructions Box */}
                <View
                  style={[
                    styles.pageInstructionCard,
                    {
                      backgroundColor: isRepairVerified
                        ? (isDark ? 'rgba(16, 185, 129, 0.12)' : '#ecfdf5')
                        : (isDark ? 'rgba(244, 63, 94, 0.12)' : '#fff1f2'),
                      borderColor: isRepairVerified
                        ? (isDark ? 'rgba(16, 185, 129, 0.45)' : '#a7f3d0')
                        : (isDark ? 'rgba(244, 63, 94, 0.45)' : '#fecdd3'),
                    },
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.pageInstructionLabel,
                      {
                        color: isRepairVerified
                          ? (isDark ? '#34d399' : '#059669')
                          : (isDark ? '#fb7185' : '#e11d48'),
                      },
                    ]}
                  >
                    {isRepairVerified ? '✓ SCOPE OF WORK & REPAIR APPROVED BY ADMIN' : 'SCOPE OF WORK & REPAIR INSTRUCTIONS *'}
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.pageInstructionText,
                      {
                        color: isRepairVerified
                          ? (isDark ? '#d1fae5' : '#065f46')
                          : (isDark ? '#fecdd3' : '#9f1239'),
                      },
                    ]}
                  >
                    {isRepairVerified
                      ? `"Corrective repair #${repairId} was verified and approved by the Facility Administrator. Component defect resolved and operational safety restored."`
                      : `"${targetRepair.description || 'Diagnose and repair component defect. Inspect parts, calibrate telemetry sensors, and validate operational safety.'}"`}
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
                          name={isRepairVerified ? 'check' : 'alert-octagon'}
                          size={12}
                          color={isRepairVerified ? (isDark ? '#34d399' : '#059669') : (isDark ? '#fb7185' : '#e11d48')}
                        />
                        <ThemedText style={[styles.pageMetaKey, { color: colors.textSecondary }]}>
                          {isRepairVerified ? 'Status:' : 'Priority:'}
                        </ThemedText>
                      </View>
                      <ThemedText
                        style={[
                          styles.pageMetaVal,
                          {
                            color: isRepairVerified
                              ? (isDark ? '#34d399' : '#059669')
                              : (isDark ? '#fb7185' : '#e11d48'),
                            fontWeight: '900',
                          },
                        ]}
                      >
                        {isRepairVerified ? 'Repaired Already' : (targetRepair.priority || activeReport.priority || 'Critical')}
                      </ThemedText>
                    </View>
                  </View>
                </View>

                {/* Repair Tasks Checklist Section */}
                <View style={styles.checklistSection}>
                  <View style={styles.checklistSectionHeader}>
                    <Image
                      source={{ uri: ICON_CHECKLIST }}
                      style={[
                        styles.checklistIcon,
                        { tintColor: isRepairVerified ? (isDark ? '#34d399' : '#059669') : (isDark ? '#fb7185' : '#e11d48') },
                      ]}
                      contentFit="contain"
                    />
                    <ThemedText style={[styles.checklistSectionTitle, { color: colors.text }]}>
                      {isRepairVerified ? 'VERIFIED REPAIR ACTION STEPS' : 'REPAIR ACTION STEPS & TELEMETRY'}
                    </ThemedText>
                  </View>
                  <ThemedText style={[styles.checklistHint, { color: colors.textSecondary }]}>
                    {isRepairVerified
                      ? 'All corrective repair tasks were verified and completed.'
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
                              backgroundColor: isDark ? '#151e32' : '#ffffff',
                              borderColor: isDone ? '#10b981' : (isDark ? '#334155' : '#e2e8f0'),
                            },
                          ]}
                        >
                          <Pressable onPress={() => handleOpenItemEditor(item, targetRepair.id)} style={styles.checklistItemMain}>
                            <Pressable
                              onPress={() => handleToggleTaskCheck(item.id, targetRepair.id)}
                              style={[
                                styles.interactiveCheckBtn,
                                {
                                  backgroundColor: isDone ? '#10b981' : (isDark ? '#0f172a' : '#f1f5f9'),
                                  borderColor: isDone ? '#10b981' : (isDark ? '#334155' : '#cbd5e1'),
                                },
                              ]}
                            >
                              {isDone ? (
                                <ThemedText style={{ color: '#ffffff', fontWeight: '900', fontSize: 13 }}>✓</ThemedText>
                              ) : (
                                <ThemedText style={{ color: colors.textSecondary, fontWeight: '800', fontSize: 11 }}>{index + 1}</ThemedText>
                              )}
                            </Pressable>

                            <View style={styles.itemTextContainer}>
                              <ThemedText
                                style={[
                                  styles.itemTitle,
                                  { color: isDone ? (isDark ? '#34d399' : '#059669') : colors.text, textDecorationLine: isDone ? 'line-through' : 'none' },
                                ]}
                              >
                                {item.title}
                              </ThemedText>
                              <ThemedText style={[styles.itemDescription, { color: colors.textSecondary }]} numberOfLines={2}>
                                {item.description}
                              </ThemedText>

                              {item.remarks && (
                                <View style={[
                                  styles.remarksSnippet,
                                  {
                                    backgroundColor: isDark ? 'rgba(15, 23, 42, 0.85)' : '#f8fafc',
                                    borderLeftColor: isDone ? (isDark ? '#34d399' : '#10b981') : (isDark ? '#fb7185' : '#e11d48'),
                                    borderColor: isDark ? '#334155' : '#e2e8f0',
                                    borderWidth: isDark ? 1 : 0,
                                    borderLeftWidth: 3,
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 6,
                                  }
                                ]}>
                                  <AppIcon name="chat" size={12} color={isDark ? '#94a3b8' : '#64748b'} />
                                  <ThemedText style={[styles.remarksSnippetText, { color: isDark ? '#e2e8f0' : '#334155', flex: 1 }]} numberOfLines={1}>
                                    {item.remarks}
                                  </ThemedText>
                                </View>
                              )}

                              {((item.photoUris && item.photoUris.length > 0) || item.photoUri) && (
                                <View style={[
                                  styles.photoAttachedBadge,
                                  {
                                    backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : '#e0f2fe',
                                    borderWidth: isDark ? 1 : 0,
                                    borderColor: isDark ? 'rgba(56, 189, 248, 0.35)' : 'transparent',
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 4,
                                  }
                                ]}>
                                  <AppIcon name="camera" size={11} color={isDark ? '#38bdf8' : '#0369a1'} />
                                  <ThemedText style={[styles.photoAttachedText, { color: isDark ? '#38bdf8' : '#0369a1' }]}>
                                    {(item.photoUris && item.photoUris.length > 1)
                                      ? `${item.photoUris.length} Photos`
                                      : 'Photo attached'}
                                  </ThemedText>
                                </View>
                              )}
                            </View>
                          </Pressable>

                          {/* Output Only Status Badge */}
                          <View style={styles.dropdownBtnContainer}>
                            <View
                              style={[
                                styles.checklistStatusBadge,
                                isDone
                                  ? {
                                      backgroundColor: isDark ? 'rgba(16, 185, 129, 0.16)' : '#ecfdf5',
                                      borderColor: isDark ? 'rgba(16, 185, 129, 0.45)' : '#a7f3d0',
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
                                {isDone ? 'Repaired' : item.status}
                              </ThemedText>
                            </View>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>

                {/* Submit Completed Repair Button or Verified Confirmation */}
                <View style={styles.submitSection}>
                  {isRepairVerified ? (
                    <View
                      style={[
                        styles.verifiedRepairBox,
                        {
                          backgroundColor: isDark ? 'rgba(16, 185, 129, 0.16)' : '#ecfdf5',
                          borderColor: isDark ? 'rgba(16, 185, 129, 0.45)' : '#a7f3d0',
                        },
                      ]}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
                        <ThemedText style={{ fontSize: 22 }}>✓</ThemedText>
                        <ThemedText style={[styles.verifiedRepairBoxTitle, { color: isDark ? '#34d399' : '#047857' }]}>
                          Repaired Already — Verified by Admin
                        </ThemedText>
                      </View>
                      <ThemedText style={[styles.verifiedRepairBoxSubtitle, { color: isDark ? '#a7f3d0' : '#065f46' }]}>
                        This corrective repair order was inspected, verified, and officially signed off by the Facility Administrator.
                      </ThemedText>
                    </View>
                  ) : (
                    <>
                      <Pressable
                        onPress={() => handleSubmitForVerification(targetRepair.id)}
                        style={({ pressed }) => [
                          styles.submitRepairBtn,
                          pressed && { opacity: 0.88, transform: [{ scale: 0.985 }] },
                        ]}
                        disabled={isSubmitting}
                      >
                        <LinearGradient
                          colors={['#f43f5e', '#e11d48']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.submitRepairGradient}
                        >
                          {isSubmitting ? (
                            <ActivityIndicator color="#ffffff" size="small" />
                          ) : (
                            <View style={styles.submitBtnInner}>
                              <AppIcon name="check" size={18} color="#ffffff" />
                              <ThemedText style={styles.submitBtnTextPrimary}>
                                Submit Repair
                              </ThemedText>
                            </View>
                          )}
                        </LinearGradient>
                      </Pressable>
                      <ThemedText style={[styles.submitDisclaimer, { color: colors.textSecondary }]}>
                        Notifies administrator for sign-off.
                      </ThemedText>
                    </>
                  )}
                </View>
              </ScrollView>
            </View>
          );
        })()}

        {/* ========================================================================= */}
        {/* SCREEN 6: SUCCESSFUL SUBMISSION SCREEN                                     */}
        {/* ========================================================================= */}
        {currentScreen === 'SUCCESS' && (
          activeReport ? (
            <ScrollView contentContainerStyle={styles.successScreenContent} showsVerticalScrollIndicator={false}>
              <View style={[styles.successCard, { backgroundColor: isDark ? '#151e32' : '#ffffff', borderColor: isDark ? '#334155' : '#a7f3d0' }]}>
                {/* Success Icon Badge */}
                <View style={[styles.successIconCircle, { backgroundColor: isDark ? (activeReport.status === 'For Verification' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(16, 185, 129, 0.2)') : (activeReport.status === 'For Verification' ? '#f3e8ff' : '#d1fae5') }]}>
                  <AppIcon
                    name={activeReport.status === 'For Verification' ? 'shield' : 'check'}
                    size={24}
                    color={isDark ? (activeReport.status === 'For Verification' ? '#c084fc' : '#34d399') : (activeReport.status === 'For Verification' ? '#9333ea' : '#059669')}
                  />
                </View>

                <ThemedText style={[styles.successTitle, { color: colors.text }]}>
                  {activeReport.status === 'For Verification'
                    ? 'Submitted for Admin Verification'
                    : 'Maintenance Update Submitted'}
                </ThemedText>
                <ThemedText style={[styles.successMessage, { color: colors.textSecondary }]}>
                  {activeReport.status === 'For Verification'
                    ? 'All maintenance tasks are complete! Your report has been submitted to the Facility Administrator for final verification and approval.'
                    : 'Your maintenance report has been successfully updated and synchronized with the EcoTrack desktop dashboard.'}
                </ThemedText>

                <View style={[styles.successDivider, { backgroundColor: isDark ? '#1e293b' : '#e2e8f0' }]} />

                {/* Submitted Details Box */}
                <View style={[styles.successDetailsBox, { backgroundColor: isDark ? '#0f172a' : '#f8fafc' }]}>
                  <View style={styles.successDetailRow}>
                    <ThemedText style={[styles.successDetailKey, { color: colors.textSecondary }]}>Report ID:</ThemedText>
                    <ThemedText style={[styles.successDetailValBold, { color: colors.text }]}>{activeReport.id}</ThemedText>
                  </View>
                  <View style={styles.successDetailRow}>
                    <ThemedText style={[styles.successDetailKey, { color: colors.textSecondary }]}>Aircon Unit:</ThemedText>
                    <ThemedText style={[styles.successDetailVal, { color: colors.text }]}>
                      {activeReport.airconId} — {activeReport.location}
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
                      color={isDark ? '#c084fc' : (activeReport.status === 'For Verification' ? '#7e22ce' : '#047857')}
                    />
                    <ThemedText style={[styles.syncConfirmedText, { color: isDark ? '#c084fc' : (activeReport.status === 'For Verification' ? '#7e22ce' : '#047857') }]}>
                      {activeReport.status === 'For Verification'
                        ? 'Sent to Desktop Admin for Verification'
                        : 'Live sync sent to Desktop Admin'}
                    </ThemedText>
                  </View>
                </View>

                {/* Back to Checklist or Maintenance Dashboard Button */}
                <View style={{ gap: 10, width: '100%' }}>
                  {activeReport.parentReportId && (
                    <Pressable
                      onPress={() => {
                        setSelectedReportId(activeReport.parentReportId!);
                        setActiveRepairId(null);
                        setCurrentScreen('DETAILS');
                      }}
                      style={[styles.successBackButton, { backgroundColor: isDark ? '#10b981' : '#059669' }]}
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
                        ? { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', borderWidth: 1, borderColor: isDark ? '#334155' : '#e2e8f0' }
                        : { backgroundColor: isDark ? '#10b981' : '#0b291d' }
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
                    backgroundColor: effectiveTheme === 'dark' ? '#151e32' : '#ffffff',
                    borderColor: effectiveTheme === 'dark' ? '#334155' : '#e2e8f0',
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
                      backgroundColor: effectiveTheme === 'dark' ? '#064e3b' : '#f0fdf4',
                      borderColor: effectiveTheme === 'dark' ? '#059669' : '#bbf7d0',
                      width: '100%',
                      justifyContent: 'center',
                    },
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.viewButtonText,
                      { color: effectiveTheme === 'dark' ? '#34d399' : '#065f46' },
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
            <View style={[styles.expandedModalContent, { backgroundColor: isDark ? '#151e32' : '#ffffff', borderColor: isDark ? 'rgba(16, 185, 129, 0.35)' : '#e2e8f0' }]}>
              <View style={[styles.modalHeader, { borderBottomColor: isDark ? '#1e293b' : '#f1f5f9' }]}>
                <View style={{ flex: 1 }}>
                  <ThemedText style={[styles.modalCategoryLabel, { color: isDark ? '#34d399' : '#059669' }]}>MAINTENANCE CHECKLIST ITEM</ThemedText>
                  <ThemedText style={[styles.modalItemTitle, { color: colors.text }]}>{expandedItem?.title}</ThemedText>
                </View>
                <Pressable onPress={() => setItemModalVisible(false)} style={[styles.modalCloseBtn, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9' }]}>
                  <ThemedText style={[styles.modalCloseText, { color: isDark ? '#94a3b8' : '#64748b' }]}>✕</ThemedText>
                </Pressable>
              </View>

              <ScrollView style={{ maxHeight: SCREEN_HEIGHT * 0.65 }} showsVerticalScrollIndicator={false}>
                {/* Active Dispatched Repair Order Notice inside Modal */}
                {expandedItem?.linkedRepairId && (
                  <View style={[styles.modalRepairBanner, { backgroundColor: isDark ? 'rgba(56, 189, 248, 0.12)' : '#f0f9ff', borderColor: isDark ? 'rgba(56, 189, 248, 0.4)' : '#bae6fd' }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                      <AppIcon name="gear" size={13} color={isDark ? '#38bdf8' : '#0284c7'} />
                      <ThemedText style={{ fontSize: 12, fontWeight: '700', color: isDark ? '#38bdf8' : '#0284c7' }}>
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
                      <ThemedText style={{ fontSize: 11, fontWeight: '800', color: '#ffffff' }}>Open Repair Page →</ThemedText>
                    </Pressable>
                  </View>
                )}

                {/* Status Selector Chips */}
                <View style={styles.modalFieldBlock}>
                  <ThemedText style={[styles.modalFieldLabel, { color: colors.text }]}>Status:</ThemedText>
                  <View style={styles.statusSelectGrid}>
                    {(isCurrentRepair ? REPAIR_CHECKLIST_STATUSES : STANDARD_CHECKLIST_STATUSES).map((st) => {
                      const isSelected = itemStatus === st || (st === 'Needs Repair' && (itemStatus === 'Under Repair' || Boolean(expandedItem?.linkedRepairId)));
                      const stStyle = getStatusColor(st);
                      return (
                        <Pressable
                          key={st}
                          onPress={() => setItemStatus(st)}
                          style={[
                            styles.statusSelectOption,
                            {
                              backgroundColor: isSelected ? stStyle.bg : isDark ? '#0f172a' : '#f8fafc',
                              borderColor: isSelected ? stStyle.text : isDark ? '#334155' : '#e2e8f0',
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
                                { color: isSelected ? stStyle.text : isDark ? '#94a3b8' : '#475569' },
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
                  <View style={[styles.needsRepairAlertBlock, { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#fee2e2', borderColor: isDark ? 'rgba(239, 68, 68, 0.4)' : '#fca5a5' }]}>
                    <ThemedText style={[styles.needsRepairLabel, { color: isDark ? '#fca5a5' : '#b91c1c' }]}>Describe the Problem (Required):</ThemedText>
                    <ThemedText style={[styles.needsRepairSubLabel, { color: isDark ? '#f87171' : '#7f1d1d' }]}>
                      Describe defect, unstable readings, or component replacement details for desktop admin.
                    </ThemedText>
                    <TextInput
                      style={[styles.needsRepairInput, { backgroundColor: isDark ? '#0f172a' : '#ffffff', color: isDark ? '#fca5a5' : '#b91c1c', borderColor: isDark ? 'rgba(239, 68, 68, 0.45)' : '#fca5a5' }]}
                      placeholder="e.g. Temperature sensor is giving inconsistent readings and may require replacement."
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
                    style={[styles.remarksInput, { backgroundColor: isDark ? '#0f172a' : '#f8fafc', borderColor: isDark ? '#334155' : '#e2e8f0', color: colors.text }]}
                    placeholder="e.g. Temperature sensor inspected and readings are within normal range."
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
                        <View style={[styles.photoCountPill, { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.2)' : '#ecfdf5', borderColor: isDark ? '#10b981' : '#a7f3d0' }]}>
                          <ThemedText style={[styles.photoCountPillText, { color: isDark ? '#34d399' : '#059669' }]}>
                            {itemPhotoUris.length} {itemPhotoUris.length === 1 ? 'image' : 'images'}
                          </ThemedText>
                        </View>
                      )}
                    </View>
                    {itemPhotoUris.length > 0 && (
                      <Pressable onPress={handleClearAllPhotos} hitSlop={8}>
                        <ThemedText style={[styles.photoClearAllText, { color: isDark ? '#f87171' : '#dc2626' }]}>
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
                          <View key={`photo_${idx}_${uri.slice(-10)}`} style={[styles.photoThumbnailCard, { borderColor: isDark ? '#334155' : '#e2e8f0', backgroundColor: isDark ? '#0f172a' : '#f8fafc' }]}>
                            <Image source={{ uri }} style={styles.photoThumbnailImage} contentFit="cover" />
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
                              borderColor: isDark ? 'rgba(16, 185, 129, 0.5)' : '#10b981',
                              backgroundColor: isDark ? 'rgba(16, 185, 129, 0.08)' : '#f0fdf4',
                            },
                          ]}
                        >
                          <View style={[styles.photoAddMoreIconCircle, { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.2)' : '#dcfce7' }]}>
                            <ThemedText style={[styles.photoAddMorePlusText, { color: '#10b981' }]}>+</ThemedText>
                          </View>
                          <ThemedText style={[styles.photoAddMoreTileText, { color: isDark ? '#34d399' : '#059669' }]}>
                            Add More
                          </ThemedText>
                        </Pressable>
                      </ScrollView>

                      {/* Action Buttons Below Gallery */}
                      <View style={styles.photoActionBar}>
                        <Pressable
                          onPress={handlePickPhotos}
                          style={[styles.photoActionSecondaryBtn, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', borderColor: isDark ? '#334155' : '#cbd5e1' }]}
                        >
                          <Image source={{ uri: ICON_CAMERA }} style={{ width: 14, height: 14, tintColor: colors.text }} contentFit="contain" />
                          <ThemedText style={[styles.photoActionBtnText, { color: colors.text }]}>Choose More</ThemedText>
                        </Pressable>
                        <Pressable
                          onPress={handleTakePhoto}
                          style={[styles.photoActionSecondaryBtn, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', borderColor: isDark ? '#334155' : '#cbd5e1' }]}
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
                          style={[styles.photoPickerBtnPrimary, { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.12)' : '#f0fdf4', borderColor: '#10b981' }]}
                        >
                          <Image source={{ uri: ICON_CAMERA }} style={[styles.cameraIcon, { tintColor: '#10b981' }]} contentFit="contain" />
                          <View style={{ alignItems: 'flex-start' }}>
                            <ThemedText style={[styles.photoPickerBtnText, { color: '#10b981' }]}>Select Photos</ThemedText>
                            <ThemedText style={[styles.photoPickerSubText, { color: isDark ? '#6ee7b7' : '#047857' }]}>Multiple allowed</ThemedText>
                          </View>
                        </Pressable>
                        <Pressable
                          onPress={handleTakePhoto}
                          style={[styles.photoPickerBtnCamera, { backgroundColor: isDark ? '#1e293b' : '#f8fafc', borderColor: isDark ? '#334155' : '#cbd5e1' }]}
                        >
                          <AppIcon name="camera" size={18} color={isDark ? '#cbd5e1' : '#475569'} />
                          <ThemedText style={[styles.photoCameraBtnText, { color: isDark ? '#cbd5e1' : '#475569' }]}>Camera</ThemedText>
                        </Pressable>
                      </View>
                      <ThemedText style={[styles.photoHelpNotice, { color: colors.textSecondary }]}>
                        You can select multiple photos from your library or capture them using the camera.
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
                }} style={[styles.modalCancelBtn, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9' }]}>
                  <ThemedText style={[styles.modalCancelBtnText, { color: isDark ? '#94a3b8' : '#64748b' }]}>Cancel</ThemedText>
                </Pressable>
                <Pressable onPress={handleSaveItemUpdate} style={[styles.modalSaveBtn, isSubmitting && { opacity: 0.65 }]} disabled={isSubmitting}>
                  {isSubmitting ? (
                    <ActivityIndicator color="#ffffff" size="small" />
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
        <Modal visible={dropdownVisible} animationType="fade" transparent>
          <Pressable onPress={() => setDropdownVisible(false)} style={styles.modalOverlay}>
            <View style={[styles.dropdownModalContent, { backgroundColor: isDark ? '#151e32' : '#ffffff', borderWidth: isDark ? 1.5 : 0, borderColor: isDark ? 'rgba(16, 185, 129, 0.35)' : 'transparent' }]}>
              <ThemedText style={[styles.dropdownModalTitle, { color: colors.text }]}>Select Item Status</ThemedText>
              <ThemedText style={[styles.dropdownModalSubTitle, { color: colors.textSecondary }]}>{dropdownItem?.title}</ThemedText>

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
            </View>
          </Pressable>
        </Modal>

        {/* ========================================================================= */}
        {/* SCREEN 5: SUBMIT CONFIRMATION DIALOG (Theme Adaptive)                      */}
        {/* ========================================================================= */}
        <Modal visible={confirmModalVisible} animationType="fade" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.confirmModalContent, { backgroundColor: isDark ? '#151e32' : '#ffffff', borderWidth: isDark ? 1.5 : 0, borderColor: isDark ? 'rgba(16, 185, 129, 0.35)' : 'transparent' }]}>
              <View style={[styles.confirmIconCircle, { backgroundColor: isDark ? (completedItems === totalItems ? 'rgba(168, 85, 247, 0.2)' : 'rgba(16, 185, 129, 0.2)') : (completedItems === totalItems ? '#f3e8ff' : '#d1fae5') }]}>
                <AppIcon
                  name={completedItems === totalItems ? 'shield' : 'checklist'}
                  size={26}
                  color={completedItems === totalItems ? (isDark ? '#c084fc' : '#9333ea') : (isDark ? '#34d399' : '#059669')}
                />
              </View>

              <ThemedText style={[styles.confirmTitle, { color: colors.text }]}>
                {completedItems === totalItems ? 'Submit for Admin Verification?' : 'Submit Maintenance Update?'}
              </ThemedText>
              <ThemedText style={[styles.confirmDesc, { color: colors.textSecondary }]}>
                {completedItems === totalItems
                  ? 'All maintenance checklist tasks are complete! This report will be submitted to the Facility Administrator for review and verification.'
                  : 'Your updated maintenance checklist will be sent to the EcoTrack desktop dashboard.'}
              </ThemedText>

              {/* Breakdown Grid */}
              <View style={styles.confirmBreakdownGrid}>
                <View style={[styles.breakdownItem, { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.18)' : '#d1fae5' }]}>
                  <ThemedText style={[styles.breakdownNum, { color: isDark ? '#34d399' : '#059669' }]}>{completedItems}</ThemedText>
                  <ThemedText style={[styles.breakdownLabel, { color: isDark ? '#cbd5e1' : '#334155' }]}>Completed</ThemedText>
                </View>
                <View style={[styles.breakdownItem, { backgroundColor: isDark ? 'rgba(245, 158, 11, 0.18)' : '#fef3c7' }]}>
                  <ThemedText style={[styles.breakdownNum, { color: isDark ? '#fbbf24' : '#d97706' }]}>{inProgressItems}</ThemedText>
                  <ThemedText style={[styles.breakdownLabel, { color: isDark ? '#cbd5e1' : '#334155' }]}>In Progress</ThemedText>
                </View>
                <View style={[styles.breakdownItem, { backgroundColor: isDark ? '#0f172a' : '#f1f5f9' }]}>
                  <ThemedText style={[styles.breakdownNum, { color: isDark ? '#94a3b8' : '#64748b' }]}>{notStartedItems}</ThemedText>
                  <ThemedText style={[styles.breakdownLabel, { color: isDark ? '#cbd5e1' : '#334155' }]}>Not Started</ThemedText>
                </View>
                {!isCurrentRepair && (
                  <View style={[styles.breakdownItem, { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.18)' : '#fee2e2' }]}>
                    <ThemedText style={[styles.breakdownNum, { color: isDark ? '#f87171' : '#dc2626' }]}>{needsRepairItems}</ThemedText>
                    <ThemedText style={[styles.breakdownLabel, { color: isDark ? '#cbd5e1' : '#334155' }]}>Needs Repair</ThemedText>
                  </View>
                )}
              </View>

              {/* Action Buttons */}
              <View style={styles.confirmActionsRow}>
                <Pressable
                  onPress={() => setConfirmModalVisible(false)}
                  style={[styles.confirmCancelBtn, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9' }]}
                  disabled={isSubmitting}
                >
                  <ThemedText style={[styles.confirmCancelBtnText, { color: isDark ? '#94a3b8' : '#64748b' }]}>Cancel</ThemedText>
                </Pressable>
                <Pressable
                  onPress={handleConfirmSubmit}
                  style={[
                    styles.confirmSubmitBtn,
                    completedItems === totalItems && { backgroundColor: '#9333ea' },
                  ]}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="#ffffff" size="small" />
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

        {/* Global Floating Bottom Navbar with Maintenance Tab Active */}
        <FloatingBottomNavbar currentPage="maintenance" />
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
    color: '#064e3b',
    lineHeight: 18,
    fontFamily: 'Roboto',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#059669',
    fontWeight: '700',
    fontFamily: 'Roboto',
  },
  workerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#d1fae5',
    gap: 6,
  },
  workerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
  },
  workerBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#064e3b',
    fontFamily: 'Roboto',
  },

  // Workflow Notice
  workflowNotice: {
    marginHorizontal: Spacing.four,
    marginTop: 4,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
    gap: 10,
  },
  workflowNoticeIcon: {
    fontSize: 20,
  },
  workflowNoticeText: {
    flex: 1,
    fontSize: 11.5,
    color: '#475569',
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
    color: '#064e3b',
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
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    position: 'relative',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
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
    borderColor: '#10b981',
    backgroundColor: '#f0fdf4',
  },
  summaryCardActivePurple: {
    borderColor: '#9333ea',
    backgroundColor: '#faf5ff',
  },
  summaryCardActiveRed: {
    borderColor: '#dc2626',
    backgroundColor: '#fef2f2',
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
    color: '#1e293b',
    fontFamily: 'Roboto',
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    marginTop: 2,
    fontFamily: 'Roboto',
  },

  // Search Bar
  searchBarContainer: {
    marginHorizontal: Spacing.four,
    marginTop: 16,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  searchIcon: {
    width: 18,
    height: 18,
    tintColor: '#9ca3af',
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#1e293b',
    fontFamily: 'Roboto',
    padding: 0,
  },
  searchClearBtn: {
    padding: 4,
  },
  searchClearText: {
    fontSize: 12,
    color: '#9ca3af',
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
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  filterChipActive: {
    backgroundColor: '#0b291d',
    borderColor: '#0b291d',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    fontFamily: 'Roboto',
  },
  filterChipTextActive: {
    color: '#ffffff',
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
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.2,
    borderColor: '#e2e8f0',
    gap: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#10b981',
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
    backgroundColor: '#0b291d',
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
    color: '#10b981',
    letterSpacing: 0.5,
    fontFamily: 'Roboto',
    includeFontPadding: false,
  },
  reportTypeBadge: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 7,
    flexShrink: 1,
  },
  reportTypeBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#047857',
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
    color: '#ffffff',
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  acIconCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#e0f2fe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  acTitleText: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
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
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  airconTypeTagText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#047857',
    fontFamily: 'Roboto',
  },
  locationBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  locationBadgeText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#475569',
    fontFamily: 'Roboto',
  },
  verificationRemarksCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ddd6fe',
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
    color: '#6b21a8',
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
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
    padding: 10,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    marginVertical: 2,
  },
  defectAlertHeader: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#b91c1c',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontFamily: 'Roboto',
  },
  defectAlertContent: {
    fontSize: 12,
    fontWeight: '600',
    color: '#dc2626',
    marginTop: 2,
    fontFamily: 'Roboto',
  },
  assignedTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  assignedTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    fontFamily: 'Roboto',
  },
  detailsVerificationBanner: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ddd6fe',
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
    color: '#6b21a8',
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
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
    padding: 12,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    marginTop: 12,
  },
  detailsDefectTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#b91c1c',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontFamily: 'Roboto',
  },
  detailsDefectText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#dc2626',
    marginTop: 3,
    lineHeight: 18,
    fontFamily: 'Roboto',
  },
  detailsDefectMeta: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ef4444',
    marginTop: 4,
    fontFamily: 'Roboto',
  },
  descriptionCardBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
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
    color: '#059669',
    letterSpacing: 0.6,
    fontFamily: 'Roboto',
  },
  descriptionBoxText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#1e293b',
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
    tintColor: '#64748b',
  },
  dueTagText: {
    fontSize: 11.5,
    color: '#64748b',
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
    color: '#475569',
    fontFamily: 'Roboto',
  },
  cardProgressPct: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#059669',
    fontFamily: 'Roboto',
  },
  progressBarTrack: {
    height: 7,
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  viewButton: {
    backgroundColor: '#0b291d',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 6,
    gap: 6,
  },
  viewButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  viewButtonIcon: {
    width: 14,
    height: 14,
    tintColor: '#10b981',
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
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#d1fae5',
    gap: 4,
  },
  backButtonIcon: {
    fontSize: 18,
    fontWeight: '900',
    color: '#064e3b',
    lineHeight: 18,
  },
  backButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#064e3b',
    fontFamily: 'Roboto',
  },
  reportPillLarge: {
    backgroundColor: '#0b291d',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    flexShrink: 1,
    maxWidth: '52%',
  },
  reportPillLargeText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#10b981',
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
    color: '#0b291d',
    fontFamily: 'Roboto',
  },
  detailsMainSubtitle: {
    fontSize: 13,
    color: '#059669',
    fontWeight: '700',
    fontFamily: 'Roboto',
    marginTop: 2,
  },

  // SCREEN 2: Aircon Information Card
  airconInfoCard: {
    marginHorizontal: Spacing.four,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.2,
    borderColor: '#e2e8f0',
    marginBottom: 14,
  },
  cardSectionHeader: {
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 6,
  },
  cardSectionTitle: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#064e3b',
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
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
    paddingBottom: 6,
  },
  infoKey: {
    fontSize: 12.5,
    color: '#64748b',
    fontWeight: '600',
    fontFamily: 'Roboto',
  },
  infoValue: {
    fontSize: 12.5,
    color: '#1e293b',
    fontWeight: '700',
    fontFamily: 'Roboto',
  },
  scopeScrollBox: {
    flex: 1,
    maxHeight: 88,
    marginLeft: 12,
  },
  scopeScrollView: {
    maxHeight: 88,
  },
  infoValueBold: {
    fontSize: 13,
    color: '#0b291d',
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
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.2,
    borderColor: 'rgba(16, 185, 129, 0.25)',
    marginBottom: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#10b981',
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
    color: '#059669',
    fontFamily: 'Roboto',
  },
  progressCountText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
    marginTop: 2,
    marginBottom: 8,
    fontFamily: 'Roboto',
  },
  largeProgressBarTrack: {
    height: 12,
    backgroundColor: '#e2e8f0',
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
    borderTopColor: '#f1f5f9',
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
    color: '#64748b',
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
    color: '#064e3b',
    letterSpacing: 0.8,
    fontFamily: 'Roboto',
  },
  checklistHint: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 12,
    lineHeight: 15,
    fontFamily: 'Roboto',
  },
  checklistItemsList: {
    gap: 10,
  },
  checklistItemCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#e2e8f0',
    padding: 14,
    gap: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
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
    borderColor: '#fca5a5',
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
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  itemIndexNumber: {
    fontSize: 11,
    fontWeight: '900',
    color: '#475569',
  },
  itemTextContainer: {
    flex: 1,
    gap: 3,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    fontFamily: 'Roboto',
  },
  itemTitleDanger: {
    color: '#dc2626',
  },
  itemDescription: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 16,
    fontFamily: 'Roboto',
  },
  remarksSnippet: {
    backgroundColor: '#f8fafc',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 4,
    borderLeftWidth: 2,
    borderLeftColor: '#10b981',
  },
  remarksSnippetText: {
    fontSize: 11,
    color: '#334155',
    fontFamily: 'Roboto',
  },
  defectSnippet: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 4,
    borderLeftWidth: 3,
    borderLeftColor: '#dc2626',
  },
  defectSnippetText: {
    fontSize: 11,
    color: '#991b1b',
    fontWeight: '700',
    fontFamily: 'Roboto',
  },
  photoAttachedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#e0f2fe',
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
    borderRadius: 8,
    borderWidth: 1,
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
    backgroundColor: '#10b981',
    width: '100%',
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#10b981',
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
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.5,
    fontFamily: 'Roboto',
  },
  submitDisclaimer: {
    fontSize: 12,
    color: '#64748b',
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
        shadowColor: '#000000',
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
    color: '#ffffff',
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
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#a7f3d0',
    ...Platform.select({
      ios: {
        shadowColor: '#10b981',
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
    backgroundColor: '#d1fae5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#10b981',
  },
  successIconText: {
    fontSize: 32,
    fontWeight: '900',
    color: '#059669',
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0b291d',
    textAlign: 'center',
    marginBottom: 6,
    fontFamily: 'Roboto',
  },
  successMessage: {
    fontSize: 13,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
    fontFamily: 'Roboto',
  },
  successDivider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    width: '100%',
    marginBottom: 16,
  },
  successDetailsBox: {
    width: '100%',
    backgroundColor: '#f8fafc',
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
    color: '#64748b',
    fontWeight: '600',
    fontFamily: 'Roboto',
  },
  successDetailVal: {
    fontSize: 12,
    color: '#1e293b',
    fontWeight: '700',
    fontFamily: 'Roboto',
  },
  successDetailValBold: {
    fontSize: 12.5,
    color: '#0b291d',
    fontWeight: '900',
    fontFamily: 'Roboto',
  },
  syncConfirmedBadge: {
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  syncConfirmedText: {
    fontSize: 11.5,
    color: '#065f46',
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  successBackButton: {
    backgroundColor: '#0b291d',
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successBackButtonText: {
    color: '#ffffff',
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
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
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
    borderBottomColor: '#f1f5f9',
    paddingBottom: 10,
    marginBottom: 12,
  },
  modalCategoryLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 0.8,
    fontFamily: 'Roboto',
  },
  modalItemTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0b291d',
    fontFamily: 'Roboto',
  },
  modalCloseBtn: {
    padding: 6,
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
  },
  modalCloseText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '900',
  },
  modalFieldBlock: {
    marginBottom: 14,
  },
  modalFieldLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
    marginBottom: 6,
    fontFamily: 'Roboto',
  },
  modalFieldDesc: {
    fontSize: 12.5,
    color: '#475569',
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
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
  },
  statusSelectOptionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    fontFamily: 'Roboto',
  },
  needsRepairAlertBlock: {
    backgroundColor: '#fee2e2',
    borderWidth: 1.5,
    borderColor: '#fca5a5',
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  needsRepairLabel: {
    fontSize: 12,
    fontWeight: '900',
    color: '#b91c1c',
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
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fca5a5',
    padding: 10,
    fontSize: 12.5,
    color: '#b91c1c',
    fontFamily: 'Roboto',
    textAlignVertical: 'top',
  },
  remarksInput: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 10,
    fontSize: 12.5,
    color: '#1e293b',
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
    color: '#ffffff',
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
    borderColor: '#ffffff',
    zIndex: 10,
  },
  photoThumbnailDeleteText: {
    color: '#ffffff',
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
    color: '#059669',
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
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#64748b',
  },
  modalSaveBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSaveBtnText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#ffffff',
    fontFamily: 'Roboto',
  },

  // Dropdown Picker Modal
  dropdownModalContent: {
    width: SCREEN_WIDTH - 48,
    maxWidth: 360,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    gap: 8,
  },
  dropdownModalTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#0b291d',
    textAlign: 'center',
    fontFamily: 'Roboto',
  },
  dropdownModalSubTitle: {
    fontSize: 12,
    color: '#64748b',
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
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 22,
    alignItems: 'center',
  },
  confirmIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#d1fae5',
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
    color: '#0b291d',
    marginBottom: 6,
    fontFamily: 'Roboto',
  },
  confirmDesc: {
    fontSize: 12.5,
    color: '#64748b',
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
    color: '#334155',
    marginTop: 2,
    textAlign: 'center',
    fontFamily: 'Roboto',
  },
  confirmActionsRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
  },
  confirmCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
  },
  confirmCancelBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#64748b',
  },
  confirmSubmitBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#10b981',
    alignItems: 'center',
  },
  confirmSubmitBtnText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#ffffff',
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

  // Corrective Maintenance Dispatch & Rework card banners (Dashboard)
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

  reworkAlertCardTop: {
    borderRadius: 14,
    borderWidth: 1.2,
    padding: 10,
    marginBottom: 10,
    gap: 4,
  },
  reworkAlertTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  reworkAlertHeader: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontFamily: 'Roboto',
  },
  reworkPriorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  reworkPriorityBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  reworkAlertText: {
    fontSize: 11.5,
    fontWeight: '600',
    lineHeight: 16,
    fontStyle: 'italic',
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
    color: '#ffffff',
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
    color: '#ffffff',
    fontFamily: 'Roboto',
  },

  // Image 2: Quality Control & Rework Card in Details Screen
  reworkDetailsCard: {
    marginHorizontal: Spacing.four,
    borderRadius: 22,
    borderWidth: 2,
    padding: 16,
    marginBottom: 14,
    gap: 12,
  },
  reworkDetailsTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reworkDetailsTagText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontFamily: 'Roboto',
  },
  reworkDetailsMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  reworkDetailsTitle: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
    fontFamily: 'Roboto',
  },
  reworkReportPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  reworkReportPillText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  reworkUnitBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  reworkTasksContainer: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    gap: 6,
  },
  reworkTasksHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  reworkTasksHeader: {
    fontSize: 10.5,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: 'Roboto',
  },
  reworkTaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  reworkTaskName: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Roboto',
  },
  reworkTaskStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
  },
  reworkTaskStatusText: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  reworkInstructionsBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  reworkInstructionsLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: 'Roboto',
  },
  reworkInstructionsText: {
    fontSize: 12.5,
    lineHeight: 18,
    fontStyle: 'italic',
    fontFamily: 'Roboto',
  },
  reworkMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  reworkMetaCol: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    gap: 4,
  },
  amberPriorityPill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  amberPriorityPillText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#000000',
    fontFamily: 'Roboto',
  },
  reworkMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  reworkMetaPillText: {
    fontSize: 11,
    fontWeight: '700',
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
    color: '#ffffff',
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
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
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
    color: '#ffffff',
    fontFamily: 'Roboto',
  },

  // Connected Rework & Repair Count Badges on Dashboard Card
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
    color: '#ffffff',
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
    color: '#ffffff',
    fontFamily: 'Roboto',
  },

  // Dedicated Rework & Repair Page Styles
  pageInstructionCard: {
    marginHorizontal: Spacing.four,
    borderRadius: 16,
    borderWidth: 1.5,
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
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
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
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
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
  repairTaskLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 8,
    borderWidth: 1,
    gap: 3,
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
