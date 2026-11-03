/**
 * Trânsito agora: a previsão da LIA para este instante nos pontos monitorados (GET /trafego/agora; a API atualiza a
 * cada minuto e não chama a TomTom). Mapa com os pontos coloridos pelo nível (web vetorial; sem WebGL ou no celular,
 * só a lista), a faixa com a proporção livre/moderado/lento/parado e as vias mais lentas.
 */
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
// @ts-ignore — import por plataforma (MapComponent.web.tsx / .native.tsx), como no MapScreen
import MapComponent from '../components/MapComponent';
import { Cartao, Container, Selo, Surgir, TituloPagina } from '../components/ui';
import { trafficColors } from '../constants/Theme';
import { useTheme } from '../context/ThemeContext';
import { API_URL } from '../lib/api';
import { useDesktopLayout } from '../lib/responsive';

type Ponto = { id: number; lat: number; lon: number; nome: string | null; razao: number; nivel: number; leitura_ha_min: number | null };
type Resposta = { atualizado_em: string; pontos: Ponto[]; resumo: Record<'livre' | 'moderado' | 'lento' | 'parado', number> };

const INTERVALO_MS = 60_000;
const NIVEIS = ['livre', 'moderado', 'lento', 'parado'] as const;
const ROTULO: Record<(typeof NIVEIS)[number], string> = { livre: 'Livre', moderado: 'Moderado', lento: 'Lento', parado: 'Parado' };
const hora = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

