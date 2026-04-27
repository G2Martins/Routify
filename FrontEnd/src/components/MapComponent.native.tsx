import React, { useImperativeHandle, forwardRef, useRef, useState } from 'react';
import MapView, { PROVIDER_DEFAULT, Polyline, Marker } from 'react-native-maps';
import { StyleSheet } from 'react-native';
import * as Location from 'expo-location';
import { Colors } from '../constants/Colors';

const BRASILIA_REGION = {
  latitude: -15.793889, longitude: -47.882778,
  latitudeDelta: 0.0922, longitudeDelta: 0.0421,
};

interface LatLon {
  latitude: number;
  longitude: number;
}

const MapComponent = forwardRef((props, ref) => {
  const mapRef = useRef<MapView>(null);
  const [routeCoords, setRouteCoords] = useState<LatLon[]>([]);
  const [origemCoord, setOrigemCoord] = useState<LatLon | null>(null);
  const [destinoCoord, setDestinoCoord] = useState<LatLon | null>(null);

  useImperativeHandle(ref, () => ({
    async centerOnUser() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        mapRef.current?.animateToRegion({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }, 1000);
      } catch (error) {
        console.log('Erro ao buscar localização:', error);
      }
    },

    showRoute(
      polyline: [number, number][],
      origemLatLon?: [number, number],
      destinoLatLon?: [number, number],
    ) {
      if (!polyline || polyline.length < 2) return;

      const coords = polyline.map(([lat, lon]) => ({ latitude: lat, longitude: lon }));
      setRouteCoords(coords);

      if (origemLatLon) {
        setOrigemCoord({ latitude: origemLatLon[0], longitude: origemLatLon[1] });
      }
      if (destinoLatLon) {
        setDestinoCoord({ latitude: destinoLatLon[0], longitude: destinoLatLon[1] });
      }

      // Centraliza no bounds da rota
      if (coords.length > 0 && mapRef.current) {
        mapRef.current.fitToCoordinates(coords, {
          edgePadding: { top: 80, right: 40, bottom: 120, left: 40 },
          animated: true,
        });
      }
    },

    clearRoute() {
      setRouteCoords([]);
      setOrigemCoord(null);
      setDestinoCoord(null);
    },
  }));

  return (
    <MapView
      ref={mapRef}
      provider={PROVIDER_DEFAULT}
      style={styles.map}
      initialRegion={BRASILIA_REGION}
      showsUserLocation
      showsMyLocationButton={false}
    >
      {routeCoords.length > 1 && (
        <Polyline
          coordinates={routeCoords}
          strokeColor={Colors.primary}
          strokeWidth={4}
          lineDashPattern={undefined}
        />
      )}
      {origemCoord && (
        <Marker coordinate={origemCoord} title="Origem" pinColor="#34C759" />
      )}
      {destinoCoord && (
        <Marker coordinate={destinoCoord} title="Destino" pinColor="#FF3B30" />
      )}
    </MapView>
  );
});

const styles = StyleSheet.create({
  map: { ...StyleSheet.absoluteFillObject },
});

export default MapComponent;
