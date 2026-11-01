import { AppState } from 'react-native';
import { Colors as UiColors, type AppColors, Spacing } from '@/constants/theme';
import React, { useState, useEffect, useRef, useMemo, useCallback, type SetStateAction } from 'react';
import { useSessionPageSnapshot } from '@/hooks/use-session-page-snapshot';
import { createReadScope, type ReadScope } from '@/services/query-utils';
import { createRefreshCoordinator, type RefreshCoordinator } from '@/services/refresh-coordinator';
import { DataListSkeleton } from '@/components/data-list-skeleton';
import { displayDeviceId, functionalDeviceText } from '@/services/sensor-readings';
import { airflowRpmText } from '@/services/airflow-pressure';

import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  Dimensions,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { FloatingBottomNavbar } from '@/components/floating-navbar';
import { AppIcon } from '@/components/app-icon';
import { ControllerRegistrationSteps, registrationStep } from '@/components/controller-registration-steps';
import { LocationIcon } from '@/components/location-icon';
import { useSettings } from '@/context/settings-context';
import { CloudHardware, type AcDeviceMode, type IrCapture } from '@/services/cloud-hardware';
import { requestId } from '@/services/ble-protocol';
import { webBluetoothAvailability } from '@/services/web-bluetooth';
import { resolveWorkerAssignment } from '@/services/supabase';
import { useAuth } from '@/context/auth-context';

import {
  ICON_DEVICES,
  ICON_WIFI,
  ICON_BLUETOOTH,
  ICON_MORE_VERTICAL,
  ICON_SEARCH,
  ICON_ALERT_TRIANGLE,
  ICON_EDIT,
  ICON_EYE,
  ICON_EYE_OFF,
  ICON_LOCATION,
  ICON_REFRESH,
  ICON_BOLT,
} from '@/constants/custom-icons';

import {
  DeviceService,
  BleDeviceService,
  Esp32Device,
  BleDiscoveredDevice,
  WifiNetwork,
  ConnectedPhoneWifi,
  AvailableRoomOption,
  UserDeviceStorage,
} from '@/services/device-service';
import {
  AcControllerService,
  type AcControllerDevice,
  POPULAR_AC_BRANDS,
} from '@/services/ac-controller-service';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type FilterTab = 'all' | 'connected' | 'offline';
type AddStep = 'find' | 'connecting' | 'wifi' | 'verifying' | 'naming' | 'success';
type ReconfigureStep = 'connect' | 'wifi' | 'verifying' | 'success';

const AIRCON_TYPES = [
  'Split Type (Inverter)',
  'Window Type (Inverter)',
  'Cassette Type (Inverter)',
  'Centralized HVAC',
  'Floor Mounted AC',
];

function alertPhoneWifiUnavailable(phone: ConnectedPhoneWifi) {
  const guidance = {
    unsupported: 'Wi-Fi name detection requires an installed app. Type your Wi-Fi name manually here.',
    'location-disabled': 'Enable Location Services and retry Auto Search, or enter the Wi-Fi name.',
    'permission-denied': 'Allow location access while using EcoTrack in Settings, or enter the Wi-Fi name.',
    'precise-location-required': 'Enable Precise Location for EcoTrack, or enter the Wi-Fi name.',
    unavailable: 'Your phone could not provide its Wi-Fi name. Tap Auto Search again, or type the name manually.',
  };
  if (phone.error || phone.isWifi) {
    Alert.alert('Wi-Fi Name Unavailable', phone.error ? guidance[phone.error]
      : 'Wi-Fi name unavailable. Check location access and Location Services, or enter it manually.');
  } else {
    Alert.alert('Phone Not Connected to Wi-Fi', "Connect your phone to 2.4 GHz Wi-Fi, then tap Auto Search or enter the network name.");
  }
}

function formatBatteryPercent(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? `${Math.round(value)}%` : 'Unavailable';
}

function formatConnectionLatency(result: { online: boolean; pingMs: number | null } | null): string {
  return result?.online && typeof result.pingMs === 'number' && Number.isFinite(result.pingMs) && result.pingMs >= 0
    ? `${Math.round(result.pingMs)} ms` : 'Unavailable';
}