export default function TransitoScreen() {
  const { theme, mapStyle } = useTheme();
  const c = theme.colors;
  const desktop = useDesktopLayout();
  const mapaRef = useRef<{ showTrafficPoints?: (p: Ponto[] | null) => void } | null>(null);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const [moderado, lento, parado] = trafficColors[mapStyle === 'street' || theme.mode === 'light' ? 'light' : 'dark'];
  const cor = [c.success, moderado, lento, parado];

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/trafego/agora`, { signal: AbortSignal.timeout(15000) });
      if (r.status === 429) throw new Error('Muitas atualizações seguidas. Aguarde um minuto.');
      if (!r.ok) throw new Error('Não foi possível ler o trânsito agora.');
      const j: Resposta = await r.json();
      setDados(j);
      setErro(null);
      mapaRef.current?.showTrafficPoints?.(j.pontos);
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : 'Sem conexão com o servidor.');
    } finally {
      setCarregando(false);
    }
  }, []);

  // Atualiza ao abrir a tela e a cada minuto enquanto ela estiver aberta.
  useFocusEffect(
    useCallback(() => {
      carregar();
      const id = setInterval(carregar, INTERVALO_MS);
      return () => clearInterval(id);
    }, [carregar]),
  );

  const total = dados ? NIVEIS.reduce((s, n) => s + (dados.resumo[n] ?? 0), 0) : 0;
  const lentas = (dados?.pontos ?? []).filter((p) => p.nivel >= 1).slice(0, 12);

  const painel = (
    <Container>
      <TituloPagina titulo="Trânsito agora" sub="Previsão da LIA em cada ponto monitorado do DF, atualizada a cada minuto" />

      {carregando && !dados ? <ActivityIndicator color={c.accent} style={{ marginTop: 24 }} /> : null}
      {erro ? (
        <Cartao>
          <Text style={[theme.typography.body, { color: c.danger }]}>{erro}</Text>
          <Pressable onPress={carregar} accessibilityRole="button" style={{ marginTop: 10 }}>
            <Text style={[theme.typography.captionMd, { color: c.accent }]}>Tentar de novo</Text>
          </Pressable>
        </Cartao>
      ) : null}

      {dados && total ? (
        <Surgir ordem={1}>
          <Cartao>
            <View style={styles.cabecalho}>
              <Text style={[theme.typography.h4, { color: c.text }]}>{`${total} pontos`}</Text>
              <Text style={[theme.typography.caption, { color: c.textMuted }]}>{`às ${hora.format(new Date(dados.atualizado_em))}`}</Text>
            </View>
            {/* Faixa: proporção de pontos em cada nível (com texto ao lado; nunca só cor). */}
            <View style={[styles.faixa, { backgroundColor: c.surfaceAlt }]} accessibilityLabel={NIVEIS.map((n) => `${ROTULO[n]} ${dados.resumo[n]}`).join(', ')}>
              {NIVEIS.map((n, i) =>
                dados.resumo[n] ? <View key={n} style={{ flex: dados.resumo[n], backgroundColor: cor[i] }} /> : null,
              )}
            </View>
            <View style={styles.legenda}>
              {NIVEIS.map((n, i) => (
                <View key={n} style={styles.legendaItem}>
                  <View style={[styles.bolinha, { backgroundColor: cor[i] }]} />
                  <Text style={[theme.typography.caption, { color: c.textMuted }]}>{`${ROTULO[n]} ${dados.resumo[n] ?? 0}`}</Text>
                </View>
              ))}
            </View>
          </Cartao>
        </Surgir>
      ) : null}

      {dados ? (
        <Surgir ordem={2} style={{ marginTop: 16 }}>
          <Cartao>
            <Text style={[theme.typography.eyebrow, { color: c.textSubtle }]}>Mais lentas agora</Text>
            {lentas.length ? (
              lentas.map((p, i) => (
                <View key={p.id} style={[styles.linha, { borderTopColor: c.border }, i === 0 && { borderTopWidth: 0 }]}>
                  <Text style={[styles.posicao, { color: c.textSubtle, fontFamily: theme.fonts.mono }]}>{String(i + 1).padStart(2, '0')}</Text>
                  <View style={{ flex: 1, gap: 6 }}>
                    <View style={styles.linhaTopo}>
                      <Text numberOfLines={1} style={[theme.typography.bodyMd ?? theme.typography.body, { color: c.text, flex: 1 }]}>
                        {p.nome ?? `Via monitorada ${p.id}`}
                      </Text>
                      <Selo tom={p.nivel >= 3 ? 'erro' : 'alerta'} ponto>{ROTULO[NIVEIS[p.nivel]]}</Selo>
                    </View>
                    {/* Barra: velocidade prevista como % da livre. */}
                    <View style={[styles.barra, { backgroundColor: c.surfaceAlt }]}>
                      <View style={{ width: `${Math.round(p.razao * 100)}%`, height: '100%', borderRadius: 3, backgroundColor: cor[p.nivel] }} />
                    </View>
                    <Text style={[theme.typography.caption, { color: c.textMuted }]}>
                      {`${Math.round(p.razao * 100)}% da velocidade livre · ${p.leitura_ha_min != null ? `leitura há ${p.leitura_ha_min} min` : 'sem leitura recente, perfil histórico'}`}
                    </Text>
                  </View>
                </View>
              ))
            ) : (
              <Text style={[theme.typography.body, { color: c.textMuted, marginTop: 10 }]}>
                Todos os pontos estão livres agora.
              </Text>
            )}
          </Cartao>
        </Surgir>
      ) : null}
    </Container>
  );

  const mapa = Platform.OS === 'web' ? (
    <View style={desktop ? styles.mapaLado : styles.mapaTopo}>
      <MapComponent ref={mapaRef as never} />
    </View>
  ) : null;

  return desktop ? (
    <View style={[styles.lado, { backgroundColor: c.background }]}>
      {mapa}
      <ScrollView style={styles.painelLado} contentContainerStyle={{ paddingBottom: 48 }}>{painel}</ScrollView>
    </View>
  ) : (
    <ScrollView style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={{ paddingBottom: 48 }}>
      {mapa}
      {painel}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  lado: { flex: 1, flexDirection: 'row' },
  mapaLado: { flex: 1.3 },
  painelLado: { flex: 1, maxWidth: 520 },
  mapaTopo: { height: 320 },
  cabecalho: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  faixa: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 14 },
  legenda: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12 },
  legendaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bolinha: { width: 8, height: 8, borderRadius: 4 },
  linha: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  posicao: { width: 22, fontSize: 13, paddingTop: 2 },
  linhaTopo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barra: { height: 6, borderRadius: 3, overflow: 'hidden' },
});
