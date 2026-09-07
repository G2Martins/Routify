/**
 * Icon — wrapper cross-platform.
 * Web: usa @iconify/react (acesso a 200k+ ícones via nome "set:icon")
 * Native: usa @expo/vector-icons (Ionicons como fallback default)
 *
 * Exemplo:
 *   <Icon name="material-symbols:directions-car-rounded" size={28} />
 *   <Icon name="ion:location-outline" size={20} color="#fff" />
 */
import React from 'react';
import { Platform, View } from 'react-native';
import {
  Ionicons,
  MaterialIcons,
  MaterialCommunityIcons,
  FontAwesome5,
} from '@expo/vector-icons';

// @ts-ignore — só web
const IconifyReact: any =
  Platform.OS === 'web'
    ? // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('@iconify/react').Icon
    : null;

export interface IconProps {
  name: string;        // ex: "ion:car-outline" | "material-symbols:home"
  size?: number;
  color?: string;
  style?: any;
}

// Mapa simples para fallback nativo a partir do prefixo
const NATIVE_FALLBACK: Record<string, { lib: any; name: string }> = {
  // Comuns usados no app
  'ion:home-outline': { lib: Ionicons, name: 'home-outline' },
  'ion:home': { lib: Ionicons, name: 'home' },
  'ion:map-outline': { lib: Ionicons, name: 'map-outline' },
  'ion:map': { lib: Ionicons, name: 'map' },
  'ion:time-outline': { lib: Ionicons, name: 'time-outline' },
  'ion:person-outline': { lib: Ionicons, name: 'person-outline' },
  'ion:person': { lib: Ionicons, name: 'person' },
  'ion:settings-outline': { lib: Ionicons, name: 'settings-outline' },
  'ion:location-outline': { lib: Ionicons, name: 'location-outline' },
  'ion:flag-outline': { lib: Ionicons, name: 'flag-outline' },
  'ion:navigate-outline': { lib: Ionicons, name: 'navigate-outline' },
  'ion:navigate': { lib: Ionicons, name: 'navigate' },
  'ion:moon-outline': { lib: Ionicons, name: 'moon-outline' },
  'ion:sunny-outline': { lib: Ionicons, name: 'sunny-outline' },
  'ion:close': { lib: Ionicons, name: 'close' },
  'ion:chevron-forward': { lib: Ionicons, name: 'chevron-forward' },
  'ion:trash-outline': { lib: Ionicons, name: 'trash-outline' },
  'ion:locate': { lib: Ionicons, name: 'locate' },
  'ion:eye-outline': { lib: Ionicons, name: 'eye-outline' },
  'ion:eye-off-outline': { lib: Ionicons, name: 'eye-off-outline' },
  'ion:mail-outline': { lib: Ionicons, name: 'mail-outline' },
  'ion:lock-closed-outline': { lib: Ionicons, name: 'lock-closed-outline' },
  'ion:logo-google': { lib: Ionicons, name: 'logo-google' },
  'ion:layers-outline': { lib: Ionicons, name: 'layers-outline' },
  'ion:analytics-outline': { lib: Ionicons, name: 'analytics-outline' },
  'ion:server-outline': { lib: Ionicons, name: 'server-outline' },
  'ion:git-network-outline': { lib: Ionicons, name: 'git-network-outline' },
  'ion:arrow-forward': { lib: Ionicons, name: 'arrow-forward' },
  'ion:arrow-back': { lib: Ionicons, name: 'arrow-back' },
  'ion:flash-outline': { lib: Ionicons, name: 'flash-outline' },
  'ion:checkmark-circle': { lib: Ionicons, name: 'checkmark-circle' },
  // Specials
  'material-symbols:directions-car-rounded': { lib: MaterialCommunityIcons, name: 'car' },
  'mdi:car': { lib: MaterialCommunityIcons, name: 'car' },
  'mdi:car-sports': { lib: MaterialCommunityIcons, name: 'car-sports' },
  'mdi:rocket-launch': { lib: MaterialCommunityIcons, name: 'rocket-launch' },
  'mdi:steering': { lib: MaterialCommunityIcons, name: 'steering' },
  'mdi:road-variant': { lib: MaterialCommunityIcons, name: 'road-variant' },
};

export default function Icon({ name, size = 24, color = '#000', style }: IconProps) {
  if (Platform.OS === 'web' && IconifyReact) {
    return (
      <View style={[{ width: size, height: size }, style]}>
        <IconifyReact icon={name} width={size} height={size} color={color} />
      </View>
    );
  }

  // Native fallback
  const fallback = NATIVE_FALLBACK[name];
  if (fallback) {
    const Lib = fallback.lib;
    return <Lib name={fallback.name} size={size} color={color} style={style} />;
  }

  // Default genérico (caso receba ícone desconhecido em native)
  return <Ionicons name="help-circle-outline" size={size} color={color} style={style} />;
}
