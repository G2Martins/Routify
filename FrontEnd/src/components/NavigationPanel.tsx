/**
 * NavigationPanel — exibido após LIA encontrar a rota.
 * Mostra resumo (tempo, distância, via) + botão "Iniciar" + carro animado.
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import Icon from './Icon';
import Button from './Button';

interface RouteSummary {
  tempo_total_seg: number;
  distancia_km: number;
  via_principal: string;
  modelo_utilizado: string;
}

interface Props {
  route: RouteSummary;
  navigating: boolean;
  onStart: () => void;
  onCancel: () => void;
}

export default function NavigationPanel({ route, navigating, onStart, onCancel }: Props) {
  const { theme } = useTheme();
  const c = theme.colors;

  // Animação do carro: oscila X e levemente rotação
  const carX = useRef(new Animated.Value(0)).current;
  const carRot = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!navigating) {
      // Idle — pulsação leve
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ])
      ).start();
      return;
    }

    // Em navegação — carro andando
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(carX, { toValue: 12, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(carX, { toValue: 0, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ]),
        Animated.sequence([
          Animated.timing(carRot, { toValue: 1, duration: 700, useNativeDriver: true }),
          Animated.timing(carRot, { toValue: 0, duration: 700, useNativeDriver: true }),
        ]),
      ])
    ).start();
  }, [navigating]);

  const carRotInterp = carRot.interpolate({
    inputRange: [0, 1],
    outputRange: ['-2deg', '2deg'],
  });
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });

  const minutos = Math.round(route.tempo_total_seg / 60);
  const km = route.distancia_km.toFixed(1);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: c.surface,
          shadowColor: '#000',
        },
      ]}
    >
      {/* Header com carro animado */}
      <View style={styles.header}>
        <View style={styles.carBadge}>
          {/* Aura pulsante */}
          {!navigating ? (
            <Animated.View
              style={[
                styles.pulseRing,
                {
                  backgroundColor: c.accent,
                  transform: [{ scale: pulseScale }],
                  opacity: pulseOpacity,
                },
              ]}
            />
          ) : null}
          <Animated.View
            style={{
              transform: [
                { translateX: navigating ? carX : 0 },
                { rotate: navigating ? carRotInterp : '0deg' },
              ],
            }}
          >
            <View
              style={[
                styles.carCircle,
                { backgroundColor: navigating ? c.success : c.inverse },
              ]}
            >
              <Icon
                name={navigating ? 'mdi:car-sports' : 'mdi:car'}
                size={28}
                color={navigating ? '#000' : c.onInverse}
              />
            </View>
          </Animated.View>
        </View>

        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={{ color: c.textMuted, fontSize: 12, fontWeight: '500', letterSpacing: 0.5 }}>
            {navigating ? 'EM NAVEGAÇÃO' : 'LIA ENCONTROU A ROTA'}
          </Text>
          <Text style={{ color: c.text, fontSize: 22, fontWeight: '700', marginTop: 2 }}>
            {minutos} min
            <Text style={{ color: c.textSubtle, fontSize: 16, fontWeight: '400' }}>
              {'  '}· {km} km
            </Text>
          </Text>
          <Text
            style={{ color: c.textMuted, fontSize: 13, marginTop: 2 }}
            numberOfLines={1}
          >
            via {route.via_principal}
          </Text>
        </View>
      </View>

      {/* Footer: ações */}
      <View style={styles.footer}>
        <Pressable
          onPress={onCancel}
          style={({ pressed }) => [
            styles.cancelBtn,
            {
              backgroundColor: c.surfaceAlt,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Icon name="ion:close" size={20} color={c.text} />
        </Pressable>

        {navigating ? (
          <Button
            label="Encerrar viagem"
            variant="primary"
            icon="ion:flag-outline"
            onPress={onCancel}
            style={{ flex: 1, marginLeft: 12 }}
          />
        ) : (
          <Button
            label="Iniciar navegação"
            variant="primary"
            icon="ion:navigate"
            onPress={onStart}
            style={{ flex: 1, marginLeft: 12 }}
          />
        )}
      </View>

      <View style={[styles.modelTag, { backgroundColor: c.surfaceMuted }]}>
        <Icon name="ion:flash-outline" size={11} color={c.accent} />
        <Text style={{ color: c.textMuted, fontSize: 11, marginLeft: 4 }}>
          {route.modelo_utilizado.replace('_', ' ').toUpperCase()}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: 18,
    ...Platform.select({
      web: { boxShadow: '0 -8px 24px rgba(0,0,0,0.16)' as any },
      default: {
        shadowOpacity: 0.16,
        shadowOffset: { width: 0, height: -4 },
        shadowRadius: 16,
        elevation: 12,
      },
    }),
  },
  header: { flexDirection: 'row', alignItems: 'center' },
  carBadge: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  carCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
  },
  cancelBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelTag: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
