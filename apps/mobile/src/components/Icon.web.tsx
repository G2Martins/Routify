/**
 * Icon na web: SVG do @iconify/react/offline com os dados de constants/icones.json (scripts/icones.mjs). Nada vai à
 * rede (o SVG entra por innerHTML: só vale o que está no repositório) e nada do @expo/vector-icons entra no bundle web
 * (o índice dele trazia os mapas de glifos de uns 15 conjuntos de ícones, centenas de KB que a web nunca usava).
 */
import React from 'react';
import { View } from 'react-native';
import { addCollection, Icon as Iconify, type IconifyJSON } from '@iconify/react/dist/offline';
import colecoes from '../constants/icones.json';
import type { IconProps } from './Icon';

for (const c of colecoes as unknown as IconifyJSON[]) addCollection(c);

export default function Icon({ name, size = 24, color = '#000', style }: IconProps) {
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Iconify icon={name} width={size} height={size} color={color} />
    </View>
  );
}
