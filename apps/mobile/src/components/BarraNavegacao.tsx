/**
 * Barra de progresso no topo ao trocar de aba (como o NavigationProgress do Valerium): aparece no clique, antes da tela
 * nova montar, e termina quando a navegação conclui. Anda por CSS (transform), no compositor: não para enquanto a tela nova
 * monta. Com menos movimento, a transição some (CSS global) e a barra só aparece e sai.
 *
 * ponytail: só na web. No nativo a troca de aba não remonta o mapa nem depende de bundle; adicionar se aparecer demora lá.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FaixaMarca } from './ui';

type Fase = 'parada' | 'andando' | 'fim';

let disparar: (() => void) | null = null;

/** Chamar no clique da navegação, antes de navegar. */
export const iniciarNavegacao = (): void => disparar?.();

const MINIMO_MS = 240; // abaixo disso a barra pisca e não se lê
const FIM_MS = 180;
const PRAZO_MS = 4000;

export default function BarraNavegacao({ assinar }: { assinar: (ouvinte: () => void) => () => void }) {
  const insets = useSafeAreaInsets();
  const [fase, setFase] = useState<Fase>('parada');
  const inicio = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const faseRef = useRef<Fase>('parada');
  faseRef.current = fase;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const limpar = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    const terminar = () => {
      limpar();
      setFase('fim');
      timers.current.push(setTimeout(() => setFase('parada'), FIM_MS));
    };
    const comecar = () => {
      limpar();
      inicio.current = performance.now();
      setFase('andando');
      timers.current.push(setTimeout(terminar, PRAZO_MS)); // navegação cancelada: não fica presa na tela
    };
    disparar = comecar;
    // Estado da navegação mudou: a tela nova já está na árvore. Espera ela pintar (dois quadros) para concluir.
    const desliga = assinar(() => {
      if (faseRef.current === 'parada') inicio.current = performance.now(), setFase('andando'); // tela empilhada: sem clique na barra
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const falta = MINIMO_MS - (performance.now() - inicio.current);
          limpar();
          timers.current.push(setTimeout(terminar, Math.max(0, falta)));
        })
      );
    });
    return () => {
      disparar = null;
      desliga();
      limpar();
    };
  }, [assinar]);

  if (Platform.OS !== 'web' || fase === 'parada') return null;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Abrindo a tela"
      pointerEvents="none"
      style={[
        styles.barra,
        { top: insets.top },
        fase === 'andando' ? styles.andando : styles.fim,
      ]}
    >
      <FaixaMarca altura={3} style={{ borderRadius: 0 }} />
    </View>
  );
}

// Só web (só renderiza lá). A entrada vem de 0 via keyframes; o fim é transition sobre o mesmo transform.
const styles = StyleSheet.create({
  barra: { position: 'fixed' as never, left: 0, right: 0, height: 3, zIndex: 10000, transformOrigin: 'left' } as ViewStyle,
  andando: {
    animationKeyframes: { from: { transform: 'scaleX(0.08)' }, to: { transform: 'scaleX(0.85)' } },
    animationDuration: '900ms',
    animationTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
    animationFillMode: 'both',
  } as ViewStyle,
  fim: {
    transform: 'scaleX(1)',
    animationKeyframes: { from: { transform: 'scaleX(0.85)', opacity: 1 }, to: { transform: 'scaleX(1)', opacity: 0 } },
    animationDuration: '180ms',
    animationFillMode: 'both',
  } as unknown as ViewStyle,
});
