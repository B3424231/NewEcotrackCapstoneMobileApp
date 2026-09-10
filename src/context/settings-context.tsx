import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme, Vibration } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';

export interface SystemSettings {
  theme: 'light' | 'dark' | 'system';
  tempUnit: 'C' | 'F';
  autoSyncEnabled: boolean;
  syncFrequency: 5 | 15 | 30;
  criticalAlertsEnabled: boolean;
  maintenanceRemindersEnabled: boolean;
  hapticFeedbackEnabled: boolean;
}

export const DEFAULT_SETTINGS: SystemSettings = {
  theme: 'system',
  tempUnit: 'C',
  autoSyncEnabled: true,
  syncFrequency: 15,
  criticalAlertsEnabled: true,
  maintenanceRemindersEnabled: true,
  hapticFeedbackEnabled: true,
};

type ColorPalette = typeof Colors.light | typeof Colors.dark;

interface SettingsContextType {
  settings: SystemSettings;
  effectiveTheme: 'light' | 'dark';
  colors: ColorPalette;
  updateSetting: <K extends keyof SystemSettings>(key: K, value: SystemSettings[K]) => void;
  saveAllSettings: (newSettings: SystemSettings) => Promise<boolean>;
  resetDefaults: () => Promise<void>;
  clearLocalCache: () => Promise<void>;
  formatTemperatureDisplay: (celsiusVal?: number | string | null) => string;
  triggerHaptic: () => void;
}

const SettingsContext = createContext<SettingsContextType>({
  settings: DEFAULT_SETTINGS,
  effectiveTheme: 'light',
  colors: Colors.light,
  updateSetting: () => {},
  saveAllSettings: async () => false,
  resetDefaults: async () => {},
  clearLocalCache: async () => {},
  formatTemperatureDisplay: () => '',
  triggerHaptic: () => {},
});

export const useSettings = () => useContext(SettingsContext);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const { userId, userEmail } = useAuth();
  const [settings, setSettings] = useState<SystemSettings>(DEFAULT_SETTINGS);

  const getStorageKey = (uid?: string, email?: string) => {
    if (uid && uid.trim()) {
      return `ecotrack_settings_user_${uid.trim()}`;
    }
    if (email && email.trim()) {
      return `ecotrack_settings_email_${email.trim().toLowerCase()}`;
    }
    return 'ecotrack_system_settings';
  };

  // Load persisted settings whenever active user changes
  useEffect(() => {
    const loadSettings = async () => {
      const storageKey = getStorageKey(userId, userEmail);
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          setSettings({
            ...DEFAULT_SETTINGS,
            ...parsed,
          });
        } else {
          // If no account-specific settings exist yet, migrate once from legacy global settings
          if (userId && userId.trim()) {
            const legacy = await AsyncStorage.getItem('ecotrack_system_settings');
            if (legacy) {
              const parsedLegacy = JSON.parse(legacy);
              const migrated = {
                ...DEFAULT_SETTINGS,
                ...parsedLegacy,
              };
              setSettings(migrated);
              await AsyncStorage.setItem(storageKey, JSON.stringify(migrated));
              return;
            }
          }
          setSettings(DEFAULT_SETTINGS);
        }
      } catch (err) {
        console.warn('Failed to load system settings:', err);
      }
    };
    loadSettings();
  }, [userId, userEmail]);

  // Compute effective theme (light vs dark) based on user preference or system
  const effectiveTheme: 'light' | 'dark' =
    settings.theme === 'system'
      ? systemScheme === 'dark'
        ? 'dark'
        : 'light'
      : settings.theme;

  const colors = Colors[effectiveTheme];

  const triggerHaptic = () => {
    if (settings.hapticFeedbackEnabled) {
      try {
        Vibration.vibrate(25);
      } catch {}
    }
  };

  const updateSetting = <K extends keyof SystemSettings>(key: K, value: SystemSettings[K]) => {
    setSettings((prev) => {
      const updated = { ...prev, [key]: value };
      const storageKey = getStorageKey(userId, userEmail);
      AsyncStorage.setItem(storageKey, JSON.stringify(updated)).catch(console.warn);
      AsyncStorage.setItem('ecotrack_system_settings', JSON.stringify(updated)).catch(() => {});
      return updated;
    });
    triggerHaptic();
  };

  const saveAllSettings = async (newSettings: SystemSettings): Promise<boolean> => {
    try {
      setSettings(newSettings);
      const storageKey = getStorageKey(userId, userEmail);
      await AsyncStorage.setItem(storageKey, JSON.stringify(newSettings));
      await AsyncStorage.setItem(`${storageKey}_temp_unit`, newSettings.tempUnit);
      await AsyncStorage.setItem(`${storageKey}_theme`, newSettings.theme);
      await AsyncStorage.setItem('ecotrack_system_settings', JSON.stringify(newSettings));
      triggerHaptic();
      return true;
    } catch (err) {
      console.error('Failed to save settings:', err);
      return false;
    }
  };

  const resetDefaults = async () => {
    try {
      setSettings(DEFAULT_SETTINGS);
      const storageKey = getStorageKey(userId, userEmail);
      await AsyncStorage.setItem(storageKey, JSON.stringify(DEFAULT_SETTINGS));
      await AsyncStorage.setItem('ecotrack_system_settings', JSON.stringify(DEFAULT_SETTINGS));
      triggerHaptic();
    } catch (err) {
      console.warn('Failed to reset defaults:', err);
    }
  };

  const clearLocalCache = async () => {
    try {
      await AsyncStorage.removeItem('ecotrack_telemetry_cache');
      await AsyncStorage.removeItem('ecotrack_reports_cache');
      await AsyncStorage.removeItem('ecotrack_nodes_cache');
      triggerHaptic();
    } catch (err) {
      console.warn('Failed to clear cache:', err);
    }
  };

  // Convert raw Celsius value to user's configured unit (°C or °F)
  const formatTemperatureDisplay = (celsiusVal?: number | string | null): string => {
    if (celsiusVal == null || celsiusVal === '') return 'N/A';
    const num = typeof celsiusVal === 'number' ? celsiusVal : parseFloat(String(celsiusVal));
    if (isNaN(num)) return String(celsiusVal);

    if (settings.tempUnit === 'F') {
      const f = (num * 9) / 5 + 32;
      return `${f.toFixed(1)} °F`;
    }
    return `${num.toFixed(1)} °C`;
  };

  return (
    <SettingsContext.Provider
      value={{
        settings,
        effectiveTheme,
        colors,
        updateSetting,
        saveAllSettings,
        resetDefaults,
        clearLocalCache,
        formatTemperatureDisplay,
        triggerHaptic,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
