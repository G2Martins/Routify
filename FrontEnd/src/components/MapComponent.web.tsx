/**
 * MapComponent (web) — Leaflet com 3 estilos de tile + correção de geolocalização.
 *
 * Geolocalização do navegador exige:
 *   - Origem segura (HTTPS) OU localhost. http://192.168.x.x não funciona.
 *   - Permissão concedida pelo usuário no popup do navegador.
 *
 * Usa o ThemeContext para escolher tile style (dark/street/satellite).
 */
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { MAP_TILE_URLS } from '../constants/Theme';

let L: any = null;

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

const MapComponent = forwardRef((_props, ref) => {
  const { mapStyle, theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const markerUserRef = useRef<any>(null);
  const markerOrigemRef = useRef<any>(null);
  const markerDestinoRef = useRef<any>(null);
  const [, setMapLoaded] = useState(false);

  // Inicializa o mapa uma única vez
  useEffect(() => {
    injectLeafletCSS();

    async function initMap() {
      if (mapInstanceRef.current || !containerRef.current) return;
      L = await import('leaflet');

      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const map = L.map(containerRef.current, {
        zoomControl: false,
        attributionControl: true,
      }).setView([BRASILIA_LAT, BRASILIA_LON], 13);

      const tile = MAP_TILE_URLS[mapStyle];
      tileLayerRef.current = L.tileLayer(tile.url, {
        attribution: tile.attribution,
        maxZoom: 19,
      }).addTo(map);

      mapInstanceRef.current = map;
      setMapLoaded(true);
    }

    initMap();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Troca tiles ao mudar o estilo
  useEffect(() => {
    if (!mapInstanceRef.current || !L) return;
    if (tileLayerRef.current) tileLayerRef.current.remove();
    const tile = MAP_TILE_URLS[mapStyle];
    tileLayerRef.current = L.tileLayer(tile.url, {
      attribution: tile.attribution,
      maxZoom: 19,
    }).addTo(mapInstanceRef.current);
  }, [mapStyle]);

  useImperativeHandle(ref, () => ({
    centerOnUser(onError?: (msg: string) => void) {
      if (!mapInstanceRef.current) return;

      if (typeof window === 'undefined' || !navigator.geolocation) {
        onError?.('Geolocalização não suportada neste navegador.');
        return;
      }

      // Geolocation API só funciona em HTTPS ou localhost
      const isSecure =
        window.isSecureContext ||
        location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1';
      if (!isSecure) {
        onError?.(
          'Geolocalização requer HTTPS ou localhost. Acesse via https:// ou http://localhost:8081'
        );
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
              html: `<div style="width:14px;height:14px;border-radius:50%;background:#0056D2;border:3px solid white;box-shadow:0 0 0 6px rgba(0,86,210,0.25);animation:pulse 2s ease-in-out infinite;"></div>`,
              iconSize: [14, 14],
              iconAnchor: [7, 7],
              className: '',
            });
            markerUserRef.current = L.marker([lat, lon], { icon }).addTo(mapInstanceRef.current);
          }
        },
        (err) => {
          let msg = 'Não foi possível obter sua localização.';
          if (err.code === err.PERMISSION_DENIED) {
            msg = 'Permissão de localização negada. Clique no cadeado da URL e libere.';
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            msg = 'Localização indisponível. Verifique GPS/Wi-Fi.';
          } else if (err.code === err.TIMEOUT) {
            msg = 'Tempo esgotado tentando obter localização.';
          }
          onError?.(msg);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60_000 }
      );
    },

    showRoute(
      polyline: [number, number][],
      origemCoord?: [number, number],
      destinoCoord?: [number, number]
    ) {
      if (!mapInstanceRef.current || !L) return;

      if (polylineRef.current) polylineRef.current.remove();
      if (!polyline || polyline.length < 2) return;

      polylineRef.current = L.polyline(polyline, {
        color: theme.colors.accent,
        weight: 5,
        opacity: 0.9,
      }).addTo(mapInstanceRef.current);

      mapInstanceRef.current.fitBounds(polylineRef.current.getBounds(), {
        padding: [60, 60],
      });

      if (origemCoord) {
        if (markerOrigemRef.current) markerOrigemRef.current.remove();
        const origemIcon = L.divIcon({
          html: `<div style="width:14px;height:14px;border-radius:50%;background:#06C167;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
          className: '',
        });
        markerOrigemRef.current = L.marker(origemCoord, { icon: origemIcon })
          .bindPopup('Origem')
          .addTo(mapInstanceRef.current);
      }
      if (destinoCoord) {
        if (markerDestinoRef.current) markerDestinoRef.current.remove();
        const destinoIcon = L.divIcon({
          html: `<div style="width:14px;height:14px;border-radius:50%;background:#E11900;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
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
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* @ts-ignore — div é válido no contexto web */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </View>
  );
});

MapComponent.displayName = 'MapComponent';

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject },
});

export default MapComponent;
