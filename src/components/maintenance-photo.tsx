import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useAuth } from '@/context/auth-context';
import { readWithTimeout } from '@/services/query-utils';
import { resolveImageUrl } from '@/services/supabase';

/** Resolve display URLs without replacing the original reference in an editable draft. */
export function MaintenancePhoto({ uri, style }: { uri: string; style?: StyleProp<ViewStyle> }) {
  const { userId } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([uri, userId, attempt]);
  const [result, setResult] = useState<{ key: string; url: string | null; failed: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    const local = /^(file|content|data|blob):/i.test(uri);
    void readWithTimeout(() => local ? Promise.resolve(uri) : resolveImageUrl(uri, attempt > 0), 15000)
      .then(url => { if (active) setResult({ key, url, failed: !url }); })
      .catch(() => { if (active) setResult({ key, url: null, failed: true }); });
    return () => { active = false; };
  }, [key, uri, attempt]);
  const current = result?.key === key ? result : null;
  return <View style={[style, styles.frame]}>
    {!current ? <ActivityIndicator accessibilityLabel="Loading photo" color="#10b981" />
      : current.failed ? <Pressable accessibilityRole="button" accessibilityLabel="Retry loading photo"
        onPress={() => setAttempt(value => value + 1)} style={styles.retry}>
        <Text style={styles.text}>Photo unavailable</Text><Text style={styles.text}>Tap to retry</Text>
      </Pressable>
      : <Image source={{ uri: current.url! }} style={StyleSheet.absoluteFill} contentFit="cover"
        accessibilityLabel="Checklist photo" onError={() => setResult({ key, url: null, failed: true })} />}
  </View>;
}

const styles = StyleSheet.create({
  frame: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  retry: { padding: 8 },
  text: { color: '#64748b', textAlign: 'center', fontSize: 12 },
});
