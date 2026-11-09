/**
 * Primitivas visuais (linguagem Valerium, paleta da logo). Telas montam com
 * estas peças em vez de estilizar do zero: mesmo raio, borda, sombra e motion.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Platform,
  Pressable,
  RefreshControlProps,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { CONTEUDO_MAX } from '../constants/Theme';
import { useAlvo, useDesktopLayout } from '../lib/responsive';
import Button from './Button';
import Icon from './Icon';

const NATIVO = Platform.OS !== 'web';
const EASE_WEB = 'cubic-bezier(0.16, 1, 0.3, 1)';

export function useMenosMovimento(): boolean {
  const [reduzir, setReduzir] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduzir).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduzir);
    return () => sub.remove();
  }, []);
  return reduzir;
}

type PropsSurgir = {
  children: React.ReactNode;
  ordem?: number;
  style?: StyleProp<ViewStyle>;
  auth?: boolean;
};

/**
 * Entrada: sobe 12 px e aparece, ease-out-expo. `ordem` escalona listas. `auth`: 480 ms, 10 px e 70 ms por item
 * (auth-rise do Valerium), para login, cadastro e verificação.
 *
 * Na web é CSS: o Animated do RN-web refaz o componente a cada quadro, e dez deles juntos tiravam 100 ms por quadro no
 * celular (CPU 4×). O repouso é visível: sem animação, o conteúdo aparece igual.
 */
function SurgirWeb({ children, ordem = 0, style, auth = false }: PropsSurgir) {
  const { theme } = useTheme();
  const atraso = ordem * (auth ? theme.motion.auth.passo : theme.motion.passo);
  return (
    <View style={[auth ? anim.surgirAuth : anim.surgir, { animationDelay: `${atraso}ms` } as ViewStyle, style]}>{children}</View>
  );
}

function SurgirNativo({ children, ordem = 0, style, auth = false }: PropsSurgir) {
  const { theme } = useTheme();
  const reduzir = useMenosMovimento();
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animacao = Animated.timing(v, {
      toValue: 1,
      duration: reduzir ? 0 : auth ? theme.motion.auth.duracao : theme.motion.entrada,
      delay: reduzir ? 0 : ordem * (auth ? theme.motion.auth.passo : theme.motion.passo),
      easing: theme.motion.easeOutExpo,
      useNativeDriver: true,
    });
    animacao.start();
    return () => animacao.stop();
  }, [reduzir]); // eslint-disable-line react-hooks/exhaustive-deps

  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [auth ? theme.motion.auth.deslocamento : 12, 0] });
  return <Animated.View style={[{ opacity: v, transform: [{ translateY }] }, style]}>{children}</Animated.View>;
}

export const Surgir = NATIVO ? SurgirNativo : SurgirWeb;

/** Área de conteúdo centralizada com largura máxima e respiro lateral. */
export function Container({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const desktop = useDesktopLayout();
  return (
    <View style={[{ width: '100%', maxWidth: CONTEUDO_MAX, alignSelf: 'center', paddingHorizontal: desktop ? 32 : 16 }, style]}>
      {children}
    </View>
  );
}

/**
 * Casca das telas de conteúdo: rolagem, respiro do topo (área segura no celular), teclado que não cobre campo e, nas
 * telas empilhadas, o botão de voltar. O respiro de baixo é pequeno porque a barra de abas já fica fora da rolagem.
 */
export function Tela({
  children,
  voltar,
  refreshControl,
}: {
  children: React.ReactNode;
  voltar?: () => void;
  refreshControl?: React.ReactElement<RefreshControlProps>;
}) {
  const { theme } = useTheme();
  const desktop = useDesktopLayout();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: desktop ? 32 : insets.top + 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
      >
        <Container>
          {voltar ? <Button variant="ghost" size="sm" icon="ion:arrow-back" label="Voltar" onPress={voltar} style={styles.voltar} /> : null}
          {children}
        </Container>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Ícone clicável com alvo de 44 px sem aumentar o desenho: a margem negativa devolve o espaço ao layout. */
export function BotaoIcone({
  icone,
  rotulo,
  onPress,
  cor,
  tamanho = 16,
  style,
}: {
  icone: string;
  rotulo: string;
  onPress: () => void;
  cor?: string;
  tamanho?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();
  const alvo = useAlvo();
  const folga = -(alvo - tamanho - 8) / 2;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      style={({ pressed }) => [
        { width: alvo, height: alvo, margin: folga, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 },
        style,
      ]}
    >
      <Icon name={icone} size={tamanho} color={cor ?? theme.colors.textMuted} />
    </Pressable>
  );
}

/** Cartão: borda fina + sombra; com onPress ganha elevação no hover e escala ao pressionar. */
export function Cartao({
  children,
  onPress,
  style,
  padding = 20,
  elevado = false,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padding?: number;
  /** Raio 16 e sombra longa (cartão de login/verificação, como no Valerium). */
  elevado?: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const base: ViewStyle = {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: elevado ? theme.radius.lg : theme.radius.md,
    padding,
    boxShadow: elevado
      ? `0 24px 70px -40px ${c.shadowMedium}, 0 1px 3px ${c.shadowLight}`
      : `0 1px 3px ${c.shadowLight}, 0 0 0 1px ${c.shadowLight}`,
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={(estado) => {
        const { hovered, pressed } = estado as { hovered?: boolean; pressed: boolean };
        return [
          base,
          hovered && { borderColor: c.borderStrong, boxShadow: `0 6px 20px ${c.shadowMedium}, 0 0 0 1px ${c.shadowLight}` },
          pressed && { transform: [{ scale: theme.motion.pressScale }] },
          style,
        ];
      }}
    >
      {children}
    </Pressable>
  );
}

/** Rótulo de seção em caixa-alta espaçada (ex.: "SEU IMPACTO"). */
export function RotuloSecao({ children, style }: { children: string; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  return (
    <View style={[{ marginTop: 32, marginBottom: 12 }, style]}>
      <Text style={[theme.typography.micro, { color: theme.colors.textSubtle, textTransform: 'uppercase' }]}>
        {children}
      </Text>
    </View>
  );
}

/** Título de página (Geist leve) + subtítulo; `direita` para ações. */
export function TituloPagina({ titulo, sub, direita }: { titulo: string; sub?: string; direita?: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={styles.tituloLinha}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[theme.typography.h1, { color: theme.colors.text }]} numberOfLines={2}>
          {titulo}
        </Text>
        {sub ? <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginTop: 4 }]}>{sub}</Text> : null}
      </View>
      {direita}
    </View>
  );
}

