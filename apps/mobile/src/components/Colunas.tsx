/**
 * Gráfico de colunas em View puro (sem biblioteca), com uma coluna escolhida. Toque, clique, arrasto ou setas do teclado
 * trocam a escolha, e quem usa mostra o valor dela numa linha de leitura: número em toda coluna seria só ruído.
 *
 * As colunas são estreitas (24 px num celular com 12 saídas), então o alvo de toque é o gráfico inteiro: tocar ou arrastar
 * em qualquer altura escolhe a coluna daquela posição. Quem precisa de precisão tem as setas de quem usa o gráfico.
 */
import React, { useRef } from 'react';
import { Platform, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';

export interface Coluna {
  chave: string;
  valor: number | null; // altura total; null = sem dado (só o traço da base)
  base?: number; // parte de baixo, mais apagada (Planejar: o tempo que o trajeto leva sem trânsito)
  rotuloTopo?: string; // valor escrito em cima: só para a escolhida e a de destaque
  a11y: string;
}

interface Props {
  colunas: Coluna[];
  max: number;
  selecionada: number;
  destaque?: number; // coluna a marcar além da escolhida (Planejar: a melhor saída)
  onSelecionar: (i: number) => void;
  rotulo: string;
  altura?: number;
  /** Rótulos do eixo: um a cada `marcaCada` colunas. */
  marcaCada?: number;
  marca: (i: number) => string;
  /** Mouse parado em cima já mostra o valor (Trânsito). No Planejar a pintura do mapa só muda com clique. */
  seguirMouse?: boolean;
}

const WEB = Platform.OS === 'web';

export default function Colunas({ colunas, max, selecionada, destaque, onSelecionar, rotulo, altura = 112, marcaCada = 1, marca, seguirMouse }: Props) {
  const { theme } = useTheme();
  const c = theme.colors;
  const n = colunas.length;
  const caixa = useRef<View>(null);
  const atual = useRef(selecionada);
  atual.current = selecionada;
  const janela = useRef({ x: 0, w: 1 });

  const escolher = (i: number) => {
    if (i !== atual.current && i >= 0 && i < n) onSelecionar(i);
  };
  const porX = (pageX: number) => Math.max(0, Math.min(n - 1, Math.floor(((pageX - janela.current.x) / janela.current.w) * n)));

  const interacao = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: { nativeEvent: { pageX: number } }) => {
      const { pageX } = e.nativeEvent; // o evento não sobrevive até o measure
      caixa.current?.measureInWindow((x, _y, w) => {
        janela.current = { x, w: w || 1 };
        escolher(porX(pageX));
      });
    },
    onResponderMove: (e: { nativeEvent: { pageX: number } }) => escolher(porX(e.nativeEvent.pageX)),
  };
  const web = WEB
    ? {
        tabIndex: 0,
        role: 'radiogroup',
        'aria-label': rotulo,
        onKeyDown: (e: { key: string; preventDefault: () => void }) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            escolher(atual.current + (e.key === 'ArrowRight' ? 1 : -1));
          }
        },
        onMouseMove: seguirMouse
          ? (e: { pageX: number; currentTarget: { getBoundingClientRect: () => { left: number; width: number } } }) => {
              const r = e.currentTarget.getBoundingClientRect();
              janela.current = { x: r.left, w: r.width || 1 };
              escolher(porX(e.pageX));
            }
          : undefined,
      }
    : { accessibilityRole: 'radiogroup' as const, accessibilityLabel: rotulo };

  return (
    <View>
      <View
        ref={caixa}
        testID="grafico-colunas"
        {...interacao}
        {...(web as object)}
        // Na web o arrasto vertical continua rolando a tela; o horizontal fica com o gráfico.
        style={[styles.area, { height: altura, borderBottomColor: c.borderStrong }, WEB ? ({ touchAction: 'pan-y', cursor: 'pointer', userSelect: 'none' } as ViewStyle) : null]}
      >
        {colunas.map((col, i) => {
          const escolhida = i === selecionada;
          const marcada = i === destaque;
          const cor = escolhida ? c.accent : marcada ? c.teal : c.textSubtle;
          const altoTotal = col.valor == null ? 0 : Math.max(2, (col.valor / (max || 1)) * (altura - 18));
          const altoBase = col.base != null && col.valor != null ? Math.min(altoTotal, (col.base / (max || 1)) * (altura - 18)) : 0;
          const altoTopo = altoTotal - altoBase;
          return (
            <View
              key={col.chave}
              accessible
              accessibilityRole="radio"
              aria-checked={escolhida}
              accessibilityLabel={col.a11y}
              // Leitor de tela na web: ativar o item vira clique aqui.
              {...(WEB ? ({ onClick: () => escolher(i) } as object) : { onAccessibilityTap: () => escolher(i) })}
              style={styles.fenda}
            >
              {col.rotuloTopo ? (
                <Text style={[styles.topo, { color: c.text, fontFamily: theme.fonts.monoBold }]}>{col.rotuloTopo}</Text>
              ) : null}
              {altoTopo > 0 ? <View style={[styles.marca, { height: altoTopo, backgroundColor: cor }]} /> : null}
              {altoBase > 0 ? (
                <View style={[styles.marcaBase, { height: altoBase, marginTop: altoTopo > 0 ? 2 : 0, backgroundColor: escolhida ? c.accentSoft : c.surfaceMuted }]} />
              ) : null}
            </View>
          );
        })}
      </View>
      <View style={styles.eixo}>
        {colunas.map((col, i) => (
          <View key={col.chave} style={styles.fendaEixo}>
            {i % marcaCada === 0 ? (
              <Text style={[styles.marcaEixo, { color: i === selecionada ? c.text : c.textMuted, fontFamily: theme.fonts.mono }]}>{marca(i)}</Text>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  area: { flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 1, gap: 2 },
  // A coluna não enche a fenda: o que sobra da largura é respiro. Ponta redonda em cima, reta na base.
  fenda: { flex: 1, minWidth: 0, height: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  marca: { width: '100%', maxWidth: 24, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  marcaBase: { width: '100%', maxWidth: 24 },
  // Mais largo que a fenda de propósito: o rótulo não pode cortar, e só poucos aparecem.
  topo: { fontSize: 12, lineHeight: 16, marginBottom: 2, width: 44, flexShrink: 0, textAlign: 'center', fontVariant: ['tabular-nums'] },
  eixo: { flexDirection: 'row', gap: 2, marginTop: 6, height: 16 },
  fendaEixo: { flex: 1, minWidth: 0, alignItems: 'center', overflow: 'visible' },
  // Sem largura fixa: mede o próprio texto e transborda a fenda dos dois lados.
  marcaEixo: { fontSize: 11, lineHeight: 16, flexShrink: 0, textAlign: 'center', fontVariant: ['tabular-nums'], ...(WEB ? ({ whiteSpace: 'nowrap' } as object) : null) },
});
