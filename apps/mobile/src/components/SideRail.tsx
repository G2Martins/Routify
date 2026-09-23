/**
 * SideRail — barra lateral da web desktop (tokens `rail*`).
 *
 * Layout manual (não depende de tabBarPosition='left' do react-navigation,
 * que não funciona consistentemente em react-native-web).
 * Recolhe/expande animando a largura (ease-out-expo); ícones ficam no mesmo
 * x nos dois estados e os rótulos só esmaecem — sem salto de layout.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from './Icon';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { ADMIN_URL, API_URL } from '../lib/api';

const TAB_ICONS: Record<string, { active: string; inactive: string }> = {
  Mapa: { active: 'ion:map', inactive: 'ion:map-outline' },
  Painel: { active: 'ion:grid', inactive: 'ion:grid-outline' },
  Histórico: { active: 'ion:time', inactive: 'ion:time-outline' },
  Perfil: { active: 'ion:person', inactive: 'ion:person-outline' },
};

const RAIL_EXPANDED = 224;
const RAIL_COLLAPSED = 72;
const HEALTH_INTERVALO_MS = 60_000;

interface Props {
  routes: string[];
  activeName: string;
  onSelect: (name: string) => void;
}

/** "lia_2.1" → "LIA 2.1". */
function rotuloModelo(v: unknown): string {
  if (typeof v !== 'string' || !v) return 'LIA';
  return v.slice(0, 16).replace(/^lia[_-]?/i, 'LIA ').replace(/_/g, '.').trim();
}

/** Versão do modelo ativo via GET /health; null = API fora do ar. */
function useModeloAtivo(): { rotulo: string; online: boolean | null } {
  const [estado, setEstado] = useState<{ rotulo: string; online: boolean | null }>({ rotulo: 'LIA', online: null });
  useEffect(() => {
    let vivo = true;
    const checar = async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      try {
        const r = await fetch(`${API_URL}/health`, { signal: ctrl.signal });
        const j = r.ok ? await r.json() : null;
        if (vivo) setEstado(j ? { rotulo: rotuloModelo(j.modelo_ativo), online: true } : { rotulo: 'LIA', online: false });
      } catch {
        if (vivo) setEstado({ rotulo: 'LIA', online: false });
      } finally {
        clearTimeout(timer);
      }
    };
    checar();
    const id = setInterval(checar, HEALTH_INTERVALO_MS);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, []);
  return estado;
}

/** Só UI: quem garante o acesso ao painel é o banco (RLS + is_admin()). */
function abrirPainelAdm() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.assign(ADMIN_URL);
  else Linking.openURL(ADMIN_URL).catch(() => {});
}

function ItemRail({
  icone,
  rotulo,
  ativo,
  onPress,
  rotuloOpacidade,
  recolhido,
}: {
  icone: string;
  rotulo: string;
  ativo?: boolean;
  onPress: () => void;
  rotuloOpacidade: Animated.AnimatedInterpolation<number>;
  recolhido: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      accessibilityState={{ selected: !!ativo }}
      onPress={onPress}
      style={({ pressed }) => [styles.item, { borderRadius: theme.radius.sm, transform: [{ scale: pressed ? theme.motion.pressScale : 1 }] }]}
    >
      {(estado) => {
        const { hovered } = estado as { hovered?: boolean };
        const cor = ativo || hovered ? c.onAccent : c.railText;
        return (
          <>
            {ativo ? <View style={[StyleSheet.absoluteFill, styles.fundo, { backgroundColor: c.railActive, opacity: 0.18 }]} /> : null}
            {!ativo && hovered ? <View style={[StyleSheet.absoluteFill, styles.fundo, { backgroundColor: c.railText, opacity: 0.08 }]} /> : null}
            {ativo ? <View style={[styles.indicador, { backgroundColor: c.railActive }]} /> : null}
            <Icon name={icone} size={20} color={cor} />
            <Animated.Text
              numberOfLines={1}
              importantForAccessibility={recolhido ? 'no-hide-descendants' : 'auto'}
              style={[theme.typography.navLg, styles.itemRotulo, { color: cor, opacity: rotuloOpacidade, fontFamily: ativo ? theme.fonts.sansSemi : theme.fonts.sansMedium }]}
            >
              {rotulo}
            </Animated.Text>
          </>
        );
      }}
    </Pressable>
  );
}

