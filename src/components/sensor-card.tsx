import React from 'react';
import { StyleSheet, View, Pressable, Platform, useColorScheme } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { ThemedText } from './themed-text';
import { Colors, GlassStyles, Spacing } from '@/constants/theme';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useSettings } from '@/context/settings-context';
import { LocationIcon } from './location-icon';

import { 
  ICON_LOCATION, 
  ICON_TEMPERATURE, 
  ICON_AIRPRESSURE, 
  ICON_AIRCONSTATE,
  ICON_CHECKLIST,
  ICON_CHEVRON_RIGHT
} from '@/constants/custom-icons';

const ICON_BATTERY = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMTBiOTgxIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMiIgeT0iNyIgd2lkdGg9IjE2IiBoZWlnaHQ9IjEwIiByeD0iMiIgcnk9IjIiLz48cGF0aCBkPSJNMjIgMTF2MmExIDEgMCAwIDEtMSAxIi8+PC9zdmc+';

export interface SensorData {
  id: string;
  name: string;
  value: string;
  status: 'optimal' | 'warning' | 'critical';
  statusLabel: string;
  details: string;
  location: string;
  aircon?: string;
  ventTemp?: string;
  pressure?: string;
  battery?: string;
  building?: string;
  floor?: string;
  room?: string;
  sensorName?: string;
  acType?: string;
  acId?: string; // e.g. AC-002, AC-105, AC-088
  activeReportId?: string; // e.g. MR-2026-001, MR-2026-002
  maintenanceStatus?: string; // e.g. 'Checklist Due', 'In Progress', 'Completed'
  maintenancePriority?: 'High' | 'Medium' | 'Low';
  wakeTime?: string;
  sleepTime?: string;
  interval?: string;
  rssi?: number | null;
  signalStrengthLabel?: string;
  signalStrengthDbm?: string;
  airconState?: string;
  updatedTime?: string;
  roomId?: string | null;
  isAssignedToRoom?: boolean;
}

interface SensorCardProps {
  sensor: SensorData;
  onPress: () => void;
  onViewChecklist?: (sensor: SensorData) => void;
}