export default function DevicesScreen() {
  const { effectiveTheme, colors, triggerHaptic, formatTemperatureDisplay } = useSettings();
  const styles = themedStyles[effectiveTheme];
  const { userId, userEmail, userName, userType } = useAuth();
  const isDark = effectiveTheme === 'dark';

  // State: Device List & Filtering
  const [adminShowAll, setAdminShowAll] = useState(true);
  const fetchUser = `${userId}|${userEmail}|${userName}|${userType}|${adminShowAll}`;
  const { data, loading, hasSnapshot: hasDeviceSnapshot, error: fetchError, setData, commit, startLoading, fail, isCurrent: isSessionCurrent } =
    useSessionPageSnapshot<{ devices: Esp32Device[]; availableRooms: AvailableRoomOption[] }>(
      userId ? `devices:${fetchUser}` : undefined, () => ({ devices: [], availableRooms: [] }));
  const { availableRooms } = data;
  const devices = data.devices.map(device => DeviceService.refreshConnectionAge(device));
  const setDevices = useCallback((value: SetStateAction<Esp32Device[]>) => setData(previous => ({ ...previous,
    devices: typeof value === 'function' ? value(previous.devices) : value,
  })), [setData]);
  const refreshRef = useRef<RefreshCoordinator | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');

  // State: Selected Device Details & Options
  const [selectedDevice, setSelectedDevice] = useState<Esp32Device | null>(null);
  const [detailsModalVisible, setDetailsModalVisible] = useState(false);
  const [optionsModalVisible, setOptionsModalVisible] = useState(false);
  const [removeConfirmVisible, setRemoveConfirmVisible] = useState(false);
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameInput, setRenameInput] = useState('');
  const [savingRename, setSavingRename] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const renameSavePending = useRef(false);
  const renameFromDetails = useRef(false);
  const [roomChangeModalVisible, setRoomChangeModalVisible] = useState(false);
  const [selectedChangeRoomId, setSelectedChangeRoomId] = useState<string | null>(null);
  const [changeRoomSearchQuery, setChangeRoomSearchQuery] = useState('');
  const [changeRoomAirconName, setChangeRoomAirconName] = useState('');
  const originalRoomMetadata = useRef({ name: '' });
  const [savingRoom, setSavingRoom] = useState(false);
  const [roomSaveError, setRoomSaveError] = useState<string | null>(null);
  const roomSavePending = useRef(false);

  // Available Rooms from Supabase for room picker


  // State: Test Connection Diagnostics
  const [testingConnection, setTestingConnection] = useState(false);
  const connectionTestRequest = useRef(0);
  const [testResult, setTestResult] = useState<{
    online: boolean;
    pingMs: number | null;
    wifiSignal: string;
    connectionState?: 'online' | 'offline' | 'sleeping' | 'unknown';
    error?: string;
  } | null>(null);

  // State: Add Device Wizard Flow
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [openingRegistration, setOpeningRegistration] = useState(false);
  const [registrationRoomId, setRegistrationRoomId] = useState<string | null>(null);
  const registrationStartRequest = useRef(0);
  const installationAttempt = useRef<{ key: string; id: string } | null>(null);
  const bleScanRequest = useRef(0);
  const wifiSearch = useRef({ id: 0, pending: false });
  const reconfigWifiSearch = useRef({ id: 0, pending: false });
  const [addStep, setAddStep] = useState<AddStep>('find');
  const [discoveredDevices, setDiscoveredDevices] = useState<BleDiscoveredDevice[]>([]);
  const [scanningBle, setScanningBle] = useState(false);
  const [targetBleDevice, setTargetBleDevice] = useState<BleDiscoveredDevice | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isManualNodeId, setIsManualNodeId] = useState(false);
  const [manualNodeIdInput, setManualNodeIdInput] = useState('');

  // Wi-Fi Setup Form State
  const [savedWifiNetworks, setSavedWifiNetworks] = useState<WifiNetwork[]>([]);
  const [discoveredWifiNetworks, setDiscoveredWifiNetworks] = useState<WifiNetwork[]>([]);
  const [scanningWifi, setScanningWifi] = useState(false);
  const [selectedWifiSsid, setSelectedWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberWifi, setRememberWifi] = useState(true);

  // Provisioning Progress State
  const [verifyStep, setVerifyStep] = useState(1);
  const [assignedIp, setAssignedIp] = useState('');

  // Naming & Location State
  const [friendlyName, setFriendlyName] = useState('');
  const [deviceMode,setDeviceMode]=useState<AcDeviceMode>('both');
  const [registrationNodeId,setRegistrationNodeId]=useState<string | null>(null);
  const [customAirconName, setCustomAirconName] = useState('');
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [availableAircons, setAvailableAircons] = useState<AcControllerDevice[]>([]);
  const [registrationNeedsPassword, setRegistrationNeedsPassword] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [roomSearchQuery, setRoomSearchQuery] = useState('');
  const [selectedAirconType, setSelectedAirconType] = useState('Split Type (Inverter)');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [customBrandInput, setCustomBrandInput] = useState('');
  const [isListeningRemote, setIsListeningRemote] = useState(false);
  const [detectedRemoteInfo, setDetectedRemoteInfo] = useState<{ brand: string; protocol?: string; capture?: IrCapture } | null>(null);
  const [sniffError, setSniffError] = useState<string | null>(null);
  const remoteSniffRequest = useRef({ id: 0, listening: false });
  const [savingDevice, setSavingDevice] = useState(false);
  const [newlyCreatedDevice, setNewlyCreatedDevice] = useState<Esp32Device | null>(null);

  // State: Reconfigure Wi-Fi Modal Flow
  const [reconfigModalVisible, setReconfigModalVisible] = useState(false);
  const [reconfigStep, setReconfigStep] = useState<ReconfigureStep>('connect');
  const [reconfigConnecting, setReconfigConnecting] = useState(false);
  const [reconfigError, setReconfigError] = useState<string | null>(null);
  const [reconfigWifiNetworks, setReconfigWifiNetworks] = useState<WifiNetwork[]>([]);
  const [reconfigScanningWifi, setReconfigScanningWifi] = useState(false);
  const [reconfigSelectedSsid, setReconfigSelectedSsid] = useState('');
  const [reconfigWifiPassword, setReconfigWifiPassword] = useState('');
  const [reconfigShowPassword, setReconfigShowPassword] = useState(false);
  const [reconfigVerifyStep, setReconfigVerifyStep] = useState(1);
  const [reconfigAssignedIp, setReconfigAssignedIp] = useState('');
  const reconfigBleConnection = useRef<string | null>(null);
  const reconfigAttempt = useRef(0);
  const reconfigBluetooth = Platform.OS === 'web' ? webBluetoothAvailability() : { available: true, message: '' };

  useEffect(() => () => {
    reconfigAttempt.current += 1;
    if (reconfigBleConnection.current) void BleDeviceService.disconnectBle(reconfigBleConnection.current);
    reconfigBleConnection.current = null;
  }, []);

  // Pulse Animation for scanning & live indicators
  const [pulseAnim] = useState(() => new Animated.Value(1));


  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const fetchDevices = useCallback(async (scope: ReadScope) => {
      const [allNodes, userIds1, userIds2, assignment] = await Promise.all([
        DeviceService.getDevices(scope),
        userId ? UserDeviceStorage.getUserNodeIds(userId) : Promise.resolve([]),
        userEmail ? UserDeviceStorage.getUserNodeIds(userEmail) : Promise.resolve([]),
        userType === 'staff' ? resolveWorkerAssignment(userId || userEmail, scope) : Promise.resolve(null),
      ]);

      const localUserNodeIds = Array.from(new Set([...userIds1, ...userIds2]));

      // Filter: only show devices added by THIS logged-in account
      const userDevices = allNodes.filter((device) => {
        // Use the current server-backed room assignment, including desktop-created controllers.
        if (userType === 'staff') return assignment?.isAssigned === true && assignment.roomId === device.roomId;
        // If admin has toggled to inspect all campus nodes
        if (userType === 'admin' && adminShowAll) {
          return true;
        }

        // 1. Direct user ID match
        if (device.addedByUserId && userId && device.addedByUserId === userId) {
          return true;
        }

        // 2. Email match (case-insensitive)
        if (
          device.addedByUserEmail &&
          userEmail &&
          device.addedByUserEmail.trim().toLowerCase() === userEmail.trim().toLowerCase()
        ) {
          return true;
        }

        // 3. Name match (case-insensitive)
        if (
          device.addedByUserName &&
          userName &&
          device.addedByUserName.trim().toLowerCase() === userName.trim().toLowerCase()
        ) {
          return true;
        }

        // 4. Stored local user node ID match
        if (localUserNodeIds.includes(device.id) || localUserNodeIds.includes(device.deviceId)) {
          return true;
        }

        return false;
      });

      return userDevices;
  }, [userId, userEmail, userName, userType, adminShowAll]);

  const refreshDeviceData = useCallback(async (isCurrent: () => boolean) => {
    if (!isSessionCurrent()) return;
    startLoading();
    const scope = createReadScope();
    try {
      const [userDevices, rooms] = await Promise.all([fetchDevices(scope), DeviceService.fetchAvailableRooms(scope)]);
      scope.assertSuccessful();
      if (!isCurrent() || !isSessionCurrent()) return;
      commit(current => ({ devices: userDevices.map(fresh => {
        const confirmed = current.devices.find(device => device.id === fresh.id);
        return confirmed && Date.parse(confirmed.updated || '') > Date.parse(fresh.updated || '') ? confirmed : fresh;
      }), availableRooms: rooms }));
      setSelectedDevice(current => {
        if (!current) return null;
        const fresh = userDevices.find(device => device.id === current.id);
        if (!fresh) return null;
        return Date.parse(current.updated || '') > Date.parse(fresh.updated || '') ? current : fresh;
      });
    } catch (e) {
      console.error('Failed to load devices:', e);
      if (isCurrent() && isSessionCurrent()) fail('Unable to refresh devices. Please try again.');
    }
  }, [fetchDevices, commit, startLoading, fail, isSessionCurrent]);

  const loadDevices = () => refreshRef.current?.refresh() ?? Promise.resolve();
  const loadRooms = loadDevices;

  useEffect(() => {
    const refresh = createRefreshCoordinator(refreshDeviceData, 150, AppState);
    refreshRef.current = refresh;
    void refresh.refresh();
    const ageDevices = () => {
      if (!refresh.isActive()) return;
      setDevices(current => current.map(device => DeviceService.refreshConnectionAge(device)));
      setSelectedDevice(current => current ? DeviceService.refreshConnectionAge(current) : null);
    };
    const unsubscribe = DeviceService.subscribeToDeviceChanges(row => {
      if (!row || !refresh.isActive()) { refresh.schedule(); return; }
      setDevices(current => current.map(device => DeviceService.applyHardwareState(device, row)));
      setSelectedDevice(current => current ? DeviceService.applyHardwareState(current, row) : null);
    }, ageDevices);
    return () => {
      refresh.dispose();
      if (refreshRef.current === refresh) refreshRef.current = null;
      unsubscribe();
    };
  }, [refreshDeviceData]);

  // Filter and Search Logic
  const filteredDevices = devices.filter((device) => {
    const matchesFilter =
      activeFilter === 'all'
        ? true
        : activeFilter === 'connected'
        ? device.status === 'connected'
        : device.status === 'offline';

    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !query ||
      device.name.toLowerCase().includes(query) ||
      device.deviceId.toLowerCase().includes(query) ||
      (device.room && device.room.toLowerCase().includes(query)) ||
      (device.building && device.building.toLowerCase().includes(query)) ||
      (device.wifiSsid && device.wifiSsid.toLowerCase().includes(query));

    return matchesFilter && matchesSearch;
  });

  const connectedCount = devices.filter((d) => d.status === 'connected').length;
  const offlineCount = devices.filter((d) => d.status === 'offline').length;

  // Room filtering & custom room helpers for Add Device Modal
  const filteredRooms = useMemo(() => {
    const q = roomSearchQuery.trim().toLowerCase();
    const rooms = userType === 'staff' ? availableRooms.filter(room => room.id === registrationRoomId) : availableRooms;
    if (!q) return rooms;
    return rooms.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.buildingName.toLowerCase().includes(q) ||
        r.floorName.toLowerCase().includes(q)
    );
  }, [availableRooms, roomSearchQuery, registrationRoomId, userType]);

  const isCustomRoomQuery = false; // Cloud registration requires an existing deployment room.

  const selectedRoomDisplayName = useMemo(() => {
    if (!selectedRoomId) return null;
    if (selectedRoomId.startsWith('custom:')) {
      return selectedRoomId.replace(/^custom:/, '');
    }
    const matched = availableRooms.find((r) => r.id === selectedRoomId);
    return matched ? matched.name : null;
  }, [selectedRoomId, availableRooms]);

  const handleRoomSearchChange = (text: string) => {
    setRoomSearchQuery(text);
    const trimmed = text.trim();
    if (!trimmed) {
      setSelectedRoomId(null);
      return;
    }
    const exact = availableRooms.find((r) => r.name.toLowerCase() === trimmed.toLowerCase());
    if (exact) {
      setSelectedRoomId(exact.id);
    } else {
      setSelectedRoomId(`custom:${trimmed}`);
    }
  };

  // Room filtering & custom room helpers for Reassign Room Modal
  const filteredChangeRooms = useMemo(() => {
    const q = changeRoomSearchQuery.trim().toLowerCase();
    if (!q) return availableRooms;
    return availableRooms.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.buildingName.toLowerCase().includes(q) ||
        r.floorName.toLowerCase().includes(q)
    );
  }, [availableRooms, changeRoomSearchQuery]);

  const isCustomChangeRoomQuery = useMemo(() => {
    const trimmed = changeRoomSearchQuery.trim();
    if (!trimmed) return false;
    return !availableRooms.some((r) => r.name.toLowerCase() === trimmed.toLowerCase());
  }, [changeRoomSearchQuery, availableRooms]);

  // Dynamic custom aircon name suggestions
  const airconNameSuggestions = useMemo(() => {
    const currentRoom = selectedRoomDisplayName || (roomSearchQuery.trim() ? roomSearchQuery.trim() : '');
    if (currentRoom) {
      return [
        `${currentRoom} Aircon`,
        `${currentRoom} Split AC`,
        `${currentRoom} AC-1`,
        `${currentRoom} AC-2`,
        `${currentRoom} Inverter AC`,
      ];
    }
    return [];
  }, [selectedRoomDisplayName, roomSearchQuery]);

  // --- Add Device Wizard Handlers ---

  const resetRemoteDetection = () => {
    remoteSniffRequest.current.id += 1;
    remoteSniffRequest.current.listening = false;
    setIsListeningRemote(false);
    setDetectedRemoteInfo(null);
    setSniffError(null);
  };

  const handleCloseAddModal = () => {
    registrationStartRequest.current += 1;
    bleScanRequest.current += 1;
    wifiSearch.current = { id: wifiSearch.current.id + 1, pending: false };
    setScanningWifi(false);
    setScanningBle(false);
    setOpeningRegistration(false);
    resetRemoteDetection();
    setAddModalVisible(false);
  };

  const handleManualBrandChange = (brand: string) => {
    // Manufacturer text is independent from the captured IR encoding.
    setSelectedBrand(brand);
  };

  const handleSniffRemote = async () => {
    if (remoteSniffRequest.current.listening) return;
    if (!assignedIp.trim() || assignedIp.trim() === '0.0.0.0') {
      Alert.alert('Device IP Unavailable', 'The AC device has not provided a local IP address. Check its Wi-Fi connection, or select your brand manually below.');
      return;
    }
    const requestId = ++remoteSniffRequest.current.id;
    remoteSniffRequest.current.listening = true;
    setIsListeningRemote(true);
    setDetectedRemoteInfo(null);
    setSniffError(null);
    try {
      if (!targetBleDevice?.bleId) throw new Error('Reconnect Bluetooth to this device.');
      const capture = await BleDeviceService.learnNearby(targetBleDevice.bleId, targetBleDevice.deviceId);
      const result = { ...capture, success: true, error: '' };
      if (requestId !== remoteSniffRequest.current.id) return;
      if (result.success && result.protocol) {
        triggerHaptic();
        setDetectedRemoteInfo({ brand: '', protocol: result.protocol, capture: result.capture });
      } else {
        setSniffError(`${result.error || 'No remote signal detected.'} Point the remote directly at the device receiver and press a button, or select your brand manually below. Keep Bluetooth connected to the AC device.`);
      }
    } catch {
      if (requestId === remoteSniffRequest.current.id) {
        setSniffError("Remote signal not detected. Reconnect Bluetooth and retry, or choose the brand manually.");
      }
    } finally {
      if (requestId === remoteSniffRequest.current.id) {
        remoteSniffRequest.current.listening = false;
        setIsListeningRemote(false);
      }
    }
  };

  useEffect(() => () => { remoteSniffRequest.current.id += 1; }, []);

  const handleStartAddDevice = async () => {
    if (openingRegistration) return;
    const request = ++registrationStartRequest.current;
    const initialBleRequest = bleScanRequest.current;
    installationAttempt.current = null;
    setOpeningRegistration(true);
    setRegistrationRoomId(null);
    triggerHaptic();
    resetRemoteDetection();
    setAddStep('find');
    setTargetBleDevice(null);
    setConnectError(null);
    setIsManualNodeId(false);
    setManualNodeIdInput('');
    setSelectedWifiSsid('');
    setWifiPassword('');
    setShowPassword(false);
    setRememberWifi(true);
    setFriendlyName('');setDeviceMode('both');setRegistrationNodeId(null);
    setCustomAirconName('');
    setAssignmentId(null);
    setAvailableAircons([]);
    setRegistrationNeedsPassword(false);
    setSelectedRoomId(null);
    setRoomSearchQuery('');
    setSelectedAirconType('Split Type (Inverter)');
    setSelectedBrand('');
    setCustomBrandInput('');
    setSavingDevice(false);
    setAddModalVisible(true);

    try {
      if (userType === 'staff') {
        const scope = createReadScope();
        const assignment = await resolveWorkerAssignment(userId || userEmail, scope);
        scope.assertSuccessful();
        if (request !== registrationStartRequest.current) return;
        if (!assignment.isAssigned || !assignment.roomId || ['ALL', 'all_rooms'].includes(assignment.roomId)) {
          setConnectError('Your account needs a specific assigned room before adding a device. Ask your administrator to assign it.');
          return;
        }
        setRegistrationRoomId(assignment.roomId);
        setSelectedRoomId(assignment.roomId);
      }
      const saved = await BleDeviceService.getSavedWifiNetworks();
      if (request !== registrationStartRequest.current) return;
      setSavedWifiNetworks(saved);
      if (saved.length > 0) setSelectedWifiSsid(saved[0].ssid);
      await Promise.all([initialBleRequest === bleScanRequest.current ? scanForNearbyBle(false) : Promise.resolve(), loadRooms()]);
    } catch (error) {
      if (request === registrationStartRequest.current) setConnectError(error instanceof Error ? error.message : 'Device setup could not start. Please retry.');
    } finally {
      if (request === registrationStartRequest.current) setOpeningRegistration(false);
    }
  };

  const scanForNearbyBle = async (promptToEnable = true) => {
    const request = ++bleScanRequest.current;
    try {
      setScanningBle(true);
      setConnectError(null);
      setDiscoveredDevices([]);
      const nearby = await BleDeviceService.scanNearbyDevices(promptToEnable);
      if (request === bleScanRequest.current) setDiscoveredDevices(nearby);
    } catch (e) {
      if (request === bleScanRequest.current) setConnectError(e instanceof Error ? e.message : 'Bluetooth scan failed. Please retry.');
    } finally {
      if (request === bleScanRequest.current) setScanningBle(false);
    }
  };

  const handleSelectBleDevice = async (bleDev: BleDiscoveredDevice) => {
    resetRemoteDetection();
    triggerHaptic();
    setTargetBleDevice(bleDev);
    setAddStep('connecting');
    setConnectError(null);

    try {
      const bleId = await BleDeviceService.resolveBleIdentifier(bleDev);
      if (!await BleDeviceService.connectBle(bleId)) throw new Error('Bluetooth connection failed. Ensure the device is powered on and nearby.');
      const info = await BleDeviceService.readControllerInfo(bleId);
      if (info.cloud_protocol !== 1 || !/^esp32s3-[a-f0-9]{12}$/.test(info.device_id))
        throw new Error('Flash the current EcoTrack cloud AC device sketch before registration.');
      setTargetBleDevice({ ...bleDev, deviceId: info.device_id, bleId, macAddress: bleId });
      const status = await CloudHardware.registrationStatus(info);
      const profiles = await AcControllerService.getAllAircons();
      setAvailableAircons(profiles);setRegistrationNodeId(status.node?.id || null);
      setDeviceMode(['monitoring','controller','both'].includes(status.node?.device_mode) ? status.node.device_mode : 'both');
      setAssignmentId(status.node?.monitor_aircon_id || status.aircon?.id || null);
      setCustomAirconName(status.aircon?.name || '');
      setFriendlyName(functionalDeviceText(status.node?.name || 'EcoTrack device'));
      setSelectedRoomId(status.node?.room_id || registrationRoomId);
      setSelectedBrand(status.aircon?.brand || status.node?.brand || '');
      setSelectedAirconType(status.aircon?.aircon_type || 'Split Type (Inverter)');
      if (status.aircon?.protocol_name) setDetectedRemoteInfo({ brand: status.aircon.brand || '', protocol: status.aircon.protocol_name });
      setRegistrationNeedsPassword(status.requires_credentials === true || info.cloud_status === 'unconfigured' || info.cloud_status === 'error');
      if (info.wifi_status === 'connected' && info.ip_address && info.wifi_ssid) {
        setAssignedIp(info.ip_address);
        setSelectedWifiSsid(info.wifi_ssid);
        setAddStep('naming');
        return;
      }
      const saved = await BleDeviceService.getSavedWifiNetworks();
      setSavedWifiNetworks(saved);
      if (saved.length > 0 && !selectedWifiSsid) {
        setSelectedWifiSsid(saved[0].ssid);
      }
      setAddStep('wifi');
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : 'Unable to connect to device over Bluetooth.');
    }
  };

  const handleScanWifiNetworks = async (forceSelectPhoneWifi: boolean = true, showConnectionAlert: boolean = false) => {
    if (wifiSearch.current.pending) return;
    const request = ++wifiSearch.current.id;
    wifiSearch.current.pending = true;
    setScanningWifi(true);
    try {
      const phone = await BleDeviceService.getConnectedPhoneWifi(showConnectionAlert);
      if (request !== wifiSearch.current.id) return;
      if (forceSelectPhoneWifi && phone.isWifi && phone.ssid) setSelectedWifiSsid(phone.ssid);
      else if (showConnectionAlert && !phone.ssid) alertPhoneWifiUnavailable(phone);
      const networks = await BleDeviceService.scanWifiNetworks(phone);
      if (request === wifiSearch.current.id) setDiscoveredWifiNetworks(networks);
    } catch (err) {
      console.warn('Wi-Fi scan failed:', err);
    } finally {
      if (request === wifiSearch.current.id) {
        wifiSearch.current.pending = false;
        setScanningWifi(false);
      }
    }
  };

  const handleScanReconfigWifi = async (forceSelectPhoneWifi: boolean = true, showConnectionAlert: boolean = false) => {
    if (reconfigWifiSearch.current.pending) return;
    const request = ++reconfigWifiSearch.current.id;
    reconfigWifiSearch.current.pending = true;
    setReconfigScanningWifi(true);
    try {
      const phone = await BleDeviceService.getConnectedPhoneWifi(showConnectionAlert);
      if (request !== reconfigWifiSearch.current.id) return;
      if (forceSelectPhoneWifi && phone.isWifi && phone.ssid) setReconfigSelectedSsid(phone.ssid);
      else if (showConnectionAlert && !phone.ssid) alertPhoneWifiUnavailable(phone);
      const networks = await BleDeviceService.scanWifiNetworks(phone);
      if (request === reconfigWifiSearch.current.id) setReconfigWifiNetworks(networks);
    } catch (err) {
      console.warn('Reconfig Wi-Fi scan failed:', err);
    } finally {
      if (request === reconfigWifiSearch.current.id) {
        reconfigWifiSearch.current.pending = false;
        setReconfigScanningWifi(false);
      }
    }
  };

  useEffect(() => {
    if (addModalVisible && addStep === 'wifi') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Entering this step starts an external Wi-Fi query and its loading indicator.
      handleScanWifiNetworks(true);
    }
  }, [addModalVisible, addStep]);

  useEffect(() => {
    let active = true;
    if (reconfigModalVisible && reconfigStep === 'wifi') {
      void Promise.resolve().then(() => { if (active) return handleScanReconfigWifi(true); });
    }
    return () => { active = false; };
  }, [reconfigModalVisible, reconfigStep]);

  const handleSelectManualNode = (customId: string) => {
    const trimmed = customId.trim();
    if (!trimmed) {
      Alert.alert('Required Field', 'Please enter a Node ID or serial identifier.');
      return;
    }
    const dev: BleDiscoveredDevice = {
      id: trimmed,
      deviceId: trimmed,
      name: trimmed,
      pingMs: null,
      macAddress: '',
      isEcoTrackDevice: true,
    };
    handleSelectBleDevice(dev);
  };

  const handleRemoveSavedWifi = async (ssid: string) => {
    await BleDeviceService.removeSavedWifiSsid(ssid);
    const updated = await BleDeviceService.getSavedWifiNetworks();
    setSavedWifiNetworks(updated);
    if (selectedWifiSsid === ssid) {
      setSelectedWifiSsid(updated.length > 0 ? updated[0].ssid : '');
    }
  };

  const handleConfigureWifi = async () => {
    const targetSsid = selectedWifiSsid.trim();
    if (!targetSsid) {
      Alert.alert('Required Field', 'Please enter your Wi-Fi network SSID.');
      return;
    }
    if (!wifiPassword) {
      Alert.alert('Required Field', 'Please enter your Wi-Fi password.');
      return;
    }
    if (wifiPassword.length < 8) {
      Alert.alert(
        'Short Password',
        'Standard WPA/WPA2 Wi-Fi passwords must be at least 8 characters long. Please check your password.',
        [{ text: 'OK' }]
      );
      return;
    }

    triggerHaptic();
    setConnectError(null);
    setAddStep('verifying');
    setVerifyStep(0);

    try {
      const result = await BleDeviceService.configureWifi(
        targetBleDevice?.bleId || '',
        targetSsid,
        wifiPassword,
        (step) => setVerifyStep(step)
      );

      if (result.success) {
        setConnectError(null);
        setAssignedIp(result.ipAddress);
        setFriendlyName(
          targetBleDevice?.name && !targetBleDevice.name.startsWith('Node')
            ? functionalDeviceText(targetBleDevice.name)
            : 'EcoTrack Aircon Unit'
        );
        setAddStep('naming');
      } else {
        const errorMsg = result.error || 'Wi-Fi connection failed.';
        setConnectError(errorMsg);
        setAddStep('wifi');
        Alert.alert(
          'Wi-Fi Connection Failed',
          `Could not connect ${displayDeviceId(targetBleDevice?.deviceId)} to "${targetSsid}".\n\n` +
          '• Please verify that your Wi-Fi password is correct.\n' +
          '• Ensure your Wi-Fi router operates on a 2.4 GHz frequency (5 GHz is not supported).\n' +
          '• Make sure the node is close enough to the router for a stable signal.',
          [{ text: 'Try Again', onPress: () => {} }]
        );
      }
    } catch (e: any) {
      const errorMsg = e?.message || 'Wi-Fi connection failed. Please check the network password.';
      setConnectError(errorMsg);
      setAddStep('wifi');
      Alert.alert(
        'Incorrect Password or Connection Failed',
        `Failed to connect to "${targetSsid}".\n\n` +
        '• Check that the Wi-Fi password was entered accurately.\n' +
        '• Confirm your network is 2.4 GHz.\n' +
        `• Details: ${errorMsg}`,
        [{ text: 'Try Again', onPress: () => {} }]
      );
    }
  };

  const handleSaveNewDevice = async () => {
    if (remoteSniffRequest.current.listening) return;
    if (!friendlyName.trim()) {
      Alert.alert('Required Field', 'Please enter the AC device display name.');
      return;
    }
    const effectiveBrand = selectedBrand === '+ Other / Custom'
      ? customBrandInput.trim()
      : (customBrandInput.trim() || selectedBrand.trim());

    if (!effectiveBrand) {
      Alert.alert('Required Field', 'Please custom assign the Air Conditioner brand.');
      return;
    }

    triggerHaptic();
    try {
      setSavingDevice(true);
      const targetSsid = selectedWifiSsid.trim();
      if (userType === 'staff') {
        const scope = createReadScope();
        const assignment = await resolveWorkerAssignment(userId || userEmail, scope);
        scope.assertSuccessful();
        if (!assignment.isAssigned || !assignment.roomId || selectedRoomId !== assignment.roomId ||
            ['ALL', 'all_rooms'].includes(assignment.roomId)) throw new Error('Your assigned room changed. Reopen Add Device before saving.');
      }
      const selectedProfile = availableAircons.find(ac => ac.id === assignmentId);
      const retainedProtocol = selectedProfile?.protocolName || selectedProfile?.protocol;
      const sensorConfig=deviceMode==='controller' ? null : {temperature:true,rotation_rpm:true};
      const setup = {
        device_mode:deviceMode,sensor_config:sensorConfig,
        controller_name: friendlyName.trim(), assignment_mode: assignmentId ? 'existing' as const : 'new' as const,
        aircon_id: assignmentId || undefined, asset_tag: !assignmentId ? customAirconName.trim() : undefined,
        aircon_name: !assignmentId ? customAirconName.trim() : undefined, room_id: selectedRoomId,
        brand: effectiveBrand, aircon_type: selectedAirconType, protocol_name: deviceMode==='monitoring' ? undefined : detectedRemoteInfo?.protocol || retainedProtocol || 'UNKNOWN',
      };
      if (!targetBleDevice?.bleId) throw new Error('Reconnect Bluetooth to the selected device.');
      if (!assignmentId && !customAirconName.trim()) throw new Error('Enter an air conditioner name or choose an available profile.');
      const installationKey = JSON.stringify({ deviceId: targetBleDevice.deviceId, setup });
      if (!installationAttempt.current || installationAttempt.current.key !== installationKey) {
        installationAttempt.current = { key: installationKey, id: requestId() };
      }
      const attemptedSetup = { ...setup, installation_attempt_id: installationAttempt.current.id };
      const created = await DeviceService.registerController(targetBleDevice.bleId, targetBleDevice.deviceId, attemptedSetup,
        { ssid: targetSsid, pass: wifiPassword }, deviceMode==='monitoring' ? undefined : detectedRemoteInfo?.capture);
      await UserDeviceStorage.recordUserNode(userId, created.id);
      await UserDeviceStorage.recordUserNode(userEmail, created.id);
      setWifiPassword('');
      setNewlyCreatedDevice(created);
      await loadDevices();
      setAddStep('success');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save new AC device.');
    } finally {
      setSavingDevice(false);
    }
  };

  // --- Reconfigure Wi-Fi Handlers ---

  const handleCloseReconfigureWifi = () => {
    reconfigAttempt.current += 1;
    reconfigWifiSearch.current = { id: reconfigWifiSearch.current.id + 1, pending: false };
    setReconfigScanningWifi(false);
    if (reconfigBleConnection.current) void BleDeviceService.disconnectBle(reconfigBleConnection.current);
    reconfigBleConnection.current = null;
    setReconfigWifiPassword('');
    setReconfigModalVisible(false);
  };

  const handleStartReconfigureWifi = async (device?: Esp32Device) => {
    const target = device || selectedDevice;
    if (!target) return;

    triggerHaptic();
    setSelectedDevice(target);
    setOptionsModalVisible(false);
    setDetailsModalVisible(false);

    const attempt = ++reconfigAttempt.current;
    if (reconfigBleConnection.current) void BleDeviceService.disconnectBle(reconfigBleConnection.current);
    reconfigBleConnection.current = null;
    setReconfigStep('connect');
    setReconfigError(null);
    setReconfigConnecting(false);
    setReconfigSelectedSsid(target.wifiSsid || '');
    setReconfigWifiPassword('');
    setReconfigShowPassword(false);
    setReconfigVerifyStep(1);
    setReconfigModalVisible(true);

    const saved = await BleDeviceService.getSavedWifiNetworks();
    if (attempt !== reconfigAttempt.current) return;
    setReconfigWifiNetworks(saved);
    if (!target.wifiSsid && saved.length > 0) {
      setReconfigSelectedSsid(saved[0].ssid);
    }
  };

  const handleConnectBleForReconfigure = async () => {
    if (!selectedDevice) return;
    triggerHaptic();
    setReconfigConnecting(true);
    setReconfigError(null);
    const attempt = ++reconfigAttempt.current;

    try {
      // Starts the browser chooser in this button gesture, before awaiting storage.
      const bleId = await BleDeviceService.connectForWifiReconfigure(selectedDevice);
      if (attempt !== reconfigAttempt.current) {
        void BleDeviceService.disconnectBle(bleId);
        return;
      }
      reconfigBleConnection.current = bleId;
      const saved = await BleDeviceService.getSavedWifiNetworks();
      if (attempt !== reconfigAttempt.current) return;
      setReconfigWifiNetworks(saved);
      if (!reconfigSelectedSsid && saved.length > 0) {
        setReconfigSelectedSsid(saved[0].ssid);
      }
      setReconfigStep('wifi');
    } catch (e) {
      if (attempt !== reconfigAttempt.current) return;
      setReconfigError(
        e instanceof Error ? e.message : `Unable to connect to ${selectedDevice.name} over Bluetooth.`
      );
    } finally {
      if (attempt === reconfigAttempt.current) setReconfigConnecting(false);
    }
  };

  const handleApplyReconfigureWifi = async () => {
    if (!selectedDevice || !reconfigBleConnection.current) {
      setReconfigError('Connect to and verify the AC device over Bluetooth first.');
      setReconfigStep('connect');
      return;
    }
    const targetSsid = reconfigSelectedSsid.trim();
    if (!targetSsid) {
      Alert.alert('Required Field', 'Please enter your Wi-Fi network SSID.');
      return;
    }
    if (!reconfigWifiPassword) {
      Alert.alert('Required Field', 'Please enter the Wi-Fi network password.');
      return;
    }
    if (reconfigWifiPassword.length < 8) {
      Alert.alert(
        'Short Password',
        'Standard WPA/WPA2 Wi-Fi passwords must be at least 8 characters long. Please verify your password.',
        [{ text: 'OK' }]
      );
      return;
    }

    triggerHaptic();
    setReconfigError(null);
    setReconfigStep('verifying');
    setReconfigVerifyStep(0);
    const attempt = reconfigAttempt.current;

    try {
      const result = await BleDeviceService.configureWifi(
        reconfigBleConnection.current,
        targetSsid,
        reconfigWifiPassword,
        (step) => { if (attempt === reconfigAttempt.current) setReconfigVerifyStep(step); },
        selectedDevice.deviceId
      );
      if (attempt !== reconfigAttempt.current) return;

      if (result.success) {
        setReconfigWifiPassword('');
        setReconfigError(null);
        setReconfigAssignedIp(result.ipAddress);
        if (selectedDevice) {
          const updated = await DeviceService.updateDevice(selectedDevice.id, {
            wifiSsid: targetSsid,
            ...(result.ipAddress ? { ipAddress: result.ipAddress } : {}),
          });
          if (attempt !== reconfigAttempt.current) return;
          if (updated) setSelectedDevice(updated);
          await loadDevices();
          if (attempt !== reconfigAttempt.current) return;
        }
        setReconfigStep('success');
      } else {
        const errorMsg = result.error || 'Wi-Fi reconfiguration failed.';
        setReconfigError(errorMsg);
        setReconfigStep('wifi');
        Alert.alert(
          'Wi-Fi Reconfiguration Failed',
          `Could not connect to "${targetSsid}".\n\n` +
          '• Please verify that your Wi-Fi password is correct.\n' +
          '• Confirm that the router operates on 2.4 GHz.\n' +
          '• Ensure the device is powered on and within range.',
          [{ text: 'Try Again', onPress: () => {} }]
        );
      }
    } catch (e: any) {
      if (attempt !== reconfigAttempt.current) return;
      const errorMsg = e?.message || 'Wi-Fi reconfiguration failed.';
      setReconfigError(errorMsg);
      setReconfigStep('wifi');
      Alert.alert(
        'Incorrect Password or Connection Failed',
        `Failed to reconfigure Wi-Fi for "${targetSsid}".\n\n` +
        '• Please verify your password and try again.\n' +
        `• Details: ${errorMsg}`,
        [{ text: 'Try Again', onPress: () => {} }]
      );
    }
  };

  const handleOpenDetails = (device: Esp32Device) => {
    triggerHaptic();
    connectionTestRequest.current += 1;
    setSelectedDevice(device);
    setTestResult(null);
    setTestingConnection(false);
    setDetailsModalVisible(true);
    void handleRunConnectionTest(device);
  };

  const handleOpenOptions = (device: Esp32Device) => {
    triggerHaptic();
    connectionTestRequest.current += 1;
    setSelectedDevice(device);
    setTestResult(null);
    setTestingConnection(false);
    setOptionsModalVisible(true);
  };

  const handleRunConnectionTest = async (device = selectedDevice) => {
    if (!device) return;
    triggerHaptic();
    setTestingConnection(true);
    setTestResult(null);
    const requestId = ++connectionTestRequest.current;

    try {
      const res = await BleDeviceService.testDeviceConnection(device.id);
      if (requestId === connectionTestRequest.current) setTestResult(res);
    } catch (e) {
      if (requestId === connectionTestRequest.current) Alert.alert('Test Failed', 'Unable to reach AC device over the network.');
    } finally {
      if (requestId === connectionTestRequest.current) setTestingConnection(false);
    }
  };

  const handlePromptRename = () => {
    if (!selectedDevice) return;
    setRenameError(null);
    setRenameInput(selectedDevice.name);
    renameFromDetails.current = detailsModalVisible;
    setDetailsModalVisible(false);
    setOptionsModalVisible(false);
    setRenameModalVisible(true);
  };

  const handleCloseRename = () => {
    if (renameSavePending.current) return;
    setRenameModalVisible(false);
    if (renameFromDetails.current) setDetailsModalVisible(true);
  };

  const handleSaveRename = async () => {
    if (!selectedDevice || !renameInput.trim() || renameSavePending.current) return;
    triggerHaptic();
    renameSavePending.current = true;
    setSavingRename(true);
    setRenameError(null);
    try {
      const updated = await DeviceService.updateDevice(selectedDevice.id, { name: renameInput.trim() }, selectedDevice, { throwOnError: true });
      if (!updated) throw new Error('Rename was not saved.');
      setSelectedDevice(updated);
      setDevices(current => current.map(device => device.id === updated.id ? updated : device));
      setRenameModalVisible(false);
      if (renameFromDetails.current) setDetailsModalVisible(true);
    } catch (error) {
      setRenameError(error && typeof (error as Error).message === 'string' ? (error as Error).message : 'The change could not be saved. Please try again.');
      return;
    } finally {
      renameSavePending.current = false;
      setSavingRename(false);
    }
    void loadDevices();
  };

  const handlePromptChangeRoom = async () => {
    if (!selectedDevice) return;
    setRoomSaveError(null);
    originalRoomMetadata.current = { name: selectedDevice.name || '' };
    setSelectedChangeRoomId(selectedDevice.roomId || null);
    setChangeRoomSearchQuery('');
    setChangeRoomAirconName(selectedDevice.name || '');
    setOptionsModalVisible(false);
    setDetailsModalVisible(false);
    setRoomChangeModalVisible(true);
    void loadRooms();
  };

  const handleSaveChangeRoom = async () => {
    if (!selectedDevice || roomSavePending.current) return;
    setRoomSaveError(null);
    const query = changeRoomSearchQuery.trim();
    const selectedRoom = availableRooms.find(room => room.id === selectedChangeRoomId);
    if (query && selectedChangeRoomId !== `custom:${query}` && selectedRoom?.name.toLowerCase() !== query.toLowerCase()) {
      setRoomSaveError('Choose a room from the list or tap the custom room option before updating.');
      return;
    }
    triggerHaptic();
    roomSavePending.current = true;
    setSavingRoom(true);
    try {
      const resolvedRoomId = await DeviceService.resolveRoomId(selectedChangeRoomId);
      const updates: Partial<Esp32Device> = { roomId: resolvedRoomId };
      const name = changeRoomAirconName.trim();
      if (name && name !== originalRoomMetadata.current.name.trim()) updates.name = name;
      const saved = await DeviceService.updateDevice(selectedDevice.id, updates, selectedDevice, { throwOnError: true });
      if (!saved) throw new Error('Room change was not saved.');
      const moved = saved.roomId !== selectedDevice.roomId;
      const updated = moved ? { ...saved,
        room: saved.roomId ? selectedRoom?.name || (resolvedRoomId?.startsWith('custom:') ? resolvedRoomId.slice(7) : saved.room) : undefined,
        floor: saved.roomId ? selectedRoom?.floorName : undefined,
        building: saved.roomId ? selectedRoom?.buildingName : undefined,
      } : saved;
      setSelectedDevice(updated);
      setDevices(current => current.map(device => device.id === updated.id ? updated : device));
      setTestResult(null);
      connectionTestRequest.current += 1;
      setTestingConnection(false);
      setRoomChangeModalVisible(false);
      void loadDevices();
    } catch (error) {
      setRoomSaveError(error && typeof (error as Error).message === 'string' ? (error as Error).message : 'The room change could not be saved. Please try again.');
    } finally {
      roomSavePending.current = false;
      setSavingRoom(false);
    }
  };

  const handleConfirmRemove = async () => {
    if (!selectedDevice) return;
    triggerHaptic();
    const removed = await DeviceService.removeDevice(selectedDevice.id, userId || userEmail);
    if (!removed) {
      Alert.alert('Unable to remove AC device', 'The AC device could not be removed. Please try again.');
      return;
    }
    if (userId) {
      await UserDeviceStorage.removeUserNode(userId, selectedDevice.id);
    }
    if (userEmail) {
      await UserDeviceStorage.removeUserNode(userEmail, selectedDevice.id);
    }
    setRemoveConfirmVisible(false);
    setDetailsModalVisible(false);
    setOptionsModalVisible(false);
    await loadDevices();
  };

  return (
    <LinearGradient
      colors={[UiColors[effectiveTheme].background, UiColors[effectiveTheme].background]}
      style={[styles.container, { backgroundColor: colors.background }]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 0.35 }}
    >
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* Header Bar with EcoTrack Logo */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image
                source={require('@/assets/images/ecoTrack.png')}
                style={styles.headerLogo}
                contentFit="contain"
              />
            <View>
              <ThemedText style={[styles.headerTitle, { color: colors.text }]}>
                Device Management
              </ThemedText>
              <ThemedText style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
                AC Devices
              </ThemedText>
            </View>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Quick Summary Cards */}
          <View style={styles.metricsRow}>
            <View style={[styles.metricCard, isDark ? styles.metricCardDark : styles.metricCardLight]}>
              <ThemedText style={[styles.metricNumber, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}>
                {hasDeviceSnapshot ? devices.length : '—'}
              </ThemedText>
              <ThemedText style={[styles.metricLabel, isDark && { color: UiColors[effectiveTheme].textMuted }]} numberOfLines={2}>
                Total Devices
              </ThemedText>
            </View>
            <View style={[styles.metricCard, isDark ? styles.metricCardDark : styles.metricCardLight]}>
              <View style={styles.metricNumberRow}>
                <View style={[styles.statusDot, { backgroundColor: UiColors[effectiveTheme].primaryFill }]} />
                <ThemedText style={[styles.metricNumber, { color: UiColors[effectiveTheme].text }]}>{hasDeviceSnapshot ? connectedCount : '—'}</ThemedText>
              </View>
              <ThemedText style={[styles.metricLabel, isDark && { color: UiColors[effectiveTheme].textMuted }]}>Online</ThemedText>
            </View>
            <View style={[styles.metricCard, isDark ? styles.metricCardDark : styles.metricCardLight]}>
              <View style={styles.metricNumberRow}>
                <View style={[styles.statusDot, { backgroundColor: '#ef4444' }]} />
                <ThemedText style={[styles.metricNumber, { color: UiColors[effectiveTheme].text }]}>{hasDeviceSnapshot ? offlineCount : '—'}</ThemedText>
              </View>
              <ThemedText style={[styles.metricLabel, isDark && { color: UiColors[effectiveTheme].textMuted }]}>Offline</ThemedText>
            </View>
          </View>

          {/* Staff register controllers only in their server-assigned room. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add Device"
            accessibilityHint="Set up an AC device with Bluetooth and Wi-Fi"
            accessibilityState={{ disabled: openingRegistration, busy: openingRegistration }}
            disabled={openingRegistration}
            onPress={handleStartAddDevice}
            style={({ pressed }) => [
              styles.inlineAddBtn,
              pressed && styles.buttonPressed,
            ]}
          >
            <AppIcon name="devices" size={16} color={UiColors[effectiveTheme].onPrimary} />
            <ThemedText style={styles.inlineAddBtnText}>{openingRegistration ? 'Opening setup…' : '+ Add Device'}</ThemedText>
          </Pressable>

          {/* Search & Filter Bar */}
          <View style={styles.searchFilterContainer}>
            <View style={[styles.searchBox, isDark ? styles.searchBoxDark : styles.searchBoxLight]}>
              <AppIcon
                name="search"
                size={16}
                color={isDark ? '#94a3b8' : '#64748b'}
                style={styles.searchIcon}
              />
              <TextInput
                style={[styles.searchInput, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}
                placeholder="Search AC devices..."
                placeholderTextColor={isDark ? '#64748b' : '#9ca3af'}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.length > 0 && (
                <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                  <ThemedText style={{ color: UiColors[effectiveTheme].textMuted, fontSize: 13, fontWeight: '700' }}>✕</ThemedText>
                </Pressable>
              )}
            </View>

            {/* Filter Pills */}
            <View style={styles.filterPillsRow}>
              {(['all', 'connected', 'offline'] as const).map((tab) => (
                <Pressable
                  key={tab}
                  onPress={() => {
                    triggerHaptic();
                    setActiveFilter(tab);
                  }}
                  style={[
                    styles.filterPill,
                    isDark ? styles.filterPillDark : styles.filterPillLight,
                    activeFilter === tab && styles.filterPillActive,
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.filterPillText,
                      activeFilter === tab ? styles.filterPillTextActive : (isDark ? styles.filterPillTextDark : styles.filterPillTextLight),
                    ]}
                  >
                    {tab === 'all'
                      ? `All (${hasDeviceSnapshot ? devices.length : '—'})`
                      : tab === 'connected'
                      ? `Online (${hasDeviceSnapshot ? connectedCount : '—'})`
                      : `Offline (${hasDeviceSnapshot ? offlineCount : '—'})`}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </View>

          {/* AC Controller Devices List Section */}
          <View style={styles.sectionHeader}>
            <ThemedText style={[styles.sectionTitle, isDark ? styles.textEmeraldLight : styles.textEmeraldDark]}>
              {userType === 'admin' && adminShowAll ? 'All Campus AC Devices' : 'AC Devices'}
            </ThemedText>
            {userType === 'admin' && (
              <Pressable
                onPress={() => {
                  triggerHaptic();
                  setAdminShowAll(!adminShowAll);
                }}
                style={[styles.adminToggleBadge, isDark ? styles.adminToggleBadgeDark : styles.adminToggleBadgeLight]}
              >
                <ThemedText style={styles.adminToggleBadgeText}>
                  {adminShowAll ? 'Showing: All Nodes' : 'Showing: My Nodes'}
                </ThemedText>
              </Pressable>
            )}
          </View>

          {fetchError && <Pressable accessibilityRole="button" onPress={() => { void loadDevices(); }} style={{ paddingVertical: 12 }}>
            <ThemedText style={{ color: colors.textSecondary }}>{functionalDeviceText(fetchError)} Tap to retry.</ThemedText>
          </Pressable>}
          {loading && devices.length === 0 ? (
            <DataListSkeleton label="Loading registered AC devices..." />
          ) : fetchError && devices.length === 0 ? null : filteredDevices.length === 0 ? (
            /* Empty State */
            <View style={[styles.emptyStateCard, isDark ? styles.emptyCardDark : styles.emptyCardLight]}>
              <View style={styles.emptyIconBadge}>
                <AppIcon name="devices" size={32} color={UiColors[effectiveTheme].emerald} />
              </View>
              <ThemedText style={[styles.emptyTitle, isDark && styles.textWhite]}>
                {devices.length === 0 ? 'No AC Devices Registered'
                  : searchQuery.trim() ? 'No Matching AC Devices'
                  : activeFilter === 'connected' ? 'No Online AC Devices' : 'No Offline AC Devices'}
              </ThemedText>
              <ThemedText style={styles.emptyDesc}>
                {devices.length === 0
                  ? userType === 'admin'
                    ? 'No AC devices are registered. Register and link your first AC device.'
                    : 'Add an AC device in your assigned room.'
                  : searchQuery.trim()
                    ? 'Try another search or show all registered devices.'
                    : activeFilter === 'connected'
                      ? 'No registered AC devices match the Online filter. Show all devices to view your inventory.'
                      : 'No registered AC devices match the Offline filter. Show all devices to view your inventory.'}
              </ThemedText>
              {devices.length > 0 && <Pressable
                accessibilityRole="button"
                accessibilityLabel="Show all devices"
                onPress={() => { setSearchQuery(''); setActiveFilter('all'); }}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: colors.primaryFill, marginTop: 16, paddingHorizontal: 20 },
                  pressed && styles.buttonPressed,
                ]}
              >
                <ThemedText style={styles.primaryButtonText}>Show All Devices</ThemedText>
              </Pressable>}
              {devices.length === 0 && <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add first device"
                disabled={openingRegistration}
                onPress={handleStartAddDevice}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: colors.primaryFill, marginTop: 16, paddingHorizontal: 20 },
                  pressed && styles.buttonPressed,
                ]}
              >
                <ThemedText style={styles.primaryButtonText}>+ Add First Device</ThemedText>
              </Pressable>}
            </View>
          ) : (
            filteredDevices.map((device) => {
              const isConnected = device.status === 'connected';
              return (
                <View
                  key={device.id}
                  style={[styles.deviceCard, isDark ? styles.deviceCardDark : styles.deviceCardLight]}
                >
                  {/* Card Header */}
                  <View style={styles.deviceCardHeader}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <View style={styles.deviceTitleRow}>
                        <ThemedText style={[styles.deviceName, isDark && styles.textWhite]}>
                          {device.name}
                        </ThemedText>
                        <View style={styles.deviceIdChip}>
                          <ThemedText style={styles.deviceIdChipText}>{displayDeviceId(device.deviceId)}</ThemedText>
                        </View>
                      </View>

                      {/* Location Row */}
                      <View style={styles.deviceLocationRow}>
                        <LocationIcon size={14} color={UiColors[effectiveTheme].emerald} style={styles.locationPinIcon} />
                        <ThemedText style={[styles.deviceLocationText, isDark ? styles.textSlateLight : styles.textSlateDark]} numberOfLines={1}>
                          {[device.building, device.floor, device.room].filter(Boolean).join(' • ') || 'Unassigned Location'}
                        </ThemedText>
                      </View>
                    </View>

                    <Pressable
                      hitSlop={12}
                      onPress={() => handleOpenOptions(device)}
                      style={styles.moreOptionsBtn}
                    >
                      <AppIcon
                        name="more-vertical"
                        size={18}
                        color={isDark ? '#94a3b8' : '#64748b'}
                      />
                    </Pressable>
                  </View>

                  {/* Status & Network Badges */}
                  <View style={styles.deviceMetaRow}>
                    <View
                      style={[
                        styles.statusPill,
                        isConnected ? styles.statusPillOnline : styles.statusPillOffline,
                      ]}
                    >
                      <View
                        style={[
                          styles.statusDot,
                          { backgroundColor: isConnected ? UiColors[effectiveTheme].primaryFill : '#ef4444' },
                        ]}
                      />
                      <ThemedText
                        style={[
                          styles.statusPillText,
                          { color: isConnected ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].error },
                        ]}
                      >
                        {isConnected ? 'Online' : 'Offline'}
                      </ThemedText>
                    </View>

                    {device.wifiSsid && (
                      <View style={styles.wifiBadge}>
                        <AppIcon name="wifi" size={14} color={UiColors[effectiveTheme].emerald} />
                        <ThemedText style={styles.wifiBadgeText}>{device.wifiSsid}</ThemedText>
                      </View>
                    )}

                    <ThemedText style={styles.lastSeenText}>Seen: {device.lastSeen}</ThemedText>
                  </View>

                  {/* Card Action Buttons */}
                  <View style={styles.deviceCardFooter}>
                    <ThemedText style={styles.addedDateText}>Added: {device.dateAdded}</ThemedText>
                    <Pressable
                      onPress={() => handleOpenDetails(device)}
                      style={({ pressed }) => [
                        styles.viewDetailsBtn,
                        isDark ? styles.viewDetailsBtnDark : styles.viewDetailsBtnLight,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <ThemedText style={styles.viewDetailsBtnText}>View Device</ThemedText>
                      <ThemedText style={{ fontSize: 13, color: UiColors[effectiveTheme].emerald, fontWeight: '800' }}>→</ThemedText>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}

          {/* Bottom spacer for floating navbar */}
          <View style={{ height: 120 }} />
        </ScrollView>

        {/* Floating Bottom Navigation Bar */}
        <FloatingBottomNavbar currentPage="devices" />

        {/* ========================================================================= */}
        {/* 1. ADD AC CONTROLLER DEVICE MULTI-STEP MODAL                              */}
        {/* ========================================================================= */}
        <Modal
          visible={addModalVisible}
          animationType="slide"
          transparent={true}
          onRequestClose={handleCloseAddModal}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBackdrop}>
            <View style={[styles.modalContent, isDark ? styles.modalContentDark : styles.modalContentLight]}>
              {/* Modal Header */}
              <View style={[styles.modalHeader, isDark && styles.modalHeaderDark]}>
                <ThemedText style={[styles.modalTitle, isDark && styles.textWhite]}>
                  Register AC Device
                </ThemedText>
                <Pressable hitSlop={12} onPress={handleCloseAddModal}>
                  <ThemedText style={styles.closeModalText}>Cancel</ThemedText>
                </Pressable>
              </View>

              {addStep !== 'success' && <View>
                <ThemedText style={{ fontSize: 12, color: colors.textSecondary }}>Step {registrationStep(addStep)} of 3: {registrationStep(addStep) === 1 ? 'Bluetooth BLE Discovery' : registrationStep(addStep) === 2 ? 'Wi-Fi Setup' : 'AC Device Details & Deployment'}</ThemedText>
                <ControllerRegistrationSteps phase={addStep} />
              </View>}

              <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.modalScrollBody} showsVerticalScrollIndicator={false}>
                {/* STEP 1: FIND DEVICE */}
                {addStep === 'find' && (
                  <View style={styles.wizardSection}>
                    <View style={styles.wizardHeaderCenter}>
                      <Animated.View style={[styles.radarCircle, { transform: [{ scale: pulseAnim }] }]}>
                        <AppIcon name="bluetooth" size={28} color={UiColors[effectiveTheme].emerald} />
                      </Animated.View>
                      <ThemedText style={[styles.wizardTitle, isDark && styles.textWhite]}>
                        Find your EcoTrack device
                      </ThemedText>
                      <ThemedText style={styles.wizardSubtitle}>
                        {Platform.OS === 'android'
                          ? 'Power on the AC device. Tap Connect Nearby Device to allow Bluetooth and scan.'
                          : Platform.OS === 'web' ? reconfigBluetooth.message
                          : 'Power on the AC device and allow Bluetooth access on your phone. Enable Bluetooth in Settings if it is off.'}
                      </ThemedText>
                    </View>

                    <Pressable
                      onPress={() => scanForNearbyBle(true)}
                      disabled={scanningBle || !reconfigBluetooth.available}
                      style={({ pressed }) => [
                        styles.secondaryButton,
                        isDark ? styles.secondaryBtnDark : styles.secondaryBtnLight,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      {scanningBle ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <ActivityIndicator size="small" color={UiColors[effectiveTheme].emerald} />
                          <ThemedText style={{ color: UiColors[effectiveTheme].emerald, fontWeight: '700' }}>Scanning for device beacons...</ThemedText>
                        </View>
                      ) : (
                        <ThemedText style={{ color: UiColors[effectiveTheme].emerald, fontWeight: '700' }}>Connect Nearby Device</ThemedText>
                      )}
                    </Pressable>

                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 6 }}>
                      <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                        Discovered Nodes ({discoveredDevices.length})
                      </ThemedText>
                      <Pressable onPress={() => setIsManualNodeId(!isManualNodeId)} hitSlop={8}>
                        <ThemedText style={{ fontSize: 12, color: UiColors[effectiveTheme].emerald, fontWeight: '700' }}>
                          {isManualNodeId ? '← Show Discovered' : '+ Enter Node ID'}
                        </ThemedText>
                      </Pressable>
                    </View>

                    {isManualNodeId ? (
                      <View style={[styles.inputGroup, { marginTop: 4 }]}>
                        <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                          Enter Node ID / Hardware Identifier
                        </ThemedText>
                        <TextInput
                          style={[styles.inputField, isDark ? styles.inputFieldDark : styles.inputFieldLight]}
                          placeholder="e.g. node-1, node-7, or device-01"
                          placeholderTextColor={UiColors[effectiveTheme].textMuted}
                          value={manualNodeIdInput}
                          onChangeText={setManualNodeIdInput}
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        <Pressable
                          onPress={() => handleSelectManualNode(manualNodeIdInput)}
                          style={({ pressed }) => [
                            styles.primaryButton,
                            { backgroundColor: colors.primaryFill, marginTop: 10 },
                            pressed && styles.buttonPressed,
                          ]}
                        >
                          <ThemedText style={styles.primaryButtonText}>Connect to Node</ThemedText>
                        </Pressable>
                      </View>
                    ) : discoveredDevices.length === 0 ? (
                      <View style={[styles.wizardCenterBox, { paddingVertical: 24, marginTop: 8 }]}>
                        <AppIcon name="bluetooth" size={32} color={UiColors[effectiveTheme].emerald} />
                        <ThemedText style={[styles.wizardTitle, { fontSize: 16, marginTop: 10 }, isDark && styles.textWhite]}>
                          No BLE Nodes Detected
                        </ThemedText>
                        <ThemedText style={[styles.wizardSubtitle, { textAlign: 'center', marginHorizontal: 12 }]}>
                          Power on the AC device and enable Bluetooth on your phone.
                        </ThemedText>
                        <Pressable
                          onPress={() => setIsManualNodeId(true)}
                          style={({ pressed }) => [
                            styles.secondaryButton,
                            isDark ? styles.secondaryBtnDark : styles.secondaryBtnLight,
                            { marginTop: 14, paddingHorizontal: 20 },
                            pressed && styles.buttonPressed,
                          ]}
                        >
                          <ThemedText style={{ color: UiColors[effectiveTheme].emerald, fontWeight: '700' }}>+ Enter Node ID Manually</ThemedText>
                        </Pressable>
                      </View>
                    ) : (
                      discoveredDevices.map((dev) => (
                        <View
                          key={dev.id}
                          style={[styles.bleCard, isDark ? styles.bleCardDark : styles.bleCardLight]}
                        >
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <ThemedText style={[styles.bleName, isDark && styles.textWhite]}>{functionalDeviceText(dev.name)}</ThemedText>
                              <View style={styles.bleChip}>
                                <ThemedText style={styles.bleChipText}>{displayDeviceId(dev.deviceId)}</ThemedText>
                              </View>
                            </View>
                            <ThemedText style={styles.bleMacText}>MAC: {dev.macAddress} • Latency: {dev.pingMs == null ? 'Unavailable' : `${dev.pingMs} ms`}</ThemedText>
                          </View>
                          <Pressable
                            onPress={() => handleSelectBleDevice(dev)}
                            style={({ pressed }) => [
                              styles.bleAddBtn,
                              pressed && styles.buttonPressed,
                            ]}
                          >
                            <ThemedText style={styles.bleAddBtnText}>Select</ThemedText>
                          </Pressable>
                        </View>
                      ))
                    )}
                  </View>
                )}

                {/* STEP 2: CONNECTING VIA BLE */}
                {addStep === 'connecting' && (
                  <View style={styles.wizardCenterBox}>
                    <ActivityIndicator size="large" color={UiColors[effectiveTheme].emerald} />
                    <ThemedText style={[styles.wizardTitle, { marginTop: 18 }, isDark && styles.textWhite]}>
                      Connecting to {displayDeviceId(targetBleDevice?.deviceId)}...
                    </ThemedText>
                    <ThemedText style={styles.wizardSubtitle}>
                      Keep your phone near the AC device while connecting.
                    </ThemedText>

                    {connectError && (
                      <View style={styles.errorBanner}>
                        <AppIcon name="alert" size={18} color={UiColors[effectiveTheme].error} />
                        <ThemedText style={styles.errorText}>{functionalDeviceText(connectError)}</ThemedText>
                      </View>
                    )}
                  </View>
                )}

                {/* STEP 3: CONFIGURE WI-FI */}
                {addStep === 'wifi' && (
                  <View style={styles.wizardSection}>
                    <View style={styles.wizardHeaderCenter}>
                      <View style={styles.iconCircleEmerald}>
                        <AppIcon name="wifi" size={28} color={UiColors[effectiveTheme].emerald} />
                      </View>
                      <ThemedText style={[styles.wizardTitle, isDark && styles.textWhite]}>
                        Configure Node Wi-Fi
                      </ThemedText>
                      <ThemedText style={styles.wizardSubtitle}>
                        Enter your facility&apos;s 2.4 GHz Wi-Fi credentials for {displayDeviceId(targetBleDevice?.deviceId)} to connect to the network.
                      </ThemedText>
                    </View>

                    {/* Error Banner when connection/password fails */}
                    {connectError && (
                      <View style={[styles.errorBanner, { marginBottom: 14 }]}>
                        <AppIcon name="alert" size={18} color={UiColors[effectiveTheme].error} />
                        <ThemedText style={styles.errorText}>{functionalDeviceText(connectError)}</ThemedText>
                      </View>
                    )}

                    {/* Connected phone Wi-Fi and known facility networks */}
                    <View style={styles.inputGroup}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, flexShrink: 1, minWidth: 0 }}>
                          <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight, { marginBottom: 0 }]} numberOfLines={1}>
                            Known Wi-Fi Networks
                          </ThemedText>
                          {scanningWifi ? (
                            <ActivityIndicator size="small" color={UiColors[effectiveTheme].emerald} style={{ transform: [{ scale: 0.8 }] }} />
                          ) : (
                            discoveredWifiNetworks.length > 0 && (
                              <View style={styles.savedNetMiniBadge}>
                                <ThemedText style={styles.savedNetMiniBadgeText}>{discoveredWifiNetworks.length} Found</ThemedText>
                              </View>
                            )
                          )}
                        </View>
                        <Pressable
                          onPress={() => {
                            triggerHaptic();
                            handleScanWifiNetworks(true, true);
                          }}
                          disabled={scanningWifi}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={({ pressed }) => [
                            styles.rescanWifiBtn,
                            isDark ? styles.rescanWifiBtnDark : styles.rescanWifiBtnLight,
                            scanningWifi && { opacity: 0.6 },
                            pressed && { opacity: 0.75 },
                          ]}
                        >
                          {scanningWifi ? (
                            <ActivityIndicator size="small" color={UiColors[effectiveTheme].emerald} style={{ transform: [{ scale: 0.75 }] }} />
                          ) : (
                            <AppIcon name="refresh" size={13} color={UiColors[effectiveTheme].emerald} />
                          )}
                          <ThemedText style={styles.rescanWifiBtnText}>
                            {scanningWifi ? 'Searching...' : 'Auto Search'}
                          </ThemedText>
                        </Pressable>
                      </View>

                      {/* Auto-searching Progress Banner */}
                      {scanningWifi ? (
                        <View style={[styles.wifiScanningBanner, isDark ? styles.wifiScanningBannerDark : styles.wifiScanningBannerLight]}>
                          <ActivityIndicator size="small" color={UiColors[effectiveTheme].emerald} />
                          <View style={{ flex: 1, gap: 2 }}>
                            <ThemedText style={[styles.wifiScanningTitle, isDark ? styles.textWhite : { color: UiColors[effectiveTheme].text }]}>
                              Checking phone Wi-Fi...
                            </ThemedText>
                            <ThemedText style={styles.wifiScanningSubtitle}>
                              Reading the connected phone network and saved facility profiles
                            </ThemedText>
                          </View>
                        </View>
                      ) : discoveredWifiNetworks.length > 0 ? (
                        <View style={styles.discoveredWifiList}>
                          {discoveredWifiNetworks.map((net) => {
                            const isSelected = selectedWifiSsid.toLowerCase().trim() === net.ssid.toLowerCase().trim();
                            return (
                              <Pressable
                                key={net.ssid}
                                onPress={() => {
                                  triggerHaptic();
                                  setSelectedWifiSsid(net.ssid);
                                }}
                                style={({ pressed }) => [
                                  styles.wifiItemCard,
                                  isDark ? styles.wifiItemCardDark : styles.wifiItemCardLight,
                                  isSelected && (isDark ? styles.wifiItemCardActiveDark : styles.wifiItemCardActiveLight),
                                  pressed && { opacity: 0.85 },
                                ]}
                              >
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                                  <View style={[
                                    styles.wifiSignalIconCircle,
                                    isSelected
                                      ? { backgroundColor: UiColors[effectiveTheme].accentSurface }
                                      : (isDark ? { backgroundColor: 'rgba(255, 255, 255, 0.05)' } : { backgroundColor: UiColors[effectiveTheme].backgroundSelected }),
                                  ]}>
                                    <AppIcon
                                      name="wifi"
                                      size={16}
                                      color={isSelected ? '#10b981' : isDark ? '#94a3b8' : '#64748b'}
                                    />
                                  </View>

                                  <View style={{ flex: 1, gap: 2 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                      <ThemedText
                                        style={[
                                          styles.wifiItemSsid,
                                          isDark && styles.textWhite,
                                          isSelected && { color: UiColors[effectiveTheme].emerald, fontWeight: '800' },
                                        ]}
                                        numberOfLines={1}
                                      >
                                        {net.ssid}
                                      </ThemedText>
                                      {net.isConnectedPhone ? (
                                        <View style={styles.savedNetMiniBadge}>
                                          <ThemedText style={styles.savedNetMiniBadgeText}>Connected Phone Wi-Fi</ThemedText>
                                        </View>
                                      ) : net.isSaved ? (
                                        <View style={styles.savedNetMiniBadge}>
                                          <ThemedText style={styles.savedNetMiniBadgeText}>Saved</ThemedText>
                                        </View>
                                      ) : (
                                        <View style={[styles.savedNetMiniBadge, { backgroundColor: isDark ? 'rgba(59, 130, 246, 0.2)' : UiColors[effectiveTheme].infoSurface }]}>
                                          <ThemedText style={[styles.savedNetMiniBadgeText, { color: UiColors[effectiveTheme].info }]}>Registered Network</ThemedText>
                                        </View>
                                      )}
                                    </View>
                                    <ThemedText style={styles.wifiItemMeta}>
                                      {net.isConnectedPhone ? `${net.frequency || 'Band unknown'} • AC Device requires 2.4 GHz` : 'Known network • Confirm availability and 2.4 GHz'}
                                    </ThemedText>
                                  </View>
                                </View>

                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                  <View style={[
                                    styles.wifiRadioBadge,
                                    isSelected && { backgroundColor: UiColors[effectiveTheme].primaryFill, borderColor: UiColors[effectiveTheme].border },
                                    isDark && !isSelected && { borderColor: UiColors[effectiveTheme].border },
                                  ]}>
                                    {isSelected ? (
                                      <ThemedText style={{ color: UiColors[effectiveTheme].onPrimary, fontSize: 11, fontWeight: '900' }}>✓</ThemedText>
                                    ) : null}
                                  </View>
                                </View>
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : (
                        <View style={[styles.wifiEmptyCard, isDark ? styles.wifiEmptyCardDark : styles.wifiEmptyCardLight]}>
                          <View style={styles.wifiEmptyIconCircle}>
                            <AppIcon name="wifi" size={18} color={UiColors[effectiveTheme].emerald} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <ThemedText style={[styles.wifiEmptyTitle, isDark && styles.textWhite]}>
                              No connected or known Wi-Fi names found
                            </ThemedText>
                            <ThemedText style={styles.wifiEmptySubtitle}>
                              Connect your phone to Wi-Fi and tap &quot;Auto Search&quot;, or enter the network name below.
                            </ThemedText>
                          </View>
                        </View>
                      )}
                    </View>

                    {/* Wi-Fi SSID Input */}
                    <View style={styles.inputGroup}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                          Wi-Fi Network Name (SSID) *
                        </ThemedText>
                        <View style={styles.wifiFreqBadge}>
                          <ThemedText style={styles.wifiFreqBadgeText}>2.4 GHz Only</ThemedText>
                        </View>
                      </View>
                      <View style={[styles.wifiInputRow, isDark ? styles.inputFieldDark : styles.inputFieldLight]}>
                        <AppIcon
                          name="wifi"
                          size={18}
                          color={isDark ? '#94a3b8' : '#64748b'}
                          style={{ marginRight: 8 }}
                        />
                        <TextInput
                          style={[styles.flexInput, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}
                          placeholder="Enter 2.4 GHz Wi-Fi Network Name"
                          placeholderTextColor={UiColors[effectiveTheme].textMuted}
                          value={selectedWifiSsid}
                          onChangeText={setSelectedWifiSsid}
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        {selectedWifiSsid ? (
                          <Pressable onPress={() => setSelectedWifiSsid('')} hitSlop={8} style={{ padding: 4 }}>
                            <ThemedText style={{ color: UiColors[effectiveTheme].textMuted, fontSize: 13, fontWeight: '700' }}>✕</ThemedText>
                          </Pressable>
                        ) : null}
                      </View>

                      {/* Quick Presets Row below Input */}
                      {(discoveredWifiNetworks.some(net => net.isConnectedPhone) || savedWifiNetworks.length > 0) && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        <ThemedText style={[styles.quickPresetLabel, isDark && styles.textSlateLight]}>Quick Presets:</ThemedText>
                        {Array.from(new Set([...discoveredWifiNetworks.filter(net => net.isConnectedPhone).map(net => net.ssid), ...savedWifiNetworks.map(s => s.ssid)])).map((preset) => {
                          const isSelected = selectedWifiSsid === preset;
                          return (
                            <Pressable
                              key={preset}
                              onPress={() => {
                                triggerHaptic();
                                setSelectedWifiSsid(preset);
                              }}
                              style={[
                                styles.presetChip,
                                isDark ? styles.presetChipDark : styles.presetChipLight,
                                isSelected && styles.presetChipActive,
                              ]}
                            >
                              <ThemedText style={[styles.presetChipText, isSelected && styles.presetChipTextActive]}>
                                {isSelected ? '✓ ' : ''}{preset}
                              </ThemedText>
                            </Pressable>
                          );
                        })}
                      </View>
                      )}
                    </View>

                    {/* Saved Facility Networks (if any previously saved) */}
                    {savedWifiNetworks.length > 0 && (
                      <View style={[styles.inputGroup, { marginTop: 12 }]}>
                        <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                          Saved Facility Networks
                        </ThemedText>
                        <View style={styles.savedNetworksRow}>
                          {savedWifiNetworks.map((net) => {
                            const isSelected = selectedWifiSsid === net.ssid;
                            return (
                              <Pressable
                                key={net.ssid}
                                onPress={() => setSelectedWifiSsid(net.ssid)}
                                style={[
                                  styles.savedNetworkChip,
                                  isDark ? styles.savedNetworkChipDark : styles.savedNetworkChipLight,
                                  isSelected && styles.savedNetworkChipActive,
                                ]}
                              >
                                <AppIcon
                                  name="wifi"
                                  size={13}
                                  color={isSelected ? '#10b981' : isDark ? '#94a3b8' : '#64748b'}
                                />
                                <ThemedText
                                  style={[
                                    styles.savedNetworkChipText,
                                    isSelected && { color: UiColors[effectiveTheme].emerald, fontWeight: '800' },
                                    isDark && !isSelected && styles.textWhite,
                                  ]}
                                >
                                  {net.ssid}
                                </ThemedText>
                                <Pressable
                                  onPress={() => handleRemoveSavedWifi(net.ssid)}
                                  hitSlop={6}
                                  style={styles.removeSavedNetBtn}
                                >
                                  <ThemedText style={{ color: UiColors[effectiveTheme].textMuted, fontSize: 10, fontWeight: '800' }}>✕</ThemedText>
                                </Pressable>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    )}

                    {/* Password Input */}
                    <View style={[styles.inputGroup, { marginTop: 14 }]}>
                      <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                        Wi-Fi Password *
                      </ThemedText>
                      <View style={[styles.passwordRow, isDark ? styles.passwordRowDark : styles.passwordRowLight]}>
                        <TextInput
                          style={[styles.passwordInput, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}
                          placeholder="Enter Wi-Fi Password"
                          placeholderTextColor={UiColors[effectiveTheme].textMuted}
                          secureTextEntry={!showPassword}
                          value={wifiPassword}
                          onChangeText={setWifiPassword}
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={10} style={{ padding: 4 }}>
                          <AppIcon
                            name={showPassword ? 'eye-off' : 'eye'}
                            size={20}
                            color={isDark ? '#94a3b8' : '#64748b'}
                          />
                        </Pressable>
                      </View>
                    </View>

                    {/* Remember network option */}
                    <Pressable
                      onPress={() => setRememberWifi(!rememberWifi)}
                      style={styles.rememberRow}
                    >
                      <View
                        style={[
                          styles.rememberCheckbox,
                          {
                            borderColor: rememberWifi ? UiColors[effectiveTheme].border : isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                            backgroundColor: rememberWifi ? UiColors[effectiveTheme].primaryFill : 'transparent',
                          },
                        ]}
                      >
                        {rememberWifi && <ThemedText style={{ color: UiColors[effectiveTheme].onPrimary, fontSize: 11, fontWeight: '900' }}>✓</ThemedText>}
                      </View>
                      <ThemedText style={[styles.rememberText, isDark ? styles.textSlateLight : styles.textSlateDark]}>
                        Remember this network for future AC nodes
                      </ThemedText>
                    </Pressable>

                    {/* Technical Notice Callout */}
                    <View style={[styles.wifiNoticeBox, isDark ? styles.wifiNoticeBoxDark : styles.wifiNoticeBoxLight]}>
                      <AppIcon name="bolt" size={14} color={isDark ? '#fbbf24' : '#d97706'} />
                      <ThemedText style={[styles.wifiNoticeText, isDark ? styles.textSlateLight : styles.textSlateDark]}>
                        Use 2.4 GHz Wi-Fi. 5 GHz is not supported.
                      </ThemedText>
                    </View>

                    <Pressable
                      onPress={handleConfigureWifi}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        { backgroundColor: colors.primaryFill, marginTop: 18 },
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <ThemedText style={styles.primaryButtonText}>Provision Wi-Fi Credentials</ThemedText>
                    </Pressable>
                  </View>
                )}

                {/* STEP 4: VERIFYING CONNECTION */}
                {addStep === 'verifying' && (
                  <View style={styles.wizardSection}>
                    <View style={styles.wizardHeaderCenter}>
                      <ActivityIndicator size="large" color={UiColors[effectiveTheme].emerald} />
                      <ThemedText style={[styles.wizardTitle, { marginTop: 14 }, isDark && styles.textWhite]}>
                        Connecting device to Wi-Fi
                      </ThemedText>
                      <ThemedText style={styles.wizardSubtitle}>
                        {displayDeviceId(targetBleDevice?.deviceId)}
                      </ThemedText>
                    </View>

                    {/* Live Verification Checklist */}
                    <View style={[styles.checklistCard, isDark ? styles.checklistCardDark : styles.checklistCardLight]}>
                      <View style={styles.checklistItem}>
                        <ThemedText style={{ fontSize: 14, color: verifyStep >= 1 ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].textMuted, fontWeight: '800' }}>
                          {verifyStep >= 1 ? '✓' : '○'}
                        </ThemedText>
                        <ThemedText style={[styles.checklistText, verifyStep >= 1 && styles.checklistTextDone, isDark && styles.textWhite]}>
                          Device Bluetooth connection confirmed
                        </ThemedText>
                      </View>
                      <View style={styles.checklistItem}>
                        <ThemedText style={{ fontSize: 14, color: verifyStep >= 2 ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].textMuted, fontWeight: '800' }}>
                          {verifyStep >= 2 ? '✓' : '○'}
                        </ThemedText>
                        <ThemedText style={[styles.checklistText, verifyStep >= 2 && styles.checklistTextDone, isDark && styles.textWhite]}>
                          Wi-Fi credentials transmitted
                        </ThemedText>
                      </View>
                      <View style={styles.checklistItem}>
                        <ThemedText style={{ fontSize: 14, color: verifyStep >= 3 ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].textMuted, fontWeight: '800' }}>
                          {verifyStep >= 3 ? '✓' : '○'}
                        </ThemedText>
                        <ThemedText style={[styles.checklistText, verifyStep >= 3 && styles.checklistTextDone, isDark && styles.textWhite]}>
                          DHCP handshake & IP assigned ({assignedIp})
                        </ThemedText>
                      </View>
                      <View style={styles.checklistItem}>
                        <ThemedText style={{ fontSize: 14, color: verifyStep >= 4 ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].textMuted, fontWeight: '800' }}>
                          {verifyStep >= 4 ? '✓' : '○'}
                        </ThemedText>
                        <ThemedText style={[styles.checklistText, verifyStep >= 4 && styles.checklistTextDone, isDark && styles.textWhite]}>
                          Network profile saved; backend access unverified
                        </ThemedText>
                      </View>
                    </View>
                  </View>
                )}

                {/* STEP 5: CUSTOM AIRCON NAME & ASSIGN ROOM */}
                {addStep === 'naming' && (
                  <View style={styles.wizardSection}>
                    <View style={styles.wizardHeaderCenter}>
                      <View style={styles.iconCircleEmerald}>
                        <AppIcon name="edit" size={24} color={UiColors[effectiveTheme].emerald} />
                      </View>
                      <ThemedText style={[styles.wizardTitle, isDark && styles.textWhite]}>
                        AC Device Details & Deployment
                      </ThemedText>
                      <ThemedText style={styles.wizardSubtitle}>
                        Name its air conditioner and verify the cloud connection.
                      </ThemedText>
                    </View>

                    <View style={styles.inputGroup}>
                      <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>Node ID / Hardware</ThemedText>
                      <View style={[styles.readOnlyInput, isDark ? styles.readOnlyInputDark : styles.readOnlyInputLight]}>
                        <ThemedText style={{ fontWeight: '700', color: UiColors[effectiveTheme].emerald }}>{displayDeviceId(targetBleDevice?.deviceId)}</ThemedText>
                        <ThemedText style={{ fontSize: 11, color: UiColors[effectiveTheme].textMuted }}>IP: {assignedIp}</ThemedText>
                      </View>
                    </View>

                    {registrationNeedsPassword && (
                      <View style={styles.inputGroup}>
                        <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>Current Wi-Fi password for cloud registration</ThemedText>
                        <TextInput style={[styles.inputField, isDark ? styles.inputFieldDark : styles.inputFieldLight]}
                          value={wifiPassword} onChangeText={setWifiPassword} secureTextEntry autoCapitalize="none"
                          placeholder="Enter the connected Wi-Fi password" placeholderTextColor={UiColors[effectiveTheme].textMuted} />
                      </View>
                    )}
                    <View style={styles.inputGroup}>
                      <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>Available air conditioner</ThemedText>
                      <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}>
                        <Pressable accessibilityRole="radio" accessibilityState={{ selected: !assignmentId }} style={[styles.airconPill, isDark ? styles.airconPillDark : styles.airconPillLight, !assignmentId && styles.airconPillActive]} onPress={() => { if (assignmentId) { setAssignmentId(null); setCustomAirconName(''); } }}>
                          <ThemedText style={[styles.airconPillText, !assignmentId && { color: UiColors[effectiveTheme].onPrimary }]}>{!assignmentId ? '✓ ' : ''}Add custom air conditioner name</ThemedText>
                        </Pressable>
                        {availableAircons.filter(ac=>deviceMode==='monitoring' || !ac.nodeId || ac.nodeId===registrationNodeId).map(ac => (
                          <Pressable key={ac.id} accessibilityRole="radio" accessibilityState={{ selected: assignmentId === ac.id }} style={[styles.airconPill, isDark ? styles.airconPillDark : styles.airconPillLight, assignmentId === ac.id && styles.airconPillActive]} onPress={() => {
                            resetRemoteDetection();
                            setAssignmentId(ac.id); setCustomAirconName(ac.airconName || 'Air conditioner');
                            setSelectedBrand(ac.brand || ''); setSelectedAirconType(ac.airconType || 'Split Type (Inverter)');
                            setSelectedRoomId(ac.roomId || null);
                            setDetectedRemoteInfo({ brand: ac.brand || '', protocol: ac.protocolName || ac.protocol });
                          }}>
                            <ThemedText style={[styles.airconPillText, assignmentId === ac.id && { color: UiColors[effectiveTheme].onPrimary }]}>{assignmentId === ac.id ? '✓ ' : ''}{ac.airconName || displayDeviceId(ac.deviceId)}</ThemedText>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                    <View style={[styles.inputGroup, { marginTop: 14 }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                        <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                          AC Device Name <ThemedText style={{ color: UiColors[effectiveTheme].error }}>*</ThemedText>
                        </ThemedText>
                        <View style={styles.customBadgePill}>
                          <ThemedText style={styles.customBadgeText}>Custom Name</ThemedText>
                        </View>
                      </View>
                      <View style={[styles.customNameInputRow, isDark ? styles.inputFieldDark : styles.inputFieldLight]}>
                        <AppIcon
                          name="edit"
                          size={16}
                          color={UiColors[effectiveTheme].emerald}
                          style={{ marginRight: 8 }}
                        />
                        <TextInput
                          style={[styles.flexInput, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text, fontWeight: '700' }]}
                          placeholder="e.g. Lab 204 Aircon, Daikin Split AC, Unit 1"
                          placeholderTextColor={UiColors[effectiveTheme].textMuted}
                          value={friendlyName}
                          onChangeText={setFriendlyName}
                          autoCorrect={false}
                        />
                        {friendlyName.length > 0 && (
                          <Pressable onPress={() => setFriendlyName('')} hitSlop={8} style={{ padding: 4 }}>
                            <ThemedText style={{ color: UiColors[effectiveTheme].textMuted, fontSize: 13, fontWeight: '700' }}>✕</ThemedText>
                          </Pressable>
                        )}
                      </View>

                      {/* Quick Aircon Name Suggestions */}
                      <View style={{ marginTop: 6 }}>
                        <ThemedText style={{ fontSize: 10.5, color: UiColors[effectiveTheme].textMuted, fontWeight: '600', marginBottom: 4 }}>
                          Quick Suggestions:
                        </ThemedText>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row' }}>
                          {airconNameSuggestions.map((sug) => {
                            const isMatch = friendlyName.trim().toLowerCase() === sug.trim().toLowerCase();
                            return (
                              <Pressable
                                key={sug}
                                onPress={() => {
                                  triggerHaptic();
                                  setFriendlyName(sug);
                                }}
                                style={[
                                  styles.nameSugPill,
                                  isDark ? styles.nameSugPillDark : styles.nameSugPillLight,
                                  isMatch && styles.nameSugPillActive,
                                ]}
                              >
                                <ThemedText
                                  style={[
                                    styles.nameSugPillText,
                                    isMatch && { color: UiColors[effectiveTheme].emerald, fontWeight: '800' },
                                    isDark && !isMatch && styles.textWhite,
                                  ]}
                                >
                                  {sug}
                                </ThemedText>
                              </Pressable>
                            );
                          })}
                        </ScrollView>
                      </View>
                    </View>

                    {deviceMode!=='monitoring' && (
                    <View style={[styles.inputGroup, {
                      marginTop: 14, padding: 14, borderRadius: 14, borderWidth: 1,
                      backgroundColor: isDark ? '#062015' : UiColors[effectiveTheme].accentSurface,
                      borderColor: isDark ? UiColors[effectiveTheme].inputBorder : UiColors[effectiveTheme].inputBorder,
                    }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <AppIcon name="aircon" size={20} color={UiColors[effectiveTheme].emerald} />
                        <ThemedText style={[styles.inputLabel, isDark && styles.textWhite, { flex: 1, marginBottom: 0 }]}>
                          Auto-Detect Brand with Remote
                        </ThemedText>
                      </View>
                      <ThemedText style={{ fontSize: 12, color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary, marginTop: 8 }}>
                        Aim the AC remote at the AC device and press Power, Temp or Mode.
                      </ThemedText>
                      <Pressable
                        onPress={handleSniffRemote}
                        disabled={isListeningRemote}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: isListeningRemote, busy: isListeningRemote }}
                        style={({ pressed }) => [
                          styles.primaryButton,
                          { backgroundColor: colors.primaryFill, marginTop: 12, flexDirection: 'row', gap: 8 },
                          isListeningRemote && { opacity: 0.65 },
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        {isListeningRemote && <ActivityIndicator size="small" color={UiColors[effectiveTheme].onPrimary} />}
                        <ThemedText style={[styles.primaryButtonText, { flexShrink: 1 }]}>
                          {isListeningRemote ? 'Listening for remote pulses...' : sniffError ? 'Retry' : detectedRemoteInfo ? 'Re-scan' : 'Listen for Remote Signal'}
                        </ThemedText>
                      </Pressable>
                      <ThemedText style={{ fontSize: 11, color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary, marginTop: 6 }}>
                        {isListeningRemote ? 'Press a button on your AC remote now!' : '6-second listening window'}
                      </ThemedText>
                      {detectedRemoteInfo && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
                          <AppIcon name="check-circle" size={16} color={UiColors[effectiveTheme].emerald} />
                          <ThemedText style={{ flex: 1, fontSize: 12, fontWeight: '700', color: isDark ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].text }}>
                            IR Protocol: {detectedRemoteInfo.protocol || 'Protocol unavailable'}
                            {detectedRemoteInfo.capture ? '\nCaptured signal will be saved with registration.' : ''}
                          </ThemedText>
                        </View>
                      )}
                      {sniffError && (
                        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 10 }}>
                          <AppIcon name="alert" size={16} color={isDark ? '#fbbf24' : '#b45309'} />
                          <ThemedText style={{ flex: 1, fontSize: 12, color: isDark ? UiColors[effectiveTheme].warning : UiColors[effectiveTheme].warning }}>{functionalDeviceText(sniffError)}</ThemedText>
                        </View>
                      )}
                    </View>
                    )}

                    {/* Air Conditioner Brand Input & Quick Presets (Custom Assign Form) */}
                    <View style={[styles.inputGroup, { marginTop: 14 }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                          Custom Aircon Brand <ThemedText style={{ color: UiColors[effectiveTheme].error }}>*</ThemedText>
                        </ThemedText>
                        <ThemedText style={{ fontSize: 10.5, color: UiColors[effectiveTheme].emerald, fontWeight: '700' }}>
                          Custom Assign
                        </ThemedText>
                      </View>
                      {selectedBrand.trim() ? (
                        <View style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          backgroundColor: isDark ? UiColors[effectiveTheme].accentSurface : UiColors[effectiveTheme].accentSurface,
                          borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                          borderWidth: 1,
                          borderRadius: 8,
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          marginBottom: 8,
                        }}>
                          <AppIcon name="check-circle" size={14} color={UiColors[effectiveTheme].emerald} />
                          <ThemedText style={{ fontSize: 11.5, fontWeight: '700', color: isDark ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].text }}>
                            Custom Assigned: {selectedBrand.trim()} {selectedAirconType ? `(${selectedAirconType})` : ''}
                          </ThemedText>
                        </View>
                      ) : null}
                      <TextInput
                        style={[styles.inputField, isDark ? styles.inputFieldDark : styles.inputFieldLight]}
                        placeholder="Custom assign brand (e.g. Daikin, Carrier, Koppel, Midea)..."
                        placeholderTextColor={UiColors[effectiveTheme].textMuted}
                        value={selectedBrand}
                        onChangeText={handleManualBrandChange}
                      />
                      <ThemedText style={{ fontSize: 11, color: UiColors[effectiveTheme].textMuted, marginTop: 8, marginBottom: 2, fontWeight: '600' }}>
                        Quick Presets:
                      </ThemedText>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row', marginTop: 4 }}>
                        {['Daikin', 'Carrier', 'Koppel', 'Panasonic', 'LG', 'Mitsubishi', 'Samsung', 'Midea', 'Gree', 'Condura', 'Haier', 'TCL', 'Sharp'].map((b) => {
                          const isSel = selectedBrand.trim().toLowerCase() === b.toLowerCase();
                          return (
                            <Pressable
                              key={b}
                              onPress={() => {
                                triggerHaptic();
                                handleManualBrandChange(b);
                              }}
                              style={[
                                styles.airconPill,
                                isDark ? styles.airconPillDark : styles.airconPillLight,
                                isSel && styles.airconPillActive,
                              ]}
                            >
                              <ThemedText style={[styles.airconPillText, isSel && { color: UiColors[effectiveTheme].onPrimary, fontWeight: '700' }, isDark && !isSel && styles.textWhite]}>
                                {b}
                              </ThemedText>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    </View>

                    {/* Aircon Type Input & Quick Presets */}
                    <View style={[styles.inputGroup, { marginTop: 14 }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                          Aircon Type / Model
                        </ThemedText>
                        <ThemedText style={{ fontSize: 10.5, color: UiColors[effectiveTheme].emerald, fontWeight: '700' }}>
                          Editable Preset
                        </ThemedText>
                      </View>
                      <TextInput
                        style={[styles.inputField, isDark ? styles.inputFieldDark : styles.inputFieldLight]}
                        placeholder="Type custom aircon type or select preset below..."
                        placeholderTextColor={UiColors[effectiveTheme].textMuted}
                        value={selectedAirconType}
                        onChangeText={setSelectedAirconType}
                      />
                      <ThemedText style={{ fontSize: 11, color: UiColors[effectiveTheme].textMuted, marginTop: 8, marginBottom: 2, fontWeight: '600' }}>
                        Quick Presets:
                      </ThemedText>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row', marginTop: 4 }}>
                        {AIRCON_TYPES.map((type) => {
                          const isSel = selectedAirconType.trim().toLowerCase() === type.trim().toLowerCase();
                          return (
                            <Pressable
                              key={type}
                              onPress={() => {
                                triggerHaptic();
                                setSelectedAirconType(type);
                              }}
                              style={[
                                styles.airconPill,
                                isDark ? styles.airconPillDark : styles.airconPillLight,
                                isSel && styles.airconPillActive,
                              ]}
                            >
                              <ThemedText style={[styles.airconPillText, isSel && { color: UiColors[effectiveTheme].onPrimary, fontWeight: '700' }, isDark && !isSel && styles.textWhite]}>
                                {type}
                              </ThemedText>
                            </Pressable>
                          );
                        })}
                        <Pressable
                          onPress={() => {
                            triggerHaptic();
                            setSelectedAirconType('');
                          }}
                          style={[
                            styles.airconPill,
                            isDark ? styles.airconPillDark : styles.airconPillLight,
                            !AIRCON_TYPES.some((t) => t.toLowerCase() === selectedAirconType.trim().toLowerCase()) && selectedAirconType.trim().length > 0 && styles.airconPillActive,
                            { borderStyle: 'dashed' },
                          ]}
                        >
                          <ThemedText style={[styles.airconPillText, { color: UiColors[effectiveTheme].emerald, fontWeight: '800' }]}>
                            + Custom Type
                          </ThemedText>
                        </Pressable>
                      </ScrollView>
                    </View>

                    {/* Room Assignment Picker with Search & Custom Room Typing */}
                    <View style={[styles.inputGroup, { marginTop: 16 }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <LocationIcon size={14} color={UiColors[effectiveTheme].emerald} />
                          <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                            Assign to Room
                          </ThemedText>
                        </View>
                        {selectedRoomDisplayName && (
                          <ThemedText style={{ fontSize: 11, color: UiColors[effectiveTheme].emerald, fontWeight: '700', maxWidth: 160 }} numberOfLines={1}>
                            Selected: {selectedRoomDisplayName}
                          </ThemedText>
                        )}
                      </View>

                      {/* Type / Search Room Input */}
                      <View style={[styles.searchBox, isDark ? styles.searchBoxDark : styles.searchBoxLight, { paddingVertical: 8, marginBottom: 8 }]}>
                        <AppIcon
                          name="search"
                          size={16}
                          color={isDark ? '#94a3b8' : '#64748b'}
                          style={styles.searchIcon}
                        />
                        <TextInput
                          style={[styles.searchInput, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}
                          placeholder="Type room name or search..."
                          placeholderTextColor={isDark ? '#64748b' : '#9ca3af'}
                          value={roomSearchQuery}
                          onChangeText={handleRoomSearchChange}
                        />
                        {roomSearchQuery.length > 0 && (
                          <Pressable
                            onPress={() => {
                              triggerHaptic();
                              setRoomSearchQuery('');
                              setSelectedRoomId(null);
                            }}
                            hitSlop={8}
                          >
                            <ThemedText style={{ color: UiColors[effectiveTheme].textMuted, fontSize: 13, fontWeight: '700', paddingHorizontal: 4 }}>✕</ThemedText>
                          </Pressable>
                        )}
                      </View>

                      {/* Room Options List */}
                      <View style={{ maxHeight: 220 }}>
                        <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
                          {/* Option to assign to custom typed room */}
                          {isCustomRoomQuery && (
                            <Pressable
                              onPress={() => {
                                triggerHaptic();
                                setSelectedRoomId(`custom:${roomSearchQuery.trim()}`);
                              }}
                              style={[
                                styles.roomOptionItem,
                                isDark ? styles.roomOptionDark : styles.roomOptionLight,
                                selectedRoomId === `custom:${roomSearchQuery.trim()}` && styles.roomOptionActive,
                                { borderColor: UiColors[effectiveTheme].border, borderStyle: 'dashed', borderWidth: 1.5 },
                              ]}
                            >
                              <View style={{ flex: 1 }}>
                                <ThemedText style={[styles.roomOptionText, { color: UiColors[effectiveTheme].emerald, fontWeight: '800' }]}>
                              + Assign to &quot;{roomSearchQuery.trim()}&quot;
                                </ThemedText>
                                <ThemedText style={styles.roomOptionSubText}>
                                  Custom room location
                                </ThemedText>
                              </View>
                              {selectedRoomId === `custom:${roomSearchQuery.trim()}` && (
                                <ThemedText style={{ color: UiColors[effectiveTheme].emerald, fontWeight: '800' }}>✓</ThemedText>
                              )}
                            </Pressable>
                          )}

                          {/* Unassigned Option */}
                          {(!roomSearchQuery || 'unassigned'.includes(roomSearchQuery.toLowerCase())) && (
                            <Pressable
                              onPress={() => {
                                triggerHaptic();
                                setSelectedRoomId(null);
                                setRoomSearchQuery('');
                              }}
                              style={[
                                styles.roomOptionItem,
                                isDark ? styles.roomOptionDark : styles.roomOptionLight,
                                selectedRoomId === null && styles.roomOptionActive,
                              ]}
                            >
                              <ThemedText style={[styles.roomOptionText, selectedRoomId === null && { color: UiColors[effectiveTheme].emerald, fontWeight: '800' }, isDark && selectedRoomId !== null && styles.textWhite]}>
                                — Unassigned (Assign Later) —
                              </ThemedText>
                              {selectedRoomId === null && (
                                <ThemedText style={{ color: UiColors[effectiveTheme].emerald, fontWeight: '800' }}>✓</ThemedText>
                              )}
                            </Pressable>
                          )}

                          {/* Filtered Rooms */}
                          {filteredRooms.map((room) => {
                            const isSel = selectedRoomId === room.id;
                            return (
                              <Pressable
                                key={room.id}
                                onPress={() => {
                                  triggerHaptic();
                                  setSelectedRoomId(room.id);
                                  setRoomSearchQuery(room.name);
                                  // Aircon brand is NOT auto-assigned - must be custom assigned by the user
                                  if (room.airconType && !selectedAirconType) {
                                    setSelectedAirconType(room.airconType);
                                  }
                                  if (!friendlyName.trim()) {
                                    setCustomAirconName(room.airconName || `${room.name} Aircon`);
                                  }
                                }}
                                style={[
                                  styles.roomOptionItem,
                                  isDark ? styles.roomOptionDark : styles.roomOptionLight,
                                  isSel && styles.roomOptionActive,
                                ]}
                              >
                                <View style={{ flex: 1, gap: 3 }}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 4 }}>
                                    <ThemedText style={[styles.roomOptionText, isSel && { color: UiColors[effectiveTheme].emerald, fontWeight: '800' }, isDark && !isSel && styles.textWhite]}>
                                      {room.name}
                                    </ThemedText>
                                    {room.airconBrand ? (
                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: isDark ? UiColors[effectiveTheme].accentSurface : UiColors[effectiveTheme].accentSurface, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }}>
                                        <AppIcon name="bolt" size={10} color={isDark ? '#34d399' : '#059669'} />
                                        <ThemedText style={{ fontSize: 10.5, fontWeight: '800', color: isDark ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].text }}>
                                          {room.airconBrand}
                                        </ThemedText>
                                      </View>
                                    ) : null}
                                  </View>
                                  <ThemedText style={styles.roomOptionSubText}>
                                    {room.buildingName} • {room.floorName}
                                    {room.airconType ? ` • ${room.airconType}` : ''}
                                    {room.nodeName ? ` • Node: ${room.nodeName}` : ''}
                                  </ThemedText>
                                </View>
                                {isSel && (
                                  <ThemedText style={{ color: UiColors[effectiveTheme].emerald, fontWeight: '800', fontSize: 16 }}>✓</ThemedText>
                                )}
                              </Pressable>
                            );
                          })}

                          {filteredRooms.length === 0 && !isCustomRoomQuery && (
                            <ThemedText style={{ textAlign: 'center', color: UiColors[effectiveTheme].textMuted, fontSize: 12, paddingVertical: 12 }}>
                              No matching rooms found.
                            </ThemedText>
                          )}
                        </ScrollView>
                      </View>

                      {/* Inline Custom Aircon Name & Brand for Selected Room */}
                      <View style={{ marginTop: 12, padding: 14, borderRadius: 12, backgroundColor: isDark ? '#062016' : UiColors[effectiveTheme].accentSurface, borderWidth: 1.2, borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <AppIcon name="bolt" size={13} color={UiColors[effectiveTheme].emerald} />
                            <ThemedText style={{ fontSize: 11.5, fontWeight: '800', color: isDark ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].emerald }}>
                              Aircon Assignment & Custom Name
                            </ThemedText>
                          </View>
                          {selectedRoomDisplayName && (
                            <ThemedText style={{ fontSize: 10.5, color: UiColors[effectiveTheme].emerald, fontWeight: '700' }}>
                              Auto-Bound: {selectedRoomDisplayName}
                            </ThemedText>
                          )}
                        </View>

                        {/* Custom Name Input */}
                        <ThemedText style={{ fontSize: 11, color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary, marginBottom: 4, fontWeight: '600' }}>
                          Custom Aircon Name:
                        </ThemedText>
                        <TextInput
                          style={[styles.inputField, isDark ? styles.inputFieldDark : styles.inputFieldLight, { fontSize: 13, paddingVertical: 8, marginBottom: 10 }]}
                          placeholder="e.g. Lab 4 Daikin Inverter AC"
                          placeholderTextColor={UiColors[effectiveTheme].textMuted}
                          value={customAirconName}
                          onChangeText={setCustomAirconName}
                          editable={!assignmentId}
                        />

                        {/* Custom Aircon Brand Input for this room */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <ThemedText style={{ fontSize: 11, color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary, fontWeight: '600' }}>
                            Custom Aircon Brand:
                          </ThemedText>
                          <ThemedText style={{ fontSize: 10.5, color: UiColors[effectiveTheme].emerald, fontWeight: '700' }}>
                            {selectedBrand ? `Custom: ${selectedBrand}` : 'Type / Select Brand'}
                          </ThemedText>
                        </View>
                        <TextInput
                          style={[styles.inputField, isDark ? styles.inputFieldDark : styles.inputFieldLight, { fontSize: 13, paddingVertical: 8, marginBottom: 8 }]}
                          placeholder="Custom assign brand (e.g. Daikin, Carrier, Koppel)..."
                          placeholderTextColor={UiColors[effectiveTheme].textMuted}
                          value={selectedBrand}
                          onChangeText={handleManualBrandChange}
                        />

                        {/* Quick Brand Switcher Pills */}
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row' }}>
                          {['Daikin', 'Carrier', 'Koppel', 'Panasonic', 'LG', 'Mitsubishi', 'Samsung', 'Midea', 'Gree', 'Condura'].map((b) => {
                            const isBrandSel = selectedBrand.trim().toLowerCase() === b.toLowerCase();
                            return (
                              <Pressable
                                key={b}
                                onPress={() => {
                                  triggerHaptic();
                                  handleManualBrandChange(b);
                                }}
                                style={[
                                  styles.airconPill,
                                  isDark ? styles.airconPillDark : styles.airconPillLight,
                                  isBrandSel && styles.airconPillActive,
                                  { paddingVertical: 4, paddingHorizontal: 10, marginEnd: 6 },
                                ]}
                              >
                                <ThemedText style={[styles.airconPillText, { fontSize: 11 }, isBrandSel && { color: UiColors[effectiveTheme].onPrimary, fontWeight: '800' }]}>
                                  {b}
                                </ThemedText>
                              </Pressable>
                            );
                          })}
                        </ScrollView>
                      </View>
                    </View>

                    <Pressable
                      onPress={handleSaveNewDevice}
                      disabled={savingDevice || isListeningRemote}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        { backgroundColor: colors.primaryFill, marginTop: 22 },
                        isListeningRemote && { opacity: 0.5 },
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      {savingDevice ? (
                        <ActivityIndicator size="small" color={UiColors[effectiveTheme].onPrimary} />
                      ) : (
                        <ThemedText style={styles.primaryButtonText}>Save & Verify Device</ThemedText>
                      )}
                    </Pressable>
                  </View>
                )}

                {/* STEP 6: SUCCESS */}
                {addStep === 'success' && (
                  <View style={styles.wizardCenterBox}>
                    <View style={styles.successBadgeCircle}>
                      <ThemedText style={{ fontSize: 32, color: UiColors[effectiveTheme].onPrimary, fontWeight: '900' }}>✓</ThemedText>
                    </View>
                    <ThemedText style={[styles.wizardTitle, { marginTop: 16 }, isDark && styles.textWhite]}>
                      Aircon Registered Successfully
                    </ThemedText>
                    <ThemedText style={styles.wizardSubtitle}>
                      {newlyCreatedDevice?.name} ({displayDeviceId(newlyCreatedDevice?.deviceId)})
                    </ThemedText>

                    {/* Summary card */}
                    <View style={[styles.successSummaryBox, isDark ? styles.successBoxDark : styles.successBoxLight]}>
                      <View style={styles.summaryRow}>
                        <ThemedText style={styles.summaryLabel}>Aircon Brand</ThemedText>
                        <ThemedText style={[styles.summaryValue, { color: UiColors[effectiveTheme].emerald, fontWeight: '800' }]}>
                          {selectedBrand.trim() || 'Custom Brand'}
                        </ThemedText>
                      </View>
                      <View style={styles.summaryRow}>
                        <ThemedText style={styles.summaryLabel}>Aircon Name</ThemedText>
                        <ThemedText style={[styles.summaryValue, isDark ? styles.textWhite : { color: UiColors[effectiveTheme].text }]} numberOfLines={1}>
                          {newlyCreatedDevice?.name}
                        </ThemedText>
                      </View>

                      <View style={styles.summaryRow}>
                        <ThemedText style={styles.summaryLabel}>Node ID</ThemedText>
                        <View style={[styles.idBadge, isDark ? styles.idBadgeDark : styles.idBadgeLight]}>
                          <ThemedText style={styles.idBadgeText} numberOfLines={1}>
                            {displayDeviceId(newlyCreatedDevice?.id || targetBleDevice?.deviceId)}
                          </ThemedText>
                        </View>
                      </View>

                      <View style={styles.summaryRow}>
                        <ThemedText style={styles.summaryLabel}>Status</ThemedText>
                        <View style={styles.statusSuccessPill}>
                          <View style={styles.statusSuccessDot} />
                          <ThemedText style={styles.statusSuccessText}>Online / Active</ThemedText>
                        </View>
                      </View>

                      <View style={styles.summaryRow}>
                        <ThemedText style={styles.summaryLabel}>Aircon Type</ThemedText>
                        <ThemedText style={[styles.summaryValue, isDark ? styles.textWhite : { color: UiColors[effectiveTheme].text }]} numberOfLines={1}>
                          {newlyCreatedDevice?.airconType || selectedAirconType || 'Split Type (Inverter)'}
                        </ThemedText>
                      </View>

                      <View style={[styles.summaryDivider, isDark ? styles.summaryDividerDark : styles.summaryDividerLight]} />

                      {/* Room Assignment with dedicated card & icon */}
                      <View style={styles.summaryLocationSection}>
                        <ThemedText style={styles.summaryLabel}>Room Assignment</ThemedText>
                        <View style={[styles.summaryLocationCard, isDark ? styles.summaryLocationCardDark : styles.summaryLocationCardLight]}>
                          <View style={styles.summaryLocationIconCircle}>
                            <LocationIcon size={14} color={UiColors[effectiveTheme].emerald} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <ThemedText style={[styles.summaryRoomTitle, isDark && styles.textWhite]}>
                              {newlyCreatedDevice?.room || '— Unassigned (Assign Later) —'}
                            </ThemedText>
                            {(newlyCreatedDevice?.building || newlyCreatedDevice?.floor) && (
                              <ThemedText style={styles.summaryLocationSubtitle} numberOfLines={2}>
                                {[newlyCreatedDevice?.building, newlyCreatedDevice?.floor].filter(Boolean).join(' • ')}
                              </ThemedText>
                            )}
                          </View>
                        </View>
                      </View>
                    </View>

                    <Pressable
                      onPress={() => {
                        handleCloseAddModal();
                        if (newlyCreatedDevice) {
                          handleOpenDetails(newlyCreatedDevice);
                        }
                      }}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        { backgroundColor: colors.primaryFill, width: '100%', marginTop: 20 },
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <ThemedText style={styles.primaryButtonText}>View Device Details</ThemedText>
                    </Pressable>

                    <Pressable
                      onPress={handleCloseAddModal}
                      style={styles.textLinkBtn}
                    >
                      <ThemedText style={styles.textLinkBtnText}>Done</ThemedText>
                    </Pressable>
                  </View>
                )}
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* ========================================================================= */}
        {/* 2. DEVICE DETAILS BOTTOM SHEET MODAL                                      */}
        {/* ========================================================================= */}
        <Modal
          visible={detailsModalVisible}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setDetailsModalVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalContent, isDark ? styles.modalContentDark : styles.modalContentLight]}>
              <View style={[styles.modalHeader, isDark && styles.modalHeaderDark]}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <ThemedText style={[styles.modalTitle, isDark && styles.textWhite]}>
                    {selectedDevice?.name}
                  </ThemedText>
                  <ThemedText style={{ fontSize: 12, color: selectedDevice?.status === 'connected' ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].error, fontWeight: '700' }}>
                    {displayDeviceId(selectedDevice?.deviceId)} • {selectedDevice?.status === 'connected' ? '● Online' : '● Offline'}
                  </ThemedText>
                </View>
                <Pressable hitSlop={12} onPress={() => setDetailsModalVisible(false)}>
                  <ThemedText style={styles.closeModalText}>Close</ThemedText>
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={styles.modalScrollBody} showsVerticalScrollIndicator={false}>
                {/* 1. HARDWARE CONFIGURATION (Matching Desktop Admin) */}
                <ThemedText style={[styles.sectionTitle, isDark ? styles.textEmeraldLight : styles.textEmeraldDark, { marginTop: 4, letterSpacing: 0.5, textTransform: 'uppercase' }]}>
                  Device status
                </ThemedText>

                <View style={[styles.infoList, isDark ? styles.infoListDark : styles.infoListLight]}>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>Status</ThemedText>
                    <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: selectedDevice?.status === 'connected' ? UiColors[effectiveTheme].primaryFill : '#ef4444' }} />
                      <ThemedText style={[styles.infoVal, { flex: 0, color: selectedDevice?.status === 'connected' ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].error, fontWeight: '800' }]}>
                        {selectedDevice?.status === 'connected' ? 'Online' : 'Offline'}
                      </ThemedText>
                    </View>
                  </View>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>Software version</ThemedText>
                    <ThemedText style={[styles.infoVal, isDark && styles.textWhite, { fontWeight: '700' }]}>
                      {functionalDeviceText(selectedDevice?.firmwareVersion || '—')}
                    </ThemedText>
                  </View>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>Device identifier</ThemedText>
                    <ThemedText style={[styles.infoVal, isDark && styles.textWhite]}>
                      {displayDeviceId(selectedDevice?.macAddress || selectedDevice?.deviceId || selectedDevice?.id)}
                    </ThemedText>
                  </View>
                  {(selectedDevice?.deviceMode === 'monitoring' || selectedDevice?.deviceMode === 'both') && <>
                    <View style={styles.infoRow}>
                      <ThemedText style={styles.infoKey}>Temperature</ThemedText>
                      <ThemedText style={[styles.infoVal, isDark && styles.textWhite]}>{typeof selectedDevice?.temp === 'number' && Number.isFinite(selectedDevice.temp) ? formatTemperatureDisplay(selectedDevice.temp) : 'Unavailable'}</ThemedText>
                    </View>
                    <View style={styles.infoRow}>
                      <ThemedText style={styles.infoKey}>Airflow Indicator (RPM)</ThemedText>
                      <ThemedText style={[styles.infoVal, isDark && styles.textWhite]}>{airflowRpmText(selectedDevice?.rotation_rpm, selectedDevice?.rotation_quality)}</ThemedText>
                    </View>
                  </>}
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>Battery Level</ThemedText>
                    <ThemedText style={[styles.infoVal, isDark && styles.textWhite]}>
                      {formatBatteryPercent(selectedDevice?.battery)}
                    </ThemedText>
                  </View>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>Connection Latency</ThemedText>
                    <ThemedText style={[styles.infoVal, isDark && styles.textWhite]}>
                      {testingConnection ? 'Checking…' : formatConnectionLatency(testResult)}
                    </ThemedText>
                  </View>
                </View>

                {/* 2. DEVICE CONFIGURATION (Matching Desktop Admin) */}
                <ThemedText style={[styles.sectionTitle, isDark ? styles.textEmeraldLight : styles.textEmeraldDark, { marginTop: 16, letterSpacing: 0.5, textTransform: 'uppercase' }]}>
                  Device Configuration
                </ThemedText>

                <View style={[styles.infoList, isDark ? styles.infoListDark : styles.infoListLight]}>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>Custom Aircon Name</ThemedText>
                    <ThemedText style={[styles.infoVal, { color: UiColors[effectiveTheme].emerald, fontWeight: '800' }]}>
                      {selectedDevice?.airconName || 'Name unavailable'}
                    </ThemedText>
                  </View>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>IR Protocol</ThemedText>
                    <ThemedText style={[styles.infoVal, isDark && styles.textWhite]}>
                      {selectedDevice?.protocolName || 'Unverified'}
                    </ThemedText>
                  </View>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>Aircon Type</ThemedText>
                    <ThemedText style={[styles.infoVal, isDark && styles.textWhite]}>
                      {selectedDevice?.airconType || '—'}
                    </ThemedText>
                  </View>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>Assigned Room</ThemedText>
                    <ThemedText style={[styles.infoVal, { color: UiColors[effectiveTheme].emerald, fontWeight: '700' }]}>
                      {[selectedDevice?.building, selectedDevice?.floor, selectedDevice?.room].filter(Boolean).join(' • ') || (selectedDevice?.roomId ? 'Room details unavailable' : 'Unassigned')}
                    </ThemedText>
                  </View>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>Rule / Daily Schedule</ThemedText>
                    <ThemedText style={[styles.infoVal, isDark && styles.textWhite]}>
                      {selectedDevice?.wakeTime && selectedDevice?.sleepTime ? `${selectedDevice.wakeTime} - ${selectedDevice.sleepTime}` : '—'}
                    </ThemedText>
                  </View>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>Database Node ID</ThemedText>
                    <ThemedText style={[styles.infoVal, isDark && styles.textWhite]}>{displayDeviceId(selectedDevice?.id)}</ThemedText>
                  </View>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>Date Installed</ThemedText>
                    <ThemedText style={[styles.infoVal, isDark && styles.textWhite]}>{selectedDevice?.dateAdded}</ThemedText>
                  </View>
                </View>

                {/* Connection Diagnostics Test Result */}
                {testResult && (
                  <View style={[styles.testResultBox, isDark ? styles.testBoxDark : styles.testBoxLight, !testResult.online && { backgroundColor: UiColors[effectiveTheme].errorSurface, borderColor: UiColors[effectiveTheme].border }]}>
                    <ThemedText style={{ fontWeight: '800', color: testResult.online ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].error, fontSize: 13 }}>
                      {testResult.online ? '✓ Cloud AC Device Reached' : testResult.connectionState === 'online'
                        ? 'Cloud Online · Ping Not Confirmed' : testResult.connectionState === 'sleeping'
                        ? 'AC Device Sleeping' : testResult.connectionState === 'offline'
                        ? 'AC Device Offline' : 'Connection Test Not Confirmed'}
                    </ThemedText>
                    <ThemedText style={{ fontSize: 12, color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary, marginTop: 4 }}>
                      {testResult.online ? `Cloud round trip: ${formatConnectionLatency(testResult)} • Device acknowledgement verified`
                        : `${testResult.connectionState === 'online' ? 'A recent heartbeat is available, but the ping was not acknowledged. ' : ''}${testResult.error || testResult.wifiSignal || 'Response time unavailable.'}`}
                    </ThemedText>
                  </View>
                )}

                {/* Actions Section */}
                <ThemedText style={[styles.sectionTitle, isDark ? styles.textEmeraldLight : styles.textEmeraldDark, { marginTop: 16 }]}>
                  Device Actions
                </ThemedText>

                <View style={styles.actionsColumn}>
                  <Pressable
                    onPress={() => { void handleRunConnectionTest(); }}
                    disabled={testingConnection}
                    style={({ pressed }) => [
                      styles.actionBtn,
                      isDark ? styles.actionBtnDark : styles.actionBtnLight,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    {testingConnection ? (
                      <ActivityIndicator size="small" color={UiColors[effectiveTheme].emerald} />
                    ) : (
                      <ThemedText style={{ color: UiColors[effectiveTheme].emerald, fontWeight: '800', fontSize: 13.5 }}>
                        Test Live Connection
                      </ThemedText>
                    )}
                  </Pressable>

                  <Pressable
                    onPress={handlePromptRename}
                    style={({ pressed }) => [
                      styles.actionBtn,
                      isDark ? styles.actionBtnDark : styles.actionBtnLight,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <ThemedText style={{ color: isDark ? UiColors[effectiveTheme].onPrimary : UiColors[effectiveTheme].text, fontWeight: '700', fontSize: 13.5 }}>
                      Rename AC Device
                    </ThemedText>
                  </Pressable>

                  <Pressable
                    onPress={handlePromptChangeRoom}
                    style={({ pressed }) => [
                      styles.actionBtn,
                      isDark ? styles.actionBtnDark : styles.actionBtnLight,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <ThemedText style={{ color: isDark ? UiColors[effectiveTheme].onPrimary : UiColors[effectiveTheme].text, fontWeight: '700', fontSize: 13.5 }}>
                      Reassign Room Location
                    </ThemedText>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      if (selectedDevice) {
                        handleStartReconfigureWifi(selectedDevice);
                      }
                    }}
                    style={({ pressed }) => [
                      styles.actionBtn,
                      isDark ? styles.actionBtnDark : styles.actionBtnLight,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <ThemedText style={{ color: isDark ? UiColors[effectiveTheme].onPrimary : UiColors[effectiveTheme].text, fontWeight: '700', fontSize: 13.5 }}>
                      Reconfigure Wi-Fi
                    </ThemedText>
                  </Pressable>

                  <Pressable
                    onPress={() => setRemoveConfirmVisible(true)}
                    style={({ pressed }) => [
                      styles.actionBtnDestructive,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <ThemedText style={{ color: UiColors[effectiveTheme].error, fontWeight: '800', fontSize: 13.5 }}>
                      Remove Node
                    </ThemedText>
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* ========================================================================= */}
        {/* 3. DEVICE OPTIONS (3-DOT) MODAL                                           */}
        {/* ========================================================================= */}
        <Modal
          visible={optionsModalVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setOptionsModalVisible(false)}
        >
          <Pressable
            style={styles.optionsBackdrop}
            onPress={() => setOptionsModalVisible(false)}
          >
            <View style={[styles.optionsPopup, isDark ? styles.optionsPopupDark : styles.optionsPopupLight]}>
              <ThemedText style={[styles.optionsPopupTitle, isDark && styles.textWhite]}>
                Node Options
              </ThemedText>

              <Pressable
                onPress={() => {
                  setOptionsModalVisible(false);
                  if (selectedDevice) handleOpenDetails(selectedDevice);
                }}
                style={styles.optionRow}
              >
                <ThemedText style={[styles.optionRowText, isDark && styles.textWhite]}>View Details</ThemedText>
              </Pressable>

              <Pressable onPress={handlePromptRename} style={styles.optionRow}>
                <ThemedText style={[styles.optionRowText, isDark && styles.textWhite]}>Rename AC Device</ThemedText>
              </Pressable>

              <Pressable onPress={handlePromptChangeRoom} style={styles.optionRow}>
                <ThemedText style={[styles.optionRowText, isDark && styles.textWhite]}>Change Room Assignment</ThemedText>
              </Pressable>

              <Pressable
                onPress={() => {
                  if (selectedDevice) {
                    handleStartReconfigureWifi(selectedDevice);
                  }
                }}
                style={styles.optionRow}
              >
                <ThemedText style={[styles.optionRowText, isDark && styles.textWhite]}>Reconfigure Wi-Fi</ThemedText>
              </Pressable>

              <Pressable
                onPress={() => {
                  setOptionsModalVisible(false);
                  if (selectedDevice) {
                    handleOpenDetails(selectedDevice);
                  }
                }}
                style={styles.optionRow}
              >
                <ThemedText style={[styles.optionRowText, isDark && styles.textWhite]}>Test Connection</ThemedText>
              </Pressable>

              <Pressable
                onPress={() => {
                  setOptionsModalVisible(false);
                  setRemoveConfirmVisible(true);
                }}
                style={[styles.optionRow, { borderBottomWidth: 0 }]}
              >
                <ThemedText style={[styles.optionRowText, { color: UiColors[effectiveTheme].error, fontWeight: '800' }]}>
                  Remove Node
                </ThemedText>
              </Pressable>
            </View>
          </Pressable>
        </Modal>

        {/* ========================================================================= */}
        {/* 3.5. RECONFIGURE WI-FI MODAL                                              */}
        {/* ========================================================================= */}
        <Modal
          visible={reconfigModalVisible}
          animationType="slide"
          transparent={true}
          onRequestClose={handleCloseReconfigureWifi}
        >
          <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[styles.modalContent, isDark ? styles.modalContentDark : styles.modalContentLight]}>
              {/* Modal Header */}
              <View style={[styles.modalHeader, isDark && styles.modalHeaderDark]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <ThemedText style={[styles.modalTitle, isDark && styles.textWhite]}>
                    Reconfigure Wi-Fi
                  </ThemedText>
                  <ThemedText style={{ fontSize: 12, color: UiColors[effectiveTheme].emerald, fontWeight: '700' }}>
                    {selectedDevice?.name} ({displayDeviceId(selectedDevice?.deviceId)})
                  </ThemedText>
                </View>
                <Pressable hitSlop={12} onPress={handleCloseReconfigureWifi}>
                  <ThemedText style={styles.closeModalText}>Cancel</ThemedText>
                </Pressable>
              </View>

              {/* Step Progress Bar */}
              {reconfigStep !== 'success' && (
                <View style={styles.stepProgressBar}>
                  <View style={styles.stepNodesRow}>
                    {(['connect', 'wifi', 'verifying'] as ReconfigureStep[]).map((st, idx) => {
                      const stepNum = idx + 1;
                      const isPassed =
                        (reconfigStep === 'wifi' && idx < 1) ||
                        (reconfigStep === 'verifying' && idx < 2);
                      const isCurrent = reconfigStep === st;

                      return (
                        <React.Fragment key={st}>
                          <View style={styles.stepNodeContainer}>
                            <View
                              style={[
                                styles.stepNodeCircle,
                                isCurrent
                                  ? styles.stepNodeCircleCurrent
                                  : isPassed
                                  ? styles.stepNodeCirclePassed
                                  : isDark
                                  ? styles.stepNodeCircleFutureDark
                                  : styles.stepNodeCircleFutureLight,
                              ]}
                            >
                              <ThemedText
                                style={[
                                  styles.stepNodeText,
                                  isCurrent || isPassed ? styles.textWhite : { color: UiColors[effectiveTheme].textMuted },
                                ]}
                              >
                                {isPassed ? '✓' : stepNum}
                              </ThemedText>
                            </View>
                            <ThemedText style={styles.stepNodeLabel}>
                              {st === 'connect'
                                ? 'Bluetooth'
                                : st === 'wifi'
                                ? 'Wi-Fi'
                                : 'Verify'}
                            </ThemedText>
                          </View>
                          {idx < 2 && (
                            <View
                              style={[
                                styles.stepConnectorLine,
                                isPassed ? styles.stepLineActive : (isDark ? styles.stepLineDark : styles.stepLineLight),
                              ]}
                            />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </View>
                </View>
              )}

              <ScrollView contentContainerStyle={styles.modalScrollBody} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {/* STEP 1: BLUETOOTH CONNECT */}
                {reconfigStep === 'connect' && (
                  <View style={styles.wizardSection}>
                    <View style={styles.wizardHeaderCenter}>
                      <Animated.View style={[styles.radarCircle, { transform: [{ scale: pulseAnim }] }]}>
                        <AppIcon
                          name="bluetooth"
                          size={28}
                          color={UiColors[effectiveTheme].emerald}
                        />
                      </Animated.View>
                      <ThemedText style={[styles.wizardTitle, isDark && styles.textWhite]}>
                        Connect to AC Device
                      </ThemedText>
                      <ThemedText style={styles.wizardSubtitle}>
                        Pair with {selectedDevice?.name} ({displayDeviceId(selectedDevice?.deviceId)}) over Bluetooth to update Wi-Fi settings.
                      </ThemedText>
                    </View>

                    {/* Device Info Overview Card */}
                    <View style={[styles.infoList, isDark ? styles.infoListDark : styles.infoListLight, { marginTop: 12 }]}>
                      <View style={styles.infoRow}>
                        <ThemedText style={styles.infoKey}>Target Device</ThemedText>
                        <ThemedText style={[styles.infoVal, { color: UiColors[effectiveTheme].emerald, fontWeight: '800' }]}>
                          {selectedDevice?.name}
                        </ThemedText>
                      </View>
                      <View style={styles.infoRow}>
                        <ThemedText style={styles.infoKey}>Device ID</ThemedText>
                        <ThemedText style={[styles.infoVal, isDark && styles.textWhite]}>
                          {displayDeviceId(selectedDevice?.deviceId)}
                        </ThemedText>
                      </View>
                      <View style={styles.infoRow}>
                        <ThemedText style={styles.infoKey}>Current Wi-Fi</ThemedText>
                        <ThemedText style={[styles.infoVal, isDark && styles.textWhite]}>
                          {selectedDevice?.wifiSsid || 'Disconnected'}
                        </ThemedText>
                      </View>
                    </View>

                    {Platform.OS === 'web' && (
                      <ThemedText style={[styles.wizardSubtitle, { marginTop: 14 }]}>
                        {reconfigBluetooth.message}
                      </ThemedText>
                    )}

                    {reconfigError && (
                      <View style={[styles.errorBanner, { marginTop: 14 }]}>
                        <AppIcon
                          name="alert"
                          size={18}
                          color={UiColors[effectiveTheme].error}
                        />
                        <ThemedText style={styles.errorText}>{reconfigError}</ThemedText>
                      </View>
                    )}

                    <Pressable
                      onPress={handleConnectBleForReconfigure}
                      disabled={reconfigConnecting || !reconfigBluetooth.available}
                      accessibilityState={{ disabled: reconfigConnecting || !reconfigBluetooth.available, busy: reconfigConnecting }}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        { backgroundColor: colors.primaryFill, marginTop: 22 },
                        !reconfigBluetooth.available && { opacity: 0.5 },
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      {reconfigConnecting ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <ActivityIndicator size="small" color={UiColors[effectiveTheme].onPrimary} />
                          <ThemedText style={styles.primaryButtonText}>Connecting to {displayDeviceId(selectedDevice?.deviceId)}...</ThemedText>
                        </View>
                      ) : (
                        <ThemedText style={styles.primaryButtonText}>{reconfigBluetooth.available ? 'Connect to AC Device' : 'Bluetooth Unavailable'}</ThemedText>
                      )}
                    </Pressable>
                  </View>
                )}

                {/* STEP 2: SELECT WI-FI NETWORK */}
                {reconfigStep === 'wifi' && (
                  <View style={styles.wizardSection}>
                    <View style={styles.wizardHeaderCenter}>
                      <View style={styles.iconCircleEmerald}>
                        <AppIcon
                          name="wifi"
                          size={28}
                          color={UiColors[effectiveTheme].emerald}
                        />
                      </View>
                      <ThemedText style={[styles.wizardTitle, isDark && styles.textWhite]}>
                        Select New Wi-Fi Network
                      </ThemedText>
                      <ThemedText style={styles.wizardSubtitle}>
                        Choose network for {selectedDevice?.name}.
                      </ThemedText>
                    </View>

                    {/* Error Banner when connection/password fails */}
                    {reconfigError && (
                      <View style={[styles.errorBanner, { marginBottom: 14 }]}>
                        <AppIcon name="alert" size={18} color={UiColors[effectiveTheme].error} />
                        <ThemedText style={styles.errorText}>{reconfigError}</ThemedText>
                      </View>
                    )}

                    {/* AUTO-SEARCHED WI-FI NETWORKS (Reconfigure) */}
                    <View style={styles.inputGroup}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, flexShrink: 1, minWidth: 0 }}>
                          <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight, { marginBottom: 0 }]} numberOfLines={1}>
                            Known Wi-Fi Networks
                          </ThemedText>
                          {reconfigScanningWifi ? (
                            <ActivityIndicator size="small" color={UiColors[effectiveTheme].emerald} style={{ transform: [{ scale: 0.8 }] }} />
                          ) : (
                            reconfigWifiNetworks.length > 0 && (
                              <View style={styles.savedNetMiniBadge}>
                                <ThemedText style={styles.savedNetMiniBadgeText}>{reconfigWifiNetworks.length} Found</ThemedText>
                              </View>
                            )
                          )}
                        </View>
                        <Pressable
                          onPress={() => {
                            triggerHaptic();
                            handleScanReconfigWifi(true, true);
                          }}
                          disabled={reconfigScanningWifi}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={({ pressed }) => [
                            styles.rescanWifiBtn,
                            isDark ? styles.rescanWifiBtnDark : styles.rescanWifiBtnLight,
                            reconfigScanningWifi && { opacity: 0.6 },
                            pressed && { opacity: 0.75 },
                          ]}
                        >
                          {reconfigScanningWifi ? (
                            <ActivityIndicator size="small" color={UiColors[effectiveTheme].emerald} style={{ transform: [{ scale: 0.75 }] }} />
                          ) : (
                            <AppIcon name="refresh" size={13} color={UiColors[effectiveTheme].emerald} />
                          )}
                          <ThemedText style={styles.rescanWifiBtnText}>
                            {reconfigScanningWifi ? 'Searching...' : 'Auto Search'}
                          </ThemedText>
                        </Pressable>
                      </View>

                      {/* Auto-searching Progress Banner */}
                      {reconfigScanningWifi ? (
                        <View style={[styles.wifiScanningBanner, isDark ? styles.wifiScanningBannerDark : styles.wifiScanningBannerLight]}>
                          <ActivityIndicator size="small" color={UiColors[effectiveTheme].emerald} />
                          <View style={{ flex: 1, gap: 2 }}>
                            <ThemedText style={[styles.wifiScanningTitle, isDark ? styles.textWhite : { color: UiColors[effectiveTheme].text }]}>
                              Checking phone Wi-Fi...
                            </ThemedText>
                            <ThemedText style={styles.wifiScanningSubtitle}>
                              Reading the connected phone network and saved facility profiles
                            </ThemedText>
                          </View>
                        </View>
                      ) : reconfigWifiNetworks.length > 0 ? (
                        <View style={styles.discoveredWifiList}>
                          {reconfigWifiNetworks.map((net) => {
                            const isSelected = reconfigSelectedSsid.toLowerCase().trim() === net.ssid.toLowerCase().trim();
                            return (
                              <Pressable
                                key={net.ssid}
                                onPress={() => {
                                  triggerHaptic();
                                  setReconfigSelectedSsid(net.ssid);
                                }}
                                style={({ pressed }) => [
                                  styles.wifiItemCard,
                                  isDark ? styles.wifiItemCardDark : styles.wifiItemCardLight,
                                  isSelected && (isDark ? styles.wifiItemCardActiveDark : styles.wifiItemCardActiveLight),
                                  pressed && { opacity: 0.85 },
                                ]}
                              >
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                                  <View style={[
                                    styles.wifiSignalIconCircle,
                                    isSelected
                                      ? { backgroundColor: UiColors[effectiveTheme].accentSurface }
                                      : (isDark ? { backgroundColor: 'rgba(255, 255, 255, 0.05)' } : { backgroundColor: UiColors[effectiveTheme].backgroundSelected }),
                                  ]}>
                                    <AppIcon
                                      name="wifi"
                                      size={16}
                                      color={isSelected ? '#10b981' : isDark ? '#94a3b8' : '#64748b'}
                                    />
                                  </View>

                                  <View style={{ flex: 1, gap: 2 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                      <ThemedText
                                        style={[
                                          styles.wifiItemSsid,
                                          isDark && styles.textWhite,
                                          isSelected && { color: UiColors[effectiveTheme].emerald, fontWeight: '800' },
                                        ]}
                                        numberOfLines={1}
                                      >
                                        {net.ssid}
                                      </ThemedText>
                                      {net.isConnectedPhone ? (
                                        <View style={styles.savedNetMiniBadge}>
                                          <ThemedText style={styles.savedNetMiniBadgeText}>Connected Phone Wi-Fi</ThemedText>
                                        </View>
                                      ) : net.isSaved ? (
                                        <View style={styles.savedNetMiniBadge}>
                                          <ThemedText style={styles.savedNetMiniBadgeText}>Saved</ThemedText>
                                        </View>
                                      ) : (
                                        <View style={[styles.savedNetMiniBadge, { backgroundColor: isDark ? 'rgba(59, 130, 246, 0.2)' : UiColors[effectiveTheme].infoSurface }]}>
                                          <ThemedText style={[styles.savedNetMiniBadgeText, { color: UiColors[effectiveTheme].info }]}>Registered Network</ThemedText>
                                        </View>
                                      )}
                                    </View>
                                    <ThemedText style={styles.wifiItemMeta}>
                                      {net.isConnectedPhone ? `${net.frequency || 'Band unknown'} • AC Device requires 2.4 GHz` : 'Known network • Confirm availability and 2.4 GHz'}
                                    </ThemedText>
                                  </View>
                                </View>

                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                  <View style={[
                                    styles.wifiRadioBadge,
                                    isSelected && { backgroundColor: UiColors[effectiveTheme].primaryFill, borderColor: UiColors[effectiveTheme].border },
                                    isDark && !isSelected && { borderColor: UiColors[effectiveTheme].border },
                                  ]}>
                                    {isSelected ? (
                                      <ThemedText style={{ color: UiColors[effectiveTheme].onPrimary, fontSize: 11, fontWeight: '900' }}>✓</ThemedText>
                                    ) : null}
                                  </View>
                                </View>
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : (
                        <View style={[styles.wifiEmptyCard, isDark ? styles.wifiEmptyCardDark : styles.wifiEmptyCardLight]}>
                          <View style={styles.wifiEmptyIconCircle}>
                            <AppIcon name="wifi" size={18} color={UiColors[effectiveTheme].emerald} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <ThemedText style={[styles.wifiEmptyTitle, isDark && styles.textWhite]}>
                              No connected or known Wi-Fi names found
                            </ThemedText>
                            <ThemedText style={styles.wifiEmptySubtitle}>
                              Connect your phone to Wi-Fi and tap &quot;Auto Search&quot;, or enter the network name below.
                            </ThemedText>
                          </View>
                        </View>
                      )}
                    </View>

                    {/* Wi-Fi SSID Input */}
                    <View style={styles.inputGroup}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                          Wi-Fi Network Name (SSID) *
                        </ThemedText>
                        <View style={styles.wifiFreqBadge}>
                          <ThemedText style={styles.wifiFreqBadgeText}>2.4 GHz Only</ThemedText>
                        </View>
                      </View>
                      <View style={[styles.wifiInputRow, isDark ? styles.inputFieldDark : styles.inputFieldLight]}>
                        <AppIcon
                          name="wifi"
                          size={18}
                          color={isDark ? '#94a3b8' : '#64748b'}
                          style={{ marginRight: 8 }}
                        />
                        <TextInput
                          style={[styles.flexInput, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}
                          placeholder="Enter 2.4 GHz Wi-Fi Network Name"
                          placeholderTextColor={UiColors[effectiveTheme].textMuted}
                          value={reconfigSelectedSsid}
                          onChangeText={setReconfigSelectedSsid}
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        {reconfigSelectedSsid ? (
                          <Pressable onPress={() => setReconfigSelectedSsid('')} hitSlop={8} style={{ padding: 4 }}>
                            <ThemedText style={{ color: UiColors[effectiveTheme].textMuted, fontSize: 13, fontWeight: '700' }}>✕</ThemedText>
                          </Pressable>
                        ) : null}
                      </View>

                      {/* Quick Presets Row below Input */}
                      {reconfigWifiNetworks.some(net => net.isConnectedPhone || net.isSaved) && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        <ThemedText style={[styles.quickPresetLabel, isDark && styles.textSlateLight]}>Quick Presets:</ThemedText>
                        {Array.from(new Set(reconfigWifiNetworks.filter(net => net.isConnectedPhone || net.isSaved).map(s => s.ssid))).map((preset) => {
                          const isSelected = reconfigSelectedSsid === preset;
                          return (
                            <Pressable
                              key={preset}
                              onPress={() => {
                                triggerHaptic();
                                setReconfigSelectedSsid(preset);
                              }}
                              style={[
                                styles.presetChip,
                                isDark ? styles.presetChipDark : styles.presetChipLight,
                                isSelected && styles.presetChipActive,
                              ]}
                            >
                              <ThemedText style={[styles.presetChipText, isSelected && styles.presetChipTextActive]}>
                                {isSelected ? '✓ ' : ''}{preset}
                              </ThemedText>
                            </Pressable>
                          );
                        })}
                      </View>
                      )}
                    </View>

                    {/* Saved Facility Networks (if any) */}
                    {reconfigWifiNetworks.some(net => net.isSaved) && (
                      <View style={[styles.inputGroup, { marginTop: 12 }]}>
                        <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                          Saved Facility Networks
                        </ThemedText>
                        <View style={styles.savedNetworksRow}>
                          {reconfigWifiNetworks.filter(net => net.isSaved).map((net) => {
                            const isSelected = reconfigSelectedSsid === net.ssid;
                            return (
                              <Pressable
                                key={net.ssid}
                                onPress={() => setReconfigSelectedSsid(net.ssid)}
                                style={[
                                  styles.savedNetworkChip,
                                  isDark ? styles.savedNetworkChipDark : styles.savedNetworkChipLight,
                                  isSelected && styles.savedNetworkChipActive,
                                ]}
                              >
                                <AppIcon
                                  name="wifi"
                                  size={13}
                                  color={isSelected ? '#10b981' : isDark ? '#94a3b8' : '#64748b'}
                                />
                                <ThemedText
                                  style={[
                                    styles.savedNetworkChipText,
                                    isSelected && { color: UiColors[effectiveTheme].emerald, fontWeight: '800' },
                                    isDark && !isSelected && styles.textWhite,
                                  ]}
                                >
                                  {net.ssid}
                                </ThemedText>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    )}

                    {/* Password Input */}
                    <View style={[styles.inputGroup, { marginTop: 14 }]}>
                      <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                        Wi-Fi Password
                      </ThemedText>
                      <View style={[styles.passwordRow, isDark ? styles.passwordRowDark : styles.passwordRowLight]}>
                        <TextInput
                          style={[styles.passwordInput, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}
                          placeholder="Enter Wi-Fi Password"
                          placeholderTextColor={UiColors[effectiveTheme].textMuted}
                          secureTextEntry={!reconfigShowPassword}
                          value={reconfigWifiPassword}
                          onChangeText={setReconfigWifiPassword}
                        />
                        <Pressable onPress={() => setReconfigShowPassword(!reconfigShowPassword)} hitSlop={10} style={{ padding: 4 }}>
                          <AppIcon
                            name={reconfigShowPassword ? 'eye-off' : 'eye'}
                            size={20}
                            color={isDark ? '#94a3b8' : '#64748b'}
                          />
                        </Pressable>
                      </View>
                    </View>

                    {reconfigError && (
                      <View style={[styles.errorBanner, { marginTop: 14 }]}>
                        <AppIcon
                          name="alert"
                          size={18}
                          color={UiColors[effectiveTheme].error}
                        />
                        <ThemedText style={styles.errorText}>{reconfigError}</ThemedText>
                      </View>
                    )}

                    <Pressable
                      onPress={handleApplyReconfigureWifi}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        { backgroundColor: colors.primaryFill, marginTop: 22 },
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <ThemedText style={styles.primaryButtonText}>Update Wi-Fi Settings</ThemedText>
                    </Pressable>

                    <Pressable
                      onPress={() => setReconfigStep('connect')}
                      style={[styles.textLinkBtn, { marginTop: 10 }]}
                    >
                      <ThemedText style={styles.textLinkBtnText}>← Back to Bluetooth Link</ThemedText>
                    </Pressable>
                  </View>
                )}

                {/* STEP 3: VERIFYING WI-FI CONFIGURATION */}
                {reconfigStep === 'verifying' && (
                  <View style={styles.wizardSection}>
                    <View style={styles.wizardHeaderCenter}>
                      <ActivityIndicator size="large" color={UiColors[effectiveTheme].emerald} />
                      <ThemedText style={[styles.wizardTitle, { marginTop: 14 }, isDark && styles.textWhite]}>
                        Reconfiguring Node Wi-Fi
                      </ThemedText>
                      <ThemedText style={styles.wizardSubtitle}>
                        {selectedDevice?.name} ({displayDeviceId(selectedDevice?.deviceId)})
                      </ThemedText>
                    </View>

                    {/* Live Verification Checklist */}
                    <View style={[styles.checklistCard, isDark ? styles.checklistCardDark : styles.checklistCardLight]}>
                      <View style={styles.checklistItem}>
                        <ThemedText style={{ fontSize: 14, color: reconfigVerifyStep >= 1 ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].textMuted, fontWeight: '800' }}>
                          {reconfigVerifyStep >= 1 ? '✓' : '○'}
                        </ThemedText>
                        <ThemedText style={[styles.checklistText, reconfigVerifyStep >= 1 && styles.checklistTextDone, isDark && styles.textWhite]}>
                          Sending new credentials over BLE
                        </ThemedText>
                      </View>
                      <View style={styles.checklistItem}>
                        <ThemedText style={{ fontSize: 14, color: reconfigVerifyStep >= 2 ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].textMuted, fontWeight: '800' }}>
                          {reconfigVerifyStep >= 2 ? '✓' : '○'}
                        </ThemedText>
                        <ThemedText style={[styles.checklistText, reconfigVerifyStep >= 2 && styles.checklistTextDone, isDark && styles.textWhite]}>
                          Connecting to {reconfigSelectedSsid}
                        </ThemedText>
                      </View>
                      <View style={styles.checklistItem}>
                        <ThemedText style={{ fontSize: 14, color: reconfigVerifyStep >= 3 ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].textMuted, fontWeight: '800' }}>
                          {reconfigVerifyStep >= 3 ? '✓' : '○'}
                        </ThemedText>
                        <ThemedText style={[styles.checklistText, reconfigVerifyStep >= 3 && styles.checklistTextDone, isDark && styles.textWhite]}>
                          Confirming AC device Wi-Fi connection
                        </ThemedText>
                      </View>
                    </View>
                  </View>
                )}

                {/* STEP 4: SUCCESS */}
                {reconfigStep === 'success' && (
                  <View style={styles.wizardCenterBox}>
                    <View style={styles.successBadgeCircle}>
                      <ThemedText style={{ fontSize: 32, color: UiColors[effectiveTheme].onPrimary, fontWeight: '900' }}>✓</ThemedText>
                    </View>
                    <ThemedText style={[styles.wizardTitle, { marginTop: 16 }, isDark && styles.textWhite]}>
                      Wi-Fi Updated Successfully
                    </ThemedText>
                    <ThemedText style={styles.wizardSubtitle}>
                      {selectedDevice?.name} ({displayDeviceId(selectedDevice?.deviceId)})
                    </ThemedText>

                    {/* Summary Card */}
                    <View style={[styles.successSummaryBox, isDark ? styles.successBoxDark : styles.successBoxLight]}>
                      <View style={styles.summaryRow}>
                        <ThemedText style={styles.summaryLabel}>Device</ThemedText>
                        <ThemedText style={{ color: UiColors[effectiveTheme].emerald, fontWeight: '800' }}>{selectedDevice?.name}</ThemedText>
                      </View>
                      <View style={styles.summaryRow}>
                        <ThemedText style={styles.summaryLabel}>New Network</ThemedText>
                        <ThemedText style={{ color: UiColors[effectiveTheme].emerald, fontWeight: '800' }}>
                          ● {reconfigSelectedSsid}
                        </ThemedText>
                      </View>
                      <View style={styles.summaryRow}>
                        <ThemedText style={styles.summaryLabel}>Assigned IP</ThemedText>
                        <ThemedText style={{ color: UiColors[effectiveTheme].emerald, fontWeight: '800' }}>{reconfigAssignedIp}</ThemedText>
                      </View>
                      <View style={styles.summaryRow}>
                        <ThemedText style={styles.summaryLabel}>Status</ThemedText>
                        <ThemedText style={{ color: UiColors[effectiveTheme].emerald, fontWeight: '800' }}>● Wi-Fi connected; backend unverified</ThemedText>
                      </View>
                    </View>

                    <Pressable
                      onPress={() => {
                        handleCloseReconfigureWifi();
                        if (selectedDevice) {
                          handleOpenDetails(selectedDevice);
                        }
                      }}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        { backgroundColor: colors.primaryFill, width: '100%', marginTop: 20 },
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <ThemedText style={styles.primaryButtonText}>View Device Details</ThemedText>
                    </Pressable>

                    <Pressable
                      onPress={handleCloseReconfigureWifi}
                      style={styles.textLinkBtn}
                    >
                      <ThemedText style={styles.textLinkBtnText}>Done</ThemedText>
                    </Pressable>
                  </View>
                )}
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* ========================================================================= */}
        {/* 4. RENAME DEVICE MODAL                                                    */}
        {/* ========================================================================= */}
        <Modal
          visible={renameModalVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={handleCloseRename}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.confirmBackdrop}>
            <View style={[styles.confirmBox, isDark && styles.confirmBoxDark]}>
              <ThemedText style={[styles.confirmTitle, isDark && styles.textWhite]}>Rename AC Device</ThemedText>
              <ThemedText style={styles.confirmDesc}>
                Enter the display name for this AC device.
              </ThemedText>

              <ThemedText style={[styles.inputLabel, { alignSelf: 'flex-start', marginBottom: 6 }, isDark && styles.textSlateLight]}>AC Device Name</ThemedText>
              <TextInput
                style={[
                  styles.inputField,
                  { width: '100%', marginBottom: 16 },
                  isDark ? styles.inputFieldDark : styles.inputFieldLight,
                ]}
                value={renameInput}
                onChangeText={setRenameInput}
                placeholder="Enter AC device name"
                placeholderTextColor={UiColors[effectiveTheme].textMuted}
                editable={!savingRename}
                maxLength={100}
                autoFocus
              />

              {renameError && (
                <View style={[styles.errorBanner, { marginTop: 0, marginBottom: 12 }]} accessibilityRole="alert">
                  <ThemedText style={styles.errorText}>{renameError}</ThemedText>
                </View>
              )}

              <View style={styles.confirmActions}>
                <Pressable
                  onPress={handleCloseRename}
                  disabled={savingRename}
                  style={[styles.confirmCancelBtn, isDark && styles.confirmCancelBtnDark]}
                >
                  <ThemedText style={[styles.confirmCancelBtnText, isDark && styles.textWhite]}>Cancel</ThemedText>
                </Pressable>
                <Pressable
                  onPress={handleSaveRename}
                  disabled={savingRename || !renameInput.trim()}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: savingRename || !renameInput.trim(), busy: savingRename }}
                  style={[styles.primaryButton, { flex: 1, backgroundColor: colors.primaryFill }]}
                >
                  {savingRename && <ActivityIndicator size="small" color={UiColors[effectiveTheme].onPrimary} style={{ marginRight: 8 }} />}
                  <ThemedText style={styles.primaryButtonText}>{savingRename ? 'Saving…' : 'Save'}</ThemedText>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* ========================================================================= */}
        {/* 4.5. REASSIGN ROOM MODAL                                                  */}
        {/* ========================================================================= */}
        <Modal
          visible={roomChangeModalVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => { if (!savingRoom) setRoomChangeModalVisible(false); }}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.confirmBackdrop}>
            <View style={[styles.confirmBox, styles.roomDialog, isDark && styles.confirmBoxDark]}>
              <ThemedText style={[styles.confirmTitle, isDark && styles.textWhite]}>Reassign Room</ThemedText>
              <ThemedText style={styles.confirmDesc}>
                Select or type the room location for {selectedDevice?.name}.
              </ThemedText>

              <ScrollView style={styles.roomDialogScroll} contentContainerStyle={styles.roomDialogBody} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator>
              {/* Type / Search Room Input */}
              <View style={[styles.searchBox, isDark ? styles.searchBoxDark : styles.searchBoxLight, { paddingVertical: 8, marginBottom: 10, width: '100%' }]}>
                <AppIcon
                  name="search"
                  size={16}
                  color={isDark ? '#94a3b8' : '#64748b'}
                  style={styles.searchIcon}
                />
                <TextInput
                  style={[styles.searchInput, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}
                  placeholder="Type or search room..."
                  placeholderTextColor={isDark ? '#64748b' : '#9ca3af'}
                  value={changeRoomSearchQuery}
                  onChangeText={setChangeRoomSearchQuery}
                  editable={!savingRoom}
                />
                {changeRoomSearchQuery.length > 0 && (
                  <Pressable disabled={savingRoom} onPress={() => setChangeRoomSearchQuery('')} hitSlop={8}>
                    <ThemedText style={{ color: UiColors[effectiveTheme].textMuted, fontSize: 13, fontWeight: '700' }}>✕</ThemedText>
                  </Pressable>
                )}
              </View>

              <View style={{ width: '100%', marginBottom: 16 }}>
                {/* Custom Typed Room Option */}
                {isCustomChangeRoomQuery && (
                  <Pressable
                    disabled={savingRoom}
                    onPress={() => {
                      triggerHaptic();
                      setSelectedChangeRoomId(`custom:${changeRoomSearchQuery.trim()}`);
                    }}
                    style={[
                      styles.roomOptionItem,
                      isDark ? styles.roomOptionDark : styles.roomOptionLight,
                      selectedChangeRoomId === `custom:${changeRoomSearchQuery.trim()}` && styles.roomOptionActive,
                      { borderColor: UiColors[effectiveTheme].border, borderStyle: 'dashed', borderWidth: 1.5 },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <ThemedText style={[styles.roomOptionText, { color: UiColors[effectiveTheme].emerald, fontWeight: '800' }]}>
                + Assign to &quot;{changeRoomSearchQuery.trim()}&quot;
                      </ThemedText>
                      <ThemedText style={styles.roomOptionSubText}>
                        Custom room location
                      </ThemedText>
                    </View>
                    {selectedChangeRoomId === `custom:${changeRoomSearchQuery.trim()}` && (
                      <ThemedText style={{ color: UiColors[effectiveTheme].emerald, fontWeight: '800' }}>✓</ThemedText>
                    )}
                  </Pressable>
                )}

                {/* Unassigned Option */}
                {(!changeRoomSearchQuery || 'unassigned'.includes(changeRoomSearchQuery.toLowerCase())) && (
                  <Pressable
                    disabled={savingRoom}
                    onPress={() => {
                      triggerHaptic();
                      setSelectedChangeRoomId(null);
                      setChangeRoomSearchQuery('');
                    }}
                    style={[
                      styles.roomOptionItem,
                      isDark ? styles.roomOptionDark : styles.roomOptionLight,
                      selectedChangeRoomId === null && styles.roomOptionActive,
                    ]}
                  >
                    <ThemedText style={[styles.roomOptionText, selectedChangeRoomId === null && { color: UiColors[effectiveTheme].emerald, fontWeight: '800' }, isDark && selectedChangeRoomId !== null && styles.textWhite]}>
                      — Unassigned —
                    </ThemedText>
                    {selectedChangeRoomId === null && (
                      <ThemedText style={{ color: UiColors[effectiveTheme].emerald, fontWeight: '800' }}>✓</ThemedText>
                    )}
                  </Pressable>
                )}

                {filteredChangeRooms.map((room) => {
                  const isSel = selectedChangeRoomId === room.id;
                  return (
                    <Pressable
                      key={room.id}
                      disabled={savingRoom}
                      onPress={() => {
                        triggerHaptic();
                        setSelectedChangeRoomId(room.id);
                        setChangeRoomSearchQuery(room.name);
                      }}
                      style={[
                        styles.roomOptionItem,
                        isDark ? styles.roomOptionDark : styles.roomOptionLight,
                        isSel && styles.roomOptionActive,
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <ThemedText style={[styles.roomOptionText, isSel && { color: UiColors[effectiveTheme].emerald, fontWeight: '800' }, isDark && !isSel && styles.textWhite]}>
                          {room.name}
                        </ThemedText>
                        <ThemedText style={styles.roomOptionSubText}>
                          {room.buildingName} • {room.floorName}
                          {room.airconBrand ? ` • ${room.airconBrand}` : ''}
                          {room.nodeName ? ` • Node: ${room.nodeName}` : ''}
                        </ThemedText>
                      </View>
                      {isSel && (
                        <ThemedText style={{ color: UiColors[effectiveTheme].emerald, fontWeight: '800' }}>✓</ThemedText>
                      )}
                    </Pressable>
                  );
                })}

                {filteredChangeRooms.length === 0 && !isCustomChangeRoomQuery && (
                  <ThemedText style={{ textAlign: 'center', color: UiColors[effectiveTheme].textMuted, fontSize: 12, paddingVertical: 12 }}>
                    No matching rooms found.
                  </ThemedText>
                )}
              </View>

              {/* Controller display name is independent of the assigned AC profile. */}
              <View style={{ width: '100%', marginBottom: 10 }}>
                <ThemedText style={[styles.inputLabel, { fontSize: 11, marginBottom: 4 }, isDark && styles.textSlateLight]}>
                  AC Device Name
                </ThemedText>
                <TextInput
                  style={[styles.inputField, isDark ? styles.inputFieldDark : styles.inputFieldLight, { paddingVertical: 8, fontSize: 13 }]}
                  value={changeRoomAirconName}
                  onChangeText={setChangeRoomAirconName}
                  editable={!savingRoom}
                  placeholder="Enter AC device name"
                  maxLength={100}
                  placeholderTextColor={UiColors[effectiveTheme].textMuted}
                />
              </View>

              {/* Custom name comes from the linked inventory, never from its IR protocol. */}
              <View style={{ width: '100%', marginBottom: 14 }}>
                <ThemedText style={[styles.inputLabel, { fontSize: 11, marginBottom: 6 }, isDark && styles.textSlateLight]}>Custom Aircon Name</ThemedText>
                <TextInput
                  style={[styles.inputField, isDark ? styles.inputFieldDark : styles.inputFieldLight, { paddingVertical: 8, fontSize: 13, marginBottom: 8 }]}
                  value={selectedDevice?.airconName || ''}
                  editable={false}
                  accessibilityLabel="Custom Aircon Name"
                  placeholder="Name unavailable"
                  placeholderTextColor={UiColors[effectiveTheme].textMuted}
                />
                <ThemedText style={[styles.inputLabel, { marginTop: 6 }, isDark && styles.textSlateLight]}>IR Protocol</ThemedText>
                <ThemedText style={{ color: colors.textSecondary, marginTop: 4 }}>{selectedDevice?.protocolName || 'Unverified'}</ThemedText>
              </View>
              </ScrollView>

              {roomSaveError && (
                <View style={styles.errorBanner} accessibilityRole="alert">
                  <ThemedText style={styles.errorText}>{roomSaveError}</ThemedText>
                </View>
              )}

              <View style={[styles.confirmActions, { paddingTop: 12 }]}>
                <Pressable
                  onPress={() => setRoomChangeModalVisible(false)}
                  disabled={savingRoom}
                  style={[styles.confirmCancelBtn, isDark && styles.confirmCancelBtnDark]}
                >
                  <ThemedText style={[styles.confirmCancelBtnText, isDark && styles.textWhite]}>Cancel</ThemedText>
                </Pressable>
                <Pressable
                  onPress={handleSaveChangeRoom}
                  disabled={savingRoom}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: savingRoom, busy: savingRoom }}
                  style={[styles.primaryButton, { flex: 1, backgroundColor: colors.primaryFill }]}
                >
                  {savingRoom && <ActivityIndicator size="small" color={UiColors[effectiveTheme].onPrimary} style={{ marginRight: 8 }} />}
                  <ThemedText style={styles.primaryButtonText}>{savingRoom ? 'Saving…' : 'Update'}</ThemedText>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* ========================================================================= */}
        {/* 5. REMOVE DEVICE CONFIRMATION MODAL                                       */}
        {/* ========================================================================= */}
        <Modal
          visible={removeConfirmVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setRemoveConfirmVisible(false)}
        >
          <View style={styles.confirmBackdrop}>
            <View style={[styles.confirmBox, isDark && styles.confirmBoxDark]}>
              <ThemedText style={[styles.confirmTitle, isDark && styles.textWhite]}>
                Remove Node?
              </ThemedText>
              <ThemedText style={styles.confirmDesc}>
                Are you sure you want to remove &quot;{selectedDevice?.name}&quot;?{'\n\n'}
                This will delete the node record from the system.
              </ThemedText>

              <View style={styles.confirmActions}>
                <Pressable
                  onPress={() => setRemoveConfirmVisible(false)}
                  style={[styles.confirmCancelBtn, isDark && styles.confirmCancelBtnDark]}
                >
                  <ThemedText style={[styles.confirmCancelBtnText, isDark && styles.textWhite]}>Cancel</ThemedText>
                </Pressable>
                <Pressable
                  onPress={handleConfirmRemove}
                  style={styles.confirmDeleteBtn}
                >
                  <ThemedText style={styles.confirmDeleteBtnText}>Delete Node</ThemedText>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
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

  // Header Styles
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: 'transparent',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerLogo: {
    width: 36,
    height: 36,
    borderRadius: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: 0.2,
  },
  headerSubtitle: {
    fontSize: 11.5,
    color: colors.text,
    fontWeight: '700',
  },

  scrollContent: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },

  // Metrics Row
  metricsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: Spacing.two,
  },
  metricCard: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 16,
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 74,
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
  metricCardLight: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.panelBorder,
  },
  metricCardDark: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.panelBorder,
  },
  metricNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  metricNumber: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  metricLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 13,
  },

  // Inline Add Device Button
  inlineAddBtn: {
    backgroundColor: colors.primaryFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 16,
    marginBottom: Spacing.three,
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  inlineAddBtnText: {
    color: colors.onPrimary,
    fontSize: 13.5,
    fontWeight: '900',
    letterSpacing: 0.3,
  },

  // Search & Filter
  searchFilterContainer: {
    gap: 10,
    marginBottom: Spacing.three,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1.2,
    gap: 8,
  },
  searchBoxLight: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.inputBorder,
  },
  searchBoxDark: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.inputBorder,
  },
  searchIcon: {
    width: 16,
    height: 16,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    padding: 0,
  },
  filterPillsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.2,
  },
  filterPillLight: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.border,
  },
  filterPillDark: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.border,
  },
  filterPillActive: {
    backgroundColor: colors.primaryFill,
    borderColor: colors.emerald,
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  filterPillTextActive: {
    color: colors.onPrimary,
  },
  filterPillTextLight: {
    color: colors.textSecondary,
  },
  filterPillTextDark: {
    color: colors.textMuted,
  },

  sectionHeader: {
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  adminToggleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  adminToggleBadgeLight: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.border,
  },
  adminToggleBadgeDark: {
    backgroundColor: colors.primaryFill,
    borderColor: colors.border,
  },
  adminToggleBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.emerald,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  textEmeraldLight: {
    color: colors.emerald,
  },
  textEmeraldDark: {
    color: colors.emerald,
  },
  textWhite: {
    color: colors.onPrimary,
  },
  textSlateLight: {
    color: colors.textMuted,
  },

  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },

  // Device Cards
  deviceCard: {
    borderRadius: 20,
    borderWidth: 1.2,
    padding: 16,
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  deviceCardLight: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.panelBorder,
  },
  deviceCardDark: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.panelBorder,
  },
  deviceCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  deviceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  deviceName: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  deviceIdChip: {
    backgroundColor: colors.accentSurface,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  deviceIdChipText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.emerald,
  },
  moreOptionsBtn: {
    padding: 6,
  },
  deviceLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 5,
  },
  locationPinIcon: {
    width: 13,
    height: 13,
    tintColor: colors.textSecondary,
  },
  deviceLocationText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  textSlateDark: {
    color: colors.textSecondary,
  },

  deviceMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 10,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusPillOnline: {
    backgroundColor: colors.accentSurface,
  },
  statusPillOffline: {
    backgroundColor: colors.errorSurface,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  telemetryBadge: {
    backgroundColor: colors.accentSurface,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  telemetryBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.emerald,
  },
  wifiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accentSurface,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  wifiBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.emerald,
  },
  lastSeenText: {
    fontSize: 11,
    color: colors.textMuted,
    marginLeft: 'auto',
    fontWeight: '600',
  },

  deviceCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  addedDateText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
  viewDetailsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  viewDetailsBtnLight: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.border,
  },
  viewDetailsBtnDark: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.border,
  },
  viewDetailsBtnText: {
    color: colors.emerald,
    fontWeight: '800',
    fontSize: 12,
  },

  // Empty State
  emptyStateCard: {
    padding: 28,
    borderRadius: 24,
    borderWidth: 1.5,
    alignItems: 'center',
    marginTop: 10,
  },
  emptyCardLight: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.panelBorder,
  },
  emptyCardDark: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.panelBorder,
  },
  emptyIconBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.accentSurface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.text,
    textAlign: 'center',
  },
  emptyDesc: {
    fontSize: 12.5,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
    paddingHorizontal: 10,
  },

  // Modal Common Styles
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  modalContent: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    height: '86%',
    padding: Spacing.four,
  },
  modalContentLight: {
    backgroundColor: colors.backgroundElement,
  },
  modalContentDark: {
    backgroundColor: colors.backgroundElement,
    borderTopWidth: 1.5,
    borderTopColor: colors.border,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 14,
    marginBottom: 10,
  },
  modalHeaderDark: {
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.text,
    flex: 1,
    marginRight: 12,
  },
  closeModalText: {
    fontSize: 14,
    color: colors.error,
    fontWeight: '800',
  },
  modalScrollBody: {
    paddingBottom: 36,
  },

  // Step Progress Bar
  stepProgressBar: {
    paddingVertical: 10,
    marginBottom: 10,
  },
  stepNodesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepNodeContainer: {
    alignItems: 'center',
  },
  stepNodeCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNodeCircleCurrent: {
    backgroundColor: colors.primaryFill,
  },
  stepNodeCirclePassed: {
    backgroundColor: colors.primaryFill,
  },
  stepNodeCircleFutureLight: {
    backgroundColor: colors.backgroundSelected,
  },
  stepNodeCircleFutureDark: {
    backgroundColor: colors.backgroundSelected,
  },
  stepNodeText: {
    fontSize: 11,
    fontWeight: '900',
  },
  stepNodeLabel: {
    fontSize: 9.5,
    color: colors.textMuted,
    fontWeight: '700',
    marginTop: 2,
  },
  stepConnectorLine: {
    flex: 1,
    height: 2,
    marginHorizontal: 4,
    marginBottom: 12,
  },
  stepLineActive: {
    backgroundColor: colors.primaryFill,
  },
  stepLineLight: {
    backgroundColor: colors.backgroundSelected,
  },
  stepLineDark: {
    backgroundColor: colors.backgroundSelected,
  },

  // Wizard Content
  wizardSection: {
    paddingTop: 8,
  },
  wizardHeaderCenter: {
    alignItems: 'center',
    marginBottom: 16,
  },
  radarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accentSurface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    borderWidth: 2,
    borderColor: colors.border,
  },
  iconCircleEmerald: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.accentSurface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  wizardTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: colors.text,
    textAlign: 'center',
  },
  wizardSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
    paddingHorizontal: 12,
  },
  wizardCenterBox: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
  },

  bleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.2,
    marginTop: 8,
  },
  bleCardLight: {
    backgroundColor: colors.background,
    borderColor: colors.panelBorder,
  },
  bleCardDark: {
    backgroundColor: colors.background,
    borderColor: colors.panelBorder,
  },
  bleName: {
    fontSize: 13.5,
    fontWeight: '800',
    color: colors.text,
  },
  bleChip: {
    backgroundColor: colors.accentSurface,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  bleChipText: {
    fontSize: 10.5,
    color: colors.emerald,
    fontWeight: '800',
  },
  bleMacText: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    fontWeight: '600',
  },
  bleAddBtn: {
    backgroundColor: colors.primaryFill,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 10,
  },
  bleAddBtnText: {
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: '800',
  },

  // Wi-Fi Selection & Configuration
  wifiInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.2,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  flexInput: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '600',
    padding: 0,
  },
  wifiFreqBadge: {
    backgroundColor: colors.accentSurface,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  wifiFreqBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.emerald,
    letterSpacing: 0.3,
  },
  savedNetworksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  savedNetworkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  savedNetworkChipLight: {
    backgroundColor: colors.backgroundSelected,
    borderColor: colors.border,
  },
  savedNetworkChipDark: {
    backgroundColor: '#0f172a',
    borderColor: colors.border,
  },
  savedNetworkChipActive: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.emerald,
  },
  savedNetworkChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  removeSavedNetBtn: {
    padding: 2,
    marginLeft: 2,
  },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  rememberCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rememberText: {
    fontSize: 12,
    fontWeight: '600',
  },
  wifiNoticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
  },
  wifiNoticeBoxLight: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  wifiNoticeBoxDark: {
    backgroundColor: '#0f172a',
    borderColor: colors.border,
  },
  wifiNoticeText: {
    fontSize: 11,
    lineHeight: 16,
    flex: 1,
  },
  wifiItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.2,
    marginTop: 6,
  },
  wifiItemLight: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  wifiItemDark: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  wifiItemActive: {
    borderColor: colors.emerald,
    backgroundColor: colors.accentSurface,
  },
  wifiItemName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },

  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.2,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  passwordRowLight: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  passwordRowDark: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  passwordInput: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '600',
    padding: 0,
  },

  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  inputField: {
    borderRadius: 14,
    borderWidth: 1.2,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 13.5,
    fontWeight: '600',
  },
  inputFieldLight: {
    backgroundColor: colors.background,
    borderColor: colors.inputBorder,
    color: colors.text,
  },
  inputFieldDark: {
    backgroundColor: colors.background,
    borderColor: colors.inputBorder,
    color: colors.text,
  },
  readOnlyInput: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  readOnlyInputLight: {
    backgroundColor: colors.background,
    borderColor: colors.inputBorder,
  },
  readOnlyInputDark: {
    backgroundColor: colors.background,
    borderColor: colors.inputBorder,
  },

  airconPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 8,
  },
  airconPillLight: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  airconPillDark: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  airconPillActive: {
    backgroundColor: colors.primaryFill,
    borderColor: colors.emerald,
  },
  airconPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },

  roomOptionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 6,
  },
  roomOptionLight: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  roomOptionDark: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  roomOptionActive: {
    borderColor: colors.emerald,
    backgroundColor: colors.accentSurface,
  },
  roomOptionText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  roomOptionSubText: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    fontWeight: '600',
  },

  // Verification Checklist
  checklistCard: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    marginTop: 8,
  },
  checklistCardLight: {
    backgroundColor: colors.background,
    borderColor: colors.panelBorder,
  },
  checklistCardDark: {
    backgroundColor: colors.background,
    borderColor: colors.panelBorder,
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checklistText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  checklistTextDone: {
    color: colors.emerald,
    fontWeight: '700',
  },

  // Success Wizard
  successBadgeCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successSummaryBox: {
    width: '100%',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 18,
    gap: 8,
  },
  successBoxLight: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  successBoxDark: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
    gap: 12,
  },
  summaryLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  summaryValue: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  idBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    maxWidth: '65%',
  },
  idBadgeLight: {
    backgroundColor: colors.accentSurface,
  },
  idBadgeDark: {
    backgroundColor: colors.accentSurface,
  },
  idBadgeText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    color: colors.emerald,
    fontWeight: '800',
  },
  statusSuccessPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    backgroundColor: colors.accentSurface,
  },
  statusSuccessDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primaryFill,
  },
  statusSuccessText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.emerald,
  },
  summaryDivider: {
    height: 1,
    marginVertical: 4,
  },
  summaryDividerLight: {
    backgroundColor: colors.backgroundSelected,
  },
  summaryDividerDark: {
    backgroundColor: colors.backgroundSelected,
  },
  summaryLocationSection: {
    marginTop: 4,
    gap: 6,
  },
  summaryLocationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  summaryLocationCardLight: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.panelBorder,
  },
  summaryLocationCardDark: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.panelBorder,
  },
  summaryLocationIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.accentSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryRoomTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
  },
  summaryLocationSubtitle: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
    fontWeight: '500',
  },

  // Device Details Modal Styles
  infoList: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 10,
    marginTop: 6,
  },
  infoListLight: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  infoListDark: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  infoKey: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
    flexShrink: 0,
    lineHeight: 18,
  },
  infoVal: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
    textAlign: 'right',
    lineHeight: 18,
  },
  testResultBox: {
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 10,
  },
  testBoxLight: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.border,
  },
  testBoxDark: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.border,
  },
  actionsColumn: {
    gap: 10,
    marginTop: 10,
  },
  actionBtn: {
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnLight: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.border,
  },
  actionBtnDark: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  actionBtnDestructive: {
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: colors.border,
    backgroundColor: colors.errorSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Options Popup
  optionsBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  optionsPopup: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 22,
    padding: 18,
    borderWidth: 1.2,
  },
  optionsPopupLight: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.border,
  },
  optionsPopupDark: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.border,
  },
  optionsPopupTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: colors.text,
    marginBottom: 12,
    textAlign: 'center',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  optionRowText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: colors.text,
  },

  // Confirmation Modals
  confirmBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  confirmBox: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.backgroundElement,
  },
  confirmBoxDark: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.border,
  },
  roomDialog: {
    maxWidth: 440,
    maxHeight: '92%',
    flexShrink: 1,
    padding: 18,
  },
  roomDialogScroll: {
    width: '100%',
    flexShrink: 1,
  },
  roomDialogBody: {
    paddingBottom: 8,
  },
  confirmTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: colors.text,
    marginBottom: 6,
    textAlign: 'center',
  },
  confirmDesc: {
    fontSize: 12.5,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 18,
    lineHeight: 18,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  confirmCancelBtn: {
    flex: 1,
    backgroundColor: colors.backgroundSelected,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  confirmCancelBtnDark: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  confirmCancelBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  confirmDeleteBtn: {
    flex: 1,
    backgroundColor: '#ef4444',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmDeleteBtnText: {
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: '900',
  },

  // Buttons Common
  primaryButton: {
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontSize: 13.5,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  secondaryButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnLight: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.border,
  },
  secondaryBtnDark: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.border,
  },
  textLinkBtn: {
    paddingVertical: 10,
    marginTop: 6,
  },
  textLinkBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.errorSurface,
    padding: 10,
    borderRadius: 12,
    marginTop: 14,
    width: '100%',
  },
  errorText: {
    fontSize: 12,
    color: colors.error,
    fontWeight: '600',
    flex: 1,
  },
  // Wi-Fi Auto-Search & Discovered Networks Styles
  rescanWifiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1.2,
    flexShrink: 0,
  },
  rescanWifiBtnLight: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.border,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  rescanWifiBtnDark: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.border,
  },
  rescanWifiBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.emerald,
  },
  wifiEmptyCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  wifiEmptyCardLight: {
    backgroundColor: colors.background,
    borderColor: colors.panelBorder,
  },
  wifiEmptyCardDark: {
    backgroundColor: '#0d1829',
    borderColor: colors.panelBorder,
  },
  wifiEmptyIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentSurface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  wifiEmptyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  wifiEmptySubtitle: {
    fontSize: 11.5,
    color: colors.textSecondary,
    lineHeight: 16,
    marginTop: 2,
  },
  presetChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  presetChip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  presetChipLight: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.border,
  },
  presetChipDark: {
    backgroundColor: colors.backgroundSelected,
    borderColor: colors.border,
  },
  presetChipActive: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.emerald,
  },
  presetChipText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  presetChipTextActive: {
    color: colors.emerald,
    fontWeight: '800',
  },
  quickPresetLabel: {
    fontSize: 11.5,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  wifiScanningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  wifiScanningBannerLight: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.border,
  },
  wifiScanningBannerDark: {
    backgroundColor: '#062015',
    borderColor: colors.border,
  },
  wifiScanningTitle: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  wifiScanningSubtitle: {
    fontSize: 11,
    color: colors.textMuted,
  },
  discoveredWifiList: {
    gap: 8,
    marginBottom: 14,
  },
  wifiItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1.2,
  },
  wifiItemCardLight: {
    backgroundColor: colors.background,
    borderColor: colors.panelBorder,
  },
  wifiItemCardDark: {
    backgroundColor: '#0d1829',
    borderColor: colors.panelBorder,
  },
  wifiItemCardActiveLight: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.emerald,
  },
  wifiItemCardActiveDark: {
    backgroundColor: '#062015',
    borderColor: colors.emerald,
  },
  wifiSignalIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wifiItemSsid: {
    fontSize: 13.5,
    fontWeight: '700',
    color: colors.text,
  },
  wifiItemMeta: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  savedNetMiniBadge: {
    backgroundColor: colors.accentSurface,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  savedNetMiniBadgeText: {
    color: colors.emerald,
    fontSize: 10,
    fontWeight: '800',
  },
  wifiRadioBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: colors.border,
  },
  // Custom Aircon Name & Suggestion Pill Styles
  customBadgePill: {
    backgroundColor: colors.accentSurface,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  customBadgeText: {
    color: colors.emerald,
    fontSize: 10.5,
    fontWeight: '800',
  },
  customNameInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.2,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  nameSugPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    marginRight: 6,
  },
  nameSugPillLight: {
    backgroundColor: colors.backgroundSelected,
    borderColor: colors.border,
  },
  nameSugPillDark: {
    backgroundColor: '#0f172a',
    borderColor: colors.border,
  },
  nameSugPillActive: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.emerald,
  },
  nameSugPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  buttonPressed: {
    transform: [{ scale: 0.97 }],
  },
});
const themedStyles = { light: createStyles(UiColors.light), dark: createStyles(UiColors.dark) };
