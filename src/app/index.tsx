import { AppState } from 'react-native';
import { Colors as UiColors, type AppColors, Colors, GlassStyles, Spacing } from '@/constants/theme';
import { useState, useRef, useEffect, useCallback, type SetStateAction } from 'react';
import { useSessionPageSnapshot } from '@/hooks/use-session-page-snapshot';
import { createReadScope } from '@/services/query-utils';
import { applyHomeControllerState, mergeHomeControllerFetch } from '@/services/home-controller-state';
import { CloudHardware, type CloudDeviceState } from '@/services/cloud-hardware';
import { createRefreshCoordinator, type RefreshCoordinator } from '@/services/refresh-coordinator';
import { DataListSkeleton } from '@/components/data-list-skeleton';

import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  Platform,
  useColorScheme,
  Animated,
  Dimensions,
  RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';

import { router } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

import { useAuth } from '@/context/auth-context';
import { useSettings } from '@/context/settings-context';
import {
  fetchLiveAcControllers,
  fetchLiveSensorReadings,
  subscribeToNodes,
  fetchActiveRoom,
  ActiveRoomData,
  resolveWorkerAssignment,
  WorkerAssignmentResult,
} from '@/services/supabase';

// Import newly organized dashboard subcomponents
import { AcControllerCard, AcControllerData } from '@/components/sensor-card';
import { AcControllerDetailSheet } from '@/components/sensor-detail-sheet';
import { FloatingBottomNavbar } from '@/components/floating-navbar';
import { LocationIcon } from '@/components/location-icon';
import { AppIcon } from '@/components/app-icon';


const SCREEN_HEIGHT = Dimensions.get('window').height;
const SCREEN_WIDTH = Dimensions.get('window').width;
const SIDEBAR_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 340);

const AVATAR_DEFAULT = require('@/assets/images/avatar_default.png');
const AVATAR_MALE = require('@/assets/images/avatar_male.png');
const AVATAR_FEMALE = require('@/assets/images/avatar_female.png');

