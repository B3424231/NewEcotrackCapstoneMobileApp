import '@/global.css';
import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#0f172a', textSecondary: '#475569', textMuted: '#64748b',
    background: '#f8fafc', backgroundElement: '#ffffff', backgroundSelected: '#f1f5f9',
    panelBorder: '#10b981', border: '#e2e8f0', inputBorder: '#64748b',
    emerald: '#047857', emeraldHover: '#065f46', deepForest: '#047857', mutedPine: '#0f172a',
    primaryFill: '#047857', onPrimary: '#ffffff', accentSurface: '#ecfdf5',
    cyan: '#1d4ed8', amber: '#92400e', rose: '#b91c1c',
    success: '#166534', warning: '#92400e', error: '#b91c1c', info: '#1d4ed8',
    successSurface: '#f0fdf4', warningSurface: '#fffbeb', errorSurface: '#fef2f2', infoSurface: '#eff6ff',
  },
  dark: {
    text: '#f1f5f9', textSecondary: '#cbd5e1', textMuted: '#94a3b8',
    background: '#0b1220', backgroundElement: '#121826', backgroundSelected: '#1e293b',
    panelBorder: '#10b981', border: '#334155', inputBorder: '#64748b',
    emerald: '#34d399', emeraldHover: '#6ee7b7', deepForest: '#34d399', mutedPine: '#f1f5f9',
    primaryFill: '#047857', onPrimary: '#ffffff', accentSurface: '#123529',
    cyan: '#93c5fd', amber: '#fbbf24', rose: '#fca5a5',
    success: '#86efac', warning: '#fbbf24', error: '#fca5a5', info: '#93c5fd',
    successSurface: '#142e22', warningSurface: '#33270f', errorSurface: '#361d23', infoSurface: '#192d49',
  },
} as const;

export type AppColors = typeof Colors.light | typeof Colors.dark;

/** Presentation only: status names, transitions and permissions remain with their callers. */
export function getStatusPalette(status: string, colors: AppColors) {
  switch (status) {
    case 'Completed': case 'Verified':
      return { bg: colors.successSurface, text: colors.success, border: colors.success };
    case 'In Progress': case 'Under Repair': case 'Assigned':
      return { bg: colors.infoSurface, text: colors.info, border: colors.info };
    case 'For Verification': case 'Awaiting Admin Verification':
      return { bg: colors.warningSurface, text: colors.warning, border: colors.warning };
    case 'Needs Repair':
      return { bg: colors.errorSurface, text: colors.error, border: colors.error };
    default:
      return { bg: colors.backgroundSelected, text: colors.textSecondary, border: colors.border };
  }
}

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
    borderColor: '#e2e8f0',
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
    borderColor: '#e2e8f0',
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
    borderColor: '#e2e8f0',
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
