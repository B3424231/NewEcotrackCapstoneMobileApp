import React, { useMemo } from 'react';
import { View, StyleProp, ViewStyle, Platform } from 'react-native';
import { SymbolView, SFSymbol } from 'expo-symbols';
import { Image } from 'expo-image';
import { useTheme } from '@/hooks/use-theme';
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
  ICON_AIRCONSTATE,
  ICON_BATTERY,
  ICON_BLUETOOTH,
  ICON_WIFI,
  ICON_CHEVRON_RIGHT,
  ICON_CHEVRON_DOWN,
  ICON_EDIT,
  ICON_EYE,
  ICON_EYE_OFF,
  ICON_MORE_VERTICAL,
  ICON_PLUS,
  ICON_DEVICES,
  ICON_HOME,
  ICON_PHONE,
  getColoredSvgUri,
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
  | 'thermometer'
  | 'snowflake'
  | 'aircon'
  | 'battery'
  | 'bluetooth'
  | 'wifi'
  | 'chevron-right'
  | 'chevron-down'
  | 'edit'
  | 'eye'
  | 'eye-off'
  | 'more-vertical'
  | 'plus'
  | 'devices'
  | 'home'
  | 'phone';

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
  snowflake: { sf: 'snowflake', svg: ICON_AIRCONSTATE },
  aircon: { sf: 'snowflake', svg: ICON_AIRCONSTATE },
  battery: { sf: 'battery.100', svg: ICON_BATTERY },
  bluetooth: { sf: 'antenna.radiowaves.left.and.right', svg: ICON_BLUETOOTH },
  wifi: { sf: 'wifi', svg: ICON_WIFI },
  'chevron-right': { sf: 'chevron.right', svg: ICON_CHEVRON_RIGHT },
  'chevron-down': { sf: 'chevron.down', svg: ICON_CHEVRON_DOWN },
  edit: { sf: 'pencil', svg: ICON_EDIT },
  eye: { sf: 'eye', svg: ICON_EYE },
  'eye-off': { sf: 'eye.slash', svg: ICON_EYE_OFF },
  'more-vertical': { sf: 'ellipsis', svg: ICON_MORE_VERTICAL },
  plus: { sf: 'plus', svg: ICON_PLUS },
  devices: { sf: 'cpu', svg: ICON_DEVICES },
  home: { sf: 'house.fill', svg: ICON_HOME },
  phone: { sf: 'phone.fill', svg: ICON_PHONE },
};

export function AppIcon({ name, size = 16, color: requestedColor, style }: AppIconProps) {
  const theme = useTheme();
  const color = requestedColor ?? theme.textSecondary;
  const icon = ICON_MAP[name];
  const coloredUri = useMemo(() => {
    return icon ? getColoredSvgUri(icon.svg, color) : '';
  }, [icon?.svg, color]);

  const imageStyle = useMemo(
    () => ({
      width: size,
      height: size,
    }),
    [size]
  );

  if (!icon) return null;

  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      {Platform.OS === 'ios' ? (
        <SymbolView
          name={icon.sf}
          tintColor={color}
          size={size}
          fallback={
            <Image
              source={{ uri: coloredUri }}
              style={imageStyle}
              contentFit="contain"
            />
          }
        />
      ) : (
        <Image
          source={{ uri: coloredUri }}
          style={imageStyle}
          contentFit="contain"
        />
      )}
    </View>
  );
}