export default function SideRail({ routes, activeName, onSelect }: Props) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { isAdmin, profile, user } = useAuth();
  const modelo = useModeloAtivo();
  const [collapsed, setCollapsed] = useState(false);
  const largura = useRef(new Animated.Value(RAIL_EXPANDED)).current;

  useEffect(() => {
    Animated.timing(largura, {
      toValue: collapsed ? RAIL_COLLAPSED : RAIL_EXPANDED,
      duration: theme.motion.medio,
      easing: theme.motion.easeOutExpo,
      useNativeDriver: false, // largura não roda no driver nativo
    }).start();
  }, [collapsed]); // eslint-disable-line react-hooks/exhaustive-deps

  const rotuloOpacidade = largura.interpolate({
    inputRange: [RAIL_COLLAPSED, RAIL_COLLAPSED + 60, RAIL_EXPANDED],
    outputRange: [0, 0, 1],
    extrapolate: 'clamp',
  });

  const nome = profile?.nome || (user?.user_metadata?.nome as string | undefined) || user?.email?.split('@')[0] || 'Você';
  const inicial = nome.trim().charAt(0).toUpperCase() || 'R';
  const corStatus = modelo.online === null ? c.textSubtle : modelo.online ? c.success : c.danger;

  return (
    <Animated.View style={[styles.rail, { width: largura, backgroundColor: c.rail }]}>
      <View style={styles.marca}>
        <Image
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          source={require('../../assets/Logo_Routify_icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Animated.Text numberOfLines={1} style={[styles.marcaNome, { color: c.onAccent, fontFamily: theme.fonts.sansBold, opacity: rotuloOpacidade }]}>
          Routify
        </Animated.Text>
      </View>

      <View style={styles.itens}>
        {routes.map((name) => {
          const icons = TAB_ICONS[name] || TAB_ICONS.Mapa;
          const ativo = name === activeName;
          return (
            <ItemRail
              key={name}
              icone={ativo ? icons.active : icons.inactive}
              rotulo={name}
              ativo={ativo}
              onPress={() => onSelect(name)}
              rotuloOpacidade={rotuloOpacidade}
              recolhido={collapsed}
            />
          );
        })}

        {isAdmin ? (
          <>
            <View style={[styles.separador, { backgroundColor: c.railText }]} />
            <ItemRail
              icone="ion:shield-checkmark-outline"
              rotulo="Painel ADM"
              onPress={abrirPainelAdm}
              rotuloOpacidade={rotuloOpacidade}
              recolhido={collapsed}
            />
          </>
        ) : null}
      </View>

      <View style={styles.itensRodape}>
        <ItemRail
          icone={collapsed ? 'ion:chevron-forward' : 'ion:chevron-back'}
          rotulo={collapsed ? 'Expandir' : 'Recolher'}
          onPress={() => setCollapsed((v) => !v)}
          rotuloOpacidade={rotuloOpacidade}
          recolhido={collapsed}
        />
      </View>

      <View style={[styles.separador, { backgroundColor: c.railText, marginHorizontal: 18 }]} />
      <View style={styles.rodape}>
        <View
          style={styles.linhaRodape}
          accessible
          accessibilityLabel={`Modelo ${modelo.rotulo}, API ${modelo.online ? 'online' : modelo.online === false ? 'offline' : 'verificando'}`}
        >
          <View style={styles.slotIcone}>
            <View style={[styles.statusPonto, { backgroundColor: corStatus }]} />
          </View>
          <Animated.View style={[styles.textoRodape, { opacity: rotuloOpacidade }]}>
            <Text numberOfLines={1} style={[theme.typography.captionMd, { color: c.onAccent, fontFamily: theme.fonts.mono }]}>
              {modelo.rotulo}
            </Text>
            <Text numberOfLines={1} style={[theme.typography.micro, { color: c.railText, textTransform: 'uppercase' }]}>
              {modelo.online === null ? 'verificando' : modelo.online ? 'online' : 'offline'}
            </Text>
          </Animated.View>
        </View>

        <Pressable
          onPress={() => onSelect('Perfil')}
          accessibilityRole="button"
          accessibilityLabel={`${nome} — abrir perfil`}
          style={[styles.linhaRodape, { marginTop: 12 }]}
        >
          <View style={[styles.avatar, { backgroundColor: c.railActive }]}>
            <Text style={[theme.typography.captionMd, { color: c.onAccent, fontFamily: theme.fonts.sansSemi }]}>{inicial}</Text>
          </View>
          <Animated.View style={[styles.textoRodape, { opacity: rotuloOpacidade }]}>
            <Text numberOfLines={1} style={[theme.typography.captionMd, { color: c.onAccent }]}>
              {nome}
            </Text>
            <Text numberOfLines={1} style={[theme.typography.caption, { color: c.railText, fontSize: 12 }]}>
              Ver perfil
            </Text>
          </Animated.View>
        </Pressable>
      </View>
    </Animated.View>
  );
}

export { RAIL_EXPANDED, RAIL_COLLAPSED };

// Ícone de todos os itens em x = 12 (padding) + 14 (item) = 26 → centro em 36 = metade do rail recolhido.
const styles = StyleSheet.create({
  rail: { flexDirection: 'column', height: '100%', paddingVertical: 16, overflow: 'hidden' },
  marca: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 22, height: 44, marginBottom: 16 },
  logo: { width: 28, height: 28 },
  marcaNome: { fontSize: 18, letterSpacing: -0.3 },
  itens: { flex: 1, paddingHorizontal: 12, gap: 4 },
  itensRodape: { paddingHorizontal: 12 },
  item: { flexDirection: 'row', alignItems: 'center', height: 42, paddingHorizontal: 14, gap: 12, position: 'relative' },
  fundo: { borderRadius: 8 },
  indicador: { position: 'absolute', left: -12, top: 9, bottom: 9, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3 },
  itemRotulo: { flex: 1, fontSize: 14 },
  separador: { height: 1, opacity: 0.12, marginVertical: 10, marginHorizontal: 6 },
  rodape: { paddingTop: 4, paddingHorizontal: 12 },
  linhaRodape: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8 },
  slotIcone: { width: 32, alignItems: 'center' },
  statusPonto: { width: 8, height: 8, borderRadius: 4 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  textoRodape: { flex: 1, minWidth: 0 },
});
