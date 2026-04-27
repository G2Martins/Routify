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
  const watchIdRef = useRef<number | null>(null);
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

      const placeUser = (lat: number, lon: number, zoom = 15) => {
        mapInstanceRef.current.setView([lat, lon], zoom, { animate: true });
        if (markerUserRef.current) {
          markerUserRef.current.setLatLng([lat, lon]);
        } else {
          const icon = L.divIcon({
            html: `<div style="width:14px;height:14px;border-radius:50%;background:#026BF8;border:3px solid white;box-shadow:0 0 0 6px rgba(2,107,248,0.25);"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
            className: '',
          });
          markerUserRef.current = L.marker([lat, lon], { icon }).addTo(mapInstanceRef.current);
        }
      };

      const tryIpFallback = async () => {
        // Última tentativa — geo por IP. Precisão ~cidade, só pra centralizar mapa.
        const endpoints = [
          'https://ipapi.co/json/',
          'https://ipwho.is/',
        ];
        for (const url of endpoints) {
          try {
            const r = await fetch(url);
            if (!r.ok) continue;
            const j = await r.json();
            const lat = Number(j.latitude ?? j.lat);
            const lon = Number(j.longitude ?? j.lon);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
              console.info('[Routify] geo IP fallback', { url, lat, lon, src: j });
              placeUser(lat, lon, 12);
              return true;
            }
          } catch (e) {
            console.warn('[Routify] geo IP fallback fail', url, e);
          }
        }
        return false;
      };

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude: lat, longitude: lon, accuracy } = pos.coords;
          console.info('[Routify] geo OK', { lat, lon, accuracy });
          placeUser(lat, lon);
        },
        async (err) => {
          // Diagnóstico aprofundado — código + nome + permissão atual.
          const codeName =
            err.code === err.PERMISSION_DENIED
              ? 'PERMISSION_DENIED'
              : err.code === err.POSITION_UNAVAILABLE
              ? 'POSITION_UNAVAILABLE'
              : err.code === err.TIMEOUT
              ? 'TIMEOUT'
              : `UNKNOWN(${err.code})`;
          let permState = 'n/a';
          try {
            const perm = await (navigator as any).permissions?.query?.({
              name: 'geolocation',
            });
            permState = perm?.state ?? 'n/a';
          } catch {
            // permissions API indisponível
          }
          console.warn('[Routify] geo FAIL', {
            code: err.code,
            name: codeName,
            message: err.message,
            permission: permState,
            isSecureContext: window.isSecureContext,
            host: location.hostname,
            ua: navigator.userAgent,
          });

          // POSITION_UNAVAILABLE em Windows sem GPS é comum; tenta IP fallback.
          if (err.code === err.POSITION_UNAVAILABLE || err.code === err.TIMEOUT) {
            const ok = await tryIpFallback();
            if (ok) {
              onError?.(
                'GPS indisponível — usando localização aproximada por IP. Veja console pra detalhes.'
              );
              return;
            }
          }

          let msg: string;
          if (err.code === err.PERMISSION_DENIED) {
            msg = 'Permissão negada. Cadeado da URL → permitir localização.';
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            msg = 'Localização indisponível (GPS/Wi-Fi off). Veja console pra diagnóstico.';
          } else if (err.code === err.TIMEOUT) {
            msg = 'Timeout obtendo localização. Tente novamente.';
          } else {
            msg = `Erro desconhecido (${codeName}). Veja console.`;
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

      // Backend faz snap origem/destino para o nó mais próximo do grafo OSM,
      // então prepende/anexa as coords reais para a linha tocar os marcadores.
      const fullLine: [number, number][] = [...(polyline as [number, number][])];
      if (origemCoord) {
        const [a, b] = fullLine[0];
        if (a !== origemCoord[0] || b !== origemCoord[1]) fullLine.unshift(origemCoord);
      }
      if (destinoCoord) {
        const last = fullLine[fullLine.length - 1];
        if (last[0] !== destinoCoord[0] || last[1] !== destinoCoord[1]) {
          fullLine.push(destinoCoord);
        }
      }

      polylineRef.current = L.polyline(fullLine, {
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

    startFollow(
      onError?: (msg: string) => void,
      onLocation?: (lat: number, lon: number) => void
    ) {
      if (!mapInstanceRef.current || typeof window === 'undefined' || !navigator.geolocation) {
        onError?.('Geolocalização indisponível.');
        return;
      }
      const isSecure =
        window.isSecureContext ||
        location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1';
      if (!isSecure) {
        onError?.('Geolocalização requer HTTPS ou localhost.');
        return;
      }
      if (watchIdRef.current !== null) return;
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude: lat, longitude: lon } = pos.coords;
          if (!mapInstanceRef.current) return;
          mapInstanceRef.current.setView([lat, lon], 17, { animate: true });
          if (markerUserRef.current) {
            markerUserRef.current.setLatLng([lat, lon]);
          } else if (L) {
            const icon = L.divIcon({
              html: `<div style="width:14px;height:14px;border-radius:50%;background:#026BF8;border:3px solid white;box-shadow:0 0 0 6px rgba(2,107,248,0.25);"></div>`,
              iconSize: [14, 14],
              iconAnchor: [7, 7],
              className: '',
            });
            markerUserRef.current = L.marker([lat, lon], { icon }).addTo(mapInstanceRef.current);
          }
          onLocation?.(lat, lon);
        },
        (err) => onError?.(err.message || 'Erro de localização.'),
        { enableHighAccuracy: true, maximumAge: 2_000, timeout: 10_000 }
      );
    },

    stopFollow() {
      if (watchIdRef.current !== null && navigator?.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
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
