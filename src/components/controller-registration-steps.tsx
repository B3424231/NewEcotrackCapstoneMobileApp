import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ThemedText } from './themed-text';
import { useSettings } from '@/context/settings-context';

export type RegistrationPhase = 'find' | 'connecting' | 'wifi' | 'verifying' | 'naming' | 'success';
export function registrationStep(phase: RegistrationPhase): number {
  return phase === 'find' || phase === 'connecting' ? 1 : phase === 'wifi' || phase === 'verifying' ? 2 : 3;
}
export function ControllerRegistrationSteps({ phase }: { phase: RegistrationPhase }) {
  const { colors } = useSettings();
  const current = registrationStep(phase);
  return <View style={styles.steps}>
    {['Bluetooth', 'Wi-Fi', 'Details'].map((label, index) => {
      const number = index + 1, passed = number < current || phase === 'success', active = number === current;
      return <View key={label} style={[styles.step, active && styles.active]} accessibilityLabel={`Step ${number} of 3: ${label}`} accessibilityState={{ selected: active }}>
        <View style={[styles.number, (active || passed) && styles.numberActive]}>
          <ThemedText style={[styles.numberText, (active || passed) && { color: '#ffffff' }]}>{passed ? '✓' : number}</ThemedText>
        </View>
        <ThemedText style={[styles.label, { color: active || passed ? colors.emerald : colors.textSecondary }]}>{label}</ThemedText>
      </View>;
    })}
  </View>;
}
const styles = StyleSheet.create({
  steps: { flexDirection: 'row', gap: 6, paddingVertical: 10, marginBottom: 10 },
  step: { flex: 1, minWidth: 0, alignItems: 'center', gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: 'transparent' },
  active: { borderColor: '#047857', backgroundColor: 'rgba(16,185,129,0.08)' },
  number: { width: 25, height: 25, borderRadius: 13, backgroundColor: 'rgba(148,163,184,0.14)', justifyContent: 'center', alignItems: 'center' },
  numberActive: { backgroundColor: '#047857' },
  numberText: { fontSize: 12, lineHeight: 18, fontWeight: '800', color: '#64748b' },
  label: { fontSize: 12, lineHeight: 18, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
});
