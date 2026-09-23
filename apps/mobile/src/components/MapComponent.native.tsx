import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import MapView, {
  PROVIDER_DEFAULT,
  Polyline,
  Marker,
  MapType,
} from 'react-native-maps';
import * as Location from 'expo-location';
import { useTheme } from '../context/ThemeContext';

const BRASILIA_REGION = {
  latitude: -15.793889,
  longitude: -47.882778,
  latitudeDelta: 0.0922,
  longitudeDelta: 0.0421,
};

interface LatLon {
  latitude: number;
  longitude: number;
}

const MapComponent = forwardRef((_props, ref) => {
  const { mapStyle, theme } = useTheme();
  const mapRef = useRef<MapView>(null);
  const watchSubRef = useRef<Location.LocationSubscription | null>(null);
  const [routeCoords, setRouteCoords] = useState<LatLon[]>([]);
  const [origemCoord, setOrigemCoord] = useState<LatLon | null>(null);
  const [destinoCoord, setDestinoCoord] = useState<LatLon | null>(null);
  const [altCoords, setAltCoords] = useState<LatLon[]>([]);

  useImperativeHandle(ref, () => ({
    async centerOnUser(onError?: (msg: string) => void) {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          onError?.('Permissão de localização negada nas configurações.');
          return;
        }
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        mapRef.current?.animateToRegion(
          {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          },
          1000
        );
      } catch (error: any) {
        onError?.(error?.message ?? 'Erro ao obter localização');
      }
    },

    showRoute(
      polyline: [number, number][],
      origemLatLon?: [number, number],
      destinoLatLon?: [number, number],
      alternativa?: [number, number][] | null
    ) {
      if (!polyline || polyline.length < 2) return;
      // A linha sólida é só a via; o trecho até o ponto real (snap no grafo)
      // é desenhado tracejado pelos conectores abaixo, não emendado na rota.
      const coords = polyline.map(([lat, lon]) => ({ latitude: lat, longitude: lon }));
      setRouteCoords(coords);
      setAltCoords((alternativa ?? []).map(([lat, lon]) => ({ latitude: lat, longitude: lon })));
      if (origemLatLon) setOrigemCoord({ latitude: origemLatLon[0], longitude: origemLatLon[1] });
      if (destinoLatLon)
        setDestinoCoord({ latitude: destinoLatLon[0], longitude: destinoLatLon[1] });
      if (coords.length > 0 && mapRef.current) {
        mapRef.current.fitToCoordinates(coords, {
          edgePadding: { top: 260, right: 72, bottom: 260, left: 40 }, // painéis flutuantes
          animated: true,
        });
      }
    },

    clearRoute() {
      setRouteCoords([]);
      setAltCoords([]);
      setOrigemCoord(null);
      setDestinoCoord(null);
    },

    async startFollow(
      onError?: (msg: string) => void,
      onLocation?: (lat: number, lon: number) => void
    ) {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          onError?.('Permissão de localização negada.');
          return;
        }
        if (watchSubRef.current) return;
        watchSubRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            distanceInterval: 5,
            timeInterval: 2_000,
          },
          (loc) => {
            const { latitude, longitude } = loc.coords;
            mapRef.current?.animateToRegion(
              {
                latitude,
                longitude,
                latitudeDelta: 0.005,
                longitudeDelta: 0.005,
              },
              700
            );
            onLocation?.(latitude, longitude);
          }
        );
      } catch (e: any) {
        onError?.(e?.message ?? 'Erro ao iniciar follow.');
      }
    },

    stopFollow() {
      if (watchSubRef.current) {
        watchSubRef.current.remove();
        watchSubRef.current = null;
      }
    },
  }));

  // Mapeia mapStyle do app para mapType nativo
  // Satellite: usa tipo nativo (já tem Esri)
  // Street: standard
  // Dark: mapa nativo em modo escuro. O overlay CARTO saiu (passou a exigir API key).
  // ponytail: userInterfaceStyle só vale no iOS; no Android o escuro cai no mapa padrão.
  const mapType: MapType = mapStyle === 'satellite' ? 'hybrid' : 'standard';

  return (
    <MapView
      ref={mapRef}
      provider={PROVIDER_DEFAULT}
      style={styles.map}
      initialRegion={BRASILIA_REGION}
      mapType={mapType}
      userInterfaceStyle={mapStyle === 'dark' ? 'dark' : 'light'}
      showsUserLocation
      showsMyLocationButton={false}
    >
      {altCoords.length > 1 ? (
        <Polyline coordinates={altCoords} strokeColor={theme.colors.textMuted} strokeWidth={4} lineDashPattern={[8, 8]} />
      ) : null}
      {routeCoords.length > 1 && origemCoord ? (
        <Polyline coordinates={[origemCoord, routeCoords[0]]} strokeColor={theme.colors.textMuted} strokeWidth={3} lineDashPattern={[2, 6]} />
      ) : null}
      {routeCoords.length > 1 && destinoCoord ? (
        <Polyline coordinates={[routeCoords[routeCoords.length - 1], destinoCoord]} strokeColor={theme.colors.textMuted} strokeWidth={3} lineDashPattern={[2, 6]} />
      ) : null}
      {/* Contorno largo na cor da superfície por baixo: a rota lê em qualquer estilo. */}
      {routeCoords.length > 1 ? (
        <Polyline
          coordinates={routeCoords}
          strokeColor={theme.colors.surface}
          strokeWidth={9}
          lineCap="round"
          lineJoin="round"
        />
      ) : null}
      {routeCoords.length > 1 ? (
        <Polyline
          coordinates={routeCoords}
          strokeColor={theme.colors.accent}
          strokeWidth={5}
          lineCap="round"
          lineJoin="round"
        />
      ) : null}
      {origemCoord ? (
        <Marker coordinate={origemCoord} title="Origem" pinColor={theme.colors.teal} />
      ) : null}
      {destinoCoord ? (
        <Marker coordinate={destinoCoord} title="Destino" pinColor={theme.colors.accent} />
      ) : null}
    </MapView>
  );
});

MapComponent.displayName = 'MapComponent';

const styles = StyleSheet.create({
  map: { ...StyleSheet.absoluteFillObject },
});

export default MapComponent;
