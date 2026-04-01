import React, { useImperativeHandle, forwardRef, useRef } from 'react';
import MapView, { PROVIDER_DEFAULT } from 'react-native-maps';
import { StyleSheet } from 'react-native';
import * as Location from 'expo-location';

const BRASILIA_REGION = {
  latitude: -15.793889, longitude: -47.882778,
  latitudeDelta: 0.0922, longitudeDelta: 0.0421,
};

const MapComponent = forwardRef((props, ref) => {
  const mapRef = useRef<MapView>(null);

  useImperativeHandle(ref, () => ({
    async centerOnUser() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.log('Permissão de localização negada pelo usuário.');
          return;
        }

        const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        mapRef.current?.animateToRegion({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }, 1000);
      } catch (error) {
        console.log("Erro ao buscar localização: ", error);
      }
    }
  }));

  return (
    <MapView
      ref={mapRef}
      provider={PROVIDER_DEFAULT}
      style={styles.map}
      initialRegion={BRASILIA_REGION}
      showsUserLocation={true}
      showsMyLocationButton={false}
    />
  );
});

const styles = StyleSheet.create({
  map: { ...StyleSheet.absoluteFillObject },
});

export default MapComponent;