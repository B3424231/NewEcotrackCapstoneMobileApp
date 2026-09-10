import { DarkTheme, DefaultTheme, ThemeProvider, Stack, router, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useState, useEffect, useRef } from 'react';
import { useColorScheme, Animated, View, StyleSheet, Platform, Pressable, TextInput, PanResponder, Dimensions, Modal } from 'react-native';
import { Image } from 'expo-image';
import { ThemedText } from '@/components/themed-text';
import Constants from 'expo-constants';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthScreen } from '@/components/auth-screen';
import { ArchivedAccountModal } from '@/components/archived-account-modal';
import { AuthProvider, useAuth } from '@/context/auth-context';
import { SettingsProvider, useSettings } from '@/context/settings-context';
import { NotificationEmitter } from '@/utils/notification-emitter';

export { useAuth } from '@/context/auth-context';
export { useSettings } from '@/context/settings-context';

SplashScreen.preventAutoHideAsync();

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function NavigationRoot() {
  const { effectiveTheme } = useSettings();
  const {
    isAuthenticated,
    userName,
    userRole,
    isArchived,
    archiveReason,
    archiveNotes,
    archivedAt,
    acknowledgeArchived,
    remotelyLoggedOut,
    acknowledgeRemoteLogout,
    login,
  } = useAuth();

  return (
    <ThemeProvider value={effectiveTheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {isAuthenticated && !isArchived ? (
        <>
          <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
          <GlobalNotificationBanner />
        </>
      ) : (
        <AuthScreen onLoginSuccess={login} />
      )}

      {/* Global Archival Reason Modal (Shows in real-time if admin archives account) */}
      <ArchivedAccountModal
        visible={isArchived}
        userName={userName}
        userRole={userRole}
        reason={archiveReason}
        notes={archiveNotes}
        archivedAt={archivedAt}
        onAcknowledge={acknowledgeArchived}
      />

      {/* Admin Remote Logout Modal */}
      <RemoteLogoutNoticeModal
        visible={remotelyLoggedOut}
        onDismiss={acknowledgeRemoteLogout}
      />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <NavigationRoot />
      </SettingsProvider>
    </AuthProvider>
  );
}

function GlobalNotificationBanner() {
  const { settings, triggerHaptic } = useSettings();
  const [visible, setVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isAlert, setIsAlert] = useState(false);

  const slideAnim = useRef(new Animated.Value(-150)).current;
  const panX = useRef(new Animated.Value(0)).current;
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear delivered/system notifications from the device tray
  const handleDismissAllSystemNotifications = () => {
    const isExpoGo = (Constants.executionEnvironment as string) === 'store-client' || Constants.appOwnership === 'expo';
    if (!isExpoGo) {
      try {
        const Notifications = require('expo-notifications');
        if (Notifications && typeof Notifications.dismissAllNotificationsAsync === 'function') {
          Notifications.dismissAllNotificationsAsync();
        }
      } catch (e) {
        // safe fallback
      }
    }
  };

  const dismissNotification = (direction: 'left' | 'right' | 'up' = 'up') => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
    }
    handleDismissAllSystemNotifications();

    if (direction === 'left') {
      Animated.timing(panX, {
        toValue: -SCREEN_WIDTH - 80,
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        setVisible(false);
        panX.setValue(0);
        slideAnim.setValue(-150);
      });
    } else if (direction === 'right') {
      Animated.timing(panX, {
        toValue: SCREEN_WIDTH + 80,
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        setVisible(false);
        panX.setValue(0);
        slideAnim.setValue(-150);
      });
    } else {
      Animated.timing(slideAnim, {
        toValue: -150,
        duration: 250,
        useNativeDriver: true,
      }).start(() => {
        setVisible(false);
        panX.setValue(0);
        slideAnim.setValue(-150);
      });
    }
  };

  // Bi-directional swipe (left & right) or upward swipe-to-dismiss PanResponder
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Handle horizontal swiping (both left & right) or upward swipe
        return Math.abs(gestureState.dx) > 8 || gestureState.dy < -8;
      },
      onPanResponderMove: (evt, gestureState) => {
        // Move horizontally left or right
        panX.setValue(gestureState.dx);
        if (gestureState.dy < 0) {
          slideAnim.setValue(20 + gestureState.dy);
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dx > 70 || gestureState.vx > 0.35) {
          // Swiped right to ignore
          dismissNotification('right');
        } else if (gestureState.dx < -70 || gestureState.vx < -0.35) {
          // Swiped left to ignore
          dismissNotification('left');
        } else if (gestureState.dy < -35 || gestureState.vy < -0.35) {
          // Swiped up to dismiss
          dismissNotification('up');
        } else {
          // Bounce back to center
          Animated.parallel([
            Animated.spring(panX, {
              toValue: 0,
              useNativeDriver: true,
              tension: 50,
              friction: 8,
            }),
            Animated.spring(slideAnim, {
              toValue: 20,
              useNativeDriver: true,
              tension: 50,
              friction: 8,
            }),
          ]).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    const removeListener = NotificationEmitter.addListener((newTitle, newBody, newIsAlert) => {
      // Respect user's System Settings notification preferences
      if (newIsAlert && !settings.criticalAlertsEnabled) {
        return;
      }
      if (!newIsAlert && !settings.maintenanceRemindersEnabled) {
        return;
      }

      setTitle(newTitle);
      setBody(newBody);
      setIsAlert(newIsAlert);
      setVisible(true);

      triggerHaptic();

      // Reset animate positions
      slideAnim.setValue(-150);
      panX.setValue(0);
      
      Animated.spring(slideAnim, {
        toValue: 20,
        useNativeDriver: true,
        tension: 40,
        friction: 8,
      }).start();

      // Auto dismiss after 6 seconds
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }
      dismissTimerRef.current = setTimeout(() => {
        dismissNotification('up');
      }, 6000);
    });

    // Safely listen to native push notification taps (if supported in standalone dev builds)
    let nativeSubscription: any = null;
    const isExpoGo = (Constants.executionEnvironment as string) === 'store-client' || Constants.appOwnership === 'expo';
    
    if (!isExpoGo) {
      try {
        const Notifications = require('expo-notifications');
        if (Notifications && typeof Notifications.addNotificationResponseReceivedListener === 'function') {
          nativeSubscription = Notifications.addNotificationResponseReceivedListener((response: any) => {
            if (response.actionIdentifier === 'turn_off') {
              if (typeof Notifications.dismissAllNotificationsAsync === 'function') {
                Notifications.dismissAllNotificationsAsync();
              }
            } else if (response.actionIdentifier === 'cancel') {
              if (typeof Notifications.dismissNotificationAsync === 'function') {
                Notifications.dismissNotificationAsync(response.notification.request.identifier);
              }
            } else {
              const channelId = response.notification?.request?.content?.android?.channelId;
              if (channelId === 'alerts') {
                router.push('/notification');
              } else if (channelId === 'messages') {
                router.push('/Maintenance' as any);
              }
            }
          });
        }
      } catch (e) {
        // safe fallback
      }
    }

    return () => {
      removeListener();
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }
      if (nativeSubscription && typeof nativeSubscription.remove === 'function') {
        nativeSubscription.remove();
      }
    };
  }, []);

  const handleBannerPress = () => {
    dismissNotification('up');
    const lowerTitle = (title || '').toLowerCase();
    const lowerBody = (body || '').toLowerCase();

    const isMaintenanceContext =
      lowerTitle.includes('task') ||
      lowerTitle.includes('maint') ||
      lowerTitle.includes('repair') ||
      lowerTitle.includes('due') ||
      lowerTitle.includes('checklist') ||
      lowerBody.includes('mr-') ||
      lowerBody.includes('aircon') ||
      lowerBody.includes('checklist');

    if (isMaintenanceContext) {
      router.push('/Maintenance' as any);
    } else if (isAlert) {
      router.push('/notification');
    } else {
      router.push('/Maintenance' as any);
    }
  };

  if (!visible) return null;

  const bannerOpacity = panX.interpolate({
    inputRange: [-SCREEN_WIDTH * 0.6, 0, SCREEN_WIDTH * 0.6],
    outputRange: [0, 1, 0],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      style={[
        bannerStyles.bannerContainer,
        {
          opacity: bannerOpacity,
          transform: [
            { translateY: slideAnim },
            { translateX: panX },
          ],
        },
      ]}
      {...panResponder.panHandlers}
    >
      <Pressable 
        onPress={handleBannerPress} 
        style={bannerStyles.bannerInner}
      >
        <View style={bannerStyles.bannerHeader}>
          <View style={bannerStyles.appIconContainer}>
            <Image
              source={require('@/assets/images/ecoTrack.png')}
              style={bannerStyles.appIcon}
              contentFit="contain"
            />
          </View>
          <ThemedText style={bannerStyles.appName}>EcoTrack</ThemedText>
          <ThemedText style={bannerStyles.timeText}>•  just now</ThemedText>
        </View>
        
        <View style={bannerStyles.bannerContent}>
          <ThemedText style={bannerStyles.titleText}>{title}</ThemedText>
          {!!body && (
            <ThemedText style={bannerStyles.bodyText} numberOfLines={2}>{body}</ThemedText>
          )}
        </View>
        
        <View style={bannerStyles.grabber} />
      </Pressable>
    </Animated.View>
  );
}

