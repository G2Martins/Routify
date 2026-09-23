import React, { useCallback } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { MAP_STYLES, MapStyle } from '../constants/Theme';
import Icon from '../components/Icon';
import Button from '../components/Button';

const STYLE_LABEL: Record<MapStyle, string> = {
  dark: 'Escuro',
  street: 'Padrão',
  satellite: 'Satélite',
};

export default function ProfileScreen({ navigation }: any) {
  const { theme, mode, preference, setPreference, mapStyle, setMapStyle } = useTheme();
  const c = theme.colors;
  const { user, profile, signOut, refreshProfile } = useAuth();

  // Refresh profile ao focar tab Perfil.
  useFocusEffect(
    useCallback(() => {
      refreshProfile();
    }, [refreshProfile])
  );

  const nome =
    profile?.nome ||
    (user?.email ? user.email.split('@')[0] : 'Usuário');
  const initial = nome[0]?.toUpperCase() || 'U';

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: c.background }]}
      contentContainerStyle={{ padding: 20, paddingTop: 60, paddingBottom: 80 }}
    >
      <View style={styles.identity}>
        <View style={[styles.avatar, { backgroundColor: c.inverse }]}>
          <Text style={{ color: c.onInverse, fontSize: 30, fontWeight: '700' }}>{initial}</Text>
        </View>
        <Text style={[styles.name, { color: c.text }]}>{nome}</Text>
        <Text style={[styles.email, { color: c.textMuted }]}>{user?.email}</Text>
      </View>

      <Text style={[styles.sectionTitle, { color: c.textMuted }]}>APARÊNCIA</Text>
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.surfaceMuted }]}>
        <View style={styles.row}>
          <Icon
            name={mode === 'dark' ? 'ion:moon-outline' : 'ion:sunny-outline'}
            size={20}
            color={c.text}
          />
          <Text style={[styles.rowLabel, { color: c.text }]}>Tema</Text>
        </View>
        <View style={styles.segmented}>
          {(['light', 'dark', 'auto'] as const).map((p) => (
            <Pressable
              key={p}
              onPress={() => setPreference(p)}
              style={[
                styles.segItem,
                {
                  backgroundColor: preference === p ? c.inverse : c.surfaceAlt,
                },
              ]}
            >
              <Text
                style={{
                  color: preference === p ? c.onInverse : c.text,
                  fontSize: 13,
                  fontWeight: '600',
                }}
              >
                {p === 'light' ? 'Claro' : p === 'dark' ? 'Escuro' : 'Auto'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Text style={[styles.sectionTitle, { color: c.textMuted }]}>MAPA</Text>
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.surfaceMuted }]}>
        <View style={styles.row}>
          <Icon name="ion:layers-outline" size={20} color={c.text} />
          <Text style={[styles.rowLabel, { color: c.text }]}>Estilo de visualização</Text>
        </View>
        <View style={styles.segmented}>
          {MAP_STYLES.map((s) => (
            <Pressable
              key={s}
              onPress={() => setMapStyle(s)}
              style={[
                styles.segItem,
                {
                  backgroundColor: mapStyle === s ? c.inverse : c.surfaceAlt,
                },
              ]}
            >
              <Text
                style={{
                  color: mapStyle === s ? c.onInverse : c.text,
                  fontSize: 13,
                  fontWeight: '600',
                }}
              >
                {STYLE_LABEL[s]}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Text style={[styles.sectionTitle, { color: c.textMuted }]}>CONTA</Text>
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.surfaceMuted }]}>
        <Pressable
          style={styles.menuItem}
          onPress={() => navigation?.navigate('EditProfile')}
        >
          <Icon name="ion:person-outline" size={20} color={c.text} />
          <Text style={[styles.menuText, { color: c.text }]}>Editar perfil</Text>
          <Icon name="ion:chevron-forward" size={18} color={c.textSubtle} />
        </Pressable>
        <View style={[styles.divider, { backgroundColor: c.surfaceMuted }]} />
        <Pressable
          style={styles.menuItem}
          onPress={() => navigation?.navigate('Privacy')}
        >
          <Icon name="ion:lock-closed-outline" size={20} color={c.text} />
          <Text style={[styles.menuText, { color: c.text }]}>Privacidade</Text>
          <Icon name="ion:chevron-forward" size={18} color={c.textSubtle} />
        </Pressable>
      </View>

      <Button
        label="Sair da conta"
        variant="secondary"
        fullWidth
        onPress={signOut}
        style={{ marginTop: 24 }}
      />

      <Text style={{ color: c.textSubtle, fontSize: 11, textAlign: 'center', marginTop: 28 }}>
        Routify · TCC · LIA powered
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  identity: { alignItems: 'center', marginBottom: 32 },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  name: { fontSize: 22, fontWeight: '700' },
  email: { fontSize: 13, marginTop: 4 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 16,
  },
  card: { borderRadius: 14, padding: 16, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  rowLabel: { fontSize: 15, fontWeight: '500', marginLeft: 12 },
  segmented: { flexDirection: 'row', gap: 8 },
  segItem: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: 'center',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  menuText: { flex: 1, marginLeft: 12, fontSize: 15, fontWeight: '500' },
  divider: { height: 1 },
});
