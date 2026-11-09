import React from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { router } from 'expo-router';
import { ThemedText } from './themed-text';
import { AppIcon } from './app-icon';
import { LocationIcon } from './location-icon';
import { useSettings } from '@/context/settings-context';
import { airconStateReading, batteryReading, fanSettingReading, controllerConnection } from '@/services/controller-display';
import type { SensorData } from '@/services/supabase';

export type AcControllerData = SensorData;
export type SensorDataLegacy = AcControllerData;
export type { SensorData };
export interface AcControllerCardProps {
  controller?: AcControllerData;
  sensor?: AcControllerData;
  onPress: () => void;
  onViewChecklist?: (controller: AcControllerData) => void;
}
export function AcControllerCard({ controller, sensor, onPress, onViewChecklist }: AcControllerCardProps) {
  const item = controller || sensor;
  const { formatTemperatureDisplay, colors } = useSettings();
  const setpoint = item?.setpoint;
  const temperature = React.useMemo(() => typeof setpoint === 'number' && Number.isFinite(setpoint)
    ? formatTemperatureDisplay(setpoint) : null, [setpoint, formatTemperatureDisplay]);
  if (!item) return null;
  const connection = controllerConnection(item), battery = batteryReading(item.battery, item.batteryState, item.connectionState === 'online'), fan = fanSettingReading(item);
  const batteryText = [battery.text, battery.status].filter(Boolean).join(' · ');
  const location = [item.building, item.floor, item.room].filter(Boolean).join(' • ') || item.location || 'Unassigned';
  const hasTask = Boolean(item.activeReportId && item.maintenanceStatus !== 'No Maintenance Yet');
  const openChecklist = () => onViewChecklist ? onViewChecklist(item) : router.push({
    pathname: '/Maintenance', ...(item.activeReportId ? { params: { reportId: item.activeReportId } } : {}),
  } as any);
  const panel = { backgroundColor: colors.background, borderColor: colors.border };
  const connectionTone = connection.label === 'Online' ? colors.success
    : connection.label === 'Sleeping' ? colors.warning : colors.textSecondary;
  const batteryTone = battery.color === '#10b981' ? colors.success : battery.color === '#f59e0b'
    ? colors.warning : battery.color === '#ef4444' ? colors.error : colors.textMuted;
  return <View style={[styles.card, { backgroundColor: colors.backgroundElement, borderColor: colors.panelBorder }]}>
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={'View ' + item.name} style={styles.body}>
      <View style={styles.heading}>
        <ThemedText style={[styles.name, { color: colors.text }]}>{item.name}</ThemedText>
        <View style={styles.headerIndicators}>
          <View style={[styles.connection, { backgroundColor: connectionTone + '15' }]}>
            <View style={[styles.dot, { backgroundColor: connectionTone }]} />
            <ThemedText style={[styles.connectionText, { color: connectionTone }]}>{connection.label}</ThemedText>
          </View>
          <View style={styles.battery} accessible accessibilityLabel={battery.text === '—' ? 'Battery unavailable' : `Battery ${batteryText}`}>
            <AppIcon name={battery.status === 'Charging' ? 'bolt' : 'battery'} size={13} color={batteryTone} />
            <ThemedText style={[styles.reading, { color: batteryTone }]}>{batteryText}</ThemedText>
          </View>
        </View>
      </View>
      <View style={styles.location}>
        <LocationIcon size={14} color={colors.emerald} />
        <ThemedText style={[styles.locationText, { color: colors.textSecondary }]}>{location}</ThemedText>
      </View>
      <View style={[styles.state, panel]}>
        <ThemedText style={[styles.label, { color: colors.textSecondary }]}>Aircon state</ThemedText>
        <ThemedText style={[styles.value, { color: colors.text }]}>{airconStateReading(item)}</ThemedText>
      </View>
      {(item.deviceMode === 'monitoring' || item.deviceMode === 'both') && <View style={styles.metrics}>
        <View style={[styles.metric, panel]}>
          <ThemedText style={[styles.label, { color: colors.textSecondary }]}>Temperature</ThemedText>
          <ThemedText style={[styles.value, { color: colors.text }]}>{temperature || 'Unavailable'}</ThemedText>
          <ThemedText style={[styles.reading, { color: colors.textSecondary }]}>AC target setpoint</ThemedText>
        </View>
        <View style={[styles.metric, panel]}>
          <ThemedText style={[styles.label, { color: colors.textSecondary }]}>Fan setting</ThemedText>
          <ThemedText style={[styles.value, { color: colors.text }]}>{fan}</ThemedText>
        </View>
      </View>}
    </Pressable>
    <Pressable accessibilityRole="button" onPress={openChecklist} style={[styles.checklist, { borderTopColor: panel.borderColor }]}>
      <AppIcon name="checklist" size={20} color={colors.emerald} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <ThemedText style={[styles.checklistTitle, { color: colors.text }]}>Maintenance Checklist</ThemedText>
        <ThemedText style={[styles.reading, { color: colors.textSecondary }]}>{hasTask ? item.maintenanceStatus : 'Routine service & inspections'}</ThemedText>
      </View>
      <AppIcon name="chevron-right" size={17} color={colors.emerald} />
    </Pressable>
  </View>;
}
export const SensorCard = AcControllerCard;
const styles = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1, overflow: 'hidden', marginBottom: 14, width: '100%' },
  body: { padding: 16, gap: 12 },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  name: { flex: 1, minWidth: 0, fontSize: 18, lineHeight: 25, fontWeight: '800' },
  headerIndicators: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginLeft: 'auto', maxWidth: '60%' },
  connection: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 20, maxWidth: '100%' },
  connectionText: { fontSize: 11, lineHeight: 16, fontWeight: '700', flexShrink: 1 },
  dot: { height: 6, width: 6, borderRadius: 3 },
  location: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  locationText: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 18 },
  metrics: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  metric: { flex: 1, minWidth: 0, padding: 11, borderRadius: 12, borderWidth: 1, gap: 4 },
  label: { fontSize: 11, lineHeight: 16, fontWeight: '600' },
  value: { fontSize: 13, lineHeight: 20, fontWeight: '700', flexShrink: 1 },
  state: { padding: 11, borderRadius: 12, borderWidth: 1, gap: 4 },
  reading: { fontSize: 11, lineHeight: 17, flexShrink: 1 },
  battery: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1, maxWidth: '100%' },
  checklist: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, padding: 14 },
  checklistTitle: { fontSize: 13, lineHeight: 19, fontWeight: '700' },
});
