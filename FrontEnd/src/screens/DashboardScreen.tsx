import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, ScrollView, Image, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/Colors';
import LIAIndicator from '../components/LIAIndicator';

const API_URL = __DEV__ ? 'http://localhost:8000' : 'https://routify-api.railway.app';

interface Metrics {
  modelo_ativo: string;
  cv_rmse_seg: number;
  cv_mae_seg: number;
  n_pontos_monitorados: number;
  periodo_dados: string;
  total_amostras_treino: number;
}

function formatDate(): string {
  const dias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const now = new Date();
  return `${dias[now.getDay()]}, ${now.getDate()} de ${meses[now.getMonth()]}`;
}

export default function DashboardScreen() {
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
      .catch(() => {
        setApiOnline(false);
      })
      .finally(() => setLoading(false));
  }, []);

  const rmse = metrics?.cv_rmse_seg;
  const pontos = metrics?.n_pontos_monitorados ?? 0;
  const amostras = metrics?.total_amostras_treino ?? 0;
  const modelVersion = metrics?.modelo_ativo ?? 'LIA 1.0';

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Cabeçalho */}
      <View style={styles.header}>
        <Image
          source={require('../../assets/Logo_Routify.png')}
          style={styles.mainLogo}
          resizeMode="contain"
        />
        <Text style={styles.dateText}>{formatDate()}</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Desempenho do Modelo</Text>

        {/* Grid de métricas reais */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Ionicons name="analytics-outline" size={32} color={Colors.primary} />
            {loading ? (
              <ActivityIndicator color={Colors.primary} size="small" style={{ marginTop: 8 }} />
            ) : (
              <Text style={styles.statValue}>
                {rmse !== undefined ? `±${rmse}s` : '—'}
              </Text>
            )}
            <Text style={styles.statLabel}>RMSE Predição</Text>
          </View>

          <View style={styles.statCard}>
            <Ionicons name="git-network-outline" size={32} color={Colors.danger} />
            {loading ? (
              <ActivityIndicator color={Colors.danger} size="small" style={{ marginTop: 8 }} />
            ) : (
              <Text style={styles.statValue}>{pontos > 0 ? pontos : '—'}</Text>
            )}
            <Text style={styles.statLabel}>Pontos Monitorados</Text>
          </View>

          <View style={styles.statCard}>
            <Ionicons name="server-outline" size={32} color={Colors.success} />
            {loading ? (
              <ActivityIndicator color={Colors.success} size="small" style={{ marginTop: 8 }} />
            ) : (
              <Text style={styles.statValue}>
                {amostras > 0 ? `${(amostras / 1000).toFixed(0)}k` : '—'}
              </Text>
            )}
            <Text style={styles.statLabel}>Amostras Treino</Text>
          </View>
        </View>

        {/* Card de Impacto da IA */}
        <Text style={styles.sectionTitle}>Inteligência Artificial</Text>
        <View style={styles.aiCard}>
          <View style={styles.aiHeader}>
            <LIAIndicator
              status={apiOnline ? 'idle' : 'idle'}
              version={modelVersion.replace('_', ' ').toUpperCase()}
              rmse={rmse}
            />
          </View>

          <View style={styles.aiStatusRow}>
            <View style={[styles.statusDot, { backgroundColor: apiOnline ? Colors.success : Colors.gray }]} />
            <Text style={[styles.aiSubtitle, { color: apiOnline ? Colors.success : Colors.gray }]}>
              {apiOnline ? 'API Online — Operando Ativamente' : 'API Offline — Inicie o servidor local'}
            </Text>
          </View>

          <Text style={styles.aiDescription}>
            {apiOnline
              ? `Modelo ${modelVersion.replace('_', ' ').toUpperCase()} treinado com ${(amostras / 1000).toFixed(0)}k amostras de Brasília. Predição de tempo de viagem via XGBoost integrada ao algoritmo A*.`
              : 'Execute "uvicorn main:app --reload" em BackEnd/API para ativar o motor preditivo.'}
          </Text>

          {/* Barra de precisão */}
          {rmse !== undefined && (
            <View style={styles.progressContainer}>
              <View style={styles.progressBarBackground}>
                {/* Precisão visual: RMSE < 60s = 100%, RMSE 120s = 50%, RMSE 180s = 0% */}
                <View style={[styles.progressBarFill,
                  { width: `${Math.max(0, Math.min(100, ((180 - rmse) / 120) * 100)).toFixed(0)}%` as any }]} />
              </View>
              <Text style={styles.progressText}>
                Precisão LIA: RMSE {rmse}s (meta: {'<'}120s)
              </Text>
            </View>
          )}

          {/* Período dos dados */}
          {metrics?.periodo_dados && (
            <Text style={styles.periodText}>
              Dados: {metrics.periodo_dados}
            </Text>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    backgroundColor: Colors.white,
    paddingVertical: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  mainLogo: { width: 250, height: 80, marginBottom: 10 },
  dateText: { color: Colors.gray, fontSize: 14, fontWeight: '500' },
  content: { padding: 20 },
  sectionTitle: {
    fontSize: 18, fontWeight: 'bold', color: Colors.text,
    marginBottom: 15, marginTop: 10,
  },
  statsGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 25 },
  statCard: {
    backgroundColor: Colors.white, width: '31%', padding: 15,
    borderRadius: 12, alignItems: 'center', elevation: 3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 3,
  },
  statValue: { fontSize: 18, fontWeight: 'bold', color: Colors.text, marginTop: 8, marginBottom: 4 },
  statLabel: { fontSize: 12, color: Colors.gray, textAlign: 'center' },
  aiCard: {
    backgroundColor: Colors.white, borderRadius: 16, padding: 20,
    elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 5,
    borderLeftWidth: 4, borderLeftColor: Colors.primary,
  },
  aiHeader: { marginBottom: 12 },
  aiStatusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  aiSubtitle: { fontSize: 13, fontWeight: '500' },
  aiDescription: { fontSize: 14, color: Colors.gray, lineHeight: 20, marginBottom: 16 },
  progressContainer: { marginTop: 5 },
  progressBarBackground: {
    height: 8, backgroundColor: '#E5E5EA', borderRadius: 4, overflow: 'hidden',
  },
  progressBarFill: { height: '100%', backgroundColor: Colors.primary },
  progressText: { fontSize: 12, color: Colors.gray, marginTop: 8, textAlign: 'right' },
  periodText: { fontSize: 11, color: Colors.gray, marginTop: 8, opacity: 0.7 },
});
