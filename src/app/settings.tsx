import { Colors as UiColors, type AppColors, Spacing } from '@/constants/theme';
import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  Switch,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ThemedText } from '@/components/themed-text';

import { useAuth } from '@/context/auth-context';
import { useSettings, SystemSettings } from '@/context/settings-context';
import { FloatingBottomNavbar } from '@/components/floating-navbar';
import { AppIcon } from '@/components/app-icon';

export default function SettingsScreen() {
  const { userId } = useAuth();
  const {
    settings,
    effectiveTheme,
    colors,
    updateSetting,
    saveAllSettings,
    resetDefaults,
    clearLocalCache,
  } = useSettings();
  const styles = themedStyles[effectiveTheme];

  const isDark = effectiveTheme === 'dark';

  const {
    theme: selectedTheme,
    tempUnit,
    autoSyncEnabled,
    syncFrequency,
    criticalAlertsEnabled,
    maintenanceRemindersEnabled,
    hapticFeedbackEnabled,
  } = settings;
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);

  // Handle instant theme change
  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    updateSetting('theme', newTheme);
  };

  // Handle instant temp unit change
  const handleTempUnitChange = (newUnit: 'C' | 'F') => {
    updateSetting('tempUnit', newUnit);
  };

  // Handle instant sync frequency change
  const handleSyncFrequencyChange = (newFreq: 5 | 15 | 30) => {
    updateSetting('syncFrequency', newFreq);
  };

  // Handle instant auto sync toggle
  const handleAutoSyncToggle = (val: boolean) => {
    updateSetting('autoSyncEnabled', val);
  };

  // Handle instant critical alerts toggle
  const handleCriticalAlertsToggle = (val: boolean) => {
    updateSetting('criticalAlertsEnabled', val);
  };

  // Handle instant maintenance reminders toggle
  const handleMaintenanceRemindersToggle = (val: boolean) => {
    updateSetting('maintenanceRemindersEnabled', val);
  };

  // Handle instant haptic feedback toggle
  const handleHapticFeedbackToggle = (val: boolean) => {
    updateSetting('hapticFeedbackEnabled', val);
  };

  const handleSave = async () => {
    const payload: SystemSettings = {
      theme: selectedTheme,
      tempUnit,
      autoSyncEnabled,
      syncFrequency,
      criticalAlertsEnabled,
      maintenanceRemindersEnabled,
      hapticFeedbackEnabled,
    };
    await saveAllSettings(payload);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const handleClearCache = () => {
    Alert.alert(
      'Clear Local Cache',
      'This will clear offline telemetry caches and refresh local buffers. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Cache',
          style: 'destructive',
          onPress: async () => {
            await clearLocalCache();
            setCacheCleared(true);
            setTimeout(() => setCacheCleared(false), 2500);
          },
        },
      ]
    );
  };

  const handleReset = async () => {
    await resetDefaults();
  };

  return (
    <LinearGradient
      colors={[UiColors[effectiveTheme].background, UiColors[effectiveTheme].background]}
      style={[styles.container, { backgroundColor: colors.background }]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 0.4 }}
    >
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* Top Header */}
        <View
          style={[
            styles.headerContainer,
            {
              backgroundColor: isDark ? '#0f172a' : UiColors[effectiveTheme].backgroundElement,
              borderBottomColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
            },
          ]}
        >
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.6 }]}
            hitSlop={12}
          >
            <ThemedText
              style={[styles.backArrow, { color: isDark ? UiColors[effectiveTheme].onPrimary : UiColors[effectiveTheme].text }]}
            >
              ←
            </ThemedText>
          </Pressable>
          <View style={styles.headerTitles}>
            <ThemedText
              style={[styles.pageTitle, { color: isDark ? UiColors[effectiveTheme].onPrimary : UiColors[effectiveTheme].text }]}
            >
              System Settings
            </ThemedText>
            <ThemedText
              style={[
                styles.pageSubtitle,
                { color: isDark ? UiColors[effectiveTheme].textSecondary : UiColors[effectiveTheme].textSecondary },
              ]}
            >
              Preferences & Configuration
            </ThemedText>
          </View>
        </View>

        <ScrollView
          style={styles.scrollBody}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* 1. Display & Measurement */}
          <View
            style={[
              styles.cardSection,
              {
                backgroundColor: isDark ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement,
                borderColor: UiColors[effectiveTheme].panelBorder,
              },
            ]}
          >
            <ThemedText
              style={[styles.sectionHeading, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}
            >
              Display & Measurement
            </ThemedText>

          {/* Theme Selector */}
          <View style={styles.inputGroup}>
            <ThemedText
              style={[styles.inputLabel, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}
            >
              App Display Theme
            </ThemedText>
            <View style={styles.segmentedRow}>
              {(['system', 'light', 'dark'] as const).map((t) => {
                const isActive = selectedTheme === t;
                return (
                  <Pressable
                    key={t}
                    onPress={() => handleThemeChange(t)}
                    style={[
                      styles.segmentedBtn,
                      isActive
                        ? styles.segmentedBtnActive
                        : isDark
                        ? styles.segmentedBtnInactiveDark
                        : styles.segmentedBtnInactiveLight,
                    ]}
                  >
                    <ThemedText
                      style={[
                        styles.segmentedBtnText,
                        {
                          color: isActive
                            ? UiColors[effectiveTheme].onPrimary
                            : isDark
                            ? UiColors[effectiveTheme].textMuted
                            : UiColors[effectiveTheme].textSecondary,
                        },
                      ]}
                    >
                      {t === 'system' ? 'System' : t === 'light' ? 'Light' : 'Dark'}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Temperature Unit */}
          <View style={[styles.inputGroup, { marginTop: 16 }]}>
            <ThemedText
              style={[styles.inputLabel, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}
            >
              Temperature Unit
            </ThemedText>
            <View style={styles.segmentedRow}>
              {(['C', 'F'] as const).map((u) => {
                const isActive = tempUnit === u;
                return (
                  <Pressable
                    key={u}
                    onPress={() => handleTempUnitChange(u)}
                    style={[
                      styles.segmentedBtn,
                      isActive
                        ? styles.segmentedBtnActive
                        : isDark
                        ? styles.segmentedBtnInactiveDark
                        : styles.segmentedBtnInactiveLight,
                    ]}
                  >
                    <ThemedText
                      style={[
                        styles.segmentedBtnText,
                        {
                          color: isActive
                            ? UiColors[effectiveTheme].onPrimary
                            : isDark
                            ? UiColors[effectiveTheme].textMuted
                            : UiColors[effectiveTheme].textSecondary,
                        },
                      ]}
                    >
                      {u === 'C' ? 'Celsius (°C)' : 'Fahrenheit (°F)'}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        {/* 2. Telemetry & Real-Time Sync */}
        <View
          style={[
            styles.cardSection,
            {
              backgroundColor: isDark ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement,
              borderColor: UiColors[effectiveTheme].panelBorder,
            },
          ]}
        >
          <ThemedText
            style={[styles.sectionHeading, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}
          >
            Telemetry & Live Sync
          </ThemedText>

          <View
            style={[
              styles.toggleRow,
              { borderBottomColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border },
            ]}
          >
            <View style={{ flex: 1, paddingRight: 10 }}>
              <ThemedText
                style={[styles.toggleLabel, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}
              >
                Live Telemetry Auto-Sync
              </ThemedText>
              <ThemedText
                style={[
                  styles.toggleSubtext,
                  { color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary },
                ]}
              >
                Real-time PostgreSQL background streaming
              </ThemedText>
            </View>
            <Switch
              value={autoSyncEnabled}
              onValueChange={handleAutoSyncToggle}
              trackColor={{ false: isDark ? '#334155' : '#cbd5e1', true: '#10b981' }}
              thumbColor="#ffffff"
            />
          </View>

          <View style={[styles.inputGroup, { marginTop: 16 }]}>
            <ThemedText
              style={[styles.inputLabel, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}
            >
              Sync Polling Rate
            </ThemedText>
            <View style={styles.segmentedRow}>
              {([5, 15, 30] as const).map((sec) => {
                const isActive = syncFrequency === sec;
                return (
                  <Pressable
                    key={sec}
                    onPress={() => handleSyncFrequencyChange(sec)}
                    style={[
                      styles.segmentedBtn,
                      isActive
                        ? styles.segmentedBtnActive
                        : isDark
                        ? styles.segmentedBtnInactiveDark
                        : styles.segmentedBtnInactiveLight,
                    ]}
                  >
                    <ThemedText
                      style={[
                        styles.segmentedBtnText,
                        {
                          color: isActive
                            ? UiColors[effectiveTheme].onPrimary
                            : isDark
                            ? UiColors[effectiveTheme].textMuted
                            : UiColors[effectiveTheme].textSecondary,
                        },
                      ]}
                    >
                      {sec === 5 ? '5s (Fast)' : sec === 15 ? '15s (Normal)' : '30s (Eco)'}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        {/* 3. Alerts & Notification Transmissions */}
        <View
          style={[
            styles.cardSection,
            {
              backgroundColor: isDark ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement,
              borderColor: UiColors[effectiveTheme].panelBorder,
            },
          ]}
        >
          <ThemedText
            style={[styles.sectionHeading, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}
          >
            Alerts & Notifications
          </ThemedText>

          <View
            style={[
              styles.toggleRow,
              { borderBottomColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border },
            ]}
          >
            <View style={{ flex: 1, paddingRight: 10 }}>
              <ThemedText
                style={[styles.toggleLabel, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}
              >
                Critical Temp Thresholds
              </ThemedText>
              <ThemedText
                style={[
                  styles.toggleSubtext,
                  { color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary },
                ]}
              >
                Alert banner when room temperatures exceed 28°C
              </ThemedText>
            </View>
            <Switch
              value={criticalAlertsEnabled}
              onValueChange={handleCriticalAlertsToggle}
              trackColor={{ false: isDark ? '#334155' : '#cbd5e1', true: '#10b981' }}
              thumbColor="#ffffff"
            />
          </View>

          <View
            style={[
              styles.toggleRow,
              { borderBottomColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border },
            ]}
          >
            <View style={{ flex: 1, paddingRight: 10 }}>
              <ThemedText
                style={[styles.toggleLabel, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}
              >
                Maintenance Reminders
              </ThemedText>
              <ThemedText
                style={[
                  styles.toggleSubtext,
                  { color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary },
                ]}
              >
                Notices for filter inspection and scheduled checklists
              </ThemedText>
            </View>
            <Switch
              value={maintenanceRemindersEnabled}
              onValueChange={handleMaintenanceRemindersToggle}
              trackColor={{ false: isDark ? '#334155' : '#cbd5e1', true: '#10b981' }}
              thumbColor="#ffffff"
            />
          </View>

          <View style={[styles.toggleRow, { borderBottomWidth: 0 }]}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <ThemedText
                style={[styles.toggleLabel, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}
              >
                Haptic Feedback
              </ThemedText>
              <ThemedText
                style={[
                  styles.toggleSubtext,
                  { color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary },
                ]}
              >
                Physical device vibration on urgent alarms and taps
              </ThemedText>
            </View>
            <Switch
              value={hapticFeedbackEnabled}
              onValueChange={handleHapticFeedbackToggle}
              trackColor={{ false: isDark ? '#334155' : '#cbd5e1', true: '#10b981' }}
              thumbColor="#ffffff"
            />
          </View>
        </View>

        {/* 4. Maintenance & Storage */}
        <View
          style={[
            styles.cardSection,
            {
              backgroundColor: isDark ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement,
              borderColor: UiColors[effectiveTheme].panelBorder,
            },
          ]}
        >
          <ThemedText
            style={[styles.sectionHeading, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}
          >
            Offline Storage & Cache
          </ThemedText>

          <Pressable
            onPress={handleClearCache}
            style={({ pressed }) => [
              styles.cacheBtn,
              isDark && styles.cacheBtnDark,
              pressed && { opacity: 0.8 },
            ]}
          >
            <View style={{ flex: 1 }}>
              <ThemedText
                style={[styles.cacheBtnText, isDark && styles.cacheBtnTextDark]}
              >
                Clear Local Cache
              </ThemedText>
              <ThemedText
                style={[
                  styles.cacheBtnSubtext,
                  isDark && styles.cacheBtnSubtextDark,
                ]}
              >
                {cacheCleared
                  ? '✓ Local cache cleared successfully (0 KB)'
                  : 'Clears offline telemetry buffers and cached reports'}
              </ThemedText>
            </View>
            <AppIcon name="trash" size={20} color={UiColors[effectiveTheme].error} />
          </Pressable>
        </View>

        {/* 5. System Diagnostics */}
        <View
          style={[
            styles.cardSection,
            {
              backgroundColor: isDark ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement,
              borderColor: UiColors[effectiveTheme].panelBorder,
            },
          ]}
        >
          <ThemedText
            style={[styles.sectionHeading, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}
          >
            System Diagnostics
          </ThemedText>

          <View
            style={[
              styles.diagnosticsBox,
              {
                backgroundColor: isDark ? UiColors[effectiveTheme].background : UiColors[effectiveTheme].background,
                borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border,
              },
            ]}
          >
            <View style={styles.diagRow}>
              <ThemedText
                style={[styles.diagLabel, { color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary }]}
              >
                Server Status
              </ThemedText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: UiColors[effectiveTheme].primaryFill,
                  }}
                />
                <ThemedText
                  style={[styles.diagValue, { color: isDark ? UiColors[effectiveTheme].emerald : UiColors[effectiveTheme].emerald }]}
                >
                  Cloud Live Sync
                </ThemedText>
              </View>
            </View>
            <View style={styles.diagRow}>
              <ThemedText
                style={[styles.diagLabel, { color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary }]}
              >
                App Version
              </ThemedText>
              <ThemedText
                style={[styles.diagValue, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}
              >
                v1.2.0 • EcoTrack Mobile
              </ThemedText>
            </View>
            <View style={styles.diagRow}>
              <ThemedText
                style={[styles.diagLabel, { color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary }]}
              >
                Technician ID
              </ThemedText>
              <ThemedText
                style={[styles.diagValue, { color: isDark ? UiColors[effectiveTheme].text : UiColors[effectiveTheme].text }]}
              >
                {userId || 'stf_dc3099cc58504e5'}
              </ThemedText>
            </View>
          </View>
        </View>

        {/* Reset Defaults Button */}
        <Pressable onPress={handleReset} style={styles.resetBtn}>
          <ThemedText
            style={[
              styles.resetBtnText,
              { color: isDark ? UiColors[effectiveTheme].textMuted : UiColors[effectiveTheme].textSecondary },
            ]}
          >
            Reset to Factory Defaults
          </ThemedText>
        </Pressable>

        {/* Save Button */}
        <Pressable
          onPress={handleSave}
          style={({ pressed }) => [
            styles.saveButton,
            pressed && { opacity: 0.9 },
          ]}
        >
          {saveSuccess ? (
            <View style={styles.successRow}>
              <ThemedText style={{ color: UiColors[effectiveTheme].onPrimary, fontSize: 16, fontWeight: '900' }}>
                ✓
              </ThemedText>
              <ThemedText style={styles.saveButtonText}>SAVED SUCCESSFULLY</ThemedText>
            </View>
          ) : (
            <ThemedText style={styles.saveButtonText}>SAVE CONFIGURATION</ThemedText>
          )}
        </Pressable>

        <View style={{ height: 110 }} />
      </ScrollView>

      {/* Persistent Floating Bottom Navigation */}
      <FloatingBottomNavbar currentPage={'profile' as any} />
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
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: 14,
    borderBottomWidth: 1,
    gap: 12,
  },
  backButton: {
    padding: 6,
  },
  backArrow: {
    fontSize: 22,
    fontWeight: '800',
  },
  headerTitles: {
    flex: 1,
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  pageSubtitle: {
    fontSize: 12,
    marginTop: 2,
    fontWeight: '500',
  },
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  cardSection: {
    borderRadius: 18,
    padding: Spacing.four,
    borderWidth: 1,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionHeading: {
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: Spacing.three,
  },
  inputGroup: {
    marginTop: 2,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  segmentedRow: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentedBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
    }),
  },
  segmentedBtnActive: {
    backgroundColor: colors.primaryFill,
    borderColor: colors.emerald,
  },
  segmentedBtnInactiveLight: {
    backgroundColor: colors.backgroundSelected,
    borderColor: colors.border,
  },
  segmentedBtnInactiveDark: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  segmentedBtnText: {
    fontSize: 12,
    fontWeight: '800',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toggleLabel: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  toggleSubtext: {
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 3,
  },
  cacheBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.errorSurface,
    borderWidth: 1,
    borderColor: colors.border,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
    }),
  },
  cacheBtnDark: {
    backgroundColor: colors.errorSurface,
    borderColor: colors.border,
  },
  cacheBtnText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: colors.error,
  },
  cacheBtnTextDark: {
    color: colors.error,
  },
  cacheBtnSubtext: {
    fontSize: 11.5,
    color: colors.error,
    marginTop: 2,
    lineHeight: 16,
  },
  cacheBtnSubtextDark: {
    color: colors.error,
  },
  diagnosticsBox: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    gap: 8,
  },
  diagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  diagLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  diagValue: {
    fontSize: 12,
    fontWeight: '700',
  },
  resetBtn: {
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  saveButton: {
    backgroundColor: colors.primaryFill,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
    }),
  },
  saveButtonText: {
    color: colors.onPrimary,
    fontSize: 13.5,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  successRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
const themedStyles = { light: createStyles(UiColors.light), dark: createStyles(UiColors.dark) };
