import React from 'react';
import { StyleSheet, View, Pressable, Platform, Animated } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { router } from 'expo-router';
import { ThemedText } from './themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { Image } from 'expo-image';
import { SensorData } from './sensor-card';
import { useSettings } from '@/context/settings-context';
import { LocationIcon } from './location-icon';

import { 
  ICON_LOCATION, 
  ICON_TEMPERATURE, 
  ICON_AIRPRESSURE, 
  ICON_AIRCONSTATE,
  ICON_CHECKLIST,
  ICON_CHEVRON_RIGHT,
  ICON_AIRCONS_NAV,
  ICON_BATTERY
} from '@/constants/custom-icons';

interface SensorDetailSheetProps {
  visible: boolean;
  sensor: SensorData | null;
  onClose: () => void;
  slideAnim: Animated.Value;
}

// ── Status color palette ───────────────────────────────────────
const STATUS_PALETTE = {
  optimal: {
    primary: '#10b981',
    tint: 'rgba(16, 185, 129, 0.12)',
    softBg: '#ecfdf5',
  },
  warning: {
    primary: '#f59e0b',
    tint: 'rgba(245, 158, 11, 0.12)',
    softBg: '#fffbeb',
  },
  critical: {
    primary: '#ef4444',
    tint: 'rgba(239, 68, 68, 0.12)',
    softBg: '#fef2f2',
  },
};

// ── Diagnostic Metric Card ─────────────────────────────────────
function DiagnosticCard({
  iconName,
  iconFallback,
  label,
  value,
  accentColor,
  iconBg,
  highlightValueColor,
}: {
  iconName: string;
  iconFallback?: React.ReactNode;
  label: string;
  value: string;
  accentColor: string;
  iconBg: string;
  highlightValueColor?: string;
}) {
  const { effectiveTheme, colors } = useSettings();
  const theme = effectiveTheme;

  return (
    <View
      style={[
        cardStyles.card,
        {
          backgroundColor: theme === 'dark' ? '#0f172a' : '#ffffff',
          borderColor: theme === 'dark' ? '#1e293b' : '#e2e8f0',
        },
      ]}
    >
      <View style={cardStyles.cardHeader}>
        <View style={[cardStyles.iconCircle, { backgroundColor: iconBg }]}>
          <SymbolView
            name={iconName as any}
            tintColor={accentColor}
            size={17}
            fallback={iconFallback}
          />
        </View>
        <View style={[cardStyles.dotIndicator, { backgroundColor: accentColor }]} />
      </View>
      <View style={cardStyles.textContainer}>
        <ThemedText style={[cardStyles.label, { color: colors.textSecondary }]}>
          {label}
        </ThemedText>
        <ThemedText
          style={[
            cardStyles.value,
            { color: highlightValueColor || colors.text },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {value}
        </ThemedText>
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 6,
      },
      android: {
        elevation: 1.5,
      },
    }),
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    opacity: 0.85,
  },
  textContainer: {
    flexDirection: 'column',
    gap: 2,
  },
  label: {
    fontSize: 9.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  value: {
    fontSize: 14.5,
    fontWeight: '800',
    letterSpacing: 0.2,
    marginTop: 1,
  },
});

