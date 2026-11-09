import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { MAP_STYLES, MapStyle } from '../constants/Theme';
import { abrirPainelAdm } from '../lib/api';
import { useDesktopLayout } from '../lib/responsive';
import Icon from '../components/Icon';
import Button from '../components/Button';
import { Cartao, RotuloSecao, Segmentado, Surgir, Tela, TituloPagina } from '../components/ui';

const ESTILO_MAPA: Record<MapStyle, { rotulo: string; icone: string }> = {
  dark: { rotulo: 'Escuro', icone: 'ion:moon-outline' },
  street: { rotulo: 'Padrão', icone: 'ion:map-outline' },
  satellite: { rotulo: 'Satélite', icone: 'ion:layers-outline' },
};

/** Avatar com anel no gradiente da marca e a inicial do nome. Também usado no EditProfile. */
export function AvatarAnel({ letra, tamanho = 72 }: { letra: string; tamanho?: number }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const externo = tamanho + 8;
  return (
    <LinearGradient
      colors={c.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width: externo, height: externo, borderRadius: externo / 2, padding: 2 }}
    >
      <View style={[styles.avatarVao, { borderRadius: externo / 2, backgroundColor: c.surface }]}>
        <View style={[styles.avatarDisco, { borderRadius: tamanho / 2, backgroundColor: c.accentSoft }]}>
          <Text style={{ fontFamily: theme.fonts.sansBold, fontSize: tamanho * 0.4, color: c.accent }}>{letra}</Text>
        </View>
      </View>
    </LinearGradient>
  );
}

export default function ProfileScreen({ navigation }: any) {
  const { theme, mode, preference, setPreference, mapStyle, setMapStyle } = useTheme();
  const c = theme.colors;
  const { user, profile, signOut, refreshProfile, isAdmin } = useAuth();
  const desktop = useDesktopLayout();

  // Refresh profile ao focar tab Perfil.
  useFocusEffect(
    useCallback(() => {
      refreshProfile();
    }, [refreshProfile])
  );

  const nome = profile?.nome || (user?.email ? user.email.split('@')[0] : 'Usuário');
  const initial = nome[0]?.toUpperCase() || 'U';

  return (
    <Tela>
        <Surgir>
          <TituloPagina titulo="Perfil" />
        </Surgir>

        <Surgir ordem={1} style={{ marginTop: 24 }}>
          <Cartao>
            <View style={styles.identidade}>
              <AvatarAnel letra={initial} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[theme.typography.h3, { color: c.text }]} numberOfLines={1}>
                  {nome}
                </Text>
                <Text style={[theme.typography.caption, { color: c.textMuted, marginTop: 2 }]} numberOfLines={1}>
                  {user?.email}
                </Text>
              </View>
            </View>
          </Cartao>
        </Surgir>

        <Surgir ordem={2}>
          <RotuloSecao>Aparência</RotuloSecao>
          <Cartao>
            <Preferencia
              icone={mode === 'dark' ? 'ion:moon-outline' : 'ion:sunny-outline'}
              titulo="Tema"
              sub="Claro, escuro ou como o sistema."
            >
              <Segmentado
                valor={preference}
                onChange={setPreference}
                opcoes={[
                  { valor: 'light', rotulo: 'Claro', icone: 'ion:sunny-outline' },
                  { valor: 'dark', rotulo: 'Escuro', icone: 'ion:moon-outline' },
                  { valor: 'auto', rotulo: 'Auto', icone: 'ion:contrast-outline' },
                ]}
              />
            </Preferencia>
          </Cartao>
        </Surgir>

        <Surgir ordem={3}>
          <RotuloSecao>Mapa</RotuloSecao>
          <Cartao>
            <Preferencia icone="ion:layers-outline" titulo="Estilo do mapa" sub="Fundo dos mapas.">
              <Segmentado
                valor={mapStyle}
                onChange={setMapStyle}
                opcoes={MAP_STYLES.map((s) => ({ valor: s, ...ESTILO_MAPA[s] }))}
              />
            </Preferencia>
          </Cartao>
        </Surgir>

        <Surgir ordem={4}>
          <RotuloSecao>Conta</RotuloSecao>
          <Cartao padding={0} style={{ overflow: 'hidden' }}>
            <LinhaConta
              icone="ion:person-outline"
              titulo="Editar perfil"
              sub="Nome e avatar"
              onPress={() => navigation?.navigate('EditProfile')}
            />
            <View style={[styles.divisor, { backgroundColor: c.border }]} />
            <LinhaConta
              icone="ion:lock-closed-outline"
              titulo="Privacidade"
              sub="O que guardamos e seus direitos"
              onPress={() => navigation?.navigate('Privacy')}
            />
            <View style={[styles.divisor, { backgroundColor: c.border }]} />
            <LinhaConta
              icone="ion:shield-checkmark-outline"
              titulo="Segurança"
              sub="Verificação em duas etapas"
              onPress={() => navigation?.navigate('Seguranca')}
            />
            {/* Só esconde o botão: quem garante o acesso é o banco (RLS + is_admin()) e a API. */}
            {isAdmin ? (
              <>
                <View style={[styles.divisor, { backgroundColor: c.border }]} />
                <LinhaConta icone="ion:speedometer-outline" titulo="Painel ADM" sub="Dados, uso e modelo" onPress={abrirPainelAdm} />
              </>
            ) : null}
          </Cartao>
        </Surgir>

        <Surgir ordem={5} style={{ marginTop: 32 }}>
          <Button label="Sair da conta" variant="danger" fullWidth={!desktop} onPress={signOut} />
        </Surgir>

        <Text style={[theme.typography.micro, styles.rodape, { color: c.textSubtle }]}>
          Routify · TCC 2026
        </Text>
    </Tela>
  );
}

