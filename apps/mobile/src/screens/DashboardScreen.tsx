import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useDesktopLayout } from '../lib/responsive';
import { API_URL } from '../lib/api';
import { supabase, RouteHistoryRow } from '../lib/supabase';
import { fonts } from '../constants/Theme';
import Icon from '../components/Icon';
import Button from '../components/Button';
import {
  Cartao,
  Container,
  FaixaMarca,
  GradeKpi,
  Kpi,
  RotuloSecao,
  Selo,
  Skeleton,
  Surgir,
  TituloPagina,
} from '../components/ui';

interface HistoryStats {
  rotas: number;
  km_total: number;
  min_total: number;
  co2_kg_economizado: number;
  vias_evitadas: number;
}

const CO2_BASELINE_KG_KM = 0.192; // emissão média carro a gasolina
const CO2_LIA_KG_KM = 0.155;      // estimativa rota otimizada (~19% menos)

interface Metrics {
  modelo_ativo: string;
  cv_rmse_seg: number | null;
  cv_mae_seg: number | null;
  n_pontos_monitorados: number | null;
  periodo_dados: string;
  total_amostras_treino: number | null;
  feature_importance?: Record<string, number>;
  cv_rmse_seg_baseline?: number | null;
}

/** Nome legível das features da LIA (chaves de ml/features.py). */
const ROTULO_FEATURE: Record<string, string> = {
  razao_lag1: 'Leitura mais recente da via',
  delta_min_lag1: 'Minutos desde a última leitura',
  perfil_via_hora_dow: 'Perfil da via por hora e dia',
  perfil_via_hora: 'Perfil da via por hora',
  perfil_via: 'Perfil médio da via',
  perfil_hora_dow: 'Perfil da cidade por hora e dia',
  perfil_via_hora_dow_std: 'Variação do perfil da via',
  perfil_via_hora_dow_n: 'Amostras do perfil da via',
  velocidade_livre: 'Velocidade livre',
  id_ponto_enc: 'Ponto monitorado',
  hora: 'Hora do dia',
  hora_sin: 'Hora (ciclo, seno)',
  hora_cos: 'Hora (ciclo, cosseno)',
  dia_semana: 'Dia da semana',
  is_fim_semana: 'Fim de semana',
  is_horario_pico: 'Horário de pico',
};

const fmt = (n: number, casas = 0) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(n);

// ponytail: compacto na mão — `notation: 'compact'` do Intl não é garantido no Hermes.
function compacto(n: number): string {
  if (n >= 1e6) return `${fmt(n / 1e6, 2)} mi`;
  if (n >= 1e4) return `${fmt(n / 1e3, 1)} mil`;
  return fmt(n);
}

/** "lia_2.1" → "LIA 2.1" (e não duplica se a API já mandar "LIA 2.1"). */
const rotuloVersao = (m?: string | null) =>
  (m || 'lia').replace(/^lia[_\s-]?/i, 'LIA ').replace(/_/g, ' ').trim();

/** "2026-03-07 19:26:09-03:00 → 2026-07-19 …" → "07/03/2026 → 19/07/2026". */
const rotuloPeriodo = (p?: string) =>
  (p || '')
    .split('→')
    .map((d) => d.trim().slice(0, 10).split('-').reverse().join('/'))
    .filter(Boolean)
    .join(' → ');

function formatDate(): string {
  const dias = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const meses = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];
  const now = new Date();
  return `${dias[now.getDay()]}, ${now.getDate()} de ${meses[now.getMonth()]}`;
}