const bannerStyles = StyleSheet.create({
  bannerContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 44 : 24,
    left: 14,
    right: 14,
    zIndex: 999999,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.35,
        shadowRadius: 12,
      },
      android: {
        elevation: 12,
      },
    }),
  },
  bannerInner: {
    backgroundColor: 'rgba(11, 41, 29, 0.95)',
    borderWidth: 1.5,
    borderColor: 'rgba(16, 185, 129, 0.45)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  bannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  appIconContainer: {
    width: 18,
    height: 18,
    marginRight: 6,
    borderRadius: 4,
    overflow: 'hidden',
  },
  appIcon: {
    width: '100%',
    height: '100%',
  },
  appName: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#10b981',
    letterSpacing: 0.3,
  },
  timeText: {
    fontSize: 10.5,
    color: 'rgba(255, 255, 255, 0.5)',
    marginLeft: 6,
  },
  bannerContent: {
    marginBottom: 2,
  },
  titleText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 2,
  },
  bodyText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.85)',
    lineHeight: 16,
  },
  grabber: {
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    alignSelf: 'center',
    marginTop: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: {
    width: SCREEN_WIDTH - 48,
    backgroundColor: '#0b291d',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    padding: 20,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.35,
        shadowRadius: 12,
      },
      android: {
        elevation: 12,
      },
    }),
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.6)',
    letterSpacing: 0.5,
    marginBottom: 16,
    textAlign: 'center',
  },
  modalOption: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalOptionCancel: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(255, 255, 255, 0.2)',
    marginTop: 4,
    marginBottom: 0,
  },
  modalOptionTextDanger: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ef4444',
  },
  modalOptionTextCancel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
  },
});

