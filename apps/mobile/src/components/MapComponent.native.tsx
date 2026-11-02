import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, {
  PROVIDER_DEFAULT,
  Polyline,
  Marker,
  MapType,
} from 'react-native-maps';
import * as Location from 'expo-location';
import { useTheme } from '../context/ThemeContext';
import { mapPalettes, trafficColors } from '../constants/Theme';
import { gruposTransito } from './mapa/transito';

// Mapa escuro do Google (Android) com a paleta do app; no iOS vale o modo escuro da Apple.
const ESC = mapPalettes.escuro;
const ESTILO_ESCURO_GOOGLE = [
  { elementType: 'geometry', stylers: [{ color: ESC.fundo }] },
  { elementType: 'labels.text.fill', stylers: [{ color: ESC.texto }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: ESC.halo }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: ESC.textoForte }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: ESC.agua }] },
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: ESC.verde }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: ESC.predio }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: ESC.viaMenor }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: ESC.viaMaiorBorda }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: ESC.viaMaior }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: ESC.expressa }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: ESC.trilho }] },
];

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
  const [trafego, setTrafego] = useState<(number | null)[] | null>(null);
  const alerta = trafficColors[mapStyle === 'street' ? 'light' : 'dark'];
  const transito = useMemo(
    () => gruposTransito(routeCoords.length, trafego).map(([a, b, nivel]) => ({ coords: routeCoords.slice(a, b + 1), nivel })),
    [routeCoords, trafego]
  );

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
      alternativa?: [number, number][] | null,
      trafegoRota?: (number | null)[] | null
    ) {
      if (!polyline || polyline.length < 2) return;
      // A linha sólida é só a via; o trecho até o ponto real (snap no grafo)
      // é desenhado tracejado pelos conectores abaixo, não emendado na rota.
      const coords = polyline.map(([lat, lon]) => ({ latitude: lat, longitude: lon }));
      setRouteCoords(coords);
      setTrafego(trafegoRota ?? null);
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
      setTrafego(null);
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
      customMapStyle={mapStyle === 'dark' ? ESTILO_ESCURO_GOOGLE : []}
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
      {/* Brilho da marca por baixo de tudo (o halo da versão web). */}
      {routeCoords.length > 1 ? (
        <Polyline coordinates={routeCoords} strokeColor={theme.colors.accentSoft} strokeWidth={16} lineCap="round" lineJoin="round" />
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
      {transito.map((t, i) => (
        <Polyline key={`t${i}`} coordinates={t.coords} strokeColor={alerta[t.nivel - 1]} strokeWidth={5} lineCap="round" lineJoin="round" />
      ))}
      {origemCoord ? (
        <Marker coordinate={origemCoord} title="Origem" anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <View style={[styles.ponto, { backgroundColor: theme.colors.teal, borderColor: theme.colors.surface }]} />
        </Marker>
      ) : null}
      {destinoCoord ? (
        <Marker coordinate={destinoCoord} title="Destino" anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}>
          <View style={styles.pino}>
            <View style={[styles.pinoCabeca, { backgroundColor: theme.colors.accent, borderColor: theme.colors.surface }]}>
              <View style={[styles.pinoMiolo, { backgroundColor: theme.colors.surface }]} />
            </View>
          </View>
        </Marker>
      ) : null}
    </MapView>
  );
});

MapComponent.displayName = 'MapComponent';

const styles = StyleSheet.create({
  map: { ...StyleSheet.absoluteFillObject },
  ponto: { width: 18, height: 18, borderRadius: 9, borderWidth: 3 },
  pino: { width: 30, height: 38, alignItems: 'center' },
  // Gota: quadrado com 3 cantos redondos girado 45°, a ponta para baixo.
  pinoCabeca: {
    width: 26, height: 26, borderRadius: 13, borderBottomRightRadius: 2, borderWidth: 3,
    transform: [{ rotate: '45deg' }], alignItems: 'center', justifyContent: 'center',
  },
  pinoMiolo: { width: 8, height: 8, borderRadius: 4 },
});

export default MapComponent;
