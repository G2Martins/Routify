import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, Text } from 'react-native';
import { useTheme } from '../context/ThemeContext';

export type LIAStatus = 'idle' | 'thinking' | 'done';

interface Props {
  status: LIAStatus;
  version?: string;
  rmse?: number;
}

export default function LIAIndicator({ status, version = 'LIA 1.0', rmse }: Props) {
  const { theme } = useTheme();
  const c = theme.colors;
  const ring1 = useRef(new Animated.Value(1)).current;
  const ring2 = useRef(new Animated.Value(1)).current;
  const ring3 = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const doneFlash = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    // Para animação anterior
    if (animRef.current) {
      animRef.current.stop();
    }

    if (status === 'idle') {
      ring1.setValue(1);
      ring2.setValue(1);
      ring3.setValue(1);
      opacity.setValue(1);
      doneFlash.setValue(0);
      return;
    }

    if (status === 'thinking') {
      // Três anéis em pulso sequencial — ondas sonoras
      const pulse = (anim: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(anim, {
              toValue: 1.4,
              duration: 600,
              useNativeDriver: true,
            }),
            Animated.timing(anim, {
              toValue: 1,
              duration: 600,
              useNativeDriver: true,
            }),
          ]),
        );

      animRef.current = Animated.parallel([
        pulse(ring1, 0),
        pulse(ring2, 200),
        pulse(ring3, 400),
      ]);
      animRef.current.start();
      return;
    }

    if (status === 'done') {
      ring1.setValue(1);
      ring2.setValue(1);
      ring3.setValue(1);
      // Flash verde rápido
      animRef.current = Animated.sequence([
        Animated.timing(doneFlash, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(doneFlash, { toValue: 0, duration: 800, useNativeDriver: true }),
      ]);
      animRef.current.start();
    }
  }, [status]);

  const ringColor = status === 'done' ? c.success : c.accent;
  const coreColor = status === 'done' ? c.success : c.accent;

  const doneOverlayColor = doneFlash.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(6,193,103,0)', 'rgba(6,193,103,0.3)'],
  });

  return (
    <View style={styles.container}>
      {/* Anéis pulsantes */}
      <View style={styles.ringsContainer}>
        <Animated.View
          style={[styles.ring, styles.ring3, { transform: [{ scale: ring3 }], borderColor: ringColor, opacity: 0.2 }]}
        />
        <Animated.View
          style={[styles.ring, styles.ring2, { transform: [{ scale: ring2 }], borderColor: ringColor, opacity: 0.35 }]}
        />
        <Animated.View
          style={[styles.ring, styles.ring1, { transform: [{ scale: ring1 }], borderColor: ringColor, opacity: 0.6 }]}
        />
        {/* Núcleo */}
        <View style={[styles.core, { backgroundColor: coreColor }]} />
        {/* Flash verde "done" */}
        <Animated.View style={[styles.doneOverlay, { backgroundColor: doneOverlayColor }]} />
      </View>

      {/* Label */}
      <View style={styles.label}>
        <Text style={[styles.versionText, { color: c.accent }]}>{version}</Text>
        {status === 'thinking' && (
          <Text style={[styles.statusText, { color: c.textMuted }]}>Calculando...</Text>
        )}
        {status === 'done' && (
          <Text style={[styles.statusText, { color: c.success }]}>Rota otimizada</Text>
        )}
        {status === 'idle' && rmse !== undefined && (
          <Text style={[styles.rmseText, { color: c.textSubtle }]}>RMSE ±{rmse}s</Text>
        )}
      </View>
    </View>
  );
}

const CORE_SIZE = 16;
const RING1 = 28;
const RING2 = 40;
const RING3 = 52;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ringsContainer: {
    width: RING3,
    height: RING3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderWidth: 1.5,
    borderRadius: 999,
  },
  ring1: { width: RING1, height: RING1 },
  ring2: { width: RING2, height: RING2 },
  ring3: { width: RING3, height: RING3 },
  core: {
    width: CORE_SIZE,
    height: CORE_SIZE,
    borderRadius: CORE_SIZE / 2,
  },
  doneOverlay: {
    position: 'absolute',
    width: RING3,
    height: RING3,
    borderRadius: RING3 / 2,
  },
  label: {
    flexShrink: 1,
  },
  versionText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  statusText: {
    fontSize: 11,
    marginTop: 1,
  },
  rmseText: {
    fontSize: 10,
    marginTop: 1,
    opacity: 0.7,
  },
});
