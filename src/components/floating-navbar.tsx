import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Pressable, Platform } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ThemedText } from './themed-text';
import { 
  ICON_HOME,
  ICON_MAINTENANCE, 
  ICON_DEVICES,
  getColoredSvgUri,
} from '@/constants/custom-icons';

const ICON_NOTIFICATION = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTE4IDhBNiA2IDAgMCAwIDYgOGMwIDctMyA5LTMgOWgxOHMtMy0yLTMtOSIvPjxwYXRoIGQ9Ik0xMy43MyAyMWEyIDIgMCAwIDEtMy40NiAwIi8+PC9zdmc+';
const ICON_PROFILE = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTIwIDIxdi0yYTQgNCAwIDAgMC00LTRIOGE0IDQgMCAwIDAtNCA0djIiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjciIHI9IjQiLz48L3N2Zz4=';

import { useAuth } from '@/context/auth-context';
import { useSettings } from '@/context/settings-context';
import { useMobileNotifications } from '@/hooks/use-mobile-notifications';
import { 
  fetchLiveMaintenanceReports, 
  subscribeToMaintenanceReports 
} from '@/services/supabase';

const AVATAR_DEFAULT = require('@/assets/images/avatar_default.png');
const AVATAR_MALE = require('@/assets/images/avatar_male.png');
const AVATAR_FEMALE = require('@/assets/images/avatar_female.png');

export type TabPageType = 'home' | 'sensor-location' | 'maintenance' | 'devices' | 'aircons' | 'notifications' | 'profile';

interface TabItem {
  id: TabPageType;
  label: string;
  icon: string;
  route: string;
  badge?: number;
  badgeColor?: string;
  badgeTextColor?: string;
  isCenter?: boolean;
}

interface FloatingBottomNavbarProps {
  currentPage: TabPageType;
}