/** Linha de preferência: rótulo à esquerda, controle à direita (empilha no celular). */
function Preferencia({
  icone,
  titulo,
  sub,
  children,
}: {
  icone: string;
  titulo: string;
  sub: string;
  children: React.ReactNode;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={styles.pref}>
      <View style={styles.prefTexto}>
        <View style={[styles.iconeCirculo, { backgroundColor: c.surfaceAlt }]}>
          <Icon name={icone} size={18} color={c.textMuted} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[theme.typography.h4, { color: c.text }]}>{titulo}</Text>
          <Text style={[theme.typography.caption, { color: c.textMuted }]}>{sub}</Text>
        </View>
      </View>
      <View style={styles.prefControle}>{children}</View>
    </View>
  );
}

/** Linha navegável da lista "Conta": hover/press com fundo surfaceAlt. */
function LinhaConta({ icone, titulo, sub, onPress }: { icone: string; titulo: string; sub: string; onPress: () => void }) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={titulo}
      style={(estado) => {
        const { hovered, pressed } = estado as { hovered?: boolean; pressed: boolean };
        return [styles.linha, (hovered || pressed) && { backgroundColor: c.surfaceAlt }];
      }}
    >
      <View style={[styles.iconeCirculo, { backgroundColor: c.accentSoft }]}>
        <Icon name={icone} size={18} color={c.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[theme.typography.bodyMd, { color: c.text }]}>{titulo}</Text>
        <Text style={[theme.typography.caption, { color: c.textMuted }]} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <Icon name="ion:chevron-forward" size={18} color={c.textSubtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatarVao: { flex: 1, padding: 2 },
  avatarDisco: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  identidade: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  pref: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16 },
  prefTexto: { flexDirection: 'row', alignItems: 'center', gap: 12, flexGrow: 1, flexShrink: 1, flexBasis: 240, minWidth: 0 },
  prefControle: { flexGrow: 1, flexShrink: 1, flexBasis: 240, minWidth: 0, maxWidth: 380 },
  iconeCirculo: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, minHeight: 44 },
  divisor: { height: 1, marginLeft: 64 },
  rodape: { textAlign: 'center', textTransform: 'uppercase', marginTop: 40 },
});
