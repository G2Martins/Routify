import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import LIAIndicator from '../components/LIAIndicator';
import Icon from '../components/Icon';

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((globalThis as any).__DEV__ ? 'http://localhost:8000' : 'https://routify-api.railway.app');

interface Metrics {
  modelo_ativo: string;
  cv_rmse_seg: number;
  cv_mae_seg: number;
  n_pontos_monitorados: number;
  periodo_dados: string;
  total_amostras_treino: number;
  feature_importance?: Record<string, number>;
}

function formatDate(): string {
  const dias = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];
  const now = new Date();
  return `${dias[now.getDay()]}, ${now.getDate()} de ${meses[now.getMonth()]}`;
}

export default function DashboardScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { user, profile } = useAuth();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiOnline, setApiOnline] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/metrics`)
      .then((r) => r.json())
      .then((data: Metrics) => {
        setMetrics(data);
        setApiOnline(true);
      })
      .catch(() => setApiOnline(false))
      .finally(() => setLoading(false));
  }, []);

  const rmse = metrics?.cv_rmse_seg;
  const pontos = metrics?.n_pontos_monitorados ?? 0;
  const amostras = metrics?.total_amostras_treino ?? 0;
  const modelVersion = metrics?.modelo_ativo ?? 'lia_1.0';
  const nome = profile?.nome || (user?.email?.split('@')[0] ?? 'piloto');

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 20, paddingTop: 60, paddingBottom: 80 }}
    >
      <View style={styles.greeting}>
        <Text style={{ color: c.textMuted, fontSize: 13 }}>{formatDate()}</Text>
        <Text style={[styles.greetingName, { color: c.text }]}>Olá, {nome}</Text>
      </View>

      {/* Hero card LIA */}
      <View style={[styles.heroCard, { backgroundColor: c.inverse }]}>
        <View style={styles.heroHeader}>
          <View style={[styles.heroBadge, { backgroundColor: c.surfaceAlt }]}>
            <Icon name="ion:flash-outline" size={12} color={c.text} />
            <Text style={{ color: c.text, fontSize: 11, fontWeight: '700', marginLeft: 4 }}>
              {modelVersion.replace('_', ' ').toUpperCase()}
            </Text>
          </View>
          <View
            style={[
              styles.statusPill,
              { backgroundColor: apiOnline ? '#06C16722' : '#E1190022' },
            ]}
          >
            <View
              style={[
                styles.statusDot,
                { backgroundColor: apiOnline ? c.success : c.danger },
              ]}
            />
            <Text
              style={{
                color: apiOnline ? c.success : c.danger,
                fontSize: 11,
                fontWeight: '600',
                marginLeft: 6,
              }}
            >
              {apiOnline ? 'Online' : 'Offline'}
            </Text>
          </View>
        </View>

        <Text style={[styles.heroTitle, { color: c.onInverse }]}>
          {loading ? '—' : rmse !== undefined ? `±${rmse}s` : '—'}
        </Text>
        <Text style={{ color: c.onInverse, opacity: 0.6, fontSize: 13, marginTop: 2 }}>
          Erro médio de previsão (RMSE) · meta {'<'}120s
        </Text>

        {rmse !== undefined ? (
          <View style={styles.precisionBar}>
            <View style={[styles.precisionTrack, { backgroundColor: c.surfaceAlt + '40' }]} />
            <View
              style={[
                styles.precisionFill,
                {
                  backgroundColor: rmse < 120 ? c.success : c.warning,
                  width: `${Math.max(0, Math.min(100, ((180 - rmse) / 120) * 100)).toFixed(0)}%`,
                },
              ]}
            />
          </View>
        ) : null}
      </View>

      {/* Grid 2x1 */}
      <View style={styles.statsRow}>
        <StatCard
          icon="ion:git-network-outline"
          label="Pontos monitorados"
          value={loading ? '—' : pontos > 0 ? `${pontos}` : '—'}
          colorBg={c.surface}
          colorText={c.text}
          colorSub={c.textMuted}
        />
        <StatCard
          icon="ion:server-outline"
          label="Amostras treino"
          value={loading ? '—' : amostras > 0 ? `${(amostras / 1000).toFixed(0)}k` : '—'}
          colorBg={c.surface}
          colorText={c.text}
          colorSub={c.textMuted}
        />
      </View>

      {/* Engine card */}
      <Text style={[styles.sectionTitle, { color: c.textMuted }]}>MOTOR PREDITIVO</Text>
      <View style={[styles.engineCard, { backgroundColor: c.surface, borderColor: c.surfaceMuted }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <LIAIndicator status="idle" version={modelVersion.replace('_', ' ').toUpperCase()} rmse={rmse} />
        </View>
        <Text style={{ color: c.textMuted, fontSize: 13, lineHeight: 20, marginTop: 14 }}>
          {apiOnline
            ? `LIA ${modelVersion.replace('_', ' ').toUpperCase()} treinada com ${(amostras / 1000).toFixed(0)}k amostras de Brasília. Predição via XGBoost integrada ao algoritmo A*.`
            : 'API offline. Execute "uvicorn main:app --reload" em BackEnd/API para ativar o motor preditivo.'}
        </Text>

        {metrics?.periodo_dados ? (
          <View style={[styles.periodTag, { backgroundColor: c.surfaceMuted }]}>
            <Icon name="ion:time-outline" size={12} color={c.textMuted} />
            <Text style={{ color: c.textMuted, fontSize: 11, marginLeft: 5 }}>
              {metrics.periodo_dados.split(' → ').map((d) => d.slice(0, 10)).join(' → ')}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Loading state */}
      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={c.text} size="small" />
          <Text style={{ color: c.textMuted, marginLeft: 8 }}>Carregando métricas...</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

interface StatProps {
  icon: string;
  label: string;
  value: string;
  colorBg: string;
  colorText: string;
  colorSub: string;
}
function StatCard({ icon, label, value, colorBg, colorText, colorSub }: StatProps) {
  return (
    <View style={[styles.statCard, { backgroundColor: colorBg }]}>
      <Icon name={icon} size={20} color={colorText} />
      <Text style={{ color: colorText, fontSize: 26, fontWeight: '700', marginTop: 12 }}>{value}</Text>
      <Text style={{ color: colorSub, fontSize: 12, marginTop: 4 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  greeting: { marginBottom: 24 },
  greetingName: { fontSize: 28, fontWeight: '700', marginTop: 4, letterSpacing: -0.5 },
  heroCard: {
    borderRadius: 20,
    padding: 24,
    marginBottom: 14,
  },
  heroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  heroBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  heroTitle: { fontSize: 56, fontWeight: '700', letterSpacing: -2 },
  precisionBar: { marginTop: 18, height: 6 },
  precisionTrack: { ...StyleSheet.absoluteFillObject, borderRadius: 3 },
  precisionFill: { height: '100%', borderRadius: 3 },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  statCard: {
    flex: 1,
    padding: 18,
    borderRadius: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  engineCard: { borderRadius: 16, padding: 20, borderWidth: 1 },
  periodTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
  },
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 20 },
});