export function FloatingBottomNavbar({ currentPage }: FloatingBottomNavbarProps) {
  const { userAvatar, userCustomPhotoUri, userName, userId, userType, isAuthenticated } = useAuth();
  const { effectiveTheme } = useSettings();
  const isDark = effectiveTheme === 'dark';
  const accountKey = isAuthenticated && userId ? `${userType}:${userId}` : undefined;
  const [maintenanceBadge, setMaintenanceBadge] = useState<{ accountKey?: string; count: number }>({ count: 0 });
  const maintenanceBadgeCount = maintenanceBadge.accountKey === accountKey ? maintenanceBadge.count : 0;
  const { items: notifications } = useMobileNotifications(accountKey);
  const alertsBadgeCount = notifications.filter(note => !note.isRead).length;

  useEffect(() => {
    let isMounted = true;
    let requestId = 0;
    if (!accountKey) return;

    const loadBadgeCounts = async () => {
      const request = ++requestId;
      try {
        const reports = await fetchLiveMaintenanceReports(userName);

        if (isMounted && request === requestId) {
          const inProgress = reports.filter((r) => r.status === 'In Progress').length;
          const activeMaintenance = inProgress > 0 ? inProgress : reports.filter((r) => r.status === 'Pending').length;

          setMaintenanceBadge({ accountKey, count: activeMaintenance });
        }
      } catch (e) {
        // Safe fallback
      }
    };

    loadBadgeCounts();

    const unsubMaint = subscribeToMaintenanceReports(() => {
      loadBadgeCounts();
    });

    return () => {
      isMounted = false;
      unsubMaint();
    };
  }, [userName, accountKey]);

  const getAvatarSource = () => {
    if (userCustomPhotoUri) return { uri: userCustomPhotoUri };
    if (userAvatar === 'male') return AVATAR_MALE;
    if (userAvatar === 'female') return AVATAR_FEMALE;
    return AVATAR_DEFAULT;
  };

  const tabs: TabItem[] = [
    { id: 'sensor-location', label: 'Home', icon: ICON_HOME, route: '/' },
    { 
      id: 'maintenance', 
      label: 'Maintenance', 
      icon: ICON_MAINTENANCE, 
      route: '/Maintenance', 
      badge: maintenanceBadgeCount,
      badgeColor: '#f59e0b',
      badgeTextColor: '#0b291d',
    },
    { 
      id: 'devices', 
      label: 'Devices', 
      icon: ICON_DEVICES, 
      route: '/devices',
      isCenter: true,
    },
    { 
      id: 'notifications', 
      label: 'Notification', 
      icon: ICON_NOTIFICATION, 
      route: '/notification', 
      badge: alertsBadgeCount,
      badgeColor: '#ef4444',
      badgeTextColor: '#ffffff',
    },
    { id: 'profile', label: 'Profile', icon: ICON_PROFILE, route: '/profile' },
  ];

  const handlePress = (route: string) => {
    router.replace(route as any);
  };

  return (
    <View style={styles.navbarContainer as any}>
      <View
        accessibilityRole="tablist"
        accessibilityLabel="Main navigation"
        style={[
          styles.navbarInner as any,
          isDark && {
            backgroundColor: '#121826',
            borderColor: 'rgba(255, 255, 255, 0.12)',
          },
        ]}
      >
        {tabs.map((tab) => {
          const isActive =
            currentPage === tab.id ||
            ((tab.id === 'sensor-location' || tab.id === 'home') &&
              (currentPage === 'home' || currentPage === 'sensor-location')) ||
            (tab.id === 'devices' && currentPage === 'aircons');
          const isProfileTab = tab.id === 'profile';
          const isCenterTab = tab.isCenter;

          if (isCenterTab) {
            const centerIconColor = isActive ? '#ffffff' : (isDark ? 'rgba(255, 255, 255, 0.7)' : '#cbd5e1');
            const centerIconUri = getColoredSvgUri(tab.icon, centerIconColor);

            return (
              <View key={tab.id} style={styles.centerTabWrapper as any}>
                <Pressable
                  onPress={() => handlePress(tab.route)}
                  style={({ pressed }) => [
                    styles.centerButton as any,
                    isDark && {
                      backgroundColor: '#1e293b',
                      borderColor: 'rgba(255, 255, 255, 0.2)',
                    },
                    isActive && (styles.centerButtonActive as any),
                    pressed && (styles.centerButtonPressed as any),
                  ]}
                  accessible
                  accessibilityRole="tab"
                  accessibilityLabel={tab.label}
                  accessibilityState={{ selected: isActive }}
                  aria-selected={isActive}
                >
                  <View style={[styles.centerButtonInner as any, isActive && (styles.centerButtonInnerActive as any)]}>
                    <Image
                      source={{ uri: centerIconUri }}
                      style={[styles.centerIcon as any, isActive && (styles.centerIconActive as any)]}
                      tintColor={centerIconColor}
                      contentFit="contain"
                    />
                  </View>
                </Pressable>
                <ThemedText
                  accessible={false}
                  importantForAccessibility="no"
                  style={[
                    styles.centerTabLabel as any,
                    isActive ? (styles.tabLabelActive as any) : (styles.tabLabelInactive as any),
                  ]}
                  numberOfLines={1}
                >
                  {tab.label}
                </ThemedText>
              </View>
            );
          }

          const tabColor = isActive ? '#34d399' : '#cbd5e1';
          const coloredIconUri = getColoredSvgUri(tab.icon, tabColor);

          return (
            <Pressable
              key={tab.id}
              accessible
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: isActive }}
                  aria-selected={isActive}
              onPress={() => handlePress(tab.route)}
              style={({ pressed }) => [
                styles.tabButton as any,
                (tab.id === 'maintenance' || tab.id === 'notifications') && styles.longLabelTab,
                pressed && (styles.tabButtonPressed as any),
              ]}
            >
              <View style={styles.iconWrapper as any}>
                {isProfileTab ? (
                  <View
                    style={[
                      styles.profileAvatarWrapper as any,
                      isActive && (styles.profileAvatarWrapperActive as any),
                    ]}
                  >
                    <Image
                      source={getAvatarSource()}
                      style={styles.profileAvatarImage as any}
                      contentFit="cover"
                    />
                  </View>
                ) : (
                  <Image
                    source={{ uri: coloredIconUri }}
                    style={[
                      styles.tabIcon as any,
                      isActive ? (styles.tabIconActive as any) : (styles.tabIconInactive as any),
                    ]}
                    tintColor={tabColor}
                    contentFit="contain"
                  />
                )}

                {/* Badge if present and count > 0 */}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <View 
                    style={[
                      styles.badgeContainer as any,
                      tab.badgeColor ? { backgroundColor: tab.badgeColor } : {},
                    ]}
                  >
                    <ThemedText 
                      style={[
                        styles.badgeText as any,
                        tab.badgeTextColor ? { color: tab.badgeTextColor } : {},
                      ]}
                    >
                      {tab.badge > 99 ? '99+' : tab.badge}
                    </ThemedText>
                  </View>
                )}
              </View>
              <ThemedText
                style={[
                  styles.tabLabel as any,
                  isActive ? (styles.tabLabelActive as any) : (styles.tabLabelInactive as any),
                ]}
                numberOfLines={2}
              >
                {tab.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  navbarContainer: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 24 : 16,
    left: 12,
    right: 12,
    zIndex: 1000,
    alignItems: 'center',
  },
  navbarInner: {
    flexDirection: 'row',
    backgroundColor: '#121826', // Solid deep forest green
    borderRadius: 28,
    paddingVertical: 8,
    paddingHorizontal: 6,
    width: '100%',
    maxWidth: 520,
    justifyContent: 'space-around',
    alignItems: 'center',
    borderWidth: 1.2,
    borderColor: '#334155',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.35,
        shadowRadius: 14,
      },
      android: {
        elevation: 10,
      },
    }),
  },
  tabButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
    gap: 3,
  },
  longLabelTab: {
    flex: 1.5,
  },
  tabButtonPressed: {
    transform: [{ scale: 0.92 }],
    opacity: 0.75,
  },
  iconWrapper: {
    position: 'relative',
    width: 26,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIcon: {
    width: 22,
    height: 22,
  },
  tabIconActive: {
    tintColor: '#34d399', // Glowing brand emerald
    ...Platform.select({
      ios: {
        shadowColor: '#10b981',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0,
        shadowRadius: 6,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  tabIconInactive: {
    tintColor: '#cbd5e1',
  },
  tabLabel: {
    fontSize: 9.5,
    lineHeight: 12,
    maxWidth: '100%',
    fontWeight: '700',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  tabLabelActive: {
    color: '#34d399',
    fontWeight: '900',
    textShadowColor: 'rgba(16, 185, 129, 0.75)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 0,
  },
  tabLabelInactive: {
    color: '#cbd5e1',
    fontWeight: '600',
  },

  // Elevated Center Floating Button Styles
  centerTabWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -20,
    width: 58,
    zIndex: 20,
  },
  centerButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#121826',
    borderWidth: 2.5,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerButtonActive: {
    borderColor: '#10b981',
    ...Platform.select({
      ios: {
        shadowColor: '#10b981',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0,
        shadowRadius: 10,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  centerButtonInner: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerButtonInnerActive: {
    backgroundColor: '#047857',
  },
  centerButtonPressed: {
    transform: [{ scale: 0.92 }],
    opacity: 0.85,
  },
  centerIcon: {
    width: 18,
    height: 18,
    tintColor: 'rgba(255, 255, 255, 0.55)',
  },
  centerIconActive: {
    tintColor: '#ffffff',
  },
  centerTabLabel: {
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.2,
    textAlign: 'center',
    marginTop: 2,
  },

  badgeContainer: {
    position: 'absolute',
    top: -4,
    right: -7,
    backgroundColor: '#f59e0b',
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.2,
    borderColor: '#0b291d',
    zIndex: 10,
    paddingHorizontal: 2,
  },
  badgeText: {
    fontSize: 8,
    fontWeight: '900',
    color: '#0b291d',
    lineHeight: 11,
  },
  profileAvatarWrapper: {
    width: 24,
    height: 24,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  profileAvatarWrapperActive: {
    borderColor: '#10b981',
    borderWidth: 2,
    ...Platform.select({
      ios: {
        shadowColor: '#10b981',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  profileAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
});
