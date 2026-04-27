import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useDesktopLayout } from '../lib/responsive';
import { supabase } from '../lib/supabase';
import { API_URL } from '../lib/api';
import AddressAutocomplete, { PlaceSuggestion } from '../components/AddressAutocomplete';
import NavigationPanel from '../components/NavigationPanel';
import MapStyleToggle from '../components/MapStyleToggle';
import LIAIndicator, { LIAStatus } from '../components/LIAIndicator';
import Icon from '../components/Icon';
import Button from '../components/Button';

// @ts-ignore
import MapComponent from '../components/MapComponent';

interface RouteResult {
  polyline: number[][];
  tempo_total_seg: number;
  distancia_km: number;
  via_principal: string;
  modelo_utilizado: string;
}

export default function MapScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { user } = useAuth();
  const desktop = useDesktopLayout();

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
      const res = await fetch(`${API_URL}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origem: { lat: origemPlace.lat, lon: origemPlace.lon },
          destino: { lat: destinoPlace.lat, lon: destinoPlace.lon },
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail || `Erro ${res.status}`);
      }
      const data: RouteResult = await res.json();

      mapRef.current?.showRoute?.(
        data.polyline,
        [origemPlace.lat, origemPlace.lon],
        [destinoPlace.lat, destinoPlace.lon]
      );
      setRoute(data);
      setLiaStatus('done');
      setTimeout(() => setLiaStatus('idle'), 2500);

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
          })
          .then((r: { error: { message: string } | null }) => {
            if (r.error) console.warn('[Routify] Falha ao salvar histórico:', r.error.message);
          });
      }
    } catch (e: any) {
      const msg = e?.message || 'Falha ao calcular rota.';
      if (Platform.OS === 'web') setError(msg);
      else Alert.alert('Erro ao calcular rota', msg);
      setLiaStatus('idle');
    } finally {
      setCalculating(false);
    }
  };

  const handleClear = () => {
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
      const res = await fetch(`${API_URL}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origem: { lat, lon },
          destino: { lat: dest.lat, lon: dest.lon },
        }),
      });
      if (!res.ok) return;
      const data: RouteResult = await res.json();
      mapRef.current?.showRoute?.(data.polyline, [lat, lon], [dest.lat, dest.lon]);
      setRoute(data);
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

  const searchInputs = (
    <>
      <AddressAutocomplete
        placeholder="Onde você está?"
        iconLeft="ion:location-outline"
        value={origemText}
        onChangeText={(v: string) => {
          setOrigemText(v);
          if (origemPlace) setOrigemPlace(null);
        }}
        onSelect={(p: PlaceSuggestion) => {
          setOrigemPlace(p);
          setOrigemText(p.label);
        }}
        zIndex={60}
      />
      <View style={[styles.divider, { backgroundColor: c.surfaceMuted }]} />
      <AddressAutocomplete
        placeholder="Para onde você vai?"
        iconLeft="ion:flag-outline"
        value={destinoText}
        onChangeText={(v: string) => {
          setDestinoText(v);
          if (destinoPlace) setDestinoPlace(null);
        }}
        onSelect={(p: PlaceSuggestion) => {
          setDestinoPlace(p);
          setDestinoText(p.label);
        }}
        zIndex={50}
      />
      {error ? (
        <View style={[styles.errorBox, { backgroundColor: c.danger + '11' }]}>
          <Icon name="ion:alert-circle-outline" size={16} color={c.danger} />
          <Text
            style={{ flex: 1, marginLeft: 8, color: c.danger, fontSize: 13 }}
            numberOfLines={3}
          >
            {error}
          </Text>
          <Pressable onPress={() => setError(null)} hitSlop={8}>
            <Icon name="ion:close" size={16} color={c.danger} />
          </Pressable>
        </View>
      ) : null}
    </>
  );

  const actionBlock = route ? (
    <NavigationPanel
      route={route}
      navigating={navigating}
      onStart={handleStartNav}
      onCancel={handleClear}
    />
  ) : (
    <Button
      label={calculating ? 'LIA está calculando...' : 'Otimizar rota'}
      variant="primary"
      size="lg"
      fullWidth
      loading={calculating}
      onPress={handleOptimize}
      icon="ion:flash-outline"
      disabled={!origemPlace || !destinoPlace}
    />
  );

  const mapControls = (
    <View style={[styles.rightStack, desktop ? styles.rightStackDesktop : null]}>
      <MapStyleToggle />
      <Pressable
        onPress={() => mapRef.current?.centerOnUser((m: string) => setError(m))}
        style={({ pressed }: { pressed: boolean }) => [
          styles.gpsBtn,
          {
            backgroundColor: c.surface,
            opacity: pressed ? 0.8 : 1,
            shadowColor: '#000',
          },
        ]}
      >
        <Icon name="ion:locate" size={20} color={c.text} />
      </Pressable>
    </View>
  );

  // ---------------------------------------------------------------- DESKTOP
  if (desktop) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <MapComponent ref={mapRef} />

        {/* Search card flutuante — top-left sobre mapa */}
        <View
          style={[
            styles.searchCardDesktopFloat,
            { backgroundColor: c.surface, shadowColor: '#000' },
          ]}
        >
          {searchInputs}
        </View>

        {/* Map controls — top-right */}
        {mapControls}

        {/* LIA indicator flutuante */}
        {liaStatus === 'thinking' ? (
          <View
            style={[
              styles.liaFloatDesktop,
              { backgroundColor: c.surface, shadowColor: '#000' },
            ]}
          >
            <LIAIndicator status="thinking" version="LIA 1.0" />
          </View>
        ) : null}

        {/* Action block — bottom-left flutuante */}
        <View style={styles.bottomDockDesktopFloat}>{actionBlock}</View>
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

      <View
        style={[
          styles.searchCard,
          { backgroundColor: c.surface, shadowColor: '#000' },
        ]}
      >
        {searchInputs}
      </View>

      {mapControls}

      {liaStatus === 'thinking' ? (
        <View
          style={[
            styles.liaFloat,
            { backgroundColor: c.surface, shadowColor: '#000' },
          ]}
        >
          <LIAIndicator status="thinking" version="LIA 1.0" />
        </View>
      ) : null}

      <View style={styles.bottomDock}>{actionBlock}</View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  searchCard: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 4,
    ...Platform.select({
      web: { boxShadow: '0 4px 16px rgba(0,0,0,0.16)' as any },
      default: {
        shadowOpacity: 0.16,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 4 },
        elevation: 8,
      },
    }),
    zIndex: 30,
  },
  divider: { height: 1, marginHorizontal: 4, marginBottom: 10, marginTop: -2 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    marginBottom: 10,
    marginTop: -4,
  },
  rightStack: {
    position: 'absolute',
    right: 16,
    bottom: 220,
    gap: 10,
    zIndex: 20,
  },
  gpsBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { boxShadow: '0 2px 8px rgba(0,0,0,0.16)' as any },
      default: {
        shadowOpacity: 0.16,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 8,
        elevation: 4,
      },
    }),
  },
  liaFloat: {
    position: 'absolute',
    top: 220,
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    ...Platform.select({
      web: { boxShadow: '0 4px 16px rgba(0,0,0,0.16)' as any },
      default: {
        shadowOpacity: 0.16,
        shadowOffset: { width: 0, height: 4 },
        shadowRadius: 16,
        elevation: 8,
      },
    }),
    zIndex: 20,
  },
  bottomDock: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    zIndex: 25,
  },
  // Desktop layout — search/action flutuantes sobre mapa
  searchCardDesktopFloat: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 400,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 4,
    ...Platform.select({
      web: { boxShadow: '0 4px 16px rgba(0,0,0,0.16)' as any },
      default: {},
    }),
    zIndex: 30,
  },
  bottomDockDesktopFloat: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    width: 400,
    zIndex: 25,
  },
  liaFloatDesktop: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    ...Platform.select({
      web: { boxShadow: '0 4px 16px rgba(0,0,0,0.16)' as any },
      default: {},
    }),
    zIndex: 20,
  },
  rightStackDesktop: {
    top: 16,
    bottom: undefined,
    right: 16,
  },
});