export default function DashboardScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { user, profile } = useAuth();
  const desktop = useDesktopLayout();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiOnline, setApiOnline] = useState(false);
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [tentativa, setTentativa] = useState(0);

  // Re-fetch toda vez que tab Painel ganha foco (clique no tab refresh) ou no "Tentar de novo".
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      fetch(`${API_URL}/metrics`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((data: Metrics) => {
          if (cancelled) return;
          setMetrics(data);
          setApiOnline(true);
        })
        .catch(() => !cancelled && setApiOnline(false))
        .finally(() => !cancelled && setLoading(false));

      // Agrega histórico do usuário: km, min, CO2 economizado vs baseline carro gasolina.
      if (user?.id) {
        (async () => {
          const { data, error } = await supabase
            .from('route_history')
            .select('distancia_km, tempo_total_seg, via_principal')
            .eq('user_id', user.id);
          if (cancelled || error || !data) return;
          const rows = data as Pick<RouteHistoryRow, 'distancia_km' | 'tempo_total_seg' | 'via_principal'>[];
          const km_total = rows.reduce((s, r) => s + Number(r.distancia_km || 0), 0);
          const min_total = rows.reduce((s, r) => s + Number(r.tempo_total_seg || 0), 0) / 60;
          const co2_kg_economizado = km_total * (CO2_BASELINE_KG_KM - CO2_LIA_KG_KM);
          const vias_evitadas = new Set(
            rows.map((r) => (r.via_principal || '').trim()).filter(Boolean)
          ).size;
          setStats({
            rotas: rows.length,
            km_total,
            min_total,
            co2_kg_economizado,
            vias_evitadas,
          });
        })();
      }

      return () => {
        cancelled = true;
      };
    }, [user?.id, tentativa])
  );

  const nome = (profile?.nome || user?.email?.split('@')[0] || 'piloto').trim().split(/\s+/)[0];
  const online = apiOnline && metrics !== null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ paddingTop: desktop ? 40 : 56, paddingBottom: 80 }}
    >
      <Container>
        <Surgir>
          <TituloPagina titulo={`Olá, ${nome}`} sub={`${formatDate()} · o trânsito do DF previsto pela LIA`} />
        </Surgir>

        {loading ? (
          <EsqueletoPainel />
        ) : (
          <>
            <Surgir ordem={1} style={{ marginTop: 24 }}>
              {online ? (
                <HeroLia rmse={metrics.cv_rmse_seg} base={metrics.cv_rmse_seg_baseline ?? null} />
              ) : (
                <CartaoOffline onRetry={() => setTentativa((t) => t + 1)} />
              )}
            </Surgir>

            <RotuloSecao>Seu impacto</RotuloSecao>
            <GradeKpi>
              <Kpi
                ordem={2}
                destaque
                icone="ion:leaf-outline"
                valor={stats ? `${fmt(stats.co2_kg_economizado, 1)} kg` : '—'}
                rotulo="CO₂ economizado"
              />
              <Kpi
                ordem={3}
                icone="ion:navigate-outline"
                valor={stats ? `${fmt(stats.km_total, stats.km_total < 100 ? 1 : 0)} km` : '—'}
                rotulo="Distância otimizada"
              />
              <Kpi ordem={4} icone="ion:flag-outline" valor={stats ? fmt(stats.rotas) : '—'} rotulo="Rotas otimizadas" />
              <Kpi
                ordem={5}
                icone="mdi:road-variant"
                valor={stats ? fmt(stats.vias_evitadas) : '—'}
                rotulo="Vias diferentes"
              />
            </GradeKpi>
            {stats?.rotas === 0 ? (
              <Text style={[theme.typography.caption, { color: c.textMuted, marginTop: 8 }]}>
                Calcule sua primeira rota na aba Mapa para ver seu impacto aqui.
              </Text>
            ) : null}

            {online ? (
              <>
                <RotuloSecao>Motor preditivo</RotuloSecao>
                <View style={styles.duas}>
                  <Surgir ordem={6} style={styles.meia}>
                    <CartaoModelo m={metrics} />
                  </Surgir>
                  {metrics.feature_importance && Object.keys(metrics.feature_importance).length > 0 ? (
                    <Surgir ordem={7} style={styles.meia}>
                      <CartaoFeatures fi={metrics.feature_importance} />
                    </Surgir>
                  ) : null}
                </View>
              </>
            ) : null}
          </>
        )}
      </Container>
    </ScrollView>
  );
}

/** Barra horizontal fina: trilho + preenchimento proporcional (0–100). */
function Barra({ pct, cor, trilho, opacidadeTrilho = 1 }: { pct: number; cor: string; trilho: string; opacidadeTrilho?: number }) {
  return (
    <View style={styles.barra}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: trilho, opacity: opacidadeTrilho, borderRadius: 3 }]} />
      <View
        style={{
          // Math.round no template: `${number}%` satisfaz DimensionValue; toFixed (string) não.
          width: `${Math.round(Math.max(0, Math.min(100, pct)))}%`,
          height: '100%',
          backgroundColor: cor,
          borderRadius: 3,
        }}
      />
    </View>
  );
}

