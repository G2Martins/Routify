import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useDesktopLayout } from '../lib/responsive';
import { supabase } from '../lib/supabase';
import { API_URL, apiHeaders, enviarEvento } from '../lib/api';
import AddressAutocomplete, { PlaceSuggestion } from '../components/AddressAutocomplete';
import NavigationPanel, { Clima, Economia } from '../components/NavigationPanel';
import { useToast } from '../components/Toast';
import MapStyleToggle, { BotaoMapa } from '../components/MapStyleToggle';
import LIAIndicator, { LIAStatus } from '../components/LIAIndicator';
import { FaixaMarca, Surgir, useMenosMovimento } from '../components/ui';
import Icon from '../components/Icon';
import Button from '../components/Button';

// @ts-ignore
import MapComponent from '../components/MapComponent';

const NATIVO = Platform.OS !== 'web';

interface RouteResult {
  polyline: number[][];
  tempo_total_seg: number;
  distancia_km: number;
  via_principal: string;
  modelo_utilizado: string;

  // Instrumentação para validação da tese (TCC 2). Opcionais para o app
  // continuar funcionando contra uma API anterior à Fase 2.
  tempo_rota_curta_seg?: number | null;
  distancia_rota_curta_km?: number | null;
  rotas_diferentes?: boolean | null;
  lia_cobertura_pct?: number | null;
  hora_partida?: number | null;
  dia_semana?: number | null;

  // TomTom sob demanda (API ≥ fase final). degradado = rota só com a LIA.
  tomtom?: {
    ativo: boolean;
    degradado: boolean;
    vias_atualizadas: number;
    arestas_interditadas: number;
    interdicoes_na_rota: number;
    incidentes: {
      tipo: string;
      descricao: string | null;
      atraso_seg: number | null;
      interdicao: boolean;
      lat: number;
      lon: number;
    }[];
    referencia_tempo_seg: number | null;
    referencia_atraso_seg: number | null;
    referencia_sem_transito_seg: number | null;
    referencia_distancia_km: number | null;
  } | null;

  // Fusão LIA × TomTom (API ≥ 2026-09-23)
  fonte_rota?: 'lia' | 'tomtom';
  tempo_lia_seg?: number | null;
  semaforos_na_rota?: number | null;
  fora_da_malha?: boolean;
  alternativa?: { fonte: 'lia' | 'tomtom'; polyline: number[][]; tempo_seg: number; distancia_km: number } | null;
  // Tempo em Brasília na partida e combustível contra o caminho mais curto (API ≥ 2026-09-24)
  clima?: Clima | null;
  economia?: Economia | null;
}

const litrosTxt = (v: number) => v.toFixed(2).replace('.', ',');

/** POST /route com o JWT da sessão; erro da API vira Error com a mensagem dela. */
async function pedirRota(origem: { lat: number; lon: number }, destino: { lat: number; lon: number }): Promise<RouteResult> {
  const res = await fetch(`${API_URL}/route`, {
    method: 'POST',
    headers: await apiHeaders(),
    body: JSON.stringify({ origem, destino }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.detail || `Erro ${res.status}`);
  }
  return res.json();
}

/** Barra indeterminada com o gradiente da marca enquanto a rota é calculada. */
function BarraProgresso() {
  const { theme } = useTheme();
  const reduzir = useMenosMovimento();
  const x = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);

  useEffect(() => {
    if (reduzir) return;
    const loop = Animated.loop(
      Animated.timing(x, { toValue: 1, duration: 1400, easing: theme.motion.easeOutExpo, useNativeDriver: NATIVO })
    );
    loop.start();
    return () => loop.stop();
  }, [reduzir]); // eslint-disable-line react-hooks/exhaustive-deps

  const trecho = w * 0.4;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Calculando rota"
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={[styles.barra, { backgroundColor: theme.colors.surfaceAlt }]}
    >
      {reduzir ? (
        <FaixaMarca />
      ) : w > 0 ? (
        <Animated.View
          style={{ width: trecho, transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-trecho, w] }) }] }}
        >
          <FaixaMarca />
        </Animated.View>
      ) : null}
    </View>
  );
}

