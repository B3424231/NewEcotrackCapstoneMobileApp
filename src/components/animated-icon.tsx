import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useState, useEffect } from 'react';
import { AccessibilityInfo, Animated as LoadingAnimation, Dimensions, Platform, StyleSheet, View } from 'react-native';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

const INITIAL_SCALE_FACTOR = Dimensions.get('screen').height / 90;
const DURATION = 600;

export function SplashLoadingBar() {
  const [position] = useState(() => new LoadingAnimation.Value(0));
  useEffect(() => {
    let disposed = false;
    let animation: ReturnType<typeof LoadingAnimation.loop> | undefined;
    const start = (reduced: boolean) => {
      if (disposed) return;
      animation?.stop();
      position.setValue(reduced ? 0.5 : 0);
      if (reduced) return;
      animation = LoadingAnimation.loop(LoadingAnimation.sequence([
        LoadingAnimation.timing(position, { toValue: 1, duration: 900, useNativeDriver: Platform.OS !== 'web' }),
        LoadingAnimation.timing(position, { toValue: 0, duration: 900, useNativeDriver: Platform.OS !== 'web' }),
      ]));
      animation.start();
    };
    AccessibilityInfo.isReduceMotionEnabled().then(start).catch(() => start(true));
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', start);
    return () => { disposed = true; animation?.stop(); listener.remove(); };
  }, [position]);
  return <View style={styles.loadingTrack} accessible accessibilityRole="progressbar"
    accessibilityLabel="Loading EcoTrack" accessibilityState={{ busy: true }}>
    <LoadingAnimation.View style={[styles.loadingSegment, {
      transform: [{ translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, 96] }) }],
    }]} />
  </View>;
}

export function AnimatedSplashOverlay({ ready = true }: { ready?: boolean } = {}) {
  const [visible, setVisible] = useState(true);
  const [laidOut, setLaidOut] = useState(false);
  const animate = ready && laidOut;

  // Reveal our loading bar as soon as its layout is ready, including slow logins.
  useEffect(() => {
    if (laidOut) void SplashScreen.hideAsync().catch(() => {});
  }, [laidOut]);

  // Keep the overlay until the existing session verification has finished.
  useEffect(() => {
    if (!ready || !laidOut) return;
    const timer = setTimeout(() => {
      setVisible(false);
    }, 1500);
    return () => { clearTimeout(timer); };
  }, [ready, laidOut]);

  if (!visible) return null;

  const splashKeyframe = new Keyframe({
    0: {
      transform: [{ scale: 1 }],
      opacity: 1,
    },
    20: {
      opacity: 1,
    },
    70: {
      opacity: 0,
      easing: Easing.elastic(0.7),
    },
    100: {
      opacity: 0,
      transform: [{ scale: 1 }],
      easing: Easing.elastic(0.7),
    },
  });

  const content = <View style={styles.splashContent}>
    <Image style={styles.splashImage} contentFit="contain" source={require('@/assets/images/ecoTrack.png')} />
    <SplashLoadingBar />
  </View>;

  return animate ? (
    <Animated.View
      entering={splashKeyframe.duration(DURATION).withCallback((finished) => {
        'worklet';
        if (finished) {
          scheduleOnRN(setVisible, false);
        }
      })}
      style={styles.splashOverlay}>
      {content}
    </Animated.View>
  ) : (
    <View
      onLayout={() => setLaidOut(true)}
      style={styles.splashOverlay}>
      {content}
    </View>
  );
}

const keyframe = new Keyframe({
  0: {
    transform: [{ scale: INITIAL_SCALE_FACTOR }],
  },
  100: {
    transform: [{ scale: 1 }],
    easing: Easing.elastic(0.7),
  },
});

const logoKeyframe = new Keyframe({
  0: {
    transform: [{ scale: 1.3 }],
    opacity: 0,
  },
  40: {
    transform: [{ scale: 1.3 }],
    opacity: 0,
    easing: Easing.elastic(0.7),
  },
  100: {
    opacity: 1,
    transform: [{ scale: 1 }],
    easing: Easing.elastic(0.7),
  },
});

const glowKeyframe = new Keyframe({
  0: {
    transform: [{ rotateZ: '0deg' }],
  },
  100: {
    transform: [{ rotateZ: '7200deg' }],
  },
});

export function AnimatedIcon() {
  return (
    <View style={styles.iconContainer}>
      <Animated.View entering={keyframe.duration(DURATION)} style={styles.background} />
      <Animated.View style={styles.imageContainer} entering={logoKeyframe.duration(DURATION)}>
        <Image style={styles.image} source={require('@/assets/images/ecoTrack.png')} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  splashContent: { alignItems: 'center', gap: 24 },
  splashImage: { width: 120, height: 120, borderRadius: 8, overflow: 'hidden' },
  loadingTrack: { width: 144, height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: '#24533e' },
  loadingSegment: { width: 48, height: 4, borderRadius: 2, backgroundColor: '#34d399' },
  imageContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  glow: {
    width: 201,
    height: 201,
    position: 'absolute',
  },
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 128,
    height: 128,
    zIndex: 100,
  },
  image: {
    width: 80,
    height: 80,
    borderRadius: 20,
    overflow: 'hidden',
  },
  background: {
    borderRadius: 40,
    experimental_backgroundImage: `linear-gradient(180deg, #10b981, #0b291d)`,
    width: 128,
    height: 128,
    position: 'absolute',
  },
  splashOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#0b291d',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
});
