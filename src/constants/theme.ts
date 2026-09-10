import '@/global.css';
import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#18392b', // Dark pine green text for default high-contrast on white bg
    background: '#f9fafb', // White/light grey background for pages
    backgroundElement: '#ffffff', // White elements
    backgroundSelected: '#0b291d', // Deep Forest Green active select
    textSecondary: '#6b7280', // Muted dark grey secondary text
    border: '#10b981', // Thin emerald green border matching the image reference
    
    // Core EcoTrack brand tokens
    emerald: '#10b981',
    emeraldHover: '#059669',
    deepForest: '#0b291d',
    mutedPine: '#18392b',
    
    // Accent Colors
    cyan: '#22d3ee',
    amber: '#fbbf24',
    rose: '#f87171',
  },
  dark: {
    text: '#f1f5f9', // Clean light slate text
    background: '#0a0f1d', // Premium dark obsidian navy background
    backgroundElement: '#151e32', // Elevated dark slate container
    backgroundSelected: '#064e3b', // Deep emerald active select
    textSecondary: '#94a3b8', // Muted slate secondary text
    border: '#059669', // Emerald border
    
    // Core EcoTrack brand tokens
    emerald: '#10b981',
    emeraldHover: '#34d399',
    deepForest: '#6ee7b7',
    mutedPine: '#cbd5e1',
    
    // Accent Colors
    cyan: '#38bdf8',
    amber: '#fbbf24',
    rose: '#fb7185',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: 'System',
    serif: 'Georgia',
    rounded: 'System',
    mono: 'Courier New',
  },
  default: {
    sans: 'sans-serif',
    serif: 'serif',
    rounded: 'sans-serif',
    mono: 'monospace',
  },
  web: {
    sans: 'Manrope, "Segoe UI", sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    rounded: 'system-ui, sans-serif',
    mono: 'monospace',
  },
});

export const GlassStyles = {
  glassSurface: {
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    ...Platform.select({
      web: {
        backdropFilter: 'blur(18px)',
        shadowColor: 'rgba(0, 0, 0, 0.05)',
        shadowOffset: { width: 0, height: 18 },
        shadowOpacity: 1,
        shadowRadius: 40,
      },
      default: {
        shadowColor: 'rgba(0, 0, 0, 0.05)',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
        elevation: 8,
      },
    }),
  },
  glassElevated: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderColor: 'rgba(16, 185, 129, 0.25)',
    borderWidth: 1,
    ...Platform.select({
      web: {
        backdropFilter: 'blur(24px)',
        shadowColor: 'rgba(0, 0, 0, 0.08)',
        shadowOffset: { width: 0, height: 24 },
        shadowOpacity: 1,
        shadowRadius: 50,
      },
      default: {
        shadowColor: 'rgba(0, 0, 0, 0.08)',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.2,
        shadowRadius: 25,
        elevation: 12,
      },
    }),
  },
  glassSoft: {
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
    borderColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    ...Platform.select({
      web: {
        backdropFilter: 'blur(14px)',
      },
    }),
  },
};

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