export default function MapScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { user } = useAuth();
  const avisar = useToast();
  const desktop = useDesktopLayout();
  const insets = useSafeAreaInsets();
  const [alturaPainel, setAlturaPainel] = useState(200);

  const [origemText, setOrigemText] = useState('');
  const [destinoText, setDestinoText] = useState('');
  const [origemPlace, setOrigemPlace] = useState<PlaceSuggestion | null>(null);
  const [destinoPlace, setDestinoPlace] = useState<PlaceSuggestion | null>(null);

  const [liaStatus, setLiaStatus] = useState<LIAStatus>('idle');
  const [calculating, setCalculating] = useState(false);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mapRef = useRef<any>(null);
  const lastReplanRef = useRef<{ lat: number; lon: number; t: number } | null>(null);
  const navigatingRef = useRef(false);
  const destinoRef = useRef<PlaceSuggestion | null>(null);
  const recalcInflightRef = useRef(false);

  useEffect(() => {
    navigatingRef.current = navigating;
  }, [navigating]);
  useEffect(() => {
    destinoRef.current = destinoPlace;
  }, [destinoPlace]);

  useEffect(() => {
    // Tenta centralizar no usuário em silêncio. Se falhar (HTTPS/permissão),
    // mantém Brasília centro como default — sem popup no carregamento.
    const t = setTimeout(
      () => mapRef.current?.centerOnUser((_m: string) => { /* silencioso no mount */ }),
      800
    );
    return () => clearTimeout(t);
  }, []);

  const handleOptimize = async () => {
    if (!origemPlace || !destinoPlace) {
      setError('Escolha origem e destino na lista de sugestões.');
      return;
    }
    setError(null);
    setCalculating(true);
    setLiaStatus('thinking');
    setRoute(null);
    mapRef.current?.clearRoute?.();

    try {
      const data = await pedirRota(
        { lat: origemPlace.lat, lon: origemPlace.lon },
        { lat: destinoPlace.lat, lon: destinoPlace.lon }
      );

      mapRef.current?.showRoute?.(
        data.polyline,
        [origemPlace.lat, origemPlace.lon],
        [destinoPlace.lat, destinoPlace.lon],
        data.alternativa?.polyline ?? null
      );
      setRoute(data);
      setLiaStatus('done');
      setTimeout(() => setLiaStatus('idle'), 2500);
      const min = Math.max(1, Math.round(data.tempo_total_seg / 60));
      const eco = data.economia;
      avisar({
        titulo: `Rota pronta · ${min} min`,
        texto:
          eco && eco.litros >= 0.01
            ? `Economiza ${litrosTxt(eco.litros)} L contra o caminho mais curto`
            : `via ${data.via_principal}`,
        tom: 'ok',
        icone: 'ion:navigate',
      });
      if (data.clima && (data.clima.chuva_agora_mm > 0 || data.clima.chuva_3h_mm > 0)) {
        avisar({ titulo: 'Chuva em Brasília', texto: 'A LIA já considerou a chuva no tempo da rota.', tom: 'alerta', icone: 'ion:rainy-outline' });
      }

      // Salva no histórico (Supabase)
      if (user?.id) {
        supabase
          .from('route_history')
          .insert({
            user_id: user.id,
            origem_label: origemPlace.label,
            origem_lat: origemPlace.lat,
            origem_lon: origemPlace.lon,
            destino_label: destinoPlace.label,
            destino_lat: destinoPlace.lat,
            destino_lon: destinoPlace.lon,
            polyline: data.polyline,
            tempo_total_seg: data.tempo_total_seg,
            distancia_km: data.distancia_km,
            via_principal: data.via_principal,
            modelo_versao: data.modelo_utilizado,
            // Instrumentação para validação da tese (TCC 2). São nullable no
            // banco, então uma API antiga que não os envie continua funcionando.
            tempo_rota_curta_seg: data.tempo_rota_curta_seg ?? null,
            distancia_rota_curta_km: data.distancia_rota_curta_km ?? null,
            rotas_diferentes: data.rotas_diferentes ?? null,
            lia_cobertura_pct: data.lia_cobertura_pct ?? null,
            hora_partida: data.hora_partida ?? null,
            dia_semana: data.dia_semana ?? null,
            combustivel_economizado_l: data.economia?.litros ?? null,
          })
          .then((r: { error: { message: string } | null }) => {
            if (r.error) console.warn('[Routify] Falha ao salvar histórico:', r.error.message);
          });
      }
    } catch (e: any) {
      const msg = e?.message || 'Falha ao calcular rota.';
      avisar({ titulo: 'Não deu para calcular a rota', texto: msg, tom: 'erro' });
      if (Platform.OS === 'web') setError(msg);
      else Alert.alert('Erro ao calcular rota', msg);
      setLiaStatus('idle');
    } finally {
      setCalculating(false);
    }
  };

  const handleClear = () => {
    if (navigatingRef.current) {
      enviarEvento('navegacao_concluida', { modelo: route?.modelo_utilizado ?? null });
    }
    setRoute(null);
    setNavigating(false);
    setOrigemPlace(null);
    setDestinoPlace(null);
    setOrigemText('');
    setDestinoText('');
    setError(null);
    mapRef.current?.clearRoute?.();
    mapRef.current?.stopFollow?.();
  };

  const REPLAN_MIN_MS = 30_000;   // máx. 1 recálculo por 30s
  const REPLAN_MIN_DIST_M = 80;   // só recalcula se andou >80m desde último replan

  const haversineM = (a: [number, number], b: [number, number]) => {
    const R = 6_371_000;
    const toRad = (x: number) => (x * Math.PI) / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLon = toRad(b[1] - a[1]);
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  };

  const replanFromHere = async (lat: number, lon: number) => {
    const dest = destinoRef.current;
    if (!dest || recalcInflightRef.current) return;
    recalcInflightRef.current = true;
    try {
      const data = await pedirRota({ lat, lon }, { lat: dest.lat, lon: dest.lon });
      mapRef.current?.showRoute?.(data.polyline, [lat, lon], [dest.lat, dest.lon], data.alternativa?.polyline ?? null);
      setRoute((antes) => {
        // Só avisa quando o recálculo muda a previsão de verdade (≥ 1 min): sem spam a cada 30 s.
        if (antes && Math.abs(antes.tempo_total_seg - data.tempo_total_seg) >= 60) {
          avisar({ titulo: 'Rota recalculada', texto: `Chegada em ${Math.max(1, Math.round(data.tempo_total_seg / 60))} min`, tom: 'info' });
        }
        return data;
      });
    } catch (e) {
      console.warn('[Routify] replan fail', e);
    } finally {
      recalcInflightRef.current = false;
    }
  };

  const handleUserLocation = (lat: number, lon: number) => {
    if (!navigatingRef.current) return;
    const now = Date.now();
    const last = lastReplanRef.current;
    if (last) {
      const moved = haversineM([last.lat, last.lon], [lat, lon]);
      if (now - last.t < REPLAN_MIN_MS) return;
      if (moved < REPLAN_MIN_DIST_M) return;
    }
    lastReplanRef.current = { lat, lon, t: now };
    replanFromHere(lat, lon);
  };

  const handleStartNav = () => {
    enviarEvento('navegacao_iniciada', {
      distancia_km: route?.distancia_km ?? null,
      tempo_previsto_seg: route?.tempo_total_seg ?? null,
      modelo: route?.modelo_utilizado ?? null,
    });
    setNavigating(true);
    lastReplanRef.current = null;
    mapRef.current?.startFollow?.(
      (m: string) => setError(m),
      handleUserLocation
    );
  };

  useEffect(() => {
    return () => {
      mapRef.current?.stopFollow?.();
    };
  }, []);

  const podeOtimizar = !!origemPlace && !!destinoPlace;
  const sombraFlutuante = `0 10px 30px ${c.shadowMedium}, 0 0 0 1px ${c.shadowLight}`;

  const trocar = () => {
    setOrigemText(destinoText);
    setDestinoText(origemText);
    setOrigemPlace(destinoPlace);
    setDestinoPlace(origemPlace);
    if (route) {
      setRoute(null);
      mapRef.current?.clearRoute?.();
    }
  };

  const painelBusca = (
    <View style={[styles.painel, { backgroundColor: c.surface, borderColor: c.border, boxShadow: sombraFlutuante }]}>
      {calculating ? <BarraProgresso /> : null}

      <View style={styles.linhaCampos}>
        {/* Trilho: origem (anel teal) · pontilhado · destino (pino azul) */}
        <View style={styles.trilho}>
          <View style={[styles.pontoOrigem, { borderColor: c.teal, backgroundColor: c.surface }]} />
          <View style={styles.pontilhado}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.pingo, { backgroundColor: c.borderStrong }]} />
            ))}
          </View>
          <Icon name="ion:location" size={16} color={c.accent} />
        </View>

        <View style={styles.campos}>
          <AddressAutocomplete
            placeholder="De onde você sai?"
            value={origemText}
            onChangeText={(v: string) => {
              setOrigemText(v);
              if (origemPlace) setOrigemPlace(null);
            }}
            onSelect={(p: PlaceSuggestion) => {
              setOrigemPlace(p);
              setOrigemText(p.label);
            }}
            perto={destinoPlace}
            zIndex={2}
            listaStyle={styles.listaLarga}
          />
          <AddressAutocomplete
            placeholder="Para onde você vai?"
            value={destinoText}
            onChangeText={(v: string) => {
              setDestinoText(v);
              if (destinoPlace) setDestinoPlace(null);
            }}
            onSelect={(p: PlaceSuggestion) => {
              setDestinoPlace(p);
              setDestinoText(p.label);
            }}
            perto={origemPlace}
            zIndex={1}
            listaStyle={styles.listaLarga}
          />
        </View>

        <Pressable
          onPress={trocar}
          disabled={navigating || (!origemText && !destinoText)}
          accessibilityRole="button"
          accessibilityLabel="Inverter origem e destino"
          style={(estado) => {
            const { hovered, pressed } = estado as { hovered?: boolean; pressed: boolean };
            return [
              styles.trocar,
              {
                backgroundColor: hovered ? c.surfaceAlt : 'transparent',
                transform: [{ scale: pressed ? theme.motion.pressScale : 1 }],
              },
            ];
          }}
        >
          <Icon name="ion:swap-vertical" size={18} color={c.textMuted} />
        </Pressable>
      </View>

      {error ? (
        <View
          accessibilityRole="alert"
          style={[styles.erro, { backgroundColor: c.surfaceAlt, borderColor: c.border, borderLeftColor: c.danger }]}
        >
          <Icon name="ion:alert-circle-outline" size={16} color={c.danger} />
          <Text style={[theme.typography.caption, { flex: 1, color: c.text }]} numberOfLines={3}>
            {error}
          </Text>
          <Pressable onPress={() => setError(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Fechar aviso">
            <Icon name="ion:close" size={16} color={c.textMuted} />
          </Pressable>
        </View>
      ) : null}

      {!route ? (
        <Button
          label={calculating ? 'Calculando rota…' : 'Otimizar rota'}
          variant="primary"
          size="lg"
          fullWidth
          loading={calculating}
          onPress={handleOptimize}
          icon="ion:flash-outline"
          disabled={!podeOtimizar}
        />
      ) : null}
    </View>
  );

  const painelRota = route ? (
    <Surgir key="rota" style={desktop ? { zIndex: 1 } : styles.dockMobile}>
      <NavigationPanel route={route} navigating={navigating} onStart={handleStartNav} onCancel={handleClear} />
    </Surgir>
  ) : null;

  const topoPainel = insets.top + 12;
  const controles = (
    <View style={[styles.controles, { top: desktop ? 16 : topoPainel + alturaPainel + 12 }]}>
      <MapStyleToggle />
      <BotaoMapa
        icone="ion:locate"
        rotulo="Centralizar na minha localização"
        onPress={() => mapRef.current?.centerOnUser((m: string) => setError(m))}
      />
    </View>
  );

  const pilulaLIA =
    liaStatus === 'thinking' ? (
      <View
        style={[
          styles.pilula,
          { backgroundColor: c.surface, borderColor: c.border, boxShadow: sombraFlutuante },
        ]}
      >
        <LIAIndicator status="thinking" />
      </View>
    ) : null;

  // ---------------------------------------------------------------- DESKTOP
  if (desktop) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <MapComponent ref={mapRef} />

        {/* Coluna flutuante à esquerda: busca + resumo da rota */}
        <View style={styles.colunaDesktop}>
          <Surgir style={{ zIndex: 2 }}>{painelBusca}</Surgir>
          {painelRota}
        </View>

        {controles}
        {pilulaLIA}
      </View>
    );
  }

  // ----------------------------------------------------------------- MOBILE
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <MapComponent ref={mapRef} />

      <Surgir style={[styles.painelMobile, { top: topoPainel }]}>
        <View onLayout={(e) => setAlturaPainel(e.nativeEvent.layout.height)}>{painelBusca}</View>
      </Surgir>

      {controles}
      {pilulaLIA}
      {painelRota}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  painel: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 12,
  },
  barra: {
    position: 'absolute',
    top: 0,
    left: 16,
    right: 16,
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  linhaCampos: { flexDirection: 'row', gap: 8, zIndex: 2 },
  // Centros alinhados aos campos de 44 px (22 e 22 + 8 + 44).
  trilho: { width: 20, alignItems: 'center', justifyContent: 'space-between', paddingTop: 16, paddingBottom: 14 },
  pontoOrigem: { width: 12, height: 12, borderRadius: 6, borderWidth: 3 },
  pontilhado: { flex: 1, justifyContent: 'space-evenly', paddingVertical: 2 },
  pingo: { width: 3, height: 3, borderRadius: 2 },
  campos: { flex: 1, gap: 8 },
  // A lista cobre do trilho até o botão de inverter (20 + 8 à esquerda, 36 + 8 à direita).
  listaLarga: { left: -28, right: -44 },
  trocar: { width: 36, height: 36, borderRadius: 8, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  erro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderLeftWidth: 3,
  },
  colunaDesktop: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 400,
    gap: 12,
    zIndex: 30,
  },
  painelMobile: { position: 'absolute', left: 16, right: 16, zIndex: 30 },
  dockMobile: { position: 'absolute', bottom: 16, left: 16, right: 16, zIndex: 25 },
  controles: { position: 'absolute', right: 16, gap: 8, zIndex: 20 },
  // Embaixo no centro: enquanto calcula não há painel de rota, e em cima colidiria com a coluna.
  pilula: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    zIndex: 20,
  },
});