export default function HomeScreen() {
  const { logout, userId, userName, userRole, userPhone, userEmail, userAssignment, setUserAssignment, userAvatar, userCustomPhotoUri } = useAuth();
  const { effectiveTheme, colors, settings, triggerHaptic } = useSettings();
  const styles = themedStyles[effectiveTheme];
  const theme = effectiveTheme;

  // Supabase live AC controllers and room assignment state
  const fetchUser = userId || userEmail || userPhone || userName;
  const { data, loading, error: fetchError, setData, commit, startLoading, fail, isCurrent: isSessionCurrent } =
    useSessionPageSnapshot<{ controllers: AcControllerData[]; activeRoom: ActiveRoomData | null; assignmentInfo: WorkerAssignmentResult | null }>(
      fetchUser ? `home:${fetchUser}` : undefined, () => ({ controllers: [], activeRoom: null, assignmentInfo: null }));
  const { activeRoom, assignmentInfo } = data;
  const controllers = data.controllers.map(item => applyHomeControllerState(item));
  const visibleControllers = useRef(controllers);
  useEffect(() => { visibleControllers.current = controllers; }, [controllers]);
  const lastInventoryRead = useRef(0);
  const setControllers = useCallback((value: SetStateAction<AcControllerData[]>) => setData(previous => ({ ...previous,
    controllers: typeof value === 'function' ? value(previous.controllers) : value,
  })), [setData]);
  const [refreshing, setRefreshing] = useState(false);
  const refreshRef = useRef<RefreshCoordinator | null>(null);

  const fetchControllers = useCallback(async (isCurrent: () => boolean) => {
    if (!isSessionCurrent()) return;
    startLoading();
    const scope = createReadScope();
    try {
      const resolved = await resolveWorkerAssignment(userId || userEmail || userPhone || userName, scope);
      scope.assertSuccessful();
      const [controllerData, roomData] = resolved.isAssigned && resolved.roomId
        ? await Promise.all([fetchLiveAcControllers(resolved.roomId, scope), fetchActiveRoom(resolved.roomId, scope)])
        : [[], null];
      scope.assertSuccessful();
      if (!isCurrent() || !isSessionCurrent()) return;
      lastInventoryRead.current = Date.now();
      setUserAssignment(resolved.assignmentText);
      commit(current => ({ controllers: mergeHomeControllerFetch(controllerData || [], current.controllers), activeRoom: roomData, assignmentInfo: resolved }));
    } catch (err) {
      console.error('Error fetching AC controllers:', err);
      if (isCurrent() && isSessionCurrent()) fail('Unable to refresh AC devices. Pull down to try again.');
    } finally {
      if (isCurrent() && isSessionCurrent()) setRefreshing(false);
    }
  }, [userId, userEmail, userPhone, userName, setUserAssignment, commit, startLoading, fail, isSessionCurrent]);

  useEffect(() => {
    const refresh = createRefreshCoordinator(fetchControllers, 150, AppState);
    refreshRef.current = refresh;
    void refresh.refresh();
    let readingHardware = false, disposed = false;
    const unsubscribe = subscribeToNodes((row?: CloudDeviceState) => {
      if (disposed || !isSessionCurrent()) return;
      if (!refresh.isActive()) { refresh.schedule(); return; }
      if (row) setControllers(current => current.map(item => applyHomeControllerState(item, row)));
      else refresh.schedule();
    });
    const heartbeatTimer = setInterval(() => { if (refresh.isActive()) setControllers(current => current.map(item => applyHomeControllerState(item))); }, 15000);
    const intervalId = setInterval(() => {
      if (!refresh.isActive()) { refresh.schedule(); return; }
      if (settings.autoSyncEnabled && Date.now() - lastInventoryRead.current >= 60000) void refresh.refresh();
      if (readingHardware) return;
      const visible = visibleControllers.current;
      const newest = Math.max(...visible.map(item => Date.parse(item.lastSeen || '')).filter(Number.isFinite));
      const since = Number.isFinite(newest) ? new Date(newest - 60000).toISOString() : undefined;
      readingHardware = true;
      const ids = visible.map(item => item.id);
      const airconIds = Object.fromEntries(visible.filter(item => item.airconId).map(item => [item.id, item.airconId!]));
      void Promise.allSettled([CloudHardware.listUpdates(ids, since), fetchLiveSensorReadings(ids, airconIds)]).then(results => {
        if (disposed || !refresh.isActive() || !isSessionCurrent()) return;
        setControllers(current => current.map(item => {
          let next = item;
          for (const [index, result] of results.entries()) if (result.status === 'fulfilled') {
            if (index === 1 && item.airconId !== airconIds[item.id]) continue;
            const row = result.value.find(state => state.node_id === item.id);
            if (row) next = applyHomeControllerState(next, row);
          }
          return applyHomeControllerState(next);
        }));
      }).catch(() => { /* Retain the last values and their original ages. */ }).finally(() => { readingHardware = false; });
    }, settings.syncFrequency * 1000);
    return () => {
      disposed = true;
      refresh.dispose();
      if (refreshRef.current === refresh) refreshRef.current = null;
      unsubscribe();
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (intervalId) clearInterval(intervalId);
    };
  }, [fetchControllers, settings.autoSyncEnabled, settings.syncFrequency, setControllers, isSessionCurrent]);

  const onRefresh = () => {
    setRefreshing(true);
    void refreshRef.current?.refresh();
  };

  const getAvatarSource = (avatar: string, uri: string | null) => {
    if (avatar === 'custom' && uri) {
      return { uri };
    }
    if (avatar === 'male') return AVATAR_MALE;
    if (avatar === 'female') return AVATAR_FEMALE;
    return AVATAR_DEFAULT;
  };

  // States
  const [selectedControllerId, setSelectedControllerId] = useState<string | null>(null);
  const selectedController = controllers.find(item => item.id === selectedControllerId) || null;
  const [bottomSheetVisible, setBottomSheetVisible] = useState(false);
  const detailsVisible = bottomSheetVisible && selectedController !== null;
  const [slideAnim] = useState(() => new Animated.Value(SCREEN_HEIGHT));

  const openDetails = (item: AcControllerData) => {
    setSelectedControllerId(item.id);
    setBottomSheetVisible(true);
    Animated.spring(slideAnim, {
      toValue: 0,
      tension: 50,
      friction: 8,
      useNativeDriver: true,
    }).start();
  };

  // Close details bottom sheet
  const closeDetails = () => {
    Animated.timing(slideAnim, {
      toValue: SCREEN_HEIGHT,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      setBottomSheetVisible(false);
      setSelectedControllerId(null);
    });
  };

  return (
    <LinearGradient 
      colors={[UiColors[effectiveTheme].background, UiColors[effectiveTheme].background]} 
      style={[styles.container, { backgroundColor: colors.background }]} 
      start={{ x: 0, y: 0 }} 
      end={{ x: 0, y: 0.35 }}
    >
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        
        {/* Telemetry Page content wrap */}
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
          {/* Main Dashboard Screen Header */}
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
                  Dashboard
                </ThemedText>
              </View>
            </View>
            

          </View>

          <View style={styles.contentBody}>
            {/* User Profile Info Card */}
            <View style={[
              styles.userProfileCard, 
              { 
                backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement,
                borderColor: UiColors[effectiveTheme].panelBorder,
              }
            ]}>
              {/* Card Top Section: Avatar & Main Details */}
              <View style={styles.cardTopSection}>
                <View style={styles.avatarContainer}>
                  <Image
                    source={getAvatarSource(userAvatar, userCustomPhotoUri)}
                    style={styles.userProfileCardAvatar}
                    contentFit="cover"
                  />
                  <View style={styles.statusDotWrapper} accessible accessibilityLabel="Online">
                    <View style={styles.statusDot} />
                  </View>
                </View>
                
                <View style={styles.userProfileCardDetails}>
                  <ThemedText style={[styles.userProfileCardName, { color: colors.text }]}>
                    {userName || 'Staff Member'}
                  </ThemedText>
                  
                  {/* Role Badge Container */}
                  <View style={[
                    styles.roleBadge,
                    {
                      backgroundColor: colors.accentSurface,
                      borderColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                    }
                  ]}>
                    <ThemedText style={[styles.roleBadgeText, { color: effectiveTheme === 'dark' ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].text }]}>
                      {userRole || 'Staff'}
                    </ThemedText>
                  </View>
                  
                  {/* Phone Row */}
                  <View style={styles.phoneRow}>
                    <ThemedText style={[styles.phoneLabel, { color: colors.textSecondary }]}>Phone:</ThemedText>
                    <ThemedText style={[styles.userProfileCardPhone, { color: colors.text }]}>
                      {userPhone || '—'}
                    </ThemedText>
                  </View>
                </View>
              </View>

              {/* Card Bottom Section: Verified badge row */}
              <View style={[styles.cardBottomRow, { borderTopColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, flex: 1 }}>
                  <LocationIcon size={14} color={UiColors[effectiveTheme].emerald} style={{ marginTop: 2, flexShrink: 0 }} />
                  <ThemedText
                    style={[styles.cardBottomText, { color: effectiveTheme === 'dark' ? UiColors[effectiveTheme].textSecondary : UiColors[effectiveTheme].textSecondary, flex: 1 }]}
                    numberOfLines={2}
                  >
                    {loading && !assignmentInfo ? 'Checking assignment...' : `Active Duty • ${userAssignment || 'Unassigned'}`}
                  </ThemedText>
                </View>
              </View>
            </View>

            {/* Room Location Context Bar */}
            {loading && !activeRoom ? <DataListSkeleton label="Checking room assignment..." count={1} compact /> : fetchError && !activeRoom ? null : activeRoom ? (
              <View style={[
                styles.roomContextCard,
                {
                  backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement,
                  borderColor: UiColors[effectiveTheme].panelBorder,
                }
              ]}>
                <View style={styles.roomContextTop}>
                  <View style={styles.roomIconTitleGroup}>
                    <View style={[styles.roomIconCircle, { backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].backgroundSelected : UiColors[effectiveTheme].accentSurface }]}>
                      <LocationIcon size={16} color={UiColors[effectiveTheme].emerald} />
                    </View>
                    <View style={styles.roomTextContainer}>
                      <ThemedText style={[styles.roomTitleText, { color: colors.text }]} numberOfLines={1}>
                        {activeRoom.name}
                      </ThemedText>
                      <ThemedText style={[styles.roomSubtitleText, { color: colors.textSecondary }]} numberOfLines={2}>
                        {activeRoom.buildingName} • {activeRoom.floorName}
                      </ThemedText>
                    </View>
                  </View>

                  {/* Device Count Badge */}
                  <View style={[styles.roomCapacityBadge, { backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].backgroundSelected : UiColors[effectiveTheme].accentSurface, borderColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border }]}>
                    <ThemedText style={[styles.roomCapacityText, { color: effectiveTheme === 'dark' ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].text }]}>
                      {controllers.length} {controllers.length === 1 ? 'device' : 'devices'}
                    </ThemedText>
                  </View>
                </View>
              </View>
            ) : (
              <View style={[
                styles.unassignedCard,
                {
                  backgroundColor: effectiveTheme === 'dark' ? '#1c1917' : UiColors[effectiveTheme].warningSurface,
                  borderColor: UiColors[effectiveTheme].panelBorder,
                }
              ]}>
                <View style={styles.unassignedCardTop}>
                  <View style={styles.unassignedIconCircle}>
                    <LocationIcon size={16} color={UiColors[effectiveTheme].textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={[styles.unassignedTitleText, { color: effectiveTheme === 'dark' ? UiColors[effectiveTheme].warning : UiColors[effectiveTheme].warning }]}>
                      Unassigned
                    </ThemedText>
                    <ThemedText style={[styles.unassignedSubtitleText, { color: effectiveTheme === 'dark' ? UiColors[effectiveTheme].warning : UiColors[effectiveTheme].warning }]}>
                      No active room assignment
                    </ThemedText>
                  </View>
                  <View style={styles.unassignedPill}>
                    <ThemedText style={styles.unassignedPillText}>STANDBY</ThemedText>
                  </View>
                </View>
                <ThemedText style={[styles.unassignedDescText, { color: effectiveTheme === 'dark' ? UiColors[effectiveTheme].warning : UiColors[effectiveTheme].warning }]}>
                  Your assigned location is no longer available. Contact your administrator.
                </ThemedText>
              </View>
            )}

            {/* Assigned Room AC Controller Devices Section Header */}
            <View style={styles.sectionHeaderContainer}>
              <View style={styles.sectionTitleRow}>
                <ThemedText type="smallBold" style={[styles.sectionTitle, { color: colors.text }]}>
                  {loading && !activeRoom ? 'Assigned AC Device' : activeRoom ? `Assigned AC Device (${controllers.length})` : 'Assigned AC Device (0)'}
                </ThemedText>
                <View style={[
                  styles.liveSyncPill,
                  {
                    backgroundColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement,
                    borderColor: effectiveTheme === 'dark' ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
                  },
                  !settings.autoSyncEnabled && { backgroundColor: UiColors[effectiveTheme].backgroundSelected, borderColor: UiColors[effectiveTheme].border },
                ]}>
                  <View style={[
                    styles.livePulseDot,
                    (!settings.autoSyncEnabled || !controllers.some(item => item.connectionState === 'online')) && { backgroundColor: '#94a3b8' },
                  ]} />
                </View>
              </View>
              <View style={[styles.thinDivider, { backgroundColor: effectiveTheme === 'dark' ? 'rgba(255, 255, 255, 0.08)' : UiColors[effectiveTheme].accentSurface }]} />
            </View>
            
            {fetchError && <ThemedText style={{ color: colors.textSecondary, marginBottom: 12 }}>{fetchError}</ThemedText>}
            <View style={styles.deviceGrid}>
              {loading && controllers.length === 0 ? (
                <DataListSkeleton label="Loading AC devices..." />
              ) : fetchError && !activeRoom ? null : !activeRoom ? (
                <View style={{ paddingVertical: 40, alignItems: 'center', justifyContent: 'center' }}>
                  <LocationIcon size={36} color={colors.textSecondary} />
                  <ThemedText style={{ marginTop: 12, fontSize: 15, color: colors.text, fontWeight: '800' }}>
                    No Assigned AC Device
                  </ThemedText>
                  <ThemedText style={{ marginTop: 6, fontSize: 12.5, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 30, lineHeight: 18 }}>
                      Ask your administrator to assign a room. Its AC devices will appear here.
                  </ThemedText>
                </View>
              ) : controllers.length === 0 ? (
                <View style={{ paddingVertical: 40, alignItems: 'center', justifyContent: 'center' }}>
                  <AppIcon name="bolt" size={36} color={colors.emerald} />
                  <ThemedText style={{ marginTop: 12, fontSize: 14, color: colors.text, fontWeight: '800' }}>
                    No AC devices assigned to {activeRoom.name}.
                  </ThemedText>
                  <ThemedText style={{ marginTop: 6, fontSize: 12, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 30, lineHeight: 18 }}>
                    AC devices placed into this room will appear here live.
                  </ThemedText>
                </View>
              ) : (
                controllers.map((controller) => (
                  <AcControllerCard
                    key={controller.id}
                    controller={controller}
                    onPress={() => openDetails(controller)}
                  />
                ))
              )}
            </View>

          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Slide-up Bottom Sheet Modal */}
      <AcControllerDetailSheet
        key={userId + ":" + (selectedController?.id || "none")}
        visible={detailsVisible}
        controller={selectedController}
        onClose={closeDetails}
        slideAnim={slideAnim}
      />

      {!detailsVisible && <FloatingBottomNavbar currentPage="home" />}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: 14,
    backgroundColor: 'transparent',
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
    lineHeight: 18,
    color: colors.text,
  },
  hamburgerTriggerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    position: 'relative',
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  hamburgerBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#ef4444',
    width: 15,
    height: 15,
    borderRadius: 7.5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    zIndex: 10,
  },
  hamburgerBadgeText: {
    fontSize: 8.5,
    fontWeight: '800',
    color: colors.onPrimary,
    lineHeight: 11,
  },
  lightTriggerButton: {
    backgroundColor: colors.backgroundElement,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  headerHamburgerLine: {
    width: 18,
    height: 2,
    backgroundColor: colors.primaryFill,
    borderRadius: 1,
  },
  scrollContent: {
    paddingBottom: 110,
  },
  contentBody: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
    marginTop: Spacing.four,
  },
  welcomeBanner: {
    borderRadius: 24,
    padding: Spacing.four,
    gap: Spacing.one,
  },
  welcomeText: {
    color: colors.onPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  welcomeSub: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  // Room Location Context Card (Mirroring Desktop Middle Panel)
  roomContextCard: {
    backgroundColor: colors.backgroundElement,
    borderWidth: 1.5,
    borderColor: colors.panelBorder,
    borderRadius: 18,
    padding: 14,
    marginTop: Spacing.three,
    marginBottom: Spacing.one,
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.07,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  roomContextTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  roomIconTitleGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
    marginRight: 6,
  },
  roomTextContainer: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  roomIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.accentSurface,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  roomTitleText: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: 0.2,
  },
  roomSubtitleText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.text,
    marginTop: 2,
    lineHeight: 15,
  },
  roomCapacityBadge: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSurface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  roomCapacityText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.text,
  },
  unassignedCard: {
    backgroundColor: colors.warningSurface,
    borderWidth: 1.5,
    borderColor: colors.panelBorder,
    borderRadius: 18,
    padding: 14,
    marginTop: Spacing.three,
    marginBottom: Spacing.one,
  },
  unassignedCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  unassignedIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.warningSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unassignedTitleText: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.warning,
  },
  unassignedSubtitleText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.warning,
    marginTop: 1,
  },
  unassignedPill: {
    backgroundColor: colors.warningSurface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  unassignedPillText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: colors.warning,
    letterSpacing: 0.5,
  },
  unassignedDescText: {
    fontSize: 11,
    color: colors.warning,
    lineHeight: 16,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  liveSyncPill: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.accentSurface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  livePulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primaryFill,
  },
  liveSyncText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: colors.emerald,
    letterSpacing: 0.5,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
  },
  sectionHeaderContainer: {
    marginTop: Spacing.two,
    alignItems: 'stretch',
  },
  thinDivider: {
    height: 1,
    backgroundColor: colors.accentSurface, // thin white emerald green color highlight line
    marginTop: 6,
    width: '100%',
  },
  deviceGrid: {
    gap: Spacing.three,
  },
  infoSection: {
    borderRadius: 20,
    padding: Spacing.four,
  },
  lightInfoSection: {
    backgroundColor: colors.backgroundSelected,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  buttonPressed: {
    transform: [{ scale: 0.97 }],
  },
  userProfileCard: {
    flexDirection: 'column',
    alignItems: 'stretch',
    backgroundColor: '#f4fbf7', // Premium soft mint tint background
    borderWidth: 1.5,
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 16,
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
  cardTopSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatarContainer: {
    position: 'relative',
    width: 80,
    height: 80,
  },
  userProfileCardAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2.5,
    borderColor: colors.panelBorder, // Changed border line color into gray
  },
  statusDotWrapper: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: colors.backgroundElement,
    backgroundColor: colors.emerald,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.emerald,
  },
  userProfileCardDetails: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  userProfileCardName: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#e6f7f0', // soft emerald background tint
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 4,
    borderWidth: 0.5,
    borderColor: colors.border,
    maxWidth: '100%',
  },
  roleBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: colors.emerald,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    lineHeight: 13,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
    flexWrap: 'wrap',
  },
  phoneLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '700',
  },
  userProfileCardPhone: {
    fontSize: 12,
    color: '#4b5563',
    fontWeight: '700',
  },
  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
    marginTop: 12,
  },
  cardBottomText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: colors.emerald,
    letterSpacing: 0.3,
    lineHeight: 15,
  },
});
const themedStyles = { light: createStyles(UiColors.light), dark: createStyles(UiColors.dark) };
