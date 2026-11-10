/**
 * Trânsito agora: a previsão da LIA para este instante nos pontos monitorados (GET /trafego/agora; a API atualiza a cada
 * minuto e não chama a TomTom). Mapa com os pontos coloridos pelo nível (web vetorial; sem WebGL ou no celular nativo,
 * só a lista), faixa com a proporção livre/moderado/lento/parado e as vias mais lentas.
 *
 * Tocar num ponto (ou numa linha da lista) abre o detalhe: painel lateral no desktop, folha de baixo no celular.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// @ts-ignore: import por plataforma (MapComponent.web.tsx / .native.tsx), como no MapScreen
import MapComponent from '../components/MapComponent';
import BotaoRadares from '../components/BotaoRadares';
import Button from '../components/Button';
import DetalhePonto from '../components/DetalhePonto';
import Icon from '../components/Icon';
import { Cartao, Container, Selo, Skeleton, Surgir, TituloPagina } from '../components/ui';
import { trafficColors } from '../constants/Theme';
import { useTheme } from '../context/ThemeContext';
import { API_URL } from '../lib/api';
import { useAlvo, useDesktopLayout } from '../lib/responsive';
import { agruparPorNome, idadeLeitura, NIVEIS, Ponto, RespostaAgora, ROTULO_NIVEL } from '../lib/trafego';

const INTERVALO_MS = 60_000;
const WEB = Platform.OS === 'web';
const hora = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
/** Quanto do mapa fica à vista acima da folha de detalhe, no celular. */
const MAPA_VISIVEL = 180;

