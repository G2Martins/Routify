import React, { useImperativeHandle, forwardRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';

const MapComponent = forwardRef((props, ref) => {
  const [lat, setLat] = useState(-15.793889);
  const [lon, setLon] = useState(-47.882778);

  useImperativeHandle(ref, () => ({
    centerOnUser() {
      if (navigator.geolocation) {
        console.log("Pedindo localização ao navegador...");
        
        navigator.geolocation.getCurrentPosition(
          (position) => {
            console.log("Localização encontrada com sucesso!");
            setLat(position.coords.latitude);
            setLon(position.coords.longitude);
          },
          (error) => {
            // Tratamento de erros específico
            if (error.code === error.PERMISSION_DENIED) {
              alert("Permissão negada! Você precisa clicar no cadeado ao lado da URL e permitir a localização.");
            } else if (error.code === error.POSITION_UNAVAILABLE) {
              alert("O PC não conseguiu determinar sua localização.");
            } else {
              alert("Erro: " + error.message);
            }
          },
          { enableHighAccuracy: true, timeout: 10000 } // Força a buscar com precisão
        );
      } else {
        alert("Geolocalização não suportada neste navegador.");
      }
    }
  }));

  const offset = 0.05;
  const bbox = `${lon - offset}%2C${lat - offset}%2C${lon + offset}%2C${lat + offset}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lon}`;

  return (
    <View style={styles.container}>
      <iframe
        title="Routify Map"
        width="100%"
        height="100%"
        frameBorder="0"
        src={src}
        style={{ border: 0, position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: '#E5E5EA' },
});

export default MapComponent;