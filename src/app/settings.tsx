import React, { useState, useEffect } from 'react';
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
import { router } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
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

  const isDark = effectiveTheme === 'dark';

  const [selectedTheme, setSelectedTheme] = useState<'light' | 'dark' | 'system'>(settings.theme);
  const [tempUnit, setTempUnit] = useState<'C' | 'F'>(settings.tempUnit);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(settings.autoSyncEnabled);
  const [syncFrequency, setSyncFrequency] = useState<5 | 15 | 30>(settings.syncFrequency);
  const [criticalAlertsEnabled, setCriticalAlertsEnabled] = useState(settings.criticalAlertsEnabled);
  const [maintenanceRemindersEnabled, setMaintenanceRemindersEnabled] = useState(
    settings.maintenanceRemindersEnabled
  );
  const [hapticFeedbackEnabled, setHapticFeedbackEnabled] = useState(
    settings.hapticFeedbackEnabled
  );
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);

  useEffect(() => {
    setSelectedTheme(settings.theme);
    setTempUnit(settings.tempUnit);
    setAutoSyncEnabled(settings.autoSyncEnabled);
    setSyncFrequency(settings.syncFrequency);
    setCriticalAlertsEnabled(settings.criticalAlertsEnabled);
    setMaintenanceRemindersEnabled(settings.maintenanceRemindersEnabled);
    setHapticFeedbackEnabled(settings.hapticFeedbackEnabled);
  }, [settings]);

  // Handle instant theme change
  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setSelectedTheme(newTheme);
    updateSetting('theme', newTheme);
  };

  // Handle instant temp unit change
  const handleTempUnitChange = (newUnit: 'C' | 'F') => {
    setTempUnit(newUnit);
    updateSetting('tempUnit', newUnit);
  };

  // Handle instant sync frequency change
  const handleSyncFrequencyChange = (newFreq: 5 | 15 | 30) => {
    setSyncFrequency(newFreq);
    updateSetting('syncFrequency', newFreq);
  };

  // Handle instant auto sync toggle
  const handleAutoSyncToggle = (val: boolean) => {
    setAutoSyncEnabled(val);
    updateSetting('autoSyncEnabled', val);
  };

  // Handle instant critical alerts toggle
  const handleCriticalAlertsToggle = (val: boolean) => {
    setCriticalAlertsEnabled(val);
    updateSetting('criticalAlertsEnabled', val);
  };

  // Handle instant maintenance reminders toggle
  const handleMaintenanceRemindersToggle = (val: boolean) => {
    setMaintenanceRemindersEnabled(val);
    updateSetting('maintenanceRemindersEnabled', val);
  };

  // Handle instant haptic feedback toggle
  const handleHapticFeedbackToggle = (val: boolean) => {
    setHapticFeedbackEnabled(val);
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
    setSelectedTheme('system');
    setTempUnit('C');
    setAutoSyncEnabled(true);
    setSyncFrequency(15);
    setCriticalAlertsEnabled(true);
    setMaintenanceRemindersEnabled(true);
    setHapticFeedbackEnabled(true);
  };

  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        { backgroundColor: isDark ? '#0a0f1d' : '#f8fafc' },
      ]}
      edges={['top']}
    >
      {/* Top Header */}
      <View
        style={[
          styles.headerContainer,
          {
            backgroundColor: isDark ? '#0f172a' : '#ffffff',
            borderBottomColor: isDark ? '#1e293b' : '#e2e8f0',
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.6 }]}
          hitSlop={12}
        >
          <ThemedText
            style={[styles.backArrow, { color: isDark ? '#ffffff' : '#064e3b' }]}
          >
            ←
          </ThemedText>
        </Pressable>
        <View style={styles.headerTitles}>
          <ThemedText
            style={[styles.pageTitle, { color: isDark ? '#ffffff' : '#064e3b' }]}
          >
            System Settings
          </ThemedText>
          <ThemedText
            style={[
              styles.pageSubtitle,
              { color: isDark ? '#94a3b8' : '#6b7280' },
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
              backgroundColor: isDark ? '#151e32' : '#ffffff',
              borderColor: isDark ? '#334155' : '#e2e8f0',
            },
          ]}
        >
          <ThemedText
            style={[styles.sectionHeading, { color: isDark ? '#34d399' : '#059669' }]}
          >
            Display & Measurement
          </ThemedText>

          {/* Theme Selector */}
          <View style={styles.inputGroup}>
            <ThemedText
              style={[styles.inputLabel, { color: isDark ? '#f1f5f9' : '#1e293b' }]}
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
                            ? '#ffffff'
                            : isDark
                            ? '#cbd5e1'
                            : '#475569',
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
              style={[styles.inputLabel, { color: isDark ? '#f1f5f9' : '#1e293b' }]}
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
                            ? '#ffffff'
                            : isDark
                            ? '#cbd5e1'
                            : '#475569',
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
              backgroundColor: isDark ? '#151e32' : '#ffffff',
              borderColor: isDark ? '#334155' : '#e2e8f0',
            },
          ]}
        >
          <ThemedText
            style={[styles.sectionHeading, { color: isDark ? '#34d399' : '#059669' }]}
          >
            Telemetry & Live Sync
          </ThemedText>

          <View
            style={[
              styles.toggleRow,
              { borderBottomColor: isDark ? '#1e293b' : '#f1f5f9' },
            ]}
          >
            <View style={{ flex: 1, paddingRight: 10 }}>
              <ThemedText
                style={[styles.toggleLabel, { color: isDark ? '#f1f5f9' : '#1e293b' }]}
              >
                Live Telemetry Auto-Sync
              </ThemedText>
              <ThemedText
                style={[
                  styles.toggleSubtext,
                  { color: isDark ? '#94a3b8' : '#64748b' },
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
              style={[styles.inputLabel, { color: isDark ? '#f1f5f9' : '#1e293b' }]}
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
                            ? '#ffffff'
                            : isDark
                            ? '#cbd5e1'
                            : '#475569',
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
              backgroundColor: isDark ? '#151e32' : '#ffffff',
              borderColor: isDark ? '#334155' : '#e2e8f0',
            },
          ]}
        >
          <ThemedText
            style={[styles.sectionHeading, { color: isDark ? '#34d399' : '#059669' }]}
          >
            Alerts & Notifications
          </ThemedText>

          <View
            style={[
              styles.toggleRow,
              { borderBottomColor: isDark ? '#1e293b' : '#f1f5f9' },
            ]}
          >
            <View style={{ flex: 1, paddingRight: 10 }}>
              <ThemedText
                style={[styles.toggleLabel, { color: isDark ? '#f1f5f9' : '#1e293b' }]}
              >
                Critical Temp Thresholds
              </ThemedText>
              <ThemedText
                style={[
                  styles.toggleSubtext,
                  { color: isDark ? '#94a3b8' : '#64748b' },
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
              { borderBottomColor: isDark ? '#1e293b' : '#f1f5f9' },
            ]}
          >
            <View style={{ flex: 1, paddingRight: 10 }}>
              <ThemedText
                style={[styles.toggleLabel, { color: isDark ? '#f1f5f9' : '#1e293b' }]}
              >
                Maintenance Reminders
              </ThemedText>
              <ThemedText
                style={[
                  styles.toggleSubtext,
                  { color: isDark ? '#94a3b8' : '#64748b' },
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
                style={[styles.toggleLabel, { color: isDark ? '#f1f5f9' : '#1e293b' }]}
              >
                Haptic Feedback
              </ThemedText>
              <ThemedText
                style={[
                  styles.toggleSubtext,
                  { color: isDark ? '#94a3b8' : '#64748b' },
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
              backgroundColor: isDark ? '#151e32' : '#ffffff',
              borderColor: isDark ? '#334155' : '#e2e8f0',
            },
          ]}
        >
          <ThemedText
            style={[styles.sectionHeading, { color: isDark ? '#34d399' : '#059669' }]}
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
            <AppIcon name="trash" size={20} color="#ef4444" />
          </Pressable>
        </View>

        {/* 5. System Diagnostics */}
        <View
          style={[
            styles.cardSection,
            {
              backgroundColor: isDark ? '#151e32' : '#ffffff',
              borderColor: isDark ? '#334155' : '#e2e8f0',
            },
          ]}
        >
          <ThemedText
            style={[styles.sectionHeading, { color: isDark ? '#34d399' : '#059669' }]}
          >
            System Diagnostics
          </ThemedText>

          <View
            style={[
              styles.diagnosticsBox,
              {
                backgroundColor: isDark ? '#0a0f1d' : '#f8fafc',
                borderColor: isDark ? '#334155' : '#e2e8f0',
              },
            ]}
          >
            <View style={styles.diagRow}>
              <ThemedText
                style={[styles.diagLabel, { color: isDark ? '#94a3b8' : '#64748b' }]}
              >
                Server Status
              </ThemedText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: '#10b981',
                  }}
                />
                <ThemedText
                  style={[styles.diagValue, { color: isDark ? '#34d399' : '#059669' }]}
                >
                  Cloud Live Sync
                </ThemedText>
              </View>
            </View>
            <View style={styles.diagRow}>
              <ThemedText
                style={[styles.diagLabel, { color: isDark ? '#94a3b8' : '#64748b' }]}
              >
                App Version
              </ThemedText>
              <ThemedText
                style={[styles.diagValue, { color: isDark ? '#f1f5f9' : '#1e293b' }]}
              >
                v1.2.0 • EcoTrack Mobile
              </ThemedText>
            </View>
            <View style={styles.diagRow}>
              <ThemedText
                style={[styles.diagLabel, { color: isDark ? '#94a3b8' : '#64748b' }]}
              >
                Technician ID
              </ThemedText>
              <ThemedText
                style={[styles.diagValue, { color: isDark ? '#f1f5f9' : '#1e293b' }]}
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
              { color: isDark ? '#94a3b8' : '#64748b' },
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
              <ThemedText style={{ color: '#ffffff', fontSize: 16, fontWeight: '900' }}>
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
  );
}

const styles = StyleSheet.create({
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
    shadowColor: '#000000',
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
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  segmentedBtnInactiveLight: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
  },
  segmentedBtnInactiveDark: {
    backgroundColor: '#0a0f1d',
    borderColor: '#334155',
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
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
    }),
  },
  cacheBtnDark: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  cacheBtnText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#b91c1c',
  },
  cacheBtnTextDark: {
    color: '#f87171',
  },
  cacheBtnSubtext: {
    fontSize: 11.5,
    color: '#991b1b',
    marginTop: 2,
    lineHeight: 16,
  },
  cacheBtnSubtextDark: {
    color: '#fca5a5',
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
    backgroundColor: '#10b981',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10b981',
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
    color: '#ffffff',
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