/** Hero navy (claro) / superfície elevada (escuro) com a faixa e um véu do gradiente da marca. */
function HeroLia({ rmse, base }: { rmse: number | null; base: number | null }) {
  const { theme, mode } = useTheme();
  const c = theme.colors;
  const escuro = mode === 'dark';
  const bg = escuro ? c.surfaceAlt : c.inverse;
  const fg = escuro ? c.text : c.onInverse;
  const comparar = rmse != null && base != null && base > 0;
  const maior = comparar ? Math.max(rmse, base) : 1;

  return (
    <View
      style={[
        styles.hero,
        { backgroundColor: bg, borderColor: escuro ? c.border : bg, boxShadow: `0 6px 20px ${c.shadowMedium}` },
      ]}
    >
      <LinearGradient
        colors={c.gradient}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, { opacity: 0.14 }]}
      />
      <FaixaMarca altura={3} style={styles.heroFaixa} />

      <View style={styles.heroTopo}>
        <Text style={[theme.typography.micro, { color: fg, opacity: 0.72, textTransform: 'uppercase' }]}>
          Precisão da LIA
        </Text>
        <Selo tom="ok" ponto>
          Online
        </Selo>
      </View>

      <View style={styles.heroCorpo}>
        <View style={styles.heroCol}>
          <Text style={[theme.typography.num, styles.heroNum, { color: fg }]} numberOfLines={1}>
            {rmse != null ? `±${fmt(rmse, 1)} s` : '—'}
          </Text>
          <Text style={[theme.typography.caption, { color: fg, opacity: 0.72, marginTop: 6 }]}>
            Erro médio de previsão (RMSE) · meta abaixo de 120 s
          </Text>
        </View>

        {comparar ? (
          <View style={[styles.heroCol, { justifyContent: 'flex-end' }]}>
            {[
              { rotulo: 'LIA', valor: rmse, cor: c.teal },
              { rotulo: 'Baseline', valor: base, cor: c.textSubtle },
            ].map((b) => (
              <View key={b.rotulo} style={{ marginBottom: 12 }}>
                <View style={styles.barraLinha}>
                  <Text style={[theme.typography.captionMd, { color: fg, opacity: 0.85 }]}>{b.rotulo}</Text>
                  <Text style={[styles.mono, { color: fg }]}>{`±${fmt(b.valor, 1)} s`}</Text>
                </View>
                <Barra pct={(b.valor / maior) * 100} cor={b.cor} trilho={fg} opacidadeTrilho={0.14} />
              </View>
            ))}
            <Text style={[theme.typography.captionMd, { color: fg }]}>
              <Text style={{ fontFamily: theme.fonts.monoBold }}>{`${fmt((1 - rmse / base) * 100, 1)}%`}</Text>
              {' menos erro que o baseline'}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function CartaoModelo({ m }: { m: Metrics }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const amostras = m.total_amostras_treino ?? 0;
  const periodo = rotuloPeriodo(m.periodo_dados);
  const stats = [
    { valor: m.n_pontos_monitorados ? fmt(m.n_pontos_monitorados) : '—', rotulo: 'pontos monitorados' },
    { valor: amostras > 0 ? compacto(amostras) : '—', rotulo: 'amostras de treino' },
    { valor: m.cv_mae_seg != null ? `±${fmt(m.cv_mae_seg, 1)} s` : '—', rotulo: 'erro absoluto (MAE)' },
  ];

  return (
    <Cartao style={{ flex: 1 }}>
      <View style={styles.cartaoTopo}>
        <View style={[styles.iconeCirculo, { backgroundColor: c.accentSoft }]}>
          <Icon name="ion:flash-outline" size={18} color={c.accent} />
        </View>
        <Text style={[theme.typography.h3, { color: c.text, flex: 1 }]}>O modelo</Text>
        <View>
          <Selo tom="marca">{rotuloVersao(m.modelo_ativo)}</Selo>
        </View>
      </View>

      <Text style={[theme.typography.body, { color: c.textMuted, marginTop: 12 }]}>
        {amostras > 0 ? `Treinada com ${compacto(amostras)} de amostras do trânsito de Brasília. ` : ''}
        O XGBoost prevê o congestionamento de cada trecho e o A* usa essa previsão para escolher a rota mais rápida.
      </Text>

      {periodo ? (
        <View style={[styles.chip, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
          <Icon name="ion:time-outline" size={13} color={c.textMuted} />
          <Text style={[styles.mono, { color: c.textMuted }]}>{periodo}</Text>
        </View>
      ) : null}

      <View style={[styles.miniStats, { borderTopColor: c.border }]}>
        {stats.map((s) => (
          <View key={s.rotulo} style={styles.miniStat}>
            <Text style={[theme.typography.num, { color: c.text, fontSize: 20, lineHeight: 26 }]} numberOfLines={1}>
              {s.valor}
            </Text>
            <Text style={[theme.typography.caption, { color: c.textMuted, marginTop: 2 }]}>{s.rotulo}</Text>
          </View>
        ))}
      </View>
    </Cartao>
  );
}

function CartaoFeatures({ fi }: { fi: Record<string, number> }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const total = Object.values(fi).reduce((s, v) => s + v, 0) || 1;
  const top = Object.entries(fi)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const max = top[0]?.[1] || 1;

  return (
    <Cartao style={{ flex: 1 }}>
      <Text style={[theme.typography.h3, { color: c.text }]}>O que mais pesa</Text>
      <Text style={[theme.typography.caption, { color: c.textMuted, marginTop: 2 }]}>
        Importância relativa das variáveis na previsão · top 5
      </Text>
      {top.map(([chave, v]) => (
        <View key={chave} style={{ marginTop: 14 }}>
          <View style={styles.barraLinha}>
            <Text style={[theme.typography.captionMd, { color: c.text, flex: 1 }]} numberOfLines={1}>
              {ROTULO_FEATURE[chave] ?? chave.replace(/_/g, ' ')}
            </Text>
            <Text style={[styles.mono, { color: c.textMuted }]}>{`${fmt((v / total) * 100, 1)}%`}</Text>
          </View>
          <Barra pct={(v / max) * 100} cor={c.accent} trilho={c.surfaceAlt} />
        </View>
      ))}
    </Cartao>
  );
}

function CartaoOffline({ onRetry }: { onRetry: () => void }) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <Cartao>
      <View style={styles.offline}>
        <View style={[styles.iconeCirculo, { backgroundColor: c.surfaceAlt }]}>
          <Icon name="ion:server-outline" size={18} color={c.danger} />
        </View>
        <View style={{ flex: 1, minWidth: 220 }}>
          <View style={styles.offlineTitulo}>
            <Text style={[theme.typography.h4, { color: c.text }]}>Motor preditivo indisponível</Text>
            <Selo tom="erro" ponto>
              Offline
            </Selo>
          </View>
          <Text style={[theme.typography.body, { color: c.textMuted, marginTop: 4 }]}>
            Não conseguimos falar com a API da LIA agora. Seu impacto continua abaixo; as métricas do modelo voltam
            assim que a API responder.
          </Text>
          {__DEV__ ? (
            <Text style={[styles.mono, { color: c.textSubtle, marginTop: 8 }]}>
              dev: uvicorn main:app --reload (em apps/api)
            </Text>
          ) : null}
        </View>
        <Button label="Tentar de novo" variant="secondary" size="sm" onPress={onRetry} />
      </View>
    </Cartao>
  );
}

/** Esqueleto com o mesmo desenho da tela carregada (hero, 4 KPIs, 2 cartões). */
function EsqueletoPainel() {
  return (
    <View accessibilityLabel="Carregando métricas">
      <View style={{ marginTop: 24 }}>
        <Skeleton altura={176} raio={12} />
      </View>
      <RotuloSecao>Seu impacto</RotuloSecao>
      <GradeKpi>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.kpiEsqueleto}>
            <Skeleton altura={134} raio={12} />
          </View>
        ))}
      </GradeKpi>
      <RotuloSecao>Motor preditivo</RotuloSecao>
      <View style={styles.duas}>
        {[0, 1].map((i) => (
          <View key={i} style={styles.meia}>
            <Skeleton altura={280} raio={12} />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 12, borderWidth: 1, padding: 24, paddingTop: 22, overflow: 'hidden' },
  heroFaixa: { position: 'absolute', top: 0, left: 0, right: 0, borderRadius: 0 },
  heroTopo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heroCorpo: { flexDirection: 'row', flexWrap: 'wrap', gap: 24, marginTop: 16 },
  heroCol: { flexGrow: 1, flexShrink: 1, flexBasis: 260 },
  heroNum: { fontSize: 52, lineHeight: 60, letterSpacing: -1.5 },
  barra: { height: 6, marginTop: 6, justifyContent: 'center' },
  barraLinha: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  mono: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 16, fontVariant: ['tabular-nums'] },
  duas: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  meia: { flexGrow: 1, flexShrink: 1, flexBasis: 320 },
  cartaoTopo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconeCirculo: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  miniStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 20, paddingTop: 16, borderTopWidth: 1 },
  miniStat: { flexGrow: 1, flexBasis: 100 },
  offline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16 },
  offlineTitulo: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  // Espelha a célula do Kpi em ui.tsx para o esqueleto ocupar o mesmo lugar.
  kpiEsqueleto: { flexGrow: 1, flexBasis: 220, padding: 6, minWidth: 150 },
});
