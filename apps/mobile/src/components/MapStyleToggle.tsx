import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import Icon from './Icon';
import { MAP_STYLES, MapStyle } from '../constants/Theme';

const STYLE_META: Record<MapStyle, { icon: string; label: string }> = {
  dark: { icon: 'ion:moon-outline', label: 'Escuro' },
  street: { icon: 'ion:map-outline', label: 'Padrão' },
  satellite: { icon: 'ion:layers-outline', label: 'Satélite' },
};

export default function MapStyleToggle() {
  const { theme, mapStyle, setMapStyle } = useTheme();
  const c = theme.colors;
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.container}>
      {open ? (
        <View
          style={[
            styles.menu,
            {
              backgroundColor: c.surface,
              shadowColor: '#000',
              borderColor: c.border + '11',
            },
          ]}
        >
          {MAP_STYLES.map((s) => {
            const active = mapStyle === s;
            return (
              <Pressable
                key={s}
                onPress={() => {
                  setMapStyle(s);
                  setOpen(false);
                }}
                style={({ pressed }: { pressed: boolean }) => [
                  styles.menuItem,
                  {
                    backgroundColor: active
                      ? c.surfaceAlt
                      : pressed
                      ? c.surfaceMuted
                      : 'transparent',
                  },
                ]}
              >
                <Icon name={STYLE_META[s].icon} size={18} color={c.text} />
                <Text style={{ color: c.text, marginLeft: 10, fontSize: 14, fontWeight: '500' }}>
                  {STYLE_META[s].label}
                </Text>
                {active ? (
                  <Icon
                    name="ion:checkmark-circle"
                    size={16}
                    color={c.accent}
                    style={{ marginLeft: 'auto' }}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }: { pressed: boolean }) => [
          styles.fab,
          {
            backgroundColor: c.surface,
            opacity: pressed ? 0.85 : 1,
            shadowColor: '#000',
          },
        ]}
      >
        <Icon name={STYLE_META[mapStyle].icon} size={20} color={c.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'flex-end',
  },
  fab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { boxShadow: '0 2px 8px rgba(0,0,0,0.16)' as any },
      default: {
        shadowOpacity: 0.16,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 8,
        elevation: 4,
      },
    }),
  },
  menu: {
    marginBottom: 8,
    borderRadius: 12,
    paddingVertical: 6,
    minWidth: 160,
    borderWidth: 1,
    ...Platform.select({
      web: { boxShadow: '0 4px 16px rgba(0,0,0,0.16)' as any },
      default: {
        shadowOpacity: 0.16,
        shadowOffset: { width: 0, height: 4 },
        shadowRadius: 16,
        elevation: 8,
      },
    }),
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
});
