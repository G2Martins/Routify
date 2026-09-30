/**
 * NavigationPanel — a rota que a LIA escolheu: tempo e distância (Geist Mono,
 * contando até o valor), via principal, tempo em Brasília na partida, economia de
 * combustível contra o caminho mais curto, avisos do trajeto e ações.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { Selo, Surgir, useMenosMovimento } from './ui';
import Icon from './Icon';
import Button from './Button';

interface ResumoTrajeto {
  degradado: boolean;
  interdicoes_na_rota: number;
  incidentes: unknown[];
}

export interface Clima {
  temperatura_c: number | null;
  condicao: string;
  codigo_wmo: number | null;
  de_dia: boolean;
  chuva_agora_mm: number;
  chuva_3h_mm: number;
  feriado: boolean;
}

export interface Economia {
  litros_rota: number;
  litros: number;
  reais: number;
  co2_kg: number;
  minutos: number;
}

interface RouteSummary {
  tempo_total_seg: number;
  distancia_km: number;
  via_principal: string;
  modelo_utilizado: string;
  tomtom?: ResumoTrajeto | null;
  fonte_rota?: 'lia' | 'tomtom';
  semaforos_na_rota?: number | null;
  fora_da_malha?: boolean;
  alternativa?: { tempo_seg: number } | null;
  clima?: Clima | null;
  economia?: Economia | null;
}

interface Props {
  route: RouteSummary;
  navigating: boolean;
  onStart: () => void;
  onCancel: () => void;
}

/** Segundos → [valor, unidade]: "23" "min" ou "1:05" "h". */
function tempo(seg: number): [string, string] {
  const m = Math.max(1, Math.round(seg / 60));
  return m < 60 ? [String(m), 'min'] : [`${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`, 'h'];
}

const km = (v: number) => v.toFixed(1).replace('.', ',');
const litros = (v: number) => Math.abs(v).toFixed(2).replace('.', ',');
const reais = (v: number) => Math.abs(v).toFixed(2).replace('.', ',');
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Ícone do tempo pelo código WMO do Open-Meteo. */
function iconeClima(codigo: number | null, dia: boolean): string {
  if (codigo == null) return 'ion:partly-sunny-outline';
  if (codigo === 0) return dia ? 'ion:sunny-outline' : 'ion:moon-outline';
  if (codigo <= 2) return dia ? 'ion:partly-sunny-outline' : 'ion:cloudy-night-outline';
  if (codigo === 3) return 'ion:cloud-outline';
  if (codigo <= 48) return 'mdi:weather-fog';
  if (codigo >= 95) return 'ion:thunderstorm-outline';
  return 'ion:rainy-outline';
}

/** Número que conta até o valor quando a rota muda (desliga com menos movimento). */
function useContagem(alvo: number, duracao = 700): number {
  const reduzir = useMenosMovimento();
  const [valor, setValor] = useState(alvo);
  const anim = useRef(new Animated.Value(alvo)).current;
  useEffect(() => {
    if (reduzir) {
      setValor(alvo);
      return;
    }
    const id = anim.addListener(({ value }) => setValor(value));
    anim.setValue(0);
    Animated.timing(anim, { toValue: alvo, duration: duracao, useNativeDriver: false }).start();
    return () => anim.removeListener(id);
  }, [alvo, reduzir]); // eslint-disable-line react-hooks/exhaustive-deps
  return valor;
}