export function SensorCard({ sensor, onPress, onViewChecklist }: SensorCardProps) {
  const { effectiveTheme, formatTemperatureDisplay, colors } = useSettings();
  const theme = effectiveTheme;

  // Dynamically formatted temperature based on user settings (°C or °F)
  const displayTemp = React.useMemo(() => {
    if (!sensor.ventTemp || sensor.ventTemp === 'N/A') return 'N/A';
    const match = sensor.ventTemp.match(/-?\d+(\.\d+)?/);
    if (match) {
      return formatTemperatureDisplay(parseFloat(match[0]));
    }
    return sensor.ventTemp;
  }, [sensor.ventTemp, formatTemperatureDisplay]);

  // Battery status color coding
  const batteryNum = parseInt(sensor.battery || '100', 10);
  const batteryColor = batteryNum >= 80 ? '#10b981' : batteryNum >= 40 ? '#f59e0b' : '#ef4444';
  const batteryBg = batteryNum >= 80 ? 'rgba(16, 185, 129, 0.08)' : batteryNum >= 40 ? 'rgba(245, 158, 11, 0.08)' : 'rgba(239, 68, 68, 0.08)';

  // Status-based subtle dot color
  const statusColor = sensor.status === 'optimal' ? '#10b981' : sensor.status === 'warning' ? '#f59e0b' : '#ef4444';

  const handleChecklistPress = () => {
    if (onViewChecklist) {
      onViewChecklist(sensor);
    } else {
      router.push({
        pathname: '/Maintenance',
        ...(sensor.activeReportId ? { params: { reportId: sensor.activeReportId } } : {}),
      } as any);
    }
  };

  const hasActiveMaintenance = Boolean(sensor.activeReportId && sensor.maintenanceStatus !== 'No Maintenance Yet');
  const hasHighPriority = hasActiveMaintenance && sensor.maintenancePriority === 'High';
  const hasInProgress = hasActiveMaintenance && sensor.maintenanceStatus === 'In Progress';
  const hasForVerification = hasActiveMaintenance && sensor.maintenanceStatus === 'For Verification';

  return (
    <View
      style={[
        styles.sensorCard,
        {
          backgroundColor: theme === 'dark' ? '#151e32' : '#ffffff',
          borderColor: theme === 'dark' ? '#334155' : '#e5e7eb',
        },
      ]}
    >
      {/* Upper Card Body (Clickable to open Sensor Detail Modal) */}
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.cardBody,
          pressed && styles.bodyPressed,
        ]}
      >
        {/* Top Row: Name and Battery */}
        <View style={styles.topRow}>
          <View style={styles.titleContainer}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <ThemedText style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
              {sensor.name}
            </ThemedText>
          </View>
          <View style={[styles.batteryRow, { backgroundColor: batteryBg }]}>
            <SymbolView 
              name="battery.100" 
              tintColor={batteryColor} 
              size={16} 
              fallback={
                <Image
                  source={{ uri: ICON_BATTERY }}
                  style={{ width: 16, height: 16, tintColor: batteryColor }}
                  contentFit="contain"
                />
              } 
            />
            <ThemedText style={[styles.batteryPercentage, { color: batteryColor }]}>
              {sensor.battery || '100%'}
            </ThemedText>
          </View>
        </View>

        {/* Location Row (Highlighted Building, Floor, Room) */}
        <View style={[styles.locationRow, { backgroundColor: theme === 'dark' ? '#0f172a' : '#f8fafc', borderColor: theme === 'dark' ? '#1e293b' : '#e2e8f0' }]}>
          <LocationIcon size={12} color="#059669" />
          <ThemedText style={[styles.locationText, { color: colors.textSecondary }]}>
            {sensor.building ? `${sensor.building} • ` : ''}{sensor.floor ? `${sensor.floor} • ` : ''}{sensor.room || sensor.location}
          </ThemedText>
        </View>

        {/* Middle Row: Temperature and Air Pressure */}
        <View style={styles.middleRow}>
          {/* Temperature Column */}
          <View style={[styles.metricColumn, { backgroundColor: theme === 'dark' ? '#0f172a' : '#f9fafb', borderColor: theme === 'dark' ? '#1e293b' : '#f3f4f6' }]}>
            <View style={styles.paramLabelRow}>
              <SymbolView 
                name="thermometer" 
                tintColor="#ef4444" 
                size={14} 
                fallback={
                  <Image
                    source={{ uri: ICON_TEMPERATURE }}
                    style={{ width: 14, height: 14, tintColor: '#ef4444' }}
                    contentFit="contain"
                  />
                } 
              />
              <ThemedText style={[styles.paramLabel, { color: colors.textSecondary }]}>Temperature</ThemedText>
            </View>
            <ThemedText style={[styles.paramValue, { color: colors.text }]}>
              {displayTemp}
            </ThemedText>
          </View>

          {/* Air Pressure Column */}
          <View style={[styles.metricColumn, { backgroundColor: theme === 'dark' ? '#0f172a' : '#f9fafb', borderColor: theme === 'dark' ? '#1e293b' : '#f3f4f6' }]}>
            <View style={styles.paramLabelRow}>
              <SymbolView 
                name="gauge.with.needle" 
                tintColor="#3b82f6" 
                size={14} 
                fallback={
                  <Image
                    source={{ uri: ICON_AIRPRESSURE }}
                    style={{ width: 14, height: 14, tintColor: '#3b82f6' }}
                    contentFit="contain"
                  />
                } 
              />
              <ThemedText style={[styles.paramLabel, { color: colors.textSecondary }]}>Air Pressure</ThemedText>
            </View>
            <ThemedText style={[styles.paramValue, { color: colors.text }]}>
              {sensor.pressure || '0.5 kPa'}
            </ThemedText>
          </View>
        </View>

        {/* Aircon State Row */}
        <View style={[styles.bottomRow, { backgroundColor: theme === 'dark' ? '#0f172a' : '#f9fafb', borderColor: theme === 'dark' ? '#1e293b' : '#f3f4f6' }]}>
          <View style={styles.paramLabelRowCent}>
            <SymbolView 
              name="snowflake" 
              tintColor="#06b6d4" 
              size={14} 
              fallback={
                <Image
                  source={{ uri: ICON_AIRCONSTATE }}
                  style={{ width: 14, height: 14, tintColor: '#06b6d4' }}
                  contentFit="contain"
                />
              } 
            />
            <ThemedText style={[styles.paramLabelCent, { color: colors.textSecondary }]}>Aircon State</ThemedText>
          </View>
          <ThemedText style={[styles.paramValueCent, { color: colors.text }]}>
            {sensor.airconState || (sensor.aircon === 'Active' ? 'ACTIVE COOLING' : (sensor.aircon || 'ACTIVE COOLING'))}
          </ThemedText>
        </View>
      </Pressable>

      {/* In-Card Separator */}
      <View style={[styles.cardSeparator, { backgroundColor: theme === 'dark' ? '#1e293b' : '#f3f4f6' }]} />

      {/* Inside-the-Card "View Checklist Maintenance" Action Bar */}
      <Pressable
        onPress={handleChecklistPress}
        style={({ pressed }) => [
          styles.checklistButton,
          hasActiveMaintenance
            ? {
                backgroundColor: theme === 'dark' ? '#064e3b' : '#f0fdf4',
                borderColor: theme === 'dark' ? '#059669' : '#bbf7d0',
              }
            : {
                backgroundColor: theme === 'dark' ? '#151e32' : '#f8fafc',
                borderColor: theme === 'dark' ? '#334155' : '#e2e8f0',
              },
          pressed && styles.checklistButtonPressed,
        ]}
      >
        <View style={styles.checklistLeftGroup}>
          <View
            style={[
              styles.checklistIconCircle,
              {
                backgroundColor: hasActiveMaintenance
                  ? (theme === 'dark' ? '#0b291d' : '#ecfdf5')
                  : (theme === 'dark' ? '#0f172a' : '#f1f5f9'),
              },
            ]}
          >
            <Image
              source={{ uri: ICON_CHECKLIST }}
              style={[
                styles.checklistIcon,
                !hasActiveMaintenance && { tintColor: theme === 'dark' ? '#64748b' : '#94a3b8' },
              ]}
              contentFit="contain"
            />
          </View>

          <View style={styles.checklistTextCol}>
            <ThemedText
              style={[
                styles.checklistBtnTitle,
                {
                  color: hasActiveMaintenance
                    ? (theme === 'dark' ? '#34d399' : '#065f46')
                    : (theme === 'dark' ? '#94a3b8' : '#64748b'),
                },
              ]}
              numberOfLines={1}
            >
              {hasActiveMaintenance
                ? (sensor.activeReportId ? `View Checklist (${sensor.activeReportId})` : 'View Maintenance Checklist')
                : 'No Maintenance Yet'}
            </ThemedText>
            <ThemedText
              style={[
                styles.checklistGuideText,
                {
                  color: hasActiveMaintenance
                    ? (theme === 'dark' ? '#a7f3d0' : '#059669')
                    : (theme === 'dark' ? '#64748b' : '#94a3b8'),
                },
              ]}
              numberOfLines={1}
            >
              {hasActiveMaintenance
                ? `${sensor.building ? `${sensor.building}, ` : ''}${sensor.room || sensor.location}${sensor.acId ? ` • ${sensor.acId}` : ''}`
                : 'No maintenance assigned by admin'}
            </ThemedText>
          </View>
        </View>

        <View style={styles.checklistRightGroup}>
          <View
            style={[
              styles.maintenanceTag,
              hasActiveMaintenance
                ? (hasForVerification
                    ? (theme === 'dark' ? styles.maintenanceTagVerificationDark : styles.maintenanceTagVerification)
                    : hasHighPriority
                    ? styles.maintenanceTagDanger
                    : hasInProgress
                    ? styles.maintenanceTagWarning
                    : styles.maintenanceTagSuccess)
                : {
                    backgroundColor: theme === 'dark' ? 'rgba(148, 163, 184, 0.12)' : '#f1f5f9',
                    borderColor: theme === 'dark' ? '#334155' : '#e2e8f0',
                  },
            ]}
          >
            <ThemedText
              style={[
                styles.maintenanceTagText,
                hasActiveMaintenance
                  ? (hasForVerification
                      ? (theme === 'dark' ? styles.maintenanceTagTextVerificationDark : styles.maintenanceTagTextVerification)
                      : hasHighPriority
                      ? styles.maintenanceTagTextDanger
                      : hasInProgress
                      ? styles.maintenanceTagTextWarning
                      : styles.maintenanceTagTextSuccess)
                  : {
                      color: theme === 'dark' ? '#94a3b8' : '#64748b',
                    },
              ]}
            >
              {hasActiveMaintenance ? (sensor.maintenanceStatus || 'Checklist Due') : 'No Maintenance Yet'}
            </ThemedText>
          </View>

          <Image
            source={{ uri: ICON_CHEVRON_RIGHT }}
            style={[
              styles.checklistChevron,
              {
                tintColor: hasActiveMaintenance
                  ? (theme === 'dark' ? '#34d399' : '#059669')
                  : (theme === 'dark' ? '#475569' : '#94a3b8'),
              },
            ]}
            contentFit="contain"
          />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sensorCard: {
    borderRadius: 20,
    marginBottom: 16,
    overflow: 'hidden',
    borderWidth: 1.5,
    padding: 16,
  },
  lightCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  cardBody: {
    padding: 2,
  },
  bodyPressed: {
    opacity: 0.9,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  batteryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  batteryPercentage: {
    fontSize: 11,
    fontWeight: '700',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 14,
    backgroundColor: 'rgba(5, 150, 105, 0.06)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  locationText: {
    fontSize: 11.5,
    color: '#047857',
    fontWeight: '700',
  },
  middleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  metricColumn: {
    flexDirection: 'column',
    alignItems: 'center',
    flex: 1,
  },
  paramLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  paramLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  paramValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1f2937',
  },
  bottomRow: {
    alignItems: 'center',
  },
  paramLabelRowCent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  paramLabelCent: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  paramValueCent: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1f2937',
  },
  cardSeparator: {
    height: 1,
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    marginVertical: 12,
  },
  // In-Card View Checklist Maintenance button
  checklistButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.28)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  checklistButtonPressed: {
    backgroundColor: '#dcfce7',
    transform: [{ scale: 0.985 }],
    opacity: 0.95,
  },
  checklistLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  checklistIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checklistIcon: {
    width: 17,
    height: 17,
    tintColor: '#059669',
  },
  checklistTextCol: {
    flex: 1,
  },
  checklistBtnTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#065f46',
    letterSpacing: 0.1,
  },
  checklistGuideText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#059669',
    marginTop: 1,
  },
  checklistRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  maintenanceTag: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 0.8,
  },
  maintenanceTagSuccess: {
    backgroundColor: '#d1fae5',
    borderColor: '#a7f3d0',
  },
  maintenanceTagWarning: {
    backgroundColor: '#fef3c7',
    borderColor: '#fde68a',
  },
  maintenanceTagDanger: {
    backgroundColor: '#fee2e2',
    borderColor: '#fca5a5',
  },
  maintenanceTagVerification: {
    backgroundColor: '#f3e8ff',
    borderColor: '#e9d5ff',
  },
  maintenanceTagVerificationDark: {
    backgroundColor: 'rgba(168, 85, 247, 0.2)',
    borderColor: 'rgba(168, 85, 247, 0.45)',
  },
  maintenanceTagText: {
    fontSize: 9.5,
    fontWeight: '800',
  },
  maintenanceTagTextSuccess: {
    color: '#059669',
  },
  maintenanceTagTextWarning: {
    color: '#d97706',
  },
  maintenanceTagTextDanger: {
    color: '#dc2626',
  },
  maintenanceTagTextVerification: {
    color: '#9333ea',
  },
  maintenanceTagTextVerificationDark: {
    color: '#c084fc',
  },
  checklistChevron: {
    width: 14,
    height: 14,
    tintColor: '#059669',
  },
});
