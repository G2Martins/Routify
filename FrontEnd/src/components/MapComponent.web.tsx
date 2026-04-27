import React, { useImperativeHandle, forwardRef, useRef, useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';

// Leaflet é carregado dinamicamente para evitar erros de SSR e bundler no Expo
let L: any = null;
let MapReady = false;

function injectLeafletCSS() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('leaflet-css')) return;
  const link = document.createElement('link');
  link.id = 'leaflet-css';
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(link);
}

const BRASILIA_LAT = -15.793889;
const BRASILIA_LON = -47.882778;

// Tile layers (igual H-Drop)
const TILES = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap © CARTO',
  },
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
  },
};

const MapComponent = forwardRef((props, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const markerUserRef = useRef<any>(null);
  const markerOrigemRef = useRef<any>(null);
  const markerDestinoRef = useRef<any>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    injectLeafletCSS();

    async function initMap() {
      if (mapInstanceRef.current || !containerRef.current) return;

      // Importa Leaflet dinamicamente (seguro para Expo/Metro)
      L = await import('leaflet');

      // Corrige ícones padrão quebrados em bundlers
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([BRASILIA_LAT, BRASILIA_LON], 13);

      L.tileLayer(TILES.dark.url, {
        attribution: TILES.dark.attribution,
        maxZoom: 19,
      }).addTo(map);

      mapInstanceRef.current = map;
      MapReady = true;
      setMapLoaded(true);
    }

    initMap();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        MapReady = false;
      }
    };
  }, []);

  useImperativeHandle(ref, () => ({
    centerOnUser() {
      if (!MapReady || !mapInstanceRef.current) return;

      if (!navigator.geolocation) {
        alert('Geolocalização não suportada neste navegador.');
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude: lat, longitude: lon } = pos.coords;
          mapInstanceRef.current.setView([lat, lon], 15, { animate: true });

          if (markerUserRef.current) {
            markerUserRef.current.setLatLng([lat, lon]);
          } else {
            const icon = L.divIcon({
              html: `<div style="
                width:14px;height:14px;border-radius:50%;
                background:#0056D2;border:3px solid white;
                box-shadow:0 0 0 4px rgba(0,86,210,0.3);">
              </div>`,
              iconSize: [14, 14],
              iconAnchor: [7, 7],
              className: '',
            });
            markerUserRef.current = L.marker([lat, lon], { icon }).addTo(mapInstanceRef.current);
          }
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            alert('Permissão de localização negada. Clique no cadeado da URL e permita.');
          } else {
            alert('Não foi possível obter sua localização: ' + err.message);
          }
        },
        { enableHighAccuracy: true, timeout: 10000 },
      );
    },

    showRoute(
      polyline: [number, number][],
      origemCoord?: [number, number],
      destinoCoord?: [number, number],
    ) {
      if (!MapReady || !mapInstanceRef.current || !L) return;

      // Remove polyline anterior
      if (polylineRef.current) {
        polylineRef.current.remove();
      }

      if (!polyline || polyline.length < 2) return;

      // Desenha rota em azul Routify
      polylineRef.current = L.polyline(polyline, {
        color: '#0056D2',
        weight: 4,
        opacity: 0.85,
      }).addTo(mapInstanceRef.current);

      // Centraliza no bounds da rota
      mapInstanceRef.current.fitBounds(polylineRef.current.getBounds(), { padding: [40, 40] });

      // Marcador de origem (verde)
      if (origemCoord) {
        if (markerOrigemRef.current) markerOrigemRef.current.remove();
        const origemIcon = L.divIcon({
          html: `<div style="width:12px;height:12px;border-radius:50%;background:#34C759;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
          className: '',
        });
        markerOrigemRef.current = L.marker(origemCoord, { icon: origemIcon })
          .bindPopup('Origem')
          .addTo(mapInstanceRef.current);
      }

      // Marcador de destino (vermelho)
      if (destinoCoord) {
        if (markerDestinoRef.current) markerDestinoRef.current.remove();
        const destinoIcon = L.divIcon({
          html: `<div style="width:12px;height:12px;border-radius:50%;background:#FF3B30;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
          className: '',
        });
        markerDestinoRef.current = L.marker(destinoCoord, { icon: destinoIcon })
          .bindPopup('Destino')
          .addTo(mapInstanceRef.current);
      }
    },

    clearRoute() {
      if (polylineRef.current) {
        polylineRef.current.remove();
        polylineRef.current = null;
      }
      if (markerOrigemRef.current) {
        markerOrigemRef.current.remove();
        markerOrigemRef.current = null;
      }
      if (markerDestinoRef.current) {
        markerDestinoRef.current.remove();
        markerDestinoRef.current = null;
      }
    },
  }));

  return (
    <View style={styles.container}>
      {/* @ts-ignore — div é válido no contexto web */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </View>
  );
});

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: '#1a1a2e' },
});

export default MapComponent;
