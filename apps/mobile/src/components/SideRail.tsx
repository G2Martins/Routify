/**
 * SideRail — barra lateral vertical estilo Uber/Google-Maps web.
 *
 * Layout manual (não depende de tabBarPosition='left' do react-navigation,
 * que não funciona consistentemente em react-native-web).
 */
import React, { useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from './Icon';
import { brand } from '../constants/Theme';

const TAB_ICONS: Record<string, { active: string; inactive: string }> = {
  Mapa: { active: 'ion:map', inactive: 'ion:map-outline' },
  Painel: { active: 'ion:grid', inactive: 'ion:grid-outline' },
  Histórico: { active: 'ion:time', inactive: 'ion:time-outline' },
  Perfil: { active: 'ion:person', inactive: 'ion:person-outline' },
};

const RAIL_EXPANDED = 220;
const RAIL_COLLAPSED = 72;

interface Props {
  routes: string[];
  activeName: string;
  onSelect: (name: string) => void;
}

export default function SideRail({ routes, activeName, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const width = collapsed ? RAIL_COLLAPSED : RAIL_EXPANDED;

  return (
    <View style={[styles.rail, { width, backgroundColor: brand.navy }]}>
      <View style={[styles.header, collapsed ? styles.headerCollapsed : null]}>
        {!collapsed ? (
          <View style={styles.brandRow}>
            <Image
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              source={require('../../assets/Logo_Routify_icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.brandName}>Routify</Text>
          </View>
        ) : (
          <Image
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            source={require('../../assets/Logo_Routify_icon.png')}
            style={styles.logoCollapsed}
            resizeMode="contain"
          />
        )}
      </View>

      <Pressable
        onPress={() => setCollapsed((v) => !v)}
        style={({ pressed }: { pressed: boolean }) => [
          styles.toggleBtn,
          collapsed ? styles.toggleBtnCollapsed : null,
          { opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Icon
          name={collapsed ? 'ion:chevron-forward' : 'ion:chevron-back'}
          size={16}
          color="#ffffff"
        />
        {!collapsed ? <Text style={styles.toggleLabel}>Recolher</Text> : null}
      </Pressable>

      <View style={styles.items}>
        {routes.map((name) => {
          const focused = name === activeName;
          const icons = TAB_ICONS[name] || TAB_ICONS.Mapa;
          return (
            <Pressable
              key={name}
              accessibilityRole="button"
              onPress={() => onSelect(name)}
              style={({ pressed }: { pressed: boolean }) => [
                styles.item,
                collapsed ? styles.itemCollapsed : null,
                focused
                  ? styles.itemFocused
                  : pressed
                  ? { backgroundColor: 'rgba(255,255,255,0.06)' }
                  : null,
              ]}
            >
              {focused ? (
                <View
                  style={[
                    styles.activeIndicator,
                    collapsed ? styles.activeIndicatorCollapsed : null,
                  ]}
                />
              ) : null}
              <View
                style={[
                  styles.itemIconWrap,
                  focused ? styles.itemIconWrapFocused : null,
                ]}
              >
                <Icon
                  name={focused ? icons.active : icons.inactive}
                  size={collapsed ? 20 : 18}
                  color="#ffffff"
                />
              </View>
              {!collapsed ? (
                <Text
                  style={[
                    styles.itemLabel,
                    focused ? { color: '#ffffff', fontWeight: '700' } : null,
                  ]}
                >
                  {name}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {!collapsed ? (
        <View style={styles.footer}>
          <Text style={styles.footerText}>LIA 1.0</Text>
          <Text style={styles.footerSubtext}>Routify TCC</Text>
        </View>
      ) : null}
    </View>
  );
}

export { RAIL_EXPANDED, RAIL_COLLAPSED };

const styles = StyleSheet.create({
  rail: {
    flexDirection: 'column',
    height: '100%',
    paddingVertical: 16,
    ...Platform.select({
      web: { transitionProperty: 'width', transitionDuration: '200ms' as any } as any,
      default: {},
    }),
  },
  header: {
    paddingHorizontal: 18,
    paddingBottom: 8,
  },
  headerCollapsed: {
    paddingHorizontal: 0,
    alignItems: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logo: { width: 28, height: 28 },
  logoCollapsed: { width: 32, height: 32 },
  brandName: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 18,
    marginBottom: 12,
    gap: 8,
  },
  toggleBtnCollapsed: {
    justifyContent: 'center',
    paddingHorizontal: 0,
  },
  toggleLabel: {
    color: '#ffffff',
    opacity: 0.7,
    fontSize: 12,
    fontWeight: '500',
  },
  items: {
    flex: 1,
    paddingHorizontal: 8,
    gap: 4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 12,
    position: 'relative',
  },
  itemCollapsed: {
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  itemFocused: {
    backgroundColor: 'rgba(2,107,248,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(2,107,248,0.45)',
    ...Platform.select({
      web: {
        boxShadow:
          '0 0 0 1px rgba(2,107,248,0.35), 0 4px 14px rgba(2,107,248,0.28)' as any,
      } as any,
      default: {
        shadowColor: brand.blue,
        shadowOpacity: 0.35,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 2 },
        elevation: 6,
      },
    }),
  },
  activeIndicator: {
    position: 'absolute',
    left: -8,
    top: 6,
    bottom: 6,
    width: 4,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    backgroundColor: brand.blue,
  },
  activeIndicatorCollapsed: {
    left: -6,
    top: 8,
    bottom: 8,
    width: 3,
  },
  itemIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemIconWrapFocused: {
    backgroundColor: brand.blue,
    ...Platform.select({
      web: { boxShadow: '0 2px 10px rgba(2,107,248,0.55)' as any } as any,
      default: {
        shadowColor: brand.blue,
        shadowOpacity: 0.55,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 4,
      },
    }),
  },
  itemLabel: {
    color: '#ffffff',
    opacity: 0.85,
    fontSize: 14,
    fontWeight: '500',
  },
  footer: {
    paddingHorizontal: 18,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    marginTop: 12,
  },
  footerText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  footerSubtext: {
    color: '#ffffff',
    opacity: 0.5,
    fontSize: 10,
  },
});
