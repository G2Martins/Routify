import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Alert, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useDesktopLayout } from '../lib/responsive';
import { supabase, RouteHistoryRow } from '../lib/supabase';
import { enviarEvento } from '../lib/api';
import Icon from '../components/Icon';
import Button from '../components/Button';
import Input from '../components/Input';
import { Cartao, Container, GradeKpi, Kpi, RotuloSecao, Selo, Skeleton, Surgir, TituloPagina } from '../components/ui';

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const hora = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const min = (seg: number) => Math.round(seg / 60);
const km = (v: number) => Number(v).toFixed(1).replace('.', ',');

/** "Hoje", "Ontem" ou "Segunda, 21 de set". */
function rotuloDia(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return 'Hoje';
  if (d.toDateString() === ontem.toDateString()) return 'Ontem';
  const ano = d.getFullYear() !== hoje.getFullYear() ? ` de ${d.getFullYear()}` : '';
  return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}${ano}`;
}

/** Agrupa por dia mantendo a ordem (a lista já vem do mais novo ao mais antigo). */
function agruparPorDia(items: RouteHistoryRow[]): { dia: string; rotas: RouteHistoryRow[] }[] {
  const grupos: { dia: string; rotas: RouteHistoryRow[] }[] = [];
  for (const r of items) {
    const dia = rotuloDia(r.created_at);
    if (grupos[grupos.length - 1]?.dia === dia) grupos[grupos.length - 1].rotas.push(r);
    else grupos.push({ dia, rotas: [r] });
  }
  return grupos;
}

export default function HistoryScreen({ navigation }: any) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { user } = useAuth();
  const desktop = useDesktopLayout();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<RouteHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const carregou = useRef(false);

  // Coleta do tempo real da viagem — é a verdade terrestre que permite
  // comparar a predição da LIA com o que de fato aconteceu. Sem isso o TCC 2
  // não consegue validar a tese (ver supabase/migrations/20260907000000_thesis_validation.sql).
  const [rotaEmFeedback, setRotaEmFeedback] = useState<RouteHistoryRow | null>(null);
  const [minutosReais, setMinutosReais] = useState('');
  const [erroFeedback, setErroFeedback] = useState<string | null>(null);
  const [salvandoFeedback, setSalvandoFeedback] = useState(false);

  const abrirFeedback = (rota: RouteHistoryRow) => {
    setRotaEmFeedback(rota);
    setErroFeedback(null);
    // Pré-preenche com o previsto: o usuário costuma ajustar, não digitar do zero.
    setMinutosReais(String(min(rota.tempo_total_seg)));
  };

  const fecharFeedback = () => {
    setRotaEmFeedback(null);
    setMinutosReais('');
    setErroFeedback(null);
  };

  const salvarTempoReal = async () => {
    if (!rotaEmFeedback || salvandoFeedback) return;

    const minutos = Number(String(minutosReais).replace(',', '.'));
    if (!Number.isFinite(minutos) || minutos <= 0 || minutos > 600) {
      setErroFeedback('Informe um tempo entre 1 e 600 minutos.');
      return;
    }

    setSalvandoFeedback(true);
    const { error } = await supabase
      .from('route_history')
      .update({
        tempo_real_seg: Math.round(minutos * 60),
        feedback_em: new Date().toISOString(),
      })
      .eq('id', rotaEmFeedback.id);
    setSalvandoFeedback(false);

    if (error) {
      setErroFeedback('Não foi possível salvar. Tente de novo.');
      return;
    }
    enviarEvento('feedback', { minutos_reais: Math.round(minutos) });

    setItems((prev) =>
      prev.map((r) =>
        r.id === rotaEmFeedback.id
          ? { ...r, tempo_real_seg: Math.round(minutos * 60), feedback_em: new Date().toISOString() }
          : r
      )
    );
    fecharFeedback();
  };

  const fetchHistory = useCallback(async () => {
    if (!user?.id) return;
    const { data, error } = await supabase
      .from('route_history')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (!error) setItems((data || []) as RouteHistoryRow[]);
  }, [user?.id]);

  // Refresh ao focar a aba. Skeleton só na primeira carga (sem piscar a lista ao voltar).
  useFocusEffect(
    useCallback(() => {
      if (!carregou.current) setLoading(true);
      fetchHistory().finally(() => {
        carregou.current = true;
        setLoading(false);
      });
    }, [fetchHistory])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchHistory();
    setRefreshing(false);
  };

  const handleDelete = (id: string) => {
    const doDelete = async () => {
      const { error } = await supabase.from('route_history').delete().eq('id', id);
      if (!error) setItems((prev) => prev.filter((x) => x.id !== id));
    };

    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (typeof window !== 'undefined' && window.confirm('Excluir esta rota do histórico?')) {
        doDelete();
      }
    } else {
      Alert.alert('Excluir rota', 'Confirma exclusão?', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Excluir', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  // ------------------------------------------------------------ resumo
  const total = items.length;
  const tempoMedio = total ? min(items.reduce((s, r) => s + r.tempo_total_seg, 0) / total) : 0;
  const comComparacao = items.filter((r) => typeof r.rotas_diferentes === 'boolean');
  const pctDiferente = comComparacao.length
    ? Math.round((comComparacao.filter((r) => r.rotas_diferentes).length / comComparacao.length) * 100)
    : null;

  const celula = { width: desktop ? ('50%' as const) : ('100%' as const), padding: 6 };

  const renderCartao = (item: RouteHistoryRow, ordem: number) => {
    const deltaSeg = item.tempo_rota_curta_seg != null ? item.tempo_rota_curta_seg - item.tempo_total_seg : null;
    const emFeedback = rotaEmFeedback?.id === item.id;
    return (
      <Surgir key={item.id} ordem={Math.min(ordem, 8)} style={celula}>
        <Cartao padding={16} style={{ flex: 1 }}>
          <View style={styles.topo}>
            <Text style={[theme.typography.caption, { color: c.textSubtle, fontFamily: theme.fonts.mono }]}>{hora(item.created_at)}</Text>
            {item.rotas_diferentes ? <Selo tom="marca" ponto>LIA escolheu outra rota</Selo> : null}
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={() => handleDelete(item.id)}
              accessibilityRole="button"
              accessibilityLabel="Excluir rota do histórico"
              hitSlop={6}
              style={({ pressed }) => [styles.excluir, { borderRadius: theme.radius.sm, opacity: pressed ? 0.6 : 1 }]}
            >
              <Icon name="ion:trash-outline" size={16} color={c.textSubtle} />
            </Pressable>
          </View>

          {/* origem (anel) → destino (pin) */}
          <View style={styles.trajeto}>
            <View style={styles.trilho}>
              <View style={[styles.origem, { borderColor: c.accent, backgroundColor: c.surface }]} />
              <View style={[styles.linha, { backgroundColor: c.border }]} />
              <Icon name="ion:location" size={16} color={c.accent} />
            </View>
            <View style={styles.enderecos}>
              <Text style={[theme.typography.bodyMd, { color: c.text }]} numberOfLines={1}>
                {item.origem_label}
              </Text>
              <Text style={[theme.typography.bodyMd, { color: c.text }]} numberOfLines={1}>
                {item.destino_label}
              </Text>
            </View>
          </View>

          <View style={[styles.metricas, { borderTopColor: c.border }]}>
            <View style={styles.metrica}>
              <Icon name="ion:time-outline" size={14} color={c.textMuted} />
              <Text style={[styles.num, { color: c.text, fontFamily: theme.fonts.monoBold }]}>{min(item.tempo_total_seg)} min</Text>
            </View>
            <View style={styles.metrica}>
              <Icon name="ion:navigate-outline" size={14} color={c.textMuted} />
              <Text style={[styles.num, { color: c.text, fontFamily: theme.fonts.mono }]}>{km(item.distancia_km)} km</Text>
            </View>
            {deltaSeg != null && min(deltaSeg) >= 1 ? (
              <View style={styles.metrica}>
                <Icon name="ion:flash-outline" size={14} color={c.success} />
                <Text style={[styles.num, { color: c.success, fontFamily: theme.fonts.mono }]}>−{min(deltaSeg)} min</Text>
                <Text style={[theme.typography.caption, { color: c.textMuted }]}>vs. mais curta</Text>
              </View>
            ) : null}
            <View style={{ flex: 1 }} />
            <Text style={[theme.typography.micro, { color: c.textSubtle, fontFamily: theme.fonts.mono }]}>
              {(item.modelo_versao || 'lia').toUpperCase()}
            </Text>
          </View>

          {/* Predição × realidade. Sem tempo real, oferece o campo que o coleta. */}
          {item.tempo_real_seg != null ? (
            (() => {
              const erroSeg = item.tempo_real_seg - item.tempo_total_seg;
              const erroMin = Math.abs(min(erroSeg));
              const acertou = Math.abs(erroSeg) <= 120; // dentro de 2 min
              return (
                <View style={[styles.resumo, { backgroundColor: c.surfaceAlt, borderRadius: theme.radius.sm }]}>
                  <Text style={[theme.typography.caption, { color: c.textMuted }]}>
                    Real <Text style={{ color: c.text, fontFamily: theme.fonts.mono }}>{min(item.tempo_real_seg)} min</Text>
                  </Text>
                  <Text style={[theme.typography.captionMd, { color: acertou ? c.success : c.textMuted, fontFamily: theme.fonts.mono }]}>
                    {erroMin === 0 ? 'previsão exata' : `${erroSeg > 0 ? '+' : '−'}${erroMin} min vs. previsto`}
                  </Text>
                </View>
              );
            })()
          ) : emFeedback ? (
            <View style={[styles.feedback, { borderTopColor: c.border }]}>
              <Text style={[theme.typography.captionMd, { color: c.text }]}>Quanto demorou de verdade?</Text>
              <Text style={[theme.typography.caption, { color: c.textMuted, marginTop: 2, marginBottom: 10 }]}>
                A LIA previu {min(item.tempo_total_seg)} min. O tempo real mede a precisão do modelo.
              </Text>
              <View style={styles.feedbackLinha}>
                <View style={{ flex: 1, minWidth: 120 }}>
                  <Input
                    value={minutosReais}
                    onChangeText={setMinutosReais}
                    keyboardType="number-pad"
                    selectTextOnFocus
                    autoFocus
                    accessibilityLabel="Tempo real em minutos"
                    placeholder="0"
                    maxLength={4}
                    onSubmitEditing={salvarTempoReal}
                    error={erroFeedback}
                    right={<Text style={[theme.typography.caption, { color: c.textMuted }]}>min</Text>}
                    style={{ fontFamily: theme.fonts.monoBold }}
                  />
                </View>
                <Button label="Salvar" loading={salvandoFeedback} onPress={salvarTempoReal} style={{ height: 44 }} />
                <Button label="Agora não" variant="ghost" onPress={fecharFeedback} style={{ height: 44 }} />
              </View>
            </View>
          ) : (
            <Button
              label="Informar tempo real"
              variant="secondary"
              size="sm"
              icon="ion:time-outline"
              fullWidth
              onPress={() => abrirFeedback(item)}
              style={{ marginTop: 12 }}
            />
          )}
        </Cartao>
      </Surgir>
    );
  };

  let ordem = 0;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ paddingTop: desktop ? 32 : insets.top + 16, paddingBottom: 100 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />}
      keyboardShouldPersistTaps="handled"
    >
      <Container>
        <Surgir>
          <TituloPagina titulo="Histórico" sub="Rotas que a LIA calculou para você." />
        </Surgir>

        {loading ? (
          <View style={[styles.grade, { marginTop: 24 }]}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={celula}>
                <Cartao padding={16}>
                  <Skeleton altura={12} largura={60} />
                  <View style={{ height: 16 }} />
                  <Skeleton altura={16} largura="80%" />
                  <View style={{ height: 10 }} />
                  <Skeleton altura={16} largura="65%" />
                  <View style={{ height: 20 }} />
                  <Skeleton altura={34} />
                </Cartao>
              </View>
            ))}
          </View>
        ) : total === 0 ? (
          <Surgir ordem={1} style={{ marginTop: 24 }}>
            <Cartao padding={32} style={{ alignItems: 'center' }}>
              <View style={[styles.vazioIcone, { backgroundColor: c.accentSoft }]}>
                <Icon name="ion:time-outline" size={26} color={c.accent} />
              </View>
              <Text style={[theme.typography.h4, { color: c.text, marginTop: 16 }]}>Nenhuma rota ainda</Text>
              <Text style={[theme.typography.body, { color: c.textMuted, marginTop: 4, textAlign: 'center' }]}>
                Calcule uma rota no mapa e ela aparece aqui, com a previsão da LIA.
              </Text>
              <Button label="Ir para o mapa" icon="ion:map-outline" onPress={() => navigation?.navigate('Mapa')} style={{ marginTop: 20, alignSelf: 'center' }} />
            </Cartao>
          </Surgir>
        ) : (
          <>
            <View style={{ marginTop: 24 }}>
              <GradeKpi>
                <Kpi icone="ion:navigate-outline" valor={String(total)} rotulo={total === 1 ? 'Rota calculada' : 'Rotas calculadas'} ordem={1} />
                <Kpi icone="ion:time-outline" valor={`${tempoMedio} min`} rotulo="Tempo médio previsto" ordem={2} />
                <Kpi
                  icone="ion:analytics-outline"
                  valor={pctDiferente == null ? '—' : `${pctDiferente}%`}
                  rotulo="Vezes em que a LIA escolheu outra rota"
                  destaque={pctDiferente != null}
                  ordem={3}
                />
              </GradeKpi>
            </View>

            {agruparPorDia(items).map((g) => (
              <View key={g.dia}>
                <RotuloSecao>{g.dia}</RotuloSecao>
                <View style={styles.grade}>{g.rotas.map((r) => renderCartao(r, ordem++))}</View>
              </View>
            ))}
          </>
        )}
      </Container>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grade: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  topo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  excluir: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  trajeto: { flexDirection: 'row', gap: 12, marginTop: 10 },
  trilho: { alignItems: 'center', paddingTop: 5, width: 16 },
  origem: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  linha: { width: 2, flex: 1, minHeight: 10, marginVertical: 3, borderRadius: 1 },
  enderecos: { flex: 1, minWidth: 0, gap: 8 },
  metricas: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginTop: 14, paddingTop: 12, borderTopWidth: 1 },
  metrica: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  num: { fontSize: 13, lineHeight: 18, fontVariant: ['tabular-nums'] },
  resumo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingVertical: 8, paddingHorizontal: 12 },
  feedback: { marginTop: 12, paddingTop: 12, borderTopWidth: 1 },
  feedbackLinha: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' },
  vazioIcone: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
