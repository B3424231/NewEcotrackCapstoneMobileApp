import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, StyleSheet, View } from 'react-native';
import { useSettings } from '@/context/settings-context';
import { ThemedText } from '@/components/themed-text';

/** Placeholders for initial reads only; callers retain their list during refresh. */
export function DataListSkeleton({ label = 'Loading data...', count = 3, compact = false }: {
  label?: string; count?: number; compact?: boolean;
}) {
  const { effectiveTheme, colors } = useSettings();
  const [opacity] = useState(() => new Animated.Value(0.65));
  useEffect(() => {
    let disposed = false;
    let animation: Animated.CompositeAnimation | undefined;
    const start = (reduced: boolean) => {
      animation?.stop(); opacity.setValue(0.65);
      if (disposed || reduced) return;
      animation = Animated.loop(Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(opacity, { toValue: 0.65, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
      ]));
      animation.start();
    };
    AccessibilityInfo.isReduceMotionEnabled().then(start).catch(() => start(true));
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', start);
    return () => { disposed = true; animation?.stop(); listener.remove(); };
  }, [opacity]);
  const dark = effectiveTheme === 'dark';
  const fill = { backgroundColor: dark ? '#263247' : '#dbe4ee' };
  return <View style={styles.list} accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityState={{ busy: true }}>
    <ThemedText style={{ color: colors.textSecondary, fontSize: 13 }}>{label}</ThemedText>
    <Animated.View style={{ opacity, gap: 12 }} importantForAccessibility="no-hide-descendants">
      {Array.from({ length: count }, (_, index) => <View key={index} style={[styles.card, {
        backgroundColor: dark ? '#121826' : '#ffffff', borderColor: colors.panelBorder,
      }]}>
        <View style={styles.header}>
          <View style={[styles.icon, fill]} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={[styles.bar, fill, { width: '65%' }]} />
            <View style={[styles.bar, fill, { width: '40%', height: 8 }]} />
          </View>
          <View style={[styles.bar, fill, { width: 52, height: 20 }]} />
        </View>
        {!compact && <View style={styles.header}>
          <View style={[styles.block, fill]} /><View style={[styles.block, fill]} />
        </View>}
        <View style={[styles.bar, fill, { width: '80%', height: 8 }]} />
      </View>)}
    </Animated.View>
  </View>;
}
const styles = StyleSheet.create({
  list: { width: '100%', gap: 12 },
  card: { padding: 16, borderRadius: 18, borderWidth: 1, gap: 18 },
  header: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  icon: { width: 38, height: 38, borderRadius: 12 },
  bar: { height: 12, borderRadius: 6 },
  block: { flex: 1, height: 42, borderRadius: 10 },
});
