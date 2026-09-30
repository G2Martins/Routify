/**
 * Primitivas visuais (linguagem Valerium, paleta da logo). Telas montam com
 * estas peças em vez de estilizar do zero: mesmo raio, borda, sombra e motion.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../context/ThemeContext';
import { CONTEUDO_MAX } from '../constants/Theme';
import { useDesktopLayout } from '../lib/responsive';
import Icon from './Icon';

const NATIVO = Platform.OS !== 'web';

export function useMenosMovimento(): boolean {
  const [reduzir, setReduzir] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduzir).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduzir);
    return () => sub.remove();
  }, []);
  return reduzir;
}

/** Entrada: sobe 12 px e aparece, ease-out-expo. `ordem` escalona listas. */
export function Surgir({
  children,
  ordem = 0,
  style,
}: {
  children: React.ReactNode;
  ordem?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();
  const reduzir = useMenosMovimento();
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(v, {
      toValue: 1,
      duration: reduzir ? 0 : theme.motion.entrada,
      delay: reduzir ? 0 : ordem * theme.motion.passo,
      easing: theme.motion.easeOutExpo,
      useNativeDriver: NATIVO,
    });
    anim.start();
    return () => anim.stop();
  }, [reduzir]); // eslint-disable-line react-hooks/exhaustive-deps

  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  return <Animated.View style={[{ opacity: v, transform: [{ translateY }] }, style]}>{children}</Animated.View>;
}

/** Área de conteúdo centralizada com largura máxima e respiro lateral. */
export function Container({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const desktop = useDesktopLayout();
  return (
    <View style={[{ width: '100%', maxWidth: CONTEUDO_MAX, alignSelf: 'center', paddingHorizontal: desktop ? 32 : 16 }, style]}>
      {children}
    </View>
  );
}

/** Cartão: borda fina + sombra; com onPress ganha elevação no hover e escala ao pressionar. */
export function Cartao({
  children,
  onPress,
  style,
  padding = 20,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padding?: number;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const base: ViewStyle = {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: theme.radius.md,
    padding,
    boxShadow: `0 1px 3px ${c.shadowLight}, 0 0 0 1px ${c.shadowLight}`,
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

/** Título de página em Kalam + subtítulo; `direita` para ações. */
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
  return (
    <Surgir ordem={ordem} style={styles.kpiCelula}>
      <Cartao style={{ flex: 1 }}>
        <View style={[styles.kpiIcone, { backgroundColor: destaque ? c.accentSoft : c.surfaceAlt }]}>
          <Icon name={icone} size={18} color={destaque ? c.accent : c.textMuted} />
        </View>
        <Text style={[theme.typography.num, { color: destaque ? c.success : c.text, marginTop: 16 }]} numberOfLines={1}>
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
  opcoes: { valor: T; rotulo: string; icone?: string }[];
  valor: T;
  onChange: (v: T) => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
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
            accessibilityState={{ selected: ativo }}
            onPress={() => onChange(o.valor)}
            style={styles.segOpcao}
          >
            {o.icone ? <Icon name={o.icone} size={15} color={ativo ? c.accent : c.textMuted} /> : null}
            <Text style={[theme.typography.captionMd, { color: ativo ? c.text : c.textMuted }]}>{o.rotulo}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Placeholder de carregamento com brilho deslizante. */
export function Skeleton({ altura = 16, largura = '100%', raio = 8 }: { altura?: number; largura?: number | `${number}%`; raio?: number }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const reduzir = useMenosMovimento();
  const x = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);

  useEffect(() => {
    if (reduzir) return;
    const loop = Animated.loop(
      Animated.timing(x, { toValue: 1, duration: 1400, easing: theme.motion.easeOutExpo, useNativeDriver: NATIVO }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduzir]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{ height: altura, width: largura, borderRadius: raio, backgroundColor: c.surfaceMuted, overflow: 'hidden' }}
    >
      {w > 0 && !reduzir ? (
        <Animated.View
          style={{ ...StyleSheet.absoluteFillObject, width: w, transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-w, w] }) }] }}
        >
          <LinearGradient
            colors={['transparent', c.surfaceAlt, 'transparent']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
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
  segOpcao: { flex: 1, height: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
});
