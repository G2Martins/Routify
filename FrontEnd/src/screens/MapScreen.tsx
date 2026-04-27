import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/Colors';
import LIAIndicator, { LIAStatus } from '../components/LIAIndicator';

// @ts-ignore
import MapComponent from '../components/MapComponent';

// URL da API — alterar para URL do Railway/Render em produção
const API_URL = __DEV__ ? 'http://localhost:8000' : 'https://routify-api.railway.app';

interface GeoResult {
  lat: number;
  lon: number;
  display_name: string;
}

async function geocode(query: string): Promise<GeoResult | null> {
  // Nominatim (OpenStreetMap) — gratuito, sem key
  const q = encodeURIComponent(`${query}, Brasília, DF, Brasil`);
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Routify/1.0 TCC' },
    });
    const data = await res.json();
    if (!data || data.length === 0) return null;
    return {
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
      display_name: data[0].display_name,
    };
  } catch {
    return null;
  }
}

export default function MapScreen() {
  const [origem, setOrigem] = useState('');
  const [destino, setDestino] = useState('');
  const [liaStatus, setLiaStatus] = useState<LIAStatus>('idle');
  const [loading, setLoading] = useState(false);
  const [routeInfo, setRouteInfo] = useState<{ tempo: number; distancia: number } | null>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      mapRef.current?.centerOnUser();
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  const handleCenterLocation = () => {
    mapRef.current?.centerOnUser();
  };

  const handleOptimizeRoute = async () => {
    if (!origem.trim() || !destino.trim()) {
      Alert.alert('Campos obrigatórios', 'Preencha a origem e o destino.');
      return;
    }

    setLoading(true);
    setLiaStatus('thinking');
    setRouteInfo(null);
    mapRef.current?.clearRoute?.();

    try {
      // Geocodifica os dois endereços em paralelo
      const [origemGeo, destinoGeo] = await Promise.all([
        geocode(origem),
        geocode(destino),
      ]);

      if (!origemGeo) {
        Alert.alert('Endereço não encontrado', `Origem "${origem}" não encontrada em Brasília.`);
        setLiaStatus('idle');
        return;
      }
      if (!destinoGeo) {
        Alert.alert('Endereço não encontrado', `Destino "${destino}" não encontrado em Brasília.`);
        setLiaStatus('idle');
        return;
      }

      // Chama API Routify
      const response = await fetch(`${API_URL}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origem: { lat: origemGeo.lat, lon: origemGeo.lon },
          destino: { lat: destinoGeo.lat, lon: destinoGeo.lon },
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `Erro ${response.status}`);
      }

      const data = await response.json();

      // Desenha rota no mapa
      mapRef.current?.showRoute?.(
        data.polyline,
        [origemGeo.lat, origemGeo.lon],
        [destinoGeo.lat, destinoGeo.lon],
      );

      setRouteInfo({ tempo: data.tempo_total_seg, distancia: data.distancia_km });
      setLiaStatus('done');

      // Volta para idle após 3 segundos
      setTimeout(() => setLiaStatus('idle'), 3000);
    } catch (err: any) {
      Alert.alert('Erro ao calcular rota', err.message || 'Verifique se a API está rodando.');
      setLiaStatus('idle');
    } finally {
      setLoading(false);
    }
  };

  const webInputStyle = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {};

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <MapComponent ref={mapRef} />

      {/* Card de busca */}
      <View style={styles.searchContainer}>
        <View style={styles.inputWrapper}>
          <Ionicons name="location-outline" size={20} color={Colors.primary} style={styles.icon} />
          <TextInput
            style={[styles.input, webInputStyle]}
            placeholder="Ponto de Origem"
            value={origem}
            onChangeText={setOrigem}
            placeholderTextColor={Colors.gray}
            returnKeyType="next"
          />
        </View>
        <View style={styles.divider} />
        <View style={styles.inputWrapper}>
          <Ionicons name="flag-outline" size={20} color={Colors.danger} style={styles.icon} />
          <TextInput
            style={[styles.input, webInputStyle]}
            placeholder="Destino Final"
            value={destino}
            onChangeText={setDestino}
            placeholderTextColor={Colors.gray}
            returnKeyType="done"
            onSubmitEditing={handleOptimizeRoute}
          />
        </View>
      </View>

      {/* Info da rota calculada */}
      {routeInfo && (
        <View style={styles.routeInfoCard}>
          <LIAIndicator status={liaStatus} />
          <View style={styles.routeStats}>
            <Text style={styles.routeStatValue}>{Math.round(routeInfo.tempo / 60)} min</Text>
            <Text style={styles.routeStatLabel}>Tempo LIA</Text>
          </View>
          <View style={styles.routeStats}>
            <Text style={styles.routeStatValue}>{routeInfo.distancia} km</Text>
            <Text style={styles.routeStatLabel}>Distância</Text>
          </View>
        </View>
      )}

      {/* Botão GPS */}
      <TouchableOpacity style={styles.locationButton} onPress={handleCenterLocation}>
        <Ionicons name="locate" size={25} color={Colors.primary} />
      </TouchableOpacity>

      {/* FAB Otimizar */}
      <TouchableOpacity
        style={[styles.fab, loading && styles.fabDisabled]}
        onPress={handleOptimizeRoute}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={Colors.white} size="small" style={{ marginRight: 8 }} />
        ) : (
          <Ionicons name="navigate" size={20} color={Colors.white} style={{ marginRight: 8 }} />
        )}
        <Text style={styles.fabText}>
          {loading ? 'Calculando...' : 'Otimizar Rota'}
        </Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchContainer: {
    position: 'absolute', top: 50, left: 20, right: 20,
    backgroundColor: Colors.white, borderRadius: 12, padding: 10,
    elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 5, zIndex: 1,
  },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  icon: { marginRight: 10 },
  input: { flex: 1, fontSize: 16, color: Colors.text },
  divider: { height: 1, backgroundColor: '#E5E5EA', marginVertical: 4, marginLeft: 30 },
  routeInfoCard: {
    position: 'absolute', bottom: 100, left: 20, right: 20,
    backgroundColor: Colors.white, borderRadius: 12, padding: 14,
    flexDirection: 'row', alignItems: 'center',
    elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2, shadowRadius: 4, zIndex: 1,
    gap: 12,
  },
  routeStats: { alignItems: 'center', flex: 1 },
  routeStatValue: { fontSize: 18, fontWeight: 'bold', color: Colors.text },
  routeStatLabel: { fontSize: 11, color: Colors.gray, marginTop: 2 },
  locationButton: {
    position: 'absolute', bottom: 185, right: 20,
    backgroundColor: Colors.white, width: 50, height: 50, borderRadius: 25,
    justifyContent: 'center', alignItems: 'center',
    elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25, shadowRadius: 3.84, zIndex: 1,
  },
  fab: {
    position: 'absolute', bottom: 120, right: 20,
    backgroundColor: Colors.primary, flexDirection: 'row', alignItems: 'center',
    paddingVertical: 15, paddingHorizontal: 25, borderRadius: 30,
    elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25, shadowRadius: 3.84, zIndex: 1,
  },
  fabDisabled: { backgroundColor: Colors.gray, opacity: 0.7 },
  fabText: { color: Colors.white, fontWeight: 'bold', fontSize: 16 },
});
