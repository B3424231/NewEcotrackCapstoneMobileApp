import { Colors as UiColors, type AppColors } from '@/constants/theme';
import React from 'react';
import { StyleSheet, View, Pressable, Animated, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ThemedText } from './themed-text';
import { AppIcon } from './app-icon';
import { useSettings } from '@/context/settings-context';
import { airconStateReading, batteryReading, blowerFanReading, controllerConnection } from '@/services/controller-display';
import type { AcControllerData } from './sensor-card';
import { displayDeviceId } from '@/services/sensor-readings';
import { canSetAirflowReference, saveAirflowReference } from '@/services/airflow-pressure';
import { supabase } from '@/services/supabase';
import { useAuth } from '@/context/auth-context';

export interface AcControllerDetailSheetProps {
  visible: boolean; controller?: AcControllerData | null; sensor?: AcControllerData | null;
  onClose: () => void; slideAnim: Animated.Value;
  onReferenceSaved?: (id: string, config: Record<string, any>) => void;
}
export function AcControllerDetailSheet({ visible, controller, sensor, onClose, slideAnim, onReferenceSaved }: AcControllerDetailSheetProps) {
  const { effectiveTheme, colors, formatTemperatureDisplay } = useSettings();
  const styles = themedStyles[effectiveTheme];
  const item = controller || sensor;
  const { userType, userId } = useAuth();
  const [savingReference, setSavingReference] = React.useState(false);
  const [referenceNotice, setReferenceNotice] = React.useState('');
  const operation = React.useRef(false), generation = React.useRef(0), active = React.useRef(false);
  React.useEffect(() => {
    generation.current++; active.current = true; operation.current = false;
    return () => { active.current = false; };
  }, [userId, item?.id]);
  if (!visible || !item) return null;
  const blower = blowerFanReading(item);
  const canSetReference = canSetAirflowReference(item.rotation_rpm, item.rotation_quality, item.measurementAt, item.reportIntervalSeconds);
  const saveReference = async () => {
    if (operation.current || userType !== 'admin' || !canSetReference) return;
    const revision = generation.current, current = () => active.current && generation.current === revision;
    operation.current = true; setSavingReference(true); setReferenceNotice('');
    try {
      const config = await saveAirflowReference(supabase, item.id, item.rotation_rpm!, item.rotation_quality, item.measurementAt!, item.reportIntervalSeconds, current);
      if (current()) { onReferenceSaved?.(item.id, config); setReferenceNotice('Reference saved.'); }
    } catch (error) { if (current()) setReferenceNotice(error instanceof Error ? error.message : 'Unable to save the reference.'); }
    finally { if (current()) { operation.current = false; setSavingReference(false); } }
  };
  const isDark = effectiveTheme === 'dark', connection = controllerConnection(item), battery = batteryReading(item.battery);
  const connectionTone = connection.label === 'Online' ? colors.success
    : connection.label === 'Sleeping' ? colors.warning : colors.textSecondary;
  const panel = { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundSelected : UiColors[effectiveTheme].background, borderColor: isDark ? UiColors[effectiveTheme].border : UiColors[effectiveTheme].border };
  const location = [item.building, item.floor, item.room].filter(Boolean).join(' • ') || item.location || 'Unassigned';
  const lastSeen = item.lastSeen && Number.isFinite(Date.parse(item.lastSeen)) ? new Date(item.lastSeen).toLocaleString() : 'Not available';
  const targetTemperature = typeof item.setpoint === 'number' && Number.isFinite(item.setpoint) ? formatTemperatureDisplay(item.setpoint) : 'Unavailable';
  const rows = [
    ['Device identifier', displayDeviceId(item.serialNumber)],
    ['Last seen', lastSeen],
    ['Battery', battery.text],
    ['Wi-Fi signal', typeof item.rssi === 'number' ? item.rssi + ' dBm' : '—'],
    ['Report interval', item.interval || '—'],
    ['Wake / sleep', item.dailySchedule || '—'],
  ];
  const values = item.deviceMode === 'monitoring' || item.deviceMode === 'both' ? [
      ['Temperature', targetTemperature],
      ['Airflow Indicator (RPM)', blower.value],
    ] : [];
  return <View style={[StyleSheet.absoluteFill, { zIndex: 100 }]}>
    <Pressable accessibilityLabel="Close AC device details" style={styles.backdrop} onPress={onClose} />
    <Animated.View style={[styles.sheet, { backgroundColor: isDark ? UiColors[effectiveTheme].backgroundElement : UiColors[effectiveTheme].backgroundElement, borderColor: UiColors[effectiveTheme].panelBorder, transform: [{ translateY: slideAnim }] }]}>
      <View style={styles.grabber} />
      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <ThemedText style={[styles.title, { color: colors.text }]}>{item.name}</ThemedText>
          <ThemedText style={[styles.location, { color: colors.textSecondary }]}>{location}</ThemedText>
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12} style={[styles.close, panel]}>
          <ThemedText style={{ fontSize: 22, lineHeight: 28, color: colors.textSecondary }}>×</ThemedText>
        </Pressable>
      </View>
      <SafeAreaView edges={['bottom']} style={{ flexShrink: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <View style={styles.connection}><View style={[styles.dot, { backgroundColor: connectionTone }]} /><ThemedText style={[styles.connectionText, { color: connectionTone }]}>{connection.label}</ThemedText></View>
          {!!values.length && <View style={styles.grid}>
            {values.map(([label, value]) => <View key={label} style={[styles.metric, panel]}>
              <ThemedText style={[styles.label, { color: colors.textSecondary }]}>{label}</ThemedText>
              <ThemedText style={[styles.metricValue, { color: colors.text }]}>{value}</ThemedText>
              {label === 'Airflow Indicator (RPM)' && <ThemedText style={[styles.label, { color: colors.textSecondary }]}>{blower.detail}</ThemedText>}
              {label === 'Temperature' && <ThemedText style={[styles.label, { color: colors.textSecondary }]}>AC target setpoint</ThemedText>}
            </View>)}
          </View>}
          {!!values.length && <View style={[styles.panel, panel]}>
            <ThemedText style={[styles.label, { color: colors.textSecondary }]}>% of saved reference · based on wheel rotation</ThemedText>
            <ThemedText style={[styles.rowLabel, { color: colors.textSecondary }]}>Keep the wheel in the same position. Run the aircon at your normal setting before saving 100%.</ThemedText>
            {userType === 'admin' ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: savingReference || !canSetReference }} disabled={savingReference || !canSetReference} onPress={saveReference} style={{ minHeight: 44, justifyContent: 'center', opacity: savingReference || !canSetReference ? 0.5 : 1 }}>
              <ThemedText style={[styles.value, { color: colors.emerald }]}>{savingReference ? 'Saving…' : 'Use current reading as 100%'}</ThemedText>
            </Pressable> : <ThemedText style={[styles.rowLabel, { color: colors.textSecondary }]}>An administrator can set the shared reference.</ThemedText>}
            {!!referenceNotice && <ThemedText accessibilityRole="alert" style={[styles.rowLabel, { color: colors.textSecondary }]}>{referenceNotice}</ThemedText>}
          </View>}
          <View style={[styles.panel, panel]}>
            <ThemedText style={[styles.label, { color: colors.textSecondary }]}>Aircon state</ThemedText>
            <ThemedText style={[styles.value, { color: colors.text }]}>{airconStateReading(item)}</ThemedText>
          </View>
          <View style={[styles.panel, panel]}>
            <ThemedText style={[styles.section, { color: colors.text }]}>AC Device details</ThemedText>
            {rows.map(([label, value]) => <View key={label} style={styles.row}>
              <ThemedText style={[styles.rowLabel, { color: colors.textSecondary }]}>{label}</ThemedText>
              <ThemedText style={[styles.rowValue, { color: colors.text }]}>{value}</ThemedText>
            </View>)}
          </View>
          <Pressable accessibilityRole="button" onPress={() => { onClose(); router.push({ pathname: '/Maintenance', ...(item.activeReportId ? { params: { reportId: item.activeReportId } } : {}) } as any); }} style={[styles.checklist, panel]}>
            <AppIcon name="checklist" size={19} color={UiColors[effectiveTheme].emerald} />
            <ThemedText style={[styles.value, { flex: 1, color: colors.text }]}>Maintenance Checklist</ThemedText>
            <AppIcon name="chevron-right" size={16} color={UiColors[effectiveTheme].emerald} />
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Animated.View>
  </View>;
}
export const SensorDetailSheet = AcControllerDetailSheet;
const createStyles = (colors: AppColors) => StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: '90%', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, overflow: 'hidden' },
  grabber: { width: 38, height: 4, backgroundColor: '#64748b', borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  header: { flexDirection: 'row', alignItems: 'flex-start', padding: 18, gap: 12 },
  title: { fontSize: 20, lineHeight: 28, fontWeight: '800' },
  location: { fontSize: 12, lineHeight: 19 },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1 },
  body: { padding: 18, paddingTop: 0, paddingBottom: 24, gap: 12 },
  connection: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  connectionText: { fontSize: 13, lineHeight: 19, fontWeight: '700' },
  panel: { padding: 13, borderRadius: 13, borderWidth: 1, gap: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: { flexGrow: 1, flexBasis: '45%', minWidth: 100, borderRadius: 13, borderWidth: 1, padding: 13, gap: 6 },
  label: { fontSize: 12, lineHeight: 18, fontWeight: '600' },
  value: { fontSize: 14, lineHeight: 22, fontWeight: '600' },
  metricValue: { fontSize: 17, lineHeight: 25, fontWeight: '800' },
  section: { fontSize: 14, lineHeight: 21, fontWeight: '700', marginBottom: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 5 },
  rowLabel: { flexBasis: '36%', flexGrow: 1, fontSize: 12, lineHeight: 19 },
  rowValue: { flexBasis: '55%', flexGrow: 1, minWidth: 0, fontSize: 12, lineHeight: 19, textAlign: 'right' },
  checklist: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 13, borderWidth: 1 },
});
const themedStyles = { light: createStyles(UiColors.light), dark: createStyles(UiColors.dark) };
