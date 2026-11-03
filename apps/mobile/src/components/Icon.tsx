/**
 * Icon no celular: @expo/vector-icons (Ionicons como fallback default). Na web vale o Icon.web.tsx (Iconify offline),
 * para os mapas de glifos daqui não irem para o bundle web.
 *
 * Exemplo:
 *   <Icon name="material-symbols:directions-car-rounded" size={28} />
 *   <Icon name="ion:location-outline" size={20} color="#fff" />
 */
import React from 'react';
import {
  Ionicons,
  MaterialCommunityIcons,
} from '@expo/vector-icons';

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
  // Specials (fora dos sets "ion"/"mdi", que resolvem pelo prefixo — ver abaixo)
  'material-symbols:home': { lib: Ionicons, name: 'home' },
  'material-symbols:directions-car-rounded': { lib: MaterialCommunityIcons, name: 'car' },
  'mdi:car': { lib: MaterialCommunityIcons, name: 'car' },
  'mdi:car-sports': { lib: MaterialCommunityIcons, name: 'car-sports' },
  'mdi:rocket-launch': { lib: MaterialCommunityIcons, name: 'rocket-launch' },
  'mdi:steering': { lib: MaterialCommunityIcons, name: 'steering' },
  'mdi:road-variant': { lib: MaterialCommunityIcons, name: 'road-variant' },
};

export default function Icon({ name, size = 24, color = '#000', style }: IconProps) {
  // Native fallback
  const fallback = NATIVE_FALLBACK[name];
  if (fallback) {
    const Lib = fallback.lib;
    return <Lib name={fallback.name} size={size} color={color} style={style} />;
  }

  // ponytail: os sets "ion" e "mdi" do Iconify usam os mesmos nomes do Ionicons 7 e do
  // MaterialCommunityIcons, então qualquer nome desses dois sets resolve sem entrada no mapa.
  const [prefixo, nome] = name.split(':');
  const lib = prefixo === 'ion' ? Ionicons : prefixo === 'mdi' ? MaterialCommunityIcons : null;
  if (lib && nome && nome in lib.glyphMap) {
    const Lib = lib as any;
    return <Lib name={nome} size={size} color={color} style={style} />;
  }

  // Default genérico (caso receba ícone desconhecido em native)
  return <Ionicons name="help-circle-outline" size={size} color={color} style={style} />;
}
