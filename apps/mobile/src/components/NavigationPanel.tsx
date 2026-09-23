/**
 * NavigationPanel — resumo da rota que a LIA encontrou (tempo e distância em
 * Geist Mono, via, selos de status) + bloco TomTom quando a API consultou
 * (incidentes perto da rota e ETA de referência) + ações.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { Selo } from './ui';
import Icon from './Icon';
import Button from './Button';

interface TomTomResumo {
  degradado: boolean;
  interdicoes_na_rota: number;
  incidentes: unknown[];
  referencia_tempo_seg: number | null;
}

interface RouteSummary {
  tempo_total_seg: number;
  distancia_km: number;
  via_principal: string;
  modelo_utilizado: string;
  tomtom?: TomTomResumo | null;
  fonte_rota?: 'lia' | 'tomtom';
  tempo_lia_seg?: number | null;
  semaforos_na_rota?: number | null;
  fora_da_malha?: boolean;
  alternativa?: { fonte: 'lia' | 'tomtom'; tempo_seg: number } | null;
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
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export default function NavigationPanel({ route, navigating, onStart, onCancel }: Props) {
  const { theme } = useTheme();
  const c = theme.colors;
  const mono = { fontFamily: theme.fonts.monoBold, fontVariant: ['tabular-nums' as const] };

  const [valor, unidade] = tempo(route.tempo_total_seg);
  const modelo = route.modelo_utilizado.replace('_', ' ').toUpperCase();
  const tt = route.tomtom;
  const nIncidentes = tt?.incidentes?.length ?? 0;
  const mostraTomTom = !!tt && (!tt.degradado || nIncidentes > 0 || tt.referencia_tempo_seg != null);

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
        {route.fonte_rota === 'tomtom' ? (
          <Selo tom="neutro">{route.fora_da_malha ? 'Fora da área da LIA · TomTom' : 'Sugerida pela TomTom'}</Selo>
        ) : null}
        {tt?.degradado ? <Selo tom="alerta">Modo só LIA</Selo> : null}
        {navigating ? <Selo tom="ok" ponto>Em navegação</Selo> : null}
      </View>

      <View style={styles.resumo}>
        <View style={[styles.badge, { backgroundColor: c.accentSoft }]}>
          <Icon name={navigating ? 'mdi:car-sports' : 'mdi:car'} size={22} color={c.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: c.text }} numberOfLines={1} accessibilityLabel={`${valor} ${unidade}, ${km(route.distancia_km)} quilômetros`}>
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

      {mostraTomTom && tt ? (
        <View style={[styles.tomtom, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
          <View style={styles.tomtomItem}>
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
                  {tt.interdicoes_na_rota > 0 ? ` · ${plural(tt.interdicoes_na_rota, 'interdição', 'interdições')}` : ''}
                </>
              ) : (
                'Sem incidentes perto da rota'
              )}
            </Text>
          </View>
          {tt.referencia_tempo_seg != null && route.tempo_lia_seg != null ? (
            <Text style={[theme.typography.caption, { color: c.textMuted, fontSize: 12 }]}>
              LIA <Text style={[mono, { color: c.accent }]}>{tempo(route.tempo_lia_seg).join(' ')}</Text>
              {'  ·  '}TomTom <Text style={[mono, { color: c.text }]}>{tempo(tt.referencia_tempo_seg).join(' ')}</Text>
            </Text>
          ) : null}
          {route.semaforos_na_rota ? (
            <Text style={[theme.typography.caption, { color: c.textMuted, fontSize: 12 }]}>
              <Text style={[mono, { color: c.text }]}>{route.semaforos_na_rota}</Text>
              {route.semaforos_na_rota === 1 ? ' semáforo no trajeto' : ' semáforos no trajeto'}
            </Text>
          ) : null}
          {route.alternativa ? (
            <Text style={[theme.typography.caption, { color: c.textMuted, fontSize: 12 }]}>
              Alternativa ({route.alternativa.fonte === 'tomtom' ? 'TomTom' : 'LIA'}, tracejada){'  '}
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
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 14 },
  selos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  resumo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tomtom: {
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
  tomtomItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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