type Tom = 'neutro' | 'marca' | 'ok' | 'alerta' | 'erro';

export function Selo({ children, tom = 'neutro', ponto }: { children: string; tom?: Tom; ponto?: boolean }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const cor = { neutro: c.textMuted, marca: c.accent, ok: c.success, alerta: c.warning, erro: c.danger }[tom];
  return (
    <View style={[styles.selo, { borderColor: c.border, backgroundColor: tom === 'marca' ? c.accentSoft : c.surfaceAlt }]}>
      {ponto ? <View style={[styles.seloPonto, { backgroundColor: cor }]} /> : null}
      <Text style={[theme.typography.captionMd, { color: cor, fontSize: 12 }]}>{children}</Text>
    </View>
  );
}

/** Indicador numérico: ícone em círculo suave, valor em Geist Mono, rótulo. */
export function Kpi({
  icone,
  valor,
  rotulo,
  destaque,
  ordem = 0,
}: {
  icone: string;
  valor: string;
  rotulo: string;
  destaque?: boolean;
  ordem?: number;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const desktop = useDesktopLayout();
  return (
    <Surgir ordem={ordem} style={styles.kpiCelula}>
      <Cartao style={{ flex: 1 }} padding={desktop ? 20 : 16}>
        <View style={[styles.kpiIcone, { backgroundColor: destaque ? c.accentSoft : c.surfaceAlt }]}>
          <Icon name={icone} size={18} color={destaque ? c.accent : c.textMuted} />
        </View>
        <Text style={[theme.typography.num, { color: destaque ? c.success : c.text, marginTop: 16 }, !desktop && { fontSize: 24, lineHeight: 28 }]} numberOfLines={1}>
          {valor}
        </Text>
        <Text style={[theme.typography.caption, { color: c.textMuted, marginTop: 4 }]}>{rotulo}</Text>
      </Cartao>
    </Surgir>
  );
}

/** Grade responsiva de KPIs: 2 colunas no celular, até 4 na web larga. */
export function GradeKpi({ children }: { children: React.ReactNode }) {
  return <View style={styles.grade}>{children}</View>;
}

/** Controle segmentado com indicador deslizante. */
export function Segmentado<T extends string>({
  opcoes,
  valor,
  onChange,
}: {
  opcoes: { valor: T; rotulo: string; icone?: string; desabilitado?: boolean }[];
  valor: T;
  onChange: (v: T) => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const alvo = useAlvo();
  const [largura, setLargura] = useState(0);
  const idx = Math.max(0, opcoes.findIndex((o) => o.valor === valor));
  const pos = useRef(new Animated.Value(idx)).current;

  useEffect(() => {
    Animated.timing(pos, {
      toValue: idx,
      duration: theme.motion.medio,
      easing: theme.motion.easeOutExpo,
      useNativeDriver: NATIVO,
    }).start();
  }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps

  const passo = largura / opcoes.length;
  return (
    <View
      accessibilityRole="tablist"
      onLayout={(e: LayoutChangeEvent) => setLargura(e.nativeEvent.layout.width - 8)}
      style={[styles.seg, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}
    >
      {largura > 0 ? (
        <Animated.View
          style={[
            styles.segIndicador,
            {
              width: passo,
              backgroundColor: c.surface,
              boxShadow: `0 1px 3px ${c.shadowMedium}`,
              transform: [{ translateX: Animated.multiply(pos, passo) }],
            },
          ]}
        />
      ) : null}
      {opcoes.map((o) => {
        const ativo = o.valor === valor;
        return (
          <Pressable
            key={o.valor}
            accessibilityRole="tab"
            aria-selected={ativo}
            aria-disabled={!!o.desabilitado}
            disabled={o.desabilitado}
            onPress={() => onChange(o.valor)}
            style={[styles.segOpcao, { minHeight: alvo, opacity: o.desabilitado ? 0.4 : 1 }]}
          >
            {o.icone ? <Icon name={o.icone} size={15} color={ativo ? c.accent : c.textMuted} /> : null}
            <Text numberOfLines={1} style={[theme.typography.captionMd, { color: ativo ? c.text : c.textMuted }]}>{o.rotulo}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Placeholder de carregamento com brilho deslizante (CSS na web: não toma quadro do resto da tela). */
export function Skeleton({ altura = 16, largura = '100%', raio = 8 }: { altura?: number; largura?: number | `${number}%`; raio?: number }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const reduzir = useMenosMovimento();
  const x = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);

  useEffect(() => {
    if (reduzir || !NATIVO) return;
    const loop = Animated.loop(
      Animated.timing(x, { toValue: 1, duration: 1400, easing: theme.motion.easeOutExpo, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduzir]); // eslint-disable-line react-hooks/exhaustive-deps

  const brilho = <LinearGradient colors={['transparent', c.surfaceAlt, 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />;
  return (
    <View
      onLayout={NATIVO ? (e) => setW(e.nativeEvent.layout.width) : undefined}
      style={{ height: altura, width: largura, borderRadius: raio, backgroundColor: c.surfaceMuted, overflow: 'hidden' }}
    >
      {reduzir ? null : !NATIVO ? (
        <View style={[StyleSheet.absoluteFill, anim.brilho]}>{brilho}</View>
      ) : w > 0 ? (
        <Animated.View style={{ ...StyleSheet.absoluteFillObject, width: w, transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-w, w] }) }] }}>
          {brilho}
        </Animated.View>
      ) : null}
    </View>
  );
}

/** Faixa com o gradiente da logo (assinatura visual). */
export function FaixaMarca({ altura = 3, style }: { altura?: number; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  return (
    <LinearGradient
      colors={theme.colors.gradient}
      start={{ x: 0, y: 0.5 }}
      end={{ x: 1, y: 0.5 }}
      style={[{ height: altura, borderRadius: altura }, style]}
    />
  );
}

// Estilos só da web (keyframes em CSS). No nativo o Animated cobre e estes nunca são usados.
const anim = StyleSheet.create({
  surgir: {
    animationKeyframes: { from: { opacity: 0, transform: 'translateY(12px)' }, to: { opacity: 1, transform: 'translateY(0px)' } },
    animationDuration: '320ms',
    animationTimingFunction: EASE_WEB,
    animationFillMode: 'backwards',
  },
  surgirAuth: {
    animationKeyframes: { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'translateY(0px)' } },
    animationDuration: '480ms',
    animationTimingFunction: EASE_WEB,
    animationFillMode: 'backwards',
  },
  brilho: {
    animationKeyframes: { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(100%)' } },
    animationDuration: '1400ms',
    animationTimingFunction: EASE_WEB,
    animationIterationCount: 'infinite',
  },
} as never) as unknown as Record<'surgir' | 'surgirAuth' | 'brilho', ViewStyle>;

const styles = StyleSheet.create({
  tituloLinha: { flexDirection: 'row', alignItems: 'flex-end', gap: 16, marginTop: 8 },
  selo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  seloPonto: { width: 6, height: 6, borderRadius: 3 },
  grade: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  kpiCelula: { flexGrow: 1, flexBasis: 160, padding: 6, minWidth: 150 },
  kpiIcone: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  seg: { flexDirection: 'row', borderRadius: 10, borderWidth: 1, padding: 3, position: 'relative' },
  segIndicador: { position: 'absolute', top: 3, bottom: 3, left: 4, borderRadius: 8 },
  segOpcao: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  // ghost tem 12 de respiro lateral: puxa para o ícone alinhar com o título.
  voltar: { marginLeft: -12, marginBottom: 8 },
});
