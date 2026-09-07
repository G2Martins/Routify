import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import MapView, {
  PROVIDER_DEFAULT,
  Polyline,
  Marker,
  UrlTile,
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
      destinoLatLon?: [number, number]
    ) {
      if (!polyline || polyline.length < 2) return;
      const coords = polyline.map(([lat, lon]) => ({ latitude: lat, longitude: lon }));
      // Backend snap-a origem/destino para o nó mais próximo do grafo;
      // estende a linha até as coords reais para tocar os marcadores.
      if (origemLatLon) {
        const head = coords[0];
        if (head.latitude !== origemLatLon[0] || head.longitude !== origemLatLon[1]) {
          coords.unshift({ latitude: origemLatLon[0], longitude: origemLatLon[1] });
        }
      }
      if (destinoLatLon) {
        const tail = coords[coords.length - 1];
        if (tail.latitude !== destinoLatLon[0] || tail.longitude !== destinoLatLon[1]) {
          coords.push({ latitude: destinoLatLon[0], longitude: destinoLatLon[1] });
        }
      }
      setRouteCoords(coords);
      if (origemLatLon) setOrigemCoord({ latitude: origemLatLon[0], longitude: origemLatLon[1] });
      if (destinoLatLon)
        setDestinoCoord({ latitude: destinoLatLon[0], longitude: destinoLatLon[1] });
      if (coords.length > 0 && mapRef.current) {
        mapRef.current.fitToCoordinates(coords, {
          edgePadding: { top: 100, right: 60, bottom: 220, left: 60 },
          animated: true,
        });
      }
    },

    clearRoute() {
      setRouteCoords([]);
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
  // Dark: standard + UrlTile do CartoDB para overlay
  const mapType: MapType = mapStyle === 'satellite' ? 'hybrid' : 'standard';

  return (
    <MapView
      ref={mapRef}
      provider={PROVIDER_DEFAULT}
      style={styles.map}
      initialRegion={BRASILIA_REGION}
      mapType={mapType}
      showsUserLocation
      showsMyLocationButton={false}
    >
      {mapStyle === 'dark' ? (
        <UrlTile
          urlTemplate="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          maximumZ={19}
          flipY={false}
          shouldReplaceMapContent
        />
      ) : null}
      {routeCoords.length > 1 ? (
        <Polyline
          coordinates={routeCoords}
          strokeColor={theme.colors.accent}
          strokeWidth={5}
        />
      ) : null}
      {origemCoord ? (
        <Marker coordinate={origemCoord} title="Origem" pinColor="#06C167" />
      ) : null}
      {destinoCoord ? (
        <Marker coordinate={destinoCoord} title="Destino" pinColor="#E11900" />
      ) : null}
    </MapView>
  );
});

MapComponent.displayName = 'MapComponent';

const styles = StyleSheet.create({
  map: { ...StyleSheet.absoluteFillObject },
});

export default MapComponent;