export function SensorDetailSheet({ visible, sensor, onClose, slideAnim }: SensorDetailSheetProps) {
  const { effectiveTheme, formatTemperatureDisplay, colors } = useSettings();
  const theme = effectiveTheme;

  if (!visible || !sensor) return null;

  // Dynamically formatted temperature based on user settings (°C or °F)
  const displayVentTemp = sensor.ventTemp && sensor.ventTemp !== 'N/A'
    ? (() => {
        const match = sensor.ventTemp.match(/-?\d+(\.\d+)?/);
        return match ? formatTemperatureDisplay(parseFloat(match[0])) : sensor.ventTemp;
      })()
    : 'N/A';

  const palette = STATUS_PALETTE[sensor.status] || STATUS_PALETTE.optimal;

  // Battery color coding
  const batteryNum = parseInt(sensor.battery || '100', 10);
  const batteryColor = batteryNum >= 80 ? '#10b981' : batteryNum >= 40 ? '#f59e0b' : '#ef4444';
  const batteryBg = batteryNum >= 80 ? 'rgba(16, 185, 129, 0.12)' : batteryNum >= 40 ? 'rgba(245, 158, 11, 0.12)' : 'rgba(239, 68, 68, 0.12)';

  const hasActiveMaintenance = Boolean(sensor.activeReportId && sensor.maintenanceStatus !== 'No Maintenance Yet');

  const handleOpenChecklist = () => {
    onClose();
    router.push({
      pathname: '/Maintenance',
      ...(sensor.activeReportId ? { params: { reportId: sensor.activeReportId } } : {}),
    } as any);
  };

  const airconStateVal = sensor.airconState || (sensor.aircon === 'Active' ? 'ACTIVE COOLING' : (sensor.aircon || 'ACTIVE COOLING'));
  const isStateCooling = airconStateVal.toUpperCase().includes('COOLING');

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Backdrop */}
      <Pressable style={styles.backdrop} onPress={onClose} />

      {/* Slide-up sheet */}
      <Animated.View
        style={[
          styles.bottomSheet,
          {
            backgroundColor: theme === 'dark' ? '#131d33' : '#ffffff',
            borderColor: theme === 'dark' ? '#1e293b' : '#e2e8f0',
          },
          { transform: [{ translateY: slideAnim }] },
        ]}
      >
        {/* Grabber handle */}
        <View style={[styles.grabber, { backgroundColor: theme === 'dark' ? '#334155' : '#cbd5e1' }]} />

        <View style={styles.sheetContent}>
          {/* Header Row */}
          <View style={styles.sheetHeader}>
            <View style={styles.headerTitleCol}>
              <View style={styles.headerNameRow}>
                <View style={[styles.headerDotPulse, { backgroundColor: palette.tint }]}>
                  <View style={[styles.headerDot, { backgroundColor: palette.primary }]} />
                </View>
                <ThemedText type="subtitle" style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={1}>
                  {sensor.name}
                </ThemedText>
              </View>

              <View style={styles.headerBadgeRow}>
                <View
                  style={[
                    styles.locationBadge,
                    {
                      backgroundColor: theme === 'dark' ? 'rgba(16, 185, 129, 0.1)' : '#ecfdf5',
                      borderColor: theme === 'dark' ? 'rgba(16, 185, 129, 0.25)' : '#a7f3d0',
                    },
                  ]}
                >
                  <LocationIcon size={12} color="#10b981" />
                  <ThemedText
                    style={[
                      styles.locationBadgeText,
                      { color: theme === 'dark' ? '#34d399' : '#047857' },
                    ]}
                    numberOfLines={1}
                  >
                    {sensor.building ? `${sensor.building} • ` : ''}
                    {sensor.floor ? `${sensor.floor} • ` : ''}
                    {sensor.room || sensor.location}
                  </ThemedText>
                </View>

                {sensor.statusLabel ? (
                  <View
                    style={[
                      styles.statusPill,
                      {
                        backgroundColor: palette.tint,
                        borderColor: palette.primary + '35',
                      },
                    ]}
                  >
                    <ThemedText style={[styles.statusPillText, { color: palette.primary }]}>
                      {sensor.statusLabel.toUpperCase()}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
            </View>

            {/* Close Button */}
            <Pressable
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={({ pressed }) => [
                styles.closeBtn,
                {
                  backgroundColor: theme === 'dark' ? '#0f172a' : '#f1f5f9',
                  borderColor: theme === 'dark' ? '#1e293b' : '#e2e8f0',
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <ThemedText style={[styles.closeBtnText, { color: colors.textSecondary }]}>✕</ThemedText>
            </Pressable>
          </View>

          {/* Aircon Type details card (Theme adaptive & High Contrast) */}
          <View
            style={[
              styles.acTypeCard,
              {
                backgroundColor: theme === 'dark' ? '#0f172a' : '#f8fafc',
                borderColor: theme === 'dark' ? '#1e293b' : '#e2e8f0',
              },
            ]}
          >
            <View style={styles.acTypeLeft}>
              <View
                style={[
                  styles.acTypeIconSquircle,
                  {
                    backgroundColor: theme === 'dark' ? 'rgba(6, 182, 212, 0.15)' : '#e0f2fe',
                  },
                ]}
              >
                <Image
                  source={{ uri: ICON_AIRCONS_NAV }}
                  style={[
                    styles.acTypeIcon,
                    { tintColor: theme === 'dark' ? '#38bdf8' : '#0284c7' },
                  ]}
                  contentFit="contain"
                />
              </View>
              <View style={styles.acTypeInfo}>
                <ThemedText style={[styles.acTypeHeaderLabel, { color: colors.textSecondary }]}>
                  AIRCON TYPE
                </ThemedText>
                <ThemedText style={[styles.acTypeIdSubtitle, { color: theme === 'dark' ? '#94a3b8' : '#64748b' }]}>
                  {sensor.acId ? `Unit ${sensor.acId}` : 'Cooling Appliance'}
                </ThemedText>
              </View>
            </View>

            <View
              style={[
                styles.acTypeBadge,
                {
                  backgroundColor: theme === 'dark' ? 'rgba(56, 189, 248, 0.12)' : '#f0fdf4',
                  borderColor: theme === 'dark' ? 'rgba(56, 189, 248, 0.3)' : '#bbf7d0',
                },
              ]}
            >
              <ThemedText
                style={[
                  styles.acTypeBadgeText,
                  { color: theme === 'dark' ? '#38bdf8' : '#059669' },
                ]}
                numberOfLines={1}
              >
                {sensor.acType || 'Split Type (Inverter)'}
              </ThemedText>
            </View>
          </View>

          {/* HVAC Diagnostics Grid */}
          <View style={styles.diagnosticsSection}>
            <View style={styles.sectionHeaderRow}>
              <ThemedText style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                HVAC DIAGNOSTICS
              </ThemedText>
              <View style={styles.liveIndicator}>
                <View style={styles.liveDot} />
                <ThemedText style={styles.liveText}>LIVE</ThemedText>
              </View>
            </View>

            <View style={styles.diagnosticsGrid}>
              {/* Row 1: Aircon State & Vent Temp */}
              <View style={styles.diagnosticsRow}>
                <DiagnosticCard
                  iconName="snowflake"
                  iconFallback={
                    <Image
                      source={{ uri: ICON_AIRCONSTATE }}
                      style={{ width: 17, height: 17, tintColor: '#06b6d4' }}
                      contentFit="contain"
                    />
                  }
                  label="Aircon State"
                  value={airconStateVal}
                  accentColor="#06b6d4"
                  iconBg="rgba(6, 182, 212, 0.12)"
                  highlightValueColor={isStateCooling ? (theme === 'dark' ? '#38bdf8' : '#0284c7') : undefined}
                />
                <DiagnosticCard
                  iconName="thermometer"
                  iconFallback={
                    <Image
                      source={{ uri: ICON_TEMPERATURE }}
                      style={{ width: 17, height: 17, tintColor: '#ef4444' }}
                      contentFit="contain"
                    />
                  }
                  label="Vent Temp"
                  value={displayVentTemp}
                  accentColor="#ef4444"
                  iconBg="rgba(239, 68, 68, 0.12)"
                  highlightValueColor={theme === 'dark' ? '#fb7185' : '#e11d48'}
                />
              </View>

              {/* Row 2: Pressure & Battery */}
              <View style={styles.diagnosticsRow}>
                <DiagnosticCard
                  iconName="gauge.with.needle"
                  iconFallback={
                    <Image
                      source={{ uri: ICON_AIRPRESSURE }}
                      style={{ width: 17, height: 17, tintColor: '#3b82f6' }}
                      contentFit="contain"
                    />
                  }
                  label="Pressure"
                  value={sensor.pressure || '0.5 kPa'}
                  accentColor="#3b82f6"
                  iconBg="rgba(59, 130, 246, 0.12)"
                  highlightValueColor={theme === 'dark' ? '#60a5fa' : '#2563eb'}
                />
                <DiagnosticCard
                  iconName="battery.100"
                  iconFallback={
                    <Image
                      source={{ uri: ICON_BATTERY }}
                      style={{ width: 17, height: 17, tintColor: batteryColor }}
                      contentFit="contain"
                    />
                  }
                  label="Battery Level"
                  value={sensor.battery || '100%'}
                  accentColor={batteryColor}
                  iconBg={batteryBg}
                  highlightValueColor={batteryColor}
                />
              </View>
            </View>
          </View>

          {/* Action Button: View Maintenance Checklist */}
          <Pressable
            onPress={handleOpenChecklist}
            style={({ pressed }) => [
              styles.checklistActionBtn,
              hasActiveMaintenance
                ? {
                    backgroundColor: theme === 'dark' ? '#064e3b' : '#f0fdf4',
                    borderColor: theme === 'dark' ? '#059669' : '#86efac',
                  }
                : {
                    backgroundColor: theme === 'dark' ? '#0f172a' : '#f8fafc',
                    borderColor: theme === 'dark' ? '#1e293b' : '#e2e8f0',
                  },
              pressed && styles.checklistActionBtnPressed,
            ]}
          >
            <View
              style={[
                styles.checklistActionIconCircle,
                hasActiveMaintenance
                  ? {
                      backgroundColor: theme === 'dark' ? '#047857' : '#d1fae5',
                    }
                  : {
                      backgroundColor: theme === 'dark' ? '#1e293b' : '#f1f5f9',
                    },
              ]}
            >
              <Image
                source={{ uri: ICON_CHECKLIST }}
                style={[
                  styles.checklistActionIcon,
                  {
                    tintColor: hasActiveMaintenance
                      ? '#10b981'
                      : (theme === 'dark' ? '#64748b' : '#94a3b8'),
                  },
                ]}
                contentFit="contain"
              />
            </View>
            <View style={styles.checklistActionTextCol}>
              <View style={styles.checklistTitleRow}>
                <ThemedText
                  style={[
                    styles.checklistActionTitle,
                    {
                      color: hasActiveMaintenance
                        ? (theme === 'dark' ? '#ffffff' : '#065f46')
                        : (theme === 'dark' ? '#94a3b8' : '#64748b'),
                    },
                  ]}
                >
                  {hasActiveMaintenance ? 'Open Maintenance Checklist' : 'No Maintenance Yet'}
                </ThemedText>
                {hasActiveMaintenance && sensor.activeReportId ? (
                  <View
                    style={[
                      styles.reportIdBadge,
                      {
                        backgroundColor: theme === 'dark' ? '#047857' : '#bbf7d0',
                      },
                    ]}
                  >
                    <ThemedText
                      style={[
                        styles.reportIdBadgeText,
                        { color: theme === 'dark' ? '#a7f3d0' : '#065f46' },
                      ]}
                    >
                      {sensor.activeReportId}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
              <ThemedText
                style={[
                  styles.checklistActionSubtitle,
                  {
                    color: hasActiveMaintenance
                      ? (theme === 'dark' ? '#a7f3d0' : '#059669')
                      : (theme === 'dark' ? '#64748b' : '#94a3b8'),
                  },
                ]}
                numberOfLines={1}
              >
                {hasActiveMaintenance
                  ? `Guides directly to ${sensor.building ? `${sensor.building}, ` : ''}${sensor.room || sensor.location}${sensor.acId ? ` • ${sensor.acId}` : ''}`
                  : 'No maintenance task assigned by administrator'}
              </ThemedText>
            </View>
            <View
              style={[
                styles.chevronCircle,
                {
                  backgroundColor: hasActiveMaintenance
                    ? (theme === 'dark' ? 'rgba(5, 150, 105, 0.35)' : '#dcfce7')
                    : (theme === 'dark' ? '#1e293b' : '#f1f5f9'),
                },
              ]}
            >
              <Image
                source={{ uri: ICON_CHEVRON_RIGHT }}
                style={[
                  styles.checklistActionChevron,
                  {
                    tintColor: hasActiveMaintenance
                      ? '#10b981'
                      : (theme === 'dark' ? '#475569' : '#94a3b8'),
                  },
                ]}
                contentFit="contain"
              />
            </View>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: -10 },
        shadowOpacity: 0.22,
        shadowRadius: 20,
      },
      android: {
        elevation: 24,
      },
    }),
  },
  grabber: {
    width: 38,
    height: 4.5,
    borderRadius: 3,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 10,
  },
  sheetContent: {
    gap: 14,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerTitleCol: {
    flex: 1,
    paddingRight: 10,
  },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerDotPulse: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  sheetTitle: {
    fontSize: 21,
    fontWeight: '800',
    lineHeight: 25,
    flex: 1,
  },
  headerBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  locationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4.5,
    borderRadius: 8,
    borderWidth: 1,
  },
  locationBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  closeBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  acTypeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  acTypeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    paddingRight: 8,
  },
  acTypeIconSquircle: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acTypeIcon: {
    width: 20,
    height: 20,
  },
  acTypeInfo: {
    flexDirection: 'column',
    justifyContent: 'center',
  },
  acTypeHeaderLabel: {
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  acTypeIdSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  acTypeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    maxWidth: '52%',
  },
  acTypeBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  diagnosticsSection: {
    gap: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  sectionLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
  },
  liveText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#10b981',
    letterSpacing: 0.6,
  },
  diagnosticsGrid: {
    gap: 9,
  },
  diagnosticsRow: {
    flexDirection: 'row',
    gap: 9,
  },
  checklistActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 10,
    marginTop: 2,
    borderWidth: 1.2,
  },
  checklistActionBtnPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
  checklistActionIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checklistActionIcon: {
    width: 18,
    height: 18,
  },
  checklistActionTextCol: {
    flex: 1,
  },
  checklistTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  checklistActionTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  reportIdBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  reportIdBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  checklistActionSubtitle: {
    fontSize: 10.5,
    fontWeight: '600',
    marginTop: 2,
  },
  chevronCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checklistActionChevron: {
    width: 13,
    height: 13,
  },
});

