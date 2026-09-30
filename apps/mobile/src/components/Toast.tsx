/**
 * Notificações efêmeras (toasts): entram pela direita com ease-out-expo, uma barra
 * mostra o tempo restante e saem sozinhas. No máximo 3 na tela; menos movimento
 * (acessibilidade) desliga as animações. Uso: const avisar = useToast();
 * avisar({ titulo: 'Rota pronta', texto: '16 min', tom: 'ok' }).
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useMenosMovimento } from './ui';
import Icon from './Icon';

export type TomAviso = 'ok' | 'info' | 'alerta' | 'erro';
export interface Aviso {
  titulo: string;
  texto?: string;
  tom?: TomAviso;
  icone?: string;
  duracao?: number;
}
interface ItemAviso extends Aviso {
  id: number;
}

const NATIVO = Platform.OS !== 'web';
const ICONE: Record<TomAviso, string> = {
  ok: 'ion:checkmark-circle',
  info: 'ion:sparkles',
  alerta: 'ion:warning',
  erro: 'ion:close-circle',
};

const Contexto = createContext<(a: Aviso) => void>(() => {});
export const useToast = () => useContext(Contexto);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [itens, setItens] = useState<ItemAviso[]>([]);
  const seq = useRef(0);
  const mostrar = useCallback((a: Aviso) => {
    seq.current += 1;
    const id = seq.current;
    setItens((xs) => [...xs.slice(-2), { ...a, id }]);
  }, []);
  const fechar = useCallback((id: number) => setItens((xs) => xs.filter((x) => x.id !== id)), []);

  return (
    <Contexto.Provider value={mostrar}>
      {children}
      <View pointerEvents="box-none" style={[styles.pilha, POSICAO]}>
        {itens.map((a) => (
          <CartaoAviso key={a.id} aviso={a} onFechar={() => fechar(a.id)} />
        ))}
      </View>
    </Contexto.Provider>
  );
}

// Na web fica fixo na janela (não rola com a página).
const POSICAO = (Platform.OS === 'web' ? { position: 'fixed' } : { position: 'absolute' }) as unknown as ViewStyle;

function CartaoAviso({ aviso, onFechar }: { aviso: ItemAviso; onFechar: () => void }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const reduzir = useMenosMovimento();
  const entrada = useRef(new Animated.Value(0)).current;
  const restante = useRef(new Animated.Value(1)).current;
  const tom = aviso.tom ?? 'info';
  const cor = { ok: c.success, info: c.accent, alerta: c.warning, erro: c.danger }[tom];
  const duracao = aviso.duracao ?? 5000;

  const sair = useCallback(() => {
    Animated.timing(entrada, {
      toValue: 0,
      duration: reduzir ? 0 : theme.motion.medio,
      easing: theme.motion.easeOutExpo,
      useNativeDriver: NATIVO,
    }).start(onFechar);
  }, [reduzir]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    Animated.timing(entrada, {
      toValue: 1,
      duration: reduzir ? 0 : theme.motion.entrada,
      easing: theme.motion.easeOutExpo,
      useNativeDriver: NATIVO,
    }).start();
    const cronometro = Animated.timing(restante, { toValue: 0, duration: duracao, useNativeDriver: NATIVO });
    cronometro.start(({ finished }) => finished && sair());
    return () => cronometro.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.cartao,
        {
          backgroundColor: c.surface,
          borderColor: c.border,
          boxShadow: `0 14px 40px ${c.shadowMedium}, 0 0 0 1px ${c.shadowLight}`,
          opacity: entrada,
          transform: [{ translateX: entrada.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }],
        },
      ]}
    >
      <View style={[styles.faixa, { backgroundColor: cor }]} />
      <View style={[styles.icone, { backgroundColor: `${cor}1f` }]}>
        <Icon name={aviso.icone ?? ICONE[tom]} size={18} color={cor} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[theme.typography.bodyMd, { color: c.text, fontSize: 14, lineHeight: 19 }]}>{aviso.titulo}</Text>
        {aviso.texto ? (
          <Text style={[theme.typography.caption, { color: c.textMuted, fontSize: 12, marginTop: 1 }]}>{aviso.texto}</Text>
        ) : null}
      </View>
      <Pressable onPress={sair} accessibilityRole="button" accessibilityLabel="Fechar aviso" hitSlop={8} style={styles.fechar}>
        <Icon name="ion:close" size={16} color={c.textSubtle} />
      </Pressable>
      <Animated.View
        style={[
          styles.tempo,
          { backgroundColor: cor, transform: [{ scaleX: restante }], transformOrigin: 'left' } as ViewStyle,
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pilha: { top: 16, right: 16, left: 16, zIndex: 9999, alignItems: 'flex-end', gap: 10 },
  cartao: {
    width: '100%',
    maxWidth: 380,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 10,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  faixa: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  icone: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  fechar: { padding: 4, borderRadius: 6 },
  tempo: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, opacity: 0.55 },
});