function RemoteLogoutNoticeModal({
  visible,
  onDismiss,
}: {
  visible: boolean;
  onDismiss: () => void;
}) {
  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={bannerStyles.modalOverlay}>
        <View style={bannerStyles.modalContent}>
          <View style={remoteLogoutStyles.iconBadge}>
            <Image
              source={{
                uri: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmNTllMGIiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNOSAyMWgtMmEyIDIgMCAwIDEtMi0ydi0xNGEyIDIgMCAwIDEgMi0yaDJtMTQgN2wtNSA1bTUtNS01LTVtNSA1SDkiLz48L3N2Zz4=',
              }}
              style={{ width: 28, height: 28 }}
              contentFit="contain"
            />
          </View>
          <ThemedText style={remoteLogoutStyles.title}>Session Terminated</ThemedText>
          <ThemedText style={remoteLogoutStyles.description}>
            An administrator has remotely signed you out from the desktop central console.
          </ThemedText>
          <Pressable onPress={onDismiss} style={remoteLogoutStyles.button}>
            <ThemedText style={remoteLogoutStyles.buttonText}>RETURN TO LOGIN</ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const remoteLogoutStyles = StyleSheet.create({
  iconBadge: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '900',
    color: '#ffffff',
    marginBottom: 6,
    textAlign: 'center',
  },
  description: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 18,
    paddingHorizontal: 8,
  },
  button: {
    width: '100%',
    backgroundColor: '#10b981',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 12.5,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 0.6,
  },
});