export default function NavigationPanel({ route, navigating, onStart, onCancel }: Props) {
  const { theme } = useTheme();
  const c = theme.colors;
  const mono = { fontFamily: theme.fonts.monoBold, fontVariant: ['tabular-nums' as const] };

  const segContados = useContagem(route.tempo_total_seg);
  const [valor, unidade] = tempo(segContados);
  const modelo = route.modelo_utilizado.replace('_', ' ').toUpperCase();
  const tt = route.tomtom;
  const nIncidentes = tt?.incidentes?.length ?? 0;
  const eco = route.economia;
  const economizou = !!eco && eco.litros >= 0.01;
  const ganhouTempo = !!eco && eco.minutos >= 1;
  const clima = route.clima;
  const temAvisos = nIncidentes > 0 || !!route.semaforos_na_rota || !!route.alternativa || (tt?.interdicoes_na_rota ?? 0) > 0;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: c.surface,
          borderColor: c.border,
          boxShadow: `0 10px 30px ${c.shadowMedium}, 0 0 0 1px ${c.shadowLight}`,
        },
      ]}
    >
      <View style={styles.selos}>
        <Selo tom="marca" ponto>{modelo}</Selo>
        {route.fora_da_malha ? (
          <Selo tom="neutro">Fora da área da LIA</Selo>
        ) : route.fonte_rota === 'tomtom' ? (
          <Selo tom="ok">Trânsito ao vivo</Selo>
        ) : null}
        {tt?.degradado ? <Selo tom="alerta">Modo só LIA</Selo> : null}
        {navigating ? <Selo tom="ok" ponto>Em navegação</Selo> : null}
      </View>

      <View style={styles.resumo}>
        <View style={[styles.badge, { backgroundColor: c.accentSoft }]}>
          <Icon name={navigating ? 'mdi:car-sports' : 'mdi:car'} size={22} color={c.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{ color: c.text }}
            numberOfLines={1}
            accessibilityLabel={`${tempo(route.tempo_total_seg).join(' ')}, ${km(route.distancia_km)} quilômetros`}
          >
            <Text style={[theme.typography.num, mono]}>{valor}</Text>
            <Text style={[theme.typography.captionMd, { color: c.textMuted }]}> {unidade}</Text>
            <Text style={[theme.typography.caption, { color: c.textSubtle }]}>{'  ·  '}</Text>
            <Text style={[mono, { fontSize: 16, color: c.textMuted }]}>{km(route.distancia_km)}</Text>
            <Text style={[theme.typography.captionMd, { color: c.textMuted }]}> km</Text>
          </Text>
          <Text style={[theme.typography.caption, { color: c.textMuted, marginTop: 2 }]} numberOfLines={1}>
            via {route.via_principal}
          </Text>
        </View>
      </View>

      {clima ? (
        <Surgir ordem={1}>
          <View style={styles.clima}>
            <Icon name={iconeClima(clima.codigo_wmo, clima.de_dia)} size={18} color={c.cyan} />
            <Text style={[theme.typography.caption, { color: c.text, fontSize: 12 }]}>
              {clima.temperatura_c != null ? (
                <Text style={[mono, { color: c.text }]}>{Math.round(clima.temperatura_c)}°</Text>
              ) : null}
              {clima.temperatura_c != null ? '  ' : ''}
              {clima.condicao} em Brasília agora
            </Text>
            {clima.chuva_3h_mm > 0 || clima.chuva_agora_mm > 0 ? (
              <Selo tom="alerta">Chuva considerada pela LIA</Selo>
            ) : null}
            {clima.feriado ? <Selo tom="neutro">Feriado</Selo> : null}
          </View>
        </Surgir>
      ) : null}

      {eco ? (
        <Surgir ordem={2}>
          <View style={[styles.eco, { backgroundColor: economizou ? `${c.teal}14` : c.surfaceAlt, borderColor: economizou ? `${c.teal}40` : c.border }]}>
            <Icon name="ion:leaf-outline" size={16} color={economizou ? c.teal : c.textMuted} />
            <View style={{ flex: 1, minWidth: 0 }}>
              {economizou || ganhouTempo ? (
                <Text style={[theme.typography.captionMd, { color: c.text, fontSize: 12 }]}>
                  {ganhouTempo ? `${Math.round(eco.minutos)} min mais rápido` : 'Mesmo tempo'}
                  {economizou ? (
                    <>
                      {' · economiza '}
                      <Text style={[mono, { color: c.teal }]}>{litros(eco.litros)} L</Text>
                      {' · R$ '}
                      <Text style={[mono, { color: c.teal }]}>{reais(eco.reais)}</Text>
                    </>
                  ) : ganhouTempo && eco.litros <= -0.01 ? (
                    ` · +${litros(eco.litros)} L`
                  ) : null}
                </Text>
              ) : (
                <Text style={[theme.typography.captionMd, { color: c.text, fontSize: 12 }]}>Já é o caminho mais curto</Text>
              )}
              <Text style={[theme.typography.caption, { color: c.textMuted, fontSize: 11 }]}>
                ≈ {litros(eco.litros_rota)} L nesta viagem · contra o caminho mais curto
              </Text>
            </View>
          </View>
        </Surgir>
      ) : null}

      {temAvisos ? (
        <View style={[styles.avisos, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
          <View style={styles.avisoItem}>
            <Icon
              name={nIncidentes > 0 ? 'ion:warning-outline' : 'ion:checkmark-circle'}
              size={14}
              color={nIncidentes > 0 ? c.warning : c.success}
            />
            <Text style={[theme.typography.caption, { color: c.textMuted, fontSize: 12 }]}>
              {nIncidentes > 0 ? (
                <>
                  <Text style={[mono, { color: c.text }]}>{nIncidentes}</Text>
                  {nIncidentes === 1 ? ' incidente perto' : ' incidentes perto'}
                  {tt && tt.interdicoes_na_rota > 0 ? ` · ${plural(tt.interdicoes_na_rota, 'interdição', 'interdições')}` : ''}
                </>
              ) : (
                'Sem incidentes perto da rota'
              )}
            </Text>
          </View>
          {route.semaforos_na_rota ? (
            <Text style={[theme.typography.caption, { color: c.textMuted, fontSize: 12 }]}>
              <Text style={[mono, { color: c.text }]}>{route.semaforos_na_rota}</Text>
              {route.semaforos_na_rota === 1 ? ' semáforo no trajeto' : ' semáforos no trajeto'}
            </Text>
          ) : null}
          {route.alternativa ? (
            <Text style={[theme.typography.caption, { color: c.textMuted, fontSize: 12 }]}>
              Alternativa tracejada{'  '}
              <Text style={[mono, { color: c.text }]}>{tempo(route.alternativa.tempo_seg).join(' ')}</Text>
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.acoes}>
        {!navigating ? (
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Limpar rota"
            style={(estado) => {
              const { hovered, pressed } = estado as { hovered?: boolean; pressed: boolean };
              return [
                styles.fechar,
                {
                  backgroundColor: hovered ? c.surfaceMuted : c.surfaceAlt,
                  borderColor: c.border,
                  transform: [{ scale: pressed ? theme.motion.pressScale : 1 }],
                },
              ];
            }}
          >
            <Icon name="ion:close" size={18} color={c.text} />
          </Pressable>
        ) : null}
        {navigating ? (
          <Button label="Encerrar viagem" variant="primary" icon="ion:flag-outline" onPress={onCancel} style={{ flex: 1 }} />
        ) : (
          <Button label="Iniciar navegação" variant="primary" icon="ion:navigate" onPress={onStart} style={{ flex: 1 }} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  selos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  resumo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  clima: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  eco: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  avisos: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  avisoItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  acoes: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fechar: {
    width: 42,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
