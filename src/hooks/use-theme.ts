import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSettings } from '@/context/settings-context';

export function useTheme() {
  const scheme = useColorScheme();
  try {
    const settingsContext = useSettings();
    if (settingsContext?.effectiveTheme) {
      return Colors[settingsContext.effectiveTheme];
    }
  } catch {
    // Fallback if rendered outside of SettingsProvider
  }

  const theme = scheme === 'dark' ? 'dark' : 'light';
  return Colors[theme];
}
