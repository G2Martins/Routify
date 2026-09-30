import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import Icon from './Icon';
import { MAP_STYLES, MapStyle } from '../constants/Theme';

const STYLE_META: Record<MapStyle, { icon: string; label: string }> = {
  dark: { icon: 'ion:moon-outline', label: 'Escuro' },
  street: { icon: 'ion:map-outline', label: 'Padrão' },
  satellite: { icon: 'ion:layers-outline', label: 'Satélite' },
};

const TRANSICAO_WEB =
  Platform.OS === 'web'
    ? ({ transitionProperty: 'background-color, border-color, box-shadow', transitionDuration: '160ms' } as ViewStyle)
    : null;

/** Botão quadrado de controle do mapa (40 px, raio 12): superfície, borda fina, sombra; hover eleva. */
export function BotaoMapa({
  icone,
  rotulo,
  onPress,
  ativo,
}: {
  icone: string;
  rotulo: string;
  onPress: () => void;
  ativo?: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      accessibilityState={{ expanded: ativo }}
      style={(estado) => {
        const { hovered, pressed } = estado as { hovered?: boolean; pressed: boolean };
        const alto = hovered || ativo;
        return [
          styles.botao,
          {
            backgroundColor: c.surface,
            borderColor: alto ? c.borderStrong : c.border,
            boxShadow: alto
              ? `0 6px 20px ${c.shadowMedium}, 0 0 0 1px ${c.shadowLight}`
              : `0 2px 8px ${c.shadowLight}, 0 0 0 1px ${c.shadowLight}`,
            transform: [{ scale: pressed ? theme.motion.pressScale : 1 }],
          },
          TRANSICAO_WEB,
        ];
      }}
    >
      {(estado) => {
        const { hovered } = estado as { hovered?: boolean };
        return <Icon name={icone} size={18} color={hovered || ativo ? c.accent : c.text} />;
      }}
    </Pressable>
  );
}

export default function MapStyleToggle() {
  const { theme, mapStyle, setMapStyle } = useTheme();
  const c = theme.colors;
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.container}>
      <BotaoMapa
        icone={STYLE_META[mapStyle].icon}
        rotulo={`Estilo do mapa: ${STYLE_META[mapStyle].label}`}
        onPress={() => setOpen((o) => !o)}
        ativo={open}
      />

      {open ? (
        <View
          accessibilityRole="menu"
          style={[
            styles.menu,
            {
              backgroundColor: c.surface,
              borderColor: c.border,
              boxShadow: `0 12px 32px ${c.shadowMedium}, 0 0 0 1px ${c.shadowLight}`,
            },
          ]}
        >
          <Text style={[theme.typography.micro, styles.titulo, { color: c.textSubtle }]}>ESTILO DO MAPA</Text>
          {MAP_STYLES.map((s) => {
            const active = mapStyle === s;
            return (
              <Pressable
                key={s}
                accessibilityRole="menuitem"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  setMapStyle(s);
                  setOpen(false);
                }}
                style={(estado) => {
                  const { hovered, pressed } = estado as { hovered?: boolean; pressed: boolean };
                  return [
                    styles.menuItem,
                    { backgroundColor: pressed ? c.surfaceMuted : hovered || active ? c.surfaceAlt : 'transparent' },
                  ];
                }}
              >
                <Icon name={STYLE_META[s].icon} size={16} color={active ? c.accent : c.textMuted} />
                <Text style={[theme.typography.captionMd, { color: c.text, flex: 1 }]}>{STYLE_META[s].label}</Text>
                {active ? <Icon name="ion:checkmark-circle" size={16} color={c.accent} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'relative', zIndex: 2 },
  botao: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Abre à esquerda do botão para não empurrar os outros controles.
  menu: {
    position: 'absolute',
    top: 0,
    right: 48,
    width: 176,
    padding: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  titulo: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 8,
  },
});
