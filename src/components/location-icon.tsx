import React from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { Image } from 'expo-image';
import { ICON_LOCATION } from '@/constants/custom-icons';

export interface LocationIconProps {
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

export function LocationIcon({ size = 14, color = '#059669', style }: LocationIconProps) {
  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      <SymbolView
        name="mappin.and.ellipse"
        tintColor={color}
        size={size}
        fallback={
          <Image
            source={{ uri: ICON_LOCATION }}
            style={{ width: size, height: size, tintColor: color }}
            contentFit="contain"
          />
        }
      />
    </View>
  );
}
