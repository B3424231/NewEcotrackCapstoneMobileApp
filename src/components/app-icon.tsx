import React from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';
import { SymbolView, SFSymbol } from 'expo-symbols';
import { Image } from 'expo-image';
import {
  ICON_USER,
  ICON_GEAR,
  ICON_REFRESH,
  ICON_SHIELD,
  ICON_CLOCK,
  ICON_CHAT,
  ICON_TRASH,
  ICON_BELL,
  ICON_BOLT,
  ICON_CHECK,
  ICON_ALERT_OCTAGON,
  ICON_PIN,
  ICON_LOCATION,
  ICON_CALENDAR,
  ICON_MAINTENANCE,
  ICON_CHECKLIST,
  ICON_CAMERA,
  ICON_SEARCH,
  ICON_FILTER,
  ICON_ALERT_TRIANGLE,
  ICON_CHECK_CIRCLE,
  ICON_TEMPERATURE,
} from '@/constants/custom-icons';

export type AppIconName =
  | 'user'
  | 'gear'
  | 'refresh'
  | 'shield'
  | 'clock'
  | 'chat'
  | 'trash'
  | 'bell'
  | 'bolt'
  | 'check'
  | 'check-circle'
  | 'alert'
  | 'alert-octagon'
  | 'pin'
  | 'location'
  | 'calendar'
  | 'maintenance'
  | 'checklist'
  | 'camera'
  | 'search'
  | 'filter'
  | 'thermometer';

export interface AppIconProps {
  name: AppIconName;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

const ICON_MAP: Record<AppIconName, { sf: SFSymbol; svg: string }> = {
  user: { sf: 'person.fill', svg: ICON_USER },
  gear: { sf: 'gearshape.fill', svg: ICON_GEAR },
  refresh: { sf: 'arrow.triangle.2.circlepath', svg: ICON_REFRESH },
  shield: { sf: 'shield.fill', svg: ICON_SHIELD },
  clock: { sf: 'clock.fill', svg: ICON_CLOCK },
  chat: { sf: 'bubble.left.fill', svg: ICON_CHAT },
  trash: { sf: 'trash.fill', svg: ICON_TRASH },
  bell: { sf: 'bell.fill', svg: ICON_BELL },
  bolt: { sf: 'bolt.fill', svg: ICON_BOLT },
  check: { sf: 'checkmark', svg: ICON_CHECK },
  'check-circle': { sf: 'checkmark.circle.fill', svg: ICON_CHECK_CIRCLE },
  alert: { sf: 'exclamationmark.triangle.fill', svg: ICON_ALERT_TRIANGLE },
  'alert-octagon': { sf: 'exclamationmark.octagon.fill', svg: ICON_ALERT_OCTAGON },
  pin: { sf: 'mappin.and.ellipse', svg: ICON_PIN },
  location: { sf: 'mappin.and.ellipse', svg: ICON_LOCATION },
  calendar: { sf: 'calendar', svg: ICON_CALENDAR },
  maintenance: { sf: 'wrench.and.screwdriver.fill', svg: ICON_MAINTENANCE },
  checklist: { sf: 'checklist', svg: ICON_CHECKLIST },
  camera: { sf: 'camera.fill', svg: ICON_CAMERA },
  search: { sf: 'magnifyingglass', svg: ICON_SEARCH },
  filter: { sf: 'line.3.horizontal.decrease', svg: ICON_FILTER },
  thermometer: { sf: 'thermometer.medium', svg: ICON_TEMPERATURE },
};

export function AppIcon({ name, size = 16, color = '#64748b', style }: AppIconProps) {
  const icon = ICON_MAP[name];
  if (!icon) return null;

  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      <SymbolView
        name={icon.sf}
        tintColor={color}
        size={size}
        fallback={
          <Image
            source={{ uri: icon.svg }}
            style={{ width: size, height: size, tintColor: color }}
            contentFit="contain"
          />
        }
      />
    </View>
  );
}
