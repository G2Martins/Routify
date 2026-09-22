import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useDesktopLayout } from '../lib/responsive';
import { supabase, RouteHistoryRow } from '../lib/supabase';
import Icon from '../components/Icon';

function formatDate(iso: string): string {
  const d = new Date(iso);
  const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${dias[d.getDay()]}, ${d.getDate()} ${meses[d.getMonth()]} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function HistoryScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { user } = useAuth();
  const desktop = useDesktopLayout();
  const [items, setItems] = useState<RouteHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Coleta do tempo real da viagem — é a verdade terrestre que permite
  // comparar a predição da LIA com o que de fato aconteceu. Sem isso o TCC 2
  // não consegue validar a tese (ver BackEnd/sql/002_validacao_tese.sql).
  const [rotaEmFeedback, setRotaEmFeedback] = useState<RouteHistoryRow | null>(null);
  const [minutosReais, setMinutosReais] = useState('');
  const [salvandoFeedback, setSalvandoFeedback] = useState(false);

  const abrirFeedback = (rota: RouteHistoryRow) => {
    setRotaEmFeedback(rota);
    // Pré-preenche com o previsto: o usuário costuma ajustar, não digitar do zero.
    setMinutosReais(String(Math.round(rota.tempo_total_seg / 60)));
  };

  const salvarTempoReal = async () => {
    if (!rotaEmFeedback) return;

    const minutos = Number(String(minutosReais).replace(',', '.'));
    if (!Number.isFinite(minutos) || minutos <= 0 || minutos > 600) {
      const msg = 'Informe um tempo entre 1 e 600 minutos.';
      Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Valor inválido', msg);
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
      const msg = `Não foi possível salvar: ${error.message}`;
      Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Erro', msg);
      return;
    }

    setItems((prev) =>
      prev.map((r) =>
        r.id === rotaEmFeedback.id
          ? { ...r, tempo_real_seg: Math.round(minutos * 60), feedback_em: new Date().toISOString() }
          : r
      )
    );
    setRotaEmFeedback(null);
    setMinutosReais('');
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

  // Refresh ao focar tab Histórico (clique no tab → re-fetch).
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchHistory().finally(() => setLoading(false));
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

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.text} />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: c.background,
          maxWidth: desktop ? 1100 : undefined,
          width: '100%',
          alignSelf: 'center',
        },
      ]}
    >
      <View style={[styles.header, desktop ? { paddingTop: 32 } : null]}>
        <Text style={[styles.title, { color: c.text }]}>Histórico</Text>
        <Text style={[styles.subtitle, { color: c.textMuted }]}>
          {items.length} {items.length === 1 ? 'rota otimizada' : 'rotas otimizadas'}
        </Text>
      </View>

      <FlatList<RouteHistoryRow>
        data={items}
        key={desktop ? 'grid-2' : 'list-1'}
        numColumns={desktop ? 2 : 1}
        columnWrapperStyle={desktop ? { gap: 12 } : undefined}
        keyExtractor={(item: RouteHistoryRow) => item.id}
        contentContainerStyle={{ padding: desktop ? 32 : 20, paddingTop: 0, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.text} />}
        ListEmptyComponent={
          <View style={[styles.empty, { borderColor: c.surfaceMuted }]}>
            <Icon name="ion:time-outline" size={48} color={c.textSubtle} />
            <Text style={{ color: c.textMuted, marginTop: 12, fontSize: 15, fontWeight: '500' }}>
              Nenhuma rota ainda
            </Text>
            <Text style={{ color: c.textSubtle, marginTop: 4, fontSize: 13, textAlign: 'center' }}>
              Suas rotas otimizadas pela LIA aparecerão aqui.
            </Text>
          </View>
        }
        renderItem={({ item }: { item: RouteHistoryRow }) => (
          <View
            style={[
              styles.card,
              { backgroundColor: c.surface, borderColor: c.surfaceMuted },
              desktop ? { flex: 1 } : null,
            ]}
          >
            <View style={styles.cardHeader}>
              <View style={[styles.dot, { backgroundColor: c.success }]} />
              <Text style={[styles.cardLabel, { color: c.text }]} numberOfLines={1}>
                {item.origem_label}
              </Text>
            </View>
            <View style={[styles.dashLine, { backgroundColor: c.surfaceMuted }]} />
            <View style={styles.cardHeader}>
              <View style={[styles.dot, { backgroundColor: c.danger }]} />
              <Text style={[styles.cardLabel, { color: c.text }]} numberOfLines={1}>
                {item.destino_label}
              </Text>
            </View>

            <View style={[styles.metricsRow, { borderTopColor: c.surfaceMuted }]}>
              <View style={styles.metric}>
                <Icon name="ion:time-outline" size={14} color={c.textMuted} />
                <Text style={[styles.metricText, { color: c.text }]}>
                  {Math.round(item.tempo_total_seg / 60)} min
                </Text>
              </View>
              <View style={styles.metric}>
                <Icon name="ion:navigate-outline" size={14} color={c.textMuted} />
                <Text style={[styles.metricText, { color: c.text }]}>
                  {Number(item.distancia_km).toFixed(1)} km
                </Text>
              </View>
              <View style={styles.metric}>
                <Icon name="ion:flash-outline" size={14} color={c.accent} />
                <Text style={[styles.metricText, { color: c.accent }]}>
                  {(item.modelo_versao || 'lia').toUpperCase()}
                </Text>
              </View>
            </View>

            {/* Comparação predição × realidade. Enquanto o tempo real não é
                informado, oferece o botão que o coleta. */}
            {item.tempo_real_seg == null ? (
              <Pressable
                onPress={() => abrirFeedback(item)}
                style={[styles.feedbackBtn, { borderColor: c.accent }]}
              >
                <Icon name="ion:time-outline" size={14} color={c.accent} />
                <Text style={{ color: c.accent, fontSize: 13, fontWeight: '600' }}>
                  Quanto demorou de verdade?
                </Text>
              </Pressable>
            ) : (
              (() => {
                const erroSeg = item.tempo_real_seg - item.tempo_total_seg;
                const acertou = Math.abs(erroSeg) <= 120; // dentro de 2 min
                return (
                  <View style={[styles.feedbackResumo, { backgroundColor: c.surfaceMuted }]}>
                    <Text style={{ color: c.textMuted, fontSize: 12 }}>
                      Real: {Math.round(item.tempo_real_seg / 60)} min
                    </Text>
                    <Text
                      style={{
                        color: acertou ? c.success : c.textMuted,
                        fontSize: 12,
                        fontWeight: '600',
                      }}
                    >
                      {erroSeg === 0
                        ? 'previsão exata'
                        : `LIA errou ${erroSeg > 0 ? '−' : '+'}${Math.abs(Math.round(erroSeg / 60))} min`}
                    </Text>
                  </View>
                );
              })()
            )}

            <View style={styles.cardFooter}>
              <Text style={{ color: c.textSubtle, fontSize: 12 }}>
                {formatDate(item.created_at)}
              </Text>
              <Pressable onPress={() => handleDelete(item.id)} style={styles.deleteBtn}>
                <Icon name="ion:trash-outline" size={16} color={c.textSubtle} />
              </Pressable>
            </View>
          </View>
        )}
      />

      {/* Modal em vez de Alert.prompt: prompt só existe no iOS. */}
      <Modal
        visible={rotaEmFeedback !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRotaEmFeedback(null)}
      >
        <View style={styles.modalFundo}>
          <View style={[styles.modalCaixa, { backgroundColor: c.surface }]}>
            <Text style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>
              Quanto demorou?
            </Text>
            <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 6 }}>
              {rotaEmFeedback?.origem_label} → {rotaEmFeedback?.destino_label}
            </Text>
            <Text style={{ color: c.textSubtle, fontSize: 12, marginTop: 10 }}>
              A LIA previu {rotaEmFeedback ? Math.round(rotaEmFeedback.tempo_total_seg / 60) : 0} min.
              Informar o tempo real ajuda a medir a precisão do modelo.
            </Text>

            <View style={[styles.modalInputLinha, { borderColor: c.surfaceMuted }]}>
              <TextInput
                value={minutosReais}
                onChangeText={setMinutosReais}
                keyboardType="number-pad"
                selectTextOnFocus
                style={[styles.modalInput, { color: c.text }]}
                placeholder="0"
                placeholderTextColor={c.textSubtle}
              />
              <Text style={{ color: c.textMuted, fontSize: 15 }}>minutos</Text>
            </View>

            <View style={styles.modalBotoes}>
              <Pressable
                onPress={() => setRotaEmFeedback(null)}
                style={[styles.modalBtn, { borderColor: c.surfaceMuted }]}
              >
                <Text style={{ color: c.textMuted, fontWeight: '600' }}>Agora não</Text>
              </Pressable>
              <Pressable
                onPress={salvarTempoReal}
                disabled={salvandoFeedback}
                style={[
                  styles.modalBtn,
                  { backgroundColor: c.accent, borderColor: c.accent, opacity: salvandoFeedback ? 0.6 : 1 },
                ]}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>
                  {salvandoFeedback ? 'Salvando…' : 'Salvar'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  feedbackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 9,
    borderWidth: 1,
    borderRadius: 10,
    borderStyle: 'dashed',
  },
  feedbackResumo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  modalFundo: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCaixa: { width: '100%', maxWidth: 420, borderRadius: 18, padding: 22 },
  modalInputLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 12,
  },
  modalInput: { flex: 1, fontSize: 26, fontWeight: '700', padding: 0 },
  modalBotoes: { flexDirection: 'row', gap: 10, marginTop: 18 },
  modalBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 12,
  },
  header: { padding: 20, paddingTop: 60 },
  title: { fontSize: 32, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, marginTop: 4 },
  empty: {
    alignItems: 'center',
    padding: 40,
    borderWidth: 1,
    borderRadius: 16,
    borderStyle: 'dashed',
    marginTop: 40,
  },
  card: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  dashLine: { width: 2, height: 14, marginLeft: 4, marginVertical: 2 },
  cardLabel: { fontSize: 14, fontWeight: '500', flex: 1 },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 16,
  },
  metric: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metricText: { fontSize: 13, fontWeight: '600' },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  deleteBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
