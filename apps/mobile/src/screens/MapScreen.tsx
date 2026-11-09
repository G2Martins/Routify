import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { useDesktopLayout, useTelaLarga } from '../lib/responsive';
import { supabase } from '../lib/supabase';
import { API_URL, apiHeaders, enviarEvento } from '../lib/api';
import AddressAutocomplete, { PlaceSuggestion } from '../components/AddressAutocomplete';
import NavigationPanel, { Clima, Economia } from '../components/NavigationPanel';
import { useToast } from '../components/Toast';
import MapStyleToggle, { BotaoMapa } from '../components/MapStyleToggle';
import BotaoRadares from '../components/BotaoRadares';
import { BotaoIcone, FaixaMarca, Surgir, useMenosMovimento } from '../components/ui';
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
  // Trânsito por trecho da polyline (0 livre … 3 parado; null = sem dado). API ≥ 2026-11-02.
  trafego?: (number | null)[] | null;
  // Tempo em Brasília na partida e combustível contra o caminho mais curto (API ≥ 2026-09-24)
  clima?: Clima | null;
  economia?: Economia | null;
}

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
  const telaLarga = useTelaLarga();
  const [alturaPainel, setAlturaPainel] = useState(200);
  const [alturaDock, setAlturaDock] = useState(150);
  const [editando, setEditando] = useState(false); // celular: com rota, a busca recolhe numa linha

  const [origemText, setOrigemText] = useState('');
  const [destinoText, setDestinoText] = useState('');
  const [origemPlace, setOrigemPlace] = useState<PlaceSuggestion | null>(null);
  const [destinoPlace, setDestinoPlace] = useState<PlaceSuggestion | null>(null);

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

  // Só em desenvolvimento: ?preview=mapa&de=lat,lon&para=lat,lon já traça a rota (inspeção visual).
  const demoRef = useRef(false);
  useEffect(() => {
    if (!__DEV__ || typeof window === 'undefined' || !window.location) return;
    const q = new URLSearchParams(window.location.search);
    const ponto = (v: string | null, label: string) => {
      const [lat, lon] = (v ?? '').split(',').map(Number);
      return Number.isFinite(lat) && Number.isFinite(lon) ? ({ label, sublabel: '', lat, lon, source: 'malha' } as PlaceSuggestion) : null;
    };
    const de = ponto(q.get('de'), 'Origem');
    const para = ponto(q.get('para'), 'Destino');
    if (de && para) {
      demoRef.current = true;
      setOrigemPlace(de);
      setDestinoPlace(para);
    }
  }, []);
  useEffect(() => {
    if (demoRef.current && origemPlace && destinoPlace) {
      demoRef.current = false;
      setTimeout(() => handleOptimize(), 1500); // depois do mapa carregar
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origemPlace, destinoPlace]);

  const handleOptimize = async () => {
    if (!origemPlace || !destinoPlace) {
      setError('Escolha origem e destino na lista de sugestões.');
      return;
    }
    setError(null);
    setCalculating(true);
    setEditando(false);
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
        data.alternativa?.polyline ?? null,
        data.trafego ?? null
      );
      setRoute(data); // o painel da rota já diz o tempo, a economia e a chuva: sem aviso repetindo por cima do mapa

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
            minutos_economizados: data.economia?.minutos ?? null,
          })
          .then((r: { error: { message: string } | null }) => {
            if (r.error) console.warn('[Routify] Falha ao salvar histórico:', r.error.message);
          });
      }
    } catch (e: any) {
      const msg = e?.message || 'Não deu para traçar a rota.';
      if (Platform.OS === 'web') setError(msg);
      else Alert.alert('Não deu para traçar a rota', msg);
    } finally {
      setCalculating(false);
    }
  };

  const handleClear = () => {
    if (navigatingRef.current) {
      enviarEvento('navegacao_concluida', { modelo: route?.modelo_utilizado ?? null });
    }
    setRoute(null);
    setEditando(false);
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
      mapRef.current?.showRoute?.(data.polyline, [lat, lon], [dest.lat, dest.lon], data.alternativa?.polyline ?? null, data.trafego ?? null);
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
    limparRota();
  };

  // Outro ponto = outra viagem: a rota na tela deixa de valer.
  const limparRota = () => {
    if (!route) return;
    setRoute(null);
    mapRef.current?.clearRoute?.();
  };

  // Celular com rota traçada: a busca vira uma linha e a tela fica para o mapa. Tocar reabre os campos.
  const buscaRecolhida = !desktop && !!route && !editando;
  const resumoBusca = (
    <Pressable
      onPress={() => setEditando(true)}
      accessibilityRole="button"
      accessibilityLabel={`De ${origemText} para ${destinoText}. Editar`}
      style={[styles.painel, styles.resumoBusca, { backgroundColor: c.surface, borderColor: c.border, boxShadow: sombraFlutuante }]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[theme.typography.captionMd, { color: c.text }]}>{origemText}</Text>
        <Text numberOfLines={1} style={[theme.typography.captionMd, { color: c.text }]}>{destinoText}</Text>
      </View>
      <Text style={[theme.typography.captionMd, { color: c.accent }]}>Editar</Text>
    </Pressable>
  );

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
              limparRota();
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
              limparRota();
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
          <BotaoIcone icone="ion:close" rotulo="Fechar aviso" onPress={() => setError(null)} />
        </View>
      ) : null}

      {!route ? (
        <Button
          label="Traçar rota"
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
    <Surgir key="rota" style={desktop ? { zIndex: 1 } : [styles.dockMobile, telaLarga && styles.painelTablet]}>
      <View onLayout={(e) => setAlturaDock(e.nativeEvent.layout.height)}>
        <NavigationPanel route={route} navigating={navigating} compacto={!desktop} onStart={handleStartNav} onCancel={handleClear} />
      </View>
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
      <BotaoRadares mapa={mapRef} />
    </View>
  );

  // O vão entre os painéis, medido: é nele que a rota precisa caber.
  const margem = useMemo(
    () =>
      desktop
        ? { top: 72, left: 440, right: 96, bottom: 72 }
        : { top: topoPainel + alturaPainel + 24, left: 32, right: 72, bottom: route ? alturaDock + 40 : 32 },
    [desktop, topoPainel, alturaPainel, alturaDock, !!route] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ---------------------------------------------------------------- DESKTOP
  if (desktop) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <MapComponent ref={mapRef} margem={margem} />

        {/* Coluna flutuante à esquerda: busca + resumo da rota */}
        <View style={styles.colunaDesktop}>
          <Surgir style={{ zIndex: 2 }}>{painelBusca}</Surgir>
          {painelRota}
        </View>

        {controles}
      </View>
    );
  }

  // ----------------------------------------------------------------- MOBILE
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <MapComponent ref={mapRef} margem={margem} />

      <Surgir style={[styles.painelMobile, telaLarga && styles.painelTablet, { top: topoPainel }]}>
        <View onLayout={(e) => setAlturaPainel(e.nativeEvent.layout.height)}>{buscaRecolhida ? resumoBusca : painelBusca}</View>
      </Surgir>

      {controles}
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
  trocar: { width: 44, height: 44, marginHorizontal: -4, borderRadius: 8, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  resumoBusca: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
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
  // Tablet: os painéis ocupam um canto e o resto da tela é mapa.
  painelTablet: { right: 'auto', width: 420 },
  controles: { position: 'absolute', right: 16, gap: 8, zIndex: 20 },
});
