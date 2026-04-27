import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
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
  const [items, setItems] = useState<RouteHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  useEffect(() => {
    fetchHistory().finally(() => setLoading(false));
  }, [fetchHistory]);

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
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: c.text }]}>Histórico</Text>
        <Text style={[styles.subtitle, { color: c.textMuted }]}>
          {items.length} {items.length === 1 ? 'rota otimizada' : 'rotas otimizadas'}
        </Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 20, paddingTop: 0, paddingBottom: 100 }}
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
        renderItem={({ item }) => (
          <View
            style={[
              styles.card,
              { backgroundColor: c.surface, borderColor: c.surfaceMuted },
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