export default function TransitoScreen() {
  const { theme, mapStyle } = useTheme();
  const c = theme.colors;
  const desktop = useDesktopLayout();
  const insets = useSafeAreaInsets();
  const { height: alturaJanela } = useWindowDimensions();
  const alvo = useAlvo();
  const mapaRef = useRef<{ showTrafficPoints?: (p: Ponto[] | null) => void; selecionarPonto?: (id: number | null) => void; destacarPontos?: (ids: number[] | null) => void; mostrarRadares?: never } | null>(null);
  const [dados, setDados] = useState<RespostaAgora | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState<number | null>(null);
  const [grupo, setGrupo] = useState<string | null>(null);

  const [moderado, lento, parado] = trafficColors[mapStyle === 'street' || theme.mode === 'light' ? 'light' : 'dark'];
  const cor = [c.success, moderado, lento, parado];

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/trafego/agora`, { signal: AbortSignal.timeout(15000) });
      if (r.status === 429) throw new Error('Muitas atualizações seguidas. Aguarde um minuto.');
      if (!r.ok) throw new Error('Não foi possível ler o trânsito agora.');
      const j: RespostaAgora = await r.json();
      setDados(j);
      setErro(null);
      mapaRef.current?.showTrafficPoints?.(j.pontos);
    } catch (e) {
      // Só as mensagens lançadas acima; rede/timeout do navegador viriam em inglês ("Failed to fetch").
      setErro(e instanceof Error && e.name === 'Error' ? e.message : 'Sem conexão com o servidor.');
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

  // Esc fecha o detalhe (web).
  useEffect(() => {
    if (!WEB || aberto == null) return;
    const aoTeclar = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(null);
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aberto]);

  const alturaMapa = Math.max(alturaJanela * 0.36, 220);
  const margem = useMemo(() => {
    if (desktop) return { top: 40, left: 40, right: 72, bottom: 40 };
    // Com a folha aberta, a câmera leva o ponto para o pedaço do mapa que continua à vista.
    return { top: 24, left: 24, right: 72, bottom: aberto != null ? Math.max(24, alturaMapa - MAPA_VISIVEL + 24) : 24 };
  }, [desktop, aberto, alturaMapa]);

  useEffect(() => {
    mapaRef.current?.selecionarPonto?.(aberto);
  }, [aberto, margem]);

  const total = dados ? NIVEIS.reduce((s, n) => s + (dados.resumo[n] ?? 0), 0) : 0;
  const lentas = agruparPorNome((dados?.pontos ?? []).filter((p) => p.nivel >= 1)).slice(0, 12);
  const temMedicao = (dados?.pontos ?? []).some((p) => p.fonte === 'medicao');
  const escolherGrupo = (nome: string, ids: number[]) => {
    const novo = grupo === nome ? null : nome;
    setGrupo(novo);
    mapaRef.current?.destacarPontos?.(novo ? ids : null);
  };
  const pontoAberto = aberto == null ? undefined : dados?.pontos.find((p) => p.id === aberto);

  const painel = (
    <Container style={{ paddingTop: desktop ? 32 : 16 }}>
      <TituloPagina titulo="Trânsito agora" sub={WEB ? 'Escolha um ponto no mapa para ver o histórico.' : 'Previsão para agora nos pontos monitorados do DF.'} />

      {carregando && !dados ? <EsqueletoPainel /> : null}
      {erro ? (
        <View style={{ marginTop: 16 }}>
          <Cartao>
            <Text accessibilityRole="alert" style={[theme.typography.body, { color: c.danger }]}>{erro}</Text>
            <Button label="Tentar de novo" variant="secondary" size="sm" onPress={carregar} style={{ marginTop: 10 }} />
          </Cartao>
        </View>
      ) : null}

      {dados && total ? (
        <Surgir ordem={1} style={{ marginTop: 16 }}>
          <Cartao>
            <View style={styles.cabecalho}>
              <Text style={[theme.typography.h4, { color: c.text }]}>{`${total} pontos`}</Text>
              <Text style={[theme.typography.caption, { color: c.textMuted }]}>{`às ${hora.format(new Date(dados.atualizado_em))}`}</Text>
            </View>
            {/* Faixa: proporção de pontos em cada nível (com texto ao lado; nunca só cor). */}
            <View style={[styles.faixa, { backgroundColor: c.surfaceAlt }]} accessibilityLabel={NIVEIS.map((n) => `${ROTULO_NIVEL[n]} ${dados.resumo[n]}`).join(', ')}>
              {NIVEIS.map((n, i) => (dados.resumo[n] ? <View key={n} style={{ flex: dados.resumo[n], backgroundColor: cor[i] }} /> : null))}
            </View>
            <View style={styles.legenda}>
              {NIVEIS.map((n, i) => (
                <View key={n} style={styles.legendaItem}>
                  <View style={[styles.bolinha, { backgroundColor: cor[i] }]} />
                  <Text style={[theme.typography.caption, { color: c.textMuted }]}>{`${ROTULO_NIVEL[n]} ${dados.resumo[n] ?? 0}`}</Text>
                </View>
              ))}
            </View>
            {temMedicao ? (
              <Text style={[theme.typography.caption, { color: c.textMuted, marginTop: 10 }]}>
                Pontos só com contorno são de coleta nova: mostram a última medição. A LIA passa a prever neles no próximo treino.
              </Text>
            ) : null}
          </Cartao>
        </Surgir>
      ) : null}

      {dados ? (
        <Surgir ordem={2} style={{ marginTop: 16 }}>
          <Cartao padding={0}>
            <Text style={[theme.typography.eyebrow, { color: c.textMuted, padding: 16, paddingBottom: 8 }]}>Mais lentas agora</Text>
            {lentas.length ? (
              lentas.map((g) => {
                const varios = g.pontos.length > 1;
                const expandido = grupo === g.nome;
                const pct = Math.round(g.razao * 100);
                return (
                  <View key={g.nome}>
                    <Pressable
                      onPress={() => (varios ? escolherGrupo(g.nome, g.pontos.map((p) => p.id)) : setAberto(g.pontos[0].id))}
                      accessibilityRole="button"
                      accessibilityState={varios ? { expanded: expandido } : undefined}
                      accessibilityLabel={`${g.nome}: ${ROTULO_NIVEL[NIVEIS[g.nivel]]}, ${varios ? `${g.pontos.length} pontos, média de ` : ''}${pct}% da velocidade livre. ${varios ? 'Mostrar os pontos no mapa' : 'Ver detalhes'}`}
                      style={(estado) => {
                        const { hovered } = estado as { hovered?: boolean };
                        return [styles.linha, { minHeight: alvo, borderTopColor: c.border }, (hovered || expandido) && { backgroundColor: c.surfaceAlt }];
                      }}
                    >
                      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                        <View style={styles.linhaTopo}>
                          <Text numberOfLines={2} style={[theme.typography.bodyMd, { color: c.text, flex: 1 }]}>{g.nome}</Text>
                          <Selo tom={g.nivel >= 3 ? 'erro' : 'alerta'} ponto>{ROTULO_NIVEL[NIVEIS[g.nivel]]}</Selo>
                        </View>
                        {/* Barra: velocidade prevista como % da livre (média dos pontos da via). */}
                        <View style={[styles.barra, { backgroundColor: c.surfaceAlt }]}>
                          <View style={{ width: `${pct}%`, height: '100%', borderRadius: 3, backgroundColor: cor[g.nivel] }} />
                        </View>
                        <Text style={[theme.typography.caption, { color: c.textMuted }]}>
                          {varios ? `${g.pontos.length} pontos nesta via · média de ${pct}% da velocidade livre` : `${pct}% da velocidade livre`}
                        </Text>
                      </View>
                      <Icon name={varios ? (expandido ? 'ion:chevron-up' : 'ion:chevron-down') : 'ion:chevron-forward'} size={16} color={c.textSubtle} />
                    </Pressable>
                    {expandido
                      ? g.pontos.map((p, i) => (
                          <Pressable
                            key={p.id}
                            onPress={() => setAberto(p.id)}
                            accessibilityRole="button"
                            accessibilityLabel={`Ponto ${i + 1} de ${g.nome}: ${Math.round(p.razao * 100)}% da velocidade livre. Ver detalhes`}
                            style={(estado) => {
                              const { hovered } = estado as { hovered?: boolean };
                              return [styles.subLinha, { minHeight: alvo, borderTopColor: c.border }, hovered && { backgroundColor: c.surfaceAlt }];
                            }}
                          >
                            <View style={[styles.bolinha, { backgroundColor: cor[p.nivel] }]} />
                            <Text style={[theme.typography.body, { color: c.text, flex: 1 }]}>{`Ponto ${i + 1} · ${Math.round(p.razao * 100)}%`}</Text>
                            <Text style={[theme.typography.caption, { color: c.textMuted }]}>{p.fonte === 'medicao' ? 'medição' : idadeLeitura(p.leitura_ha_min)}</Text>
                            <Icon name="ion:chevron-forward" size={16} color={c.textSubtle} />
                          </Pressable>
                        ))
                      : null}
                  </View>
                );
              })
            ) : (
              <Text style={[theme.typography.body, { color: c.textMuted, paddingHorizontal: 16, paddingBottom: 16 }]}>Todos os pontos estão livres agora.</Text>
            )}
          </Cartao>
        </Surgir>
      ) : null}
    </Container>
  );

  const mapa = WEB ? (
    <>
      <MapComponent ref={mapaRef as never} margem={margem} onPontoPress={setAberto} />
      <View style={[styles.controlesMapa, { top: desktop ? 16 : insets.top + 12 }]}>
        <BotaoRadares mapa={mapaRef as never} />
      </View>
    </>
  ) : null;

  const detalhe = aberto != null ? <DetalhePonto id={aberto} ponto={pontoAberto} onFechar={() => setAberto(null)} /> : null;

  if (desktop) {
    return (
      <View style={[styles.lado, { backgroundColor: c.background }]}>
        <View style={styles.mapaLado}>{mapa}</View>
        <ScrollView style={styles.painelLado} contentContainerStyle={{ paddingBottom: 32 }}>
          {detalhe ? <View style={styles.detalheLado}>{detalhe}</View> : painel}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {WEB ? <View style={{ height: alturaMapa + insets.top }}>{mapa}</View> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: WEB ? 0 : insets.top, paddingBottom: 32 }}>
        {painel}
      </ScrollView>
      {detalhe ? (
        <View style={[styles.folhaEnvelope, { top: WEB ? insets.top + MAPA_VISIVEL : insets.top + 16 }]} pointerEvents="box-none">
          <Surgir style={[styles.folha, { backgroundColor: c.surface, borderColor: c.border, boxShadow: `0 -10px 30px ${c.shadowMedium}` }]}>
            <View style={[styles.alca, { backgroundColor: c.borderStrong }]} />
            <ScrollView contentContainerStyle={styles.folhaConteudo}>{detalhe}</ScrollView>
          </Surgir>
        </View>
      ) : null}
    </View>
  );
}

function EsqueletoPainel() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Carregando o trânsito" style={{ marginTop: 16, gap: 16 }}>
      <Cartao>
        <Skeleton altura={18} largura="40%" />
        <View style={{ height: 14 }} />
        <Skeleton altura={10} raio={5} />
        <View style={{ height: 12 }} />
        <Skeleton altura={14} largura="80%" />
      </Cartao>
      <Cartao>
        <Skeleton altura={12} largura="35%" />
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{ marginTop: 16, gap: 6 }}>
            <Skeleton altura={16} largura="70%" />
            <Skeleton altura={6} raio={3} />
          </View>
        ))}
      </Cartao>
    </View>
  );
}

const styles = StyleSheet.create({
  lado: { flex: 1, flexDirection: 'row' },
  mapaLado: { flex: 1.3 },
  painelLado: { flex: 1, maxWidth: 520 },
  detalheLado: { padding: 24 },
  controlesMapa: { position: 'absolute', right: 12, zIndex: 20, gap: 8 },
  cabecalho: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  faixa: { flexDirection: 'row', gap: 2, height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 14 },
  legenda: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4, marginTop: 12 },
  legendaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bolinha: { width: 8, height: 8, borderRadius: 4 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  linhaTopo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  subLinha: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 28, paddingRight: 16, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  barra: { height: 6, borderRadius: 3, overflow: 'hidden' },
  folhaEnvelope: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 40, alignItems: 'center' },
  folha: { flex: 1, width: '100%', maxWidth: 600, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1, borderBottomWidth: 0 },
  alca: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginTop: 8 },
  folhaConteudo: { padding: 16, paddingBottom: 32 },
});
