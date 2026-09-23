/**
 * Indicador da LIA: ponto da marca com halo pulsando enquanto calcula,
 * verde de sucesso quando termina. Menos movimento = ponto estático.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useMenosMovimento } from './ui';

export type LIAStatus = 'idle' | 'thinking' | 'done';

interface Props {
  status: LIAStatus;
  version?: string;
  rmse?: number;
}

const NATIVO = Platform.OS !== 'web';

export default function LIAIndicator({ status, version = 'LIA', rmse }: Props) {
  const { theme } = useTheme();
  const c = theme.colors;
  const reduzir = useMenosMovimento();
  const pulso = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    pulso.setValue(0);
    if (status !== 'thinking' || reduzir) return;
    const loop = Animated.loop(
      Animated.timing(pulso, { toValue: 1, duration: 1400, easing: theme.motion.easeOutExpo, useNativeDriver: NATIVO })
    );
    loop.start();
    return () => loop.stop();
  }, [status, reduzir]); // eslint-disable-line react-hooks/exhaustive-deps

  const cor = status === 'done' ? c.success : c.accent;

  return (
    <View style={styles.container} accessibilityRole={status === 'thinking' ? 'progressbar' : undefined}>
      <View style={styles.marca}>
        <Animated.View
          style={[
            styles.halo,
            {
              backgroundColor: cor,
              opacity: pulso.interpolate({ inputRange: [0, 1], outputRange: [status === 'thinking' ? 0.35 : 0.18, 0] }),
              transform: [{ scale: pulso.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }],
            },
          ]}
        />
        <View style={[styles.nucleo, { backgroundColor: cor, borderColor: c.surface }]} />
      </View>

      <View style={styles.label}>
        <Text style={[theme.typography.captionMd, { color: c.text }]}>{version}</Text>
        {status === 'thinking' ? (
          <Text style={[theme.typography.caption, { color: c.textMuted, fontSize: 12 }]}>Calculando a rota…</Text>
        ) : null}
        {status === 'done' ? (
          <Text style={[theme.typography.caption, { color: c.success, fontSize: 12 }]}>Rota otimizada</Text>
        ) : null}
        {status === 'idle' && rmse !== undefined ? (
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: c.textSubtle, fontVariant: ['tabular-nums'] }}>
            RMSE ±{rmse}s
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  marca: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 14, height: 14, borderRadius: 7 },
  nucleo: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  label: { flexShrink: 1 },
});
