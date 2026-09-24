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
  link.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(link);
}

const BRASILIA_LAT = -15.793889;
const BRASILIA_LON = -47.882778;

function criarTiles(map: any, style: keyof typeof MAP_TILE_URLS) {
  const tile = MAP_TILE_URLS[style];
  const camada = L.tileLayer(tile.url, { attribution: tile.attribution, maxZoom: 19 }).addTo(map);
  // O filtro vai no container da camada: marcadores e a linha da rota não são afetados.
  camada.getContainer().style.filter = tile.filtro ?? '';
  return camada;
}

type Cores = ReturnType<typeof useTheme>['theme']['colors'];

/** A linha "se desenha" do início ao fim (SVG stroke-dashoffset). Sem animação se o
 * sistema pede menos movimento. Depois limpa o tracejado: o zoom redesenha o caminho. */
function desenhar(camada: any, ms = 1100) {
  const path: SVGPathElement | undefined = camada?.getElement?.();
  if (!path || typeof path.getTotalLength !== 'function') return;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const total = path.getTotalLength();
  path.style.strokeDasharray = `${total}`;
  path.style.strokeDashoffset = `${total}`;
  path.getBoundingClientRect(); // força o estilo inicial antes da transição
  path.style.transition = `stroke-dashoffset ${ms}ms cubic-bezier(0.16, 1, 0.3, 1)`;
  path.style.strokeDashoffset = '0';
  const limpar = () => {
    path.style.transition = '';
    path.style.strokeDasharray = '';
    path.style.strokeDashoffset = '';
  };
  path.addEventListener('transitionend', limpar, { once: true });
}

// Marcadores em HTML de divIcon montado só com tokens do tema (nenhum dado do usuário entra aqui).
function iconePonto(cor: string, c: Cores, halo?: string) {
  const sombra = `0 1px 4px ${c.shadowMedium}` + (halo ? `, 0 0 0 6px ${halo}` : '');
  return L.divIcon({
    html: `<div style="box-sizing:border-box;width:18px;height:18px;border-radius:50%;background:${cor};border:3px solid ${c.surface};box-shadow:${sombra};"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    className: '',
  });
}

function iconePino(c: Cores) {
  // Gota girada 45°: a ponta fica ~18 px abaixo do centro do quadrado de 26 px.
  return L.divIcon({
    html: `<div style="box-sizing:border-box;width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${c.accent};border:3px solid ${c.surface};box-shadow:0 2px 6px ${c.shadowMedium};display:flex;align-items:center;justify-content:center;"><div style="width:7px;height:7px;border-radius:50%;background:${c.surface};"></div></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 31],
    popupAnchor: [0, -28],
    className: '',
  });
}

const MapComponent = forwardRef((_props, ref) => {
  const { mapStyle, theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const contornoRef = useRef<any>(null);
  const alternativaRef = useRef<any>(null);
  const conectoresRef = useRef<any[]>([]);
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
        iconRetinaUrl: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const map = L.map(containerRef.current, {
        zoomControl: false,
        attributionControl: true,
      }).setView([BRASILIA_LAT, BRASILIA_LON], 13);

      tileLayerRef.current = criarTiles(map, mapStyle);
      // Crédito das fontes de dados exibidas (os termos da TomTom e a licença CC BY do Open-Meteo pedem).
      map.attributionControl.addAttribution('Trânsito © TomTom · Tempo: Open-Meteo');
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
    tileLayerRef.current = criarTiles(mapInstanceRef.current, mapStyle);
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
          const icon = iconePonto(theme.colors.accent, theme.colors, theme.colors.ring);
          markerUserRef.current = L.marker([lat, lon], { icon }).addTo(mapInstanceRef.current);
        }
      };

      const codeName = (err: GeolocationPositionError) =>
        err.code === err.PERMISSION_DENIED
          ? 'PERMISSION_DENIED'
          : err.code === err.POSITION_UNAVAILABLE
          ? 'POSITION_UNAVAILABLE'
          : err.code === err.TIMEOUT
          ? 'TIMEOUT'
          : `UNKNOWN(${err.code})`;

      const logFail = async (label: string, err: GeolocationPositionError) => {
        let permState = 'n/a';
        try {
          const perm = await (navigator as any).permissions?.query?.({ name: 'geolocation' });
          permState = perm?.state ?? 'n/a';
        } catch {
          // permissions API indisponível
        }
        console.warn(`[Routify] geo ${label} FAIL`, {
          code: err.code,
          name: codeName(err),
          message: err.message,
          permission: permState,
          isSecureContext: window.isSecureContext,
          host: location.hostname,
          ua: navigator.userAgent,
        });
      };

      // Edge usa exclusivamente Windows Geolocation Service (lfsvc).
      // Se lfsvc estiver desabilitado, HIGH e LOW falham com POSITION_UNAVAILABLE
      // pelo mesmo motivo — não adianta tentar LOW. Chrome/Firefox usam
      // Google Location API próprio e funcionam sem lfsvc.
      const isEdge = /\bEdg\//.test(navigator.userAgent);

      const tryGeo = (highAccuracy: boolean): Promise<GeolocationPosition> =>
        new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: highAccuracy,
            timeout: isEdge ? (highAccuracy ? 4000 : 6000) : highAccuracy ? 8000 : 12000,
            maximumAge: 60_000,
          });
        });

      const tryIpFallback = async () => {
        // Endpoints CORS-friendly. Precisão ~cidade, só pra centralizar.
        const endpoints = [
          'https://ipapi.co/json/',
          'https://ipwho.is/',
          'https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=pt',
          'https://geolocation-db.com/json/',
        ];
        for (const url of endpoints) {
          try {
            const r = await fetch(url);
            if (!r.ok) {
              console.warn('[Routify] geo IP', url, 'status', r.status);
              continue;
            }
            const j = await r.json();
            const lat = Number(j.latitude ?? j.lat);
            const lon = Number(j.longitude ?? j.lon ?? j.longitude);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
              console.info('[Routify] geo IP fallback OK', { url, lat, lon });
              placeUser(lat, lon, 12);
              return true;
            }
            console.warn('[Routify] geo IP no coords', url, j);
          } catch (e) {
            console.warn('[Routify] geo IP fail', url, e);
          }
        }
        return false;
      };

      (async () => {
        // 1) High-accuracy (GPS)
        try {
          const pos = await tryGeo(true);
          const { latitude: lat, longitude: lon, accuracy } = pos.coords;
          console.info('[Routify] geo HIGH OK', { lat, lon, accuracy });
          placeUser(lat, lon);
          return;
        } catch (err) {
          await logFail('HIGH', err as GeolocationPositionError);
          const code = (err as GeolocationPositionError).code;
          if (code === 1) {
            // PERMISSION_DENIED — não adianta tentar low ou IP, usuário bloqueou.
            onError?.('Permissão negada. Cadeado da URL → permitir localização.');
            return;
          }
          // Edge + POSITION_UNAVAILABLE = lfsvc desligado. LOW vai falhar igual,
          // pula direto pra IP fallback.
          if (isEdge && code === 2) {
            console.warn('[Routify] geo skipping LOW on Edge (lfsvc unavailable)');
            const ipOkEdge = await tryIpFallback();
            onError?.(
              ipOkEdge
                ? 'Edge sem acesso à Localização do Windows. Usando IP. Ative o serviço lfsvc ou use Chrome.'
                : 'Edge não tem acesso ao serviço de Localização do Windows. Ative em Configurações → Privacidade → Localização, ou abra no Chrome.'
            );
            return;
          }
        }

        // 2) Low-accuracy (Wi-Fi/network — funciona em PC sem GPS)
        try {
          const pos = await tryGeo(false);
          const { latitude: lat, longitude: lon, accuracy } = pos.coords;
          console.info('[Routify] geo LOW OK', { lat, lon, accuracy });
          placeUser(lat, lon, 14);
          return;
        } catch (err) {
          await logFail('LOW', err as GeolocationPositionError);
        }

        // 3) IP geolocation
        const ipOk = await tryIpFallback();
        if (ipOk) {
          onError?.('Localização aproximada por IP (PC sem GPS). Console tem detalhes.');
          return;
        }

        onError?.('Localização indisponível em todos os métodos. Verifique console.');
      })();
    },

    showRoute(
      polyline: [number, number][],
      origemCoord?: [number, number],
      destinoCoord?: [number, number],
      alternativa?: [number, number][] | null
    ) {
      if (!mapInstanceRef.current || !L) return;

      [polylineRef, contornoRef, alternativaRef].forEach((r) => {
        if (r.current) r.current.remove();
        r.current = null;
      });
      conectoresRef.current.forEach((l) => l.remove());
      conectoresRef.current = [];
      if (!polyline || polyline.length < 2) return;

      // A linha sólida é só a via. O trecho entre o ponto escolhido e a via
      // (snap no grafo) vai tracejado e fino — "a pé até a rua" — em vez de uma
      // reta sólida atravessando quadra.
      const fullLine: [number, number][] = [...(polyline as [number, number][])];
      const conector = (de: [number, number], ate: [number, number]) => {
        if (L.latLng(de).distanceTo(L.latLng(ate)) < 5) return;
        conectoresRef.current.push(
          L.polyline([de, ate], { color: theme.colors.textMuted, weight: 3, opacity: 0.9, dashArray: '2 6', lineCap: 'round' })
            .addTo(mapInstanceRef.current)
        );
      };
      if (origemCoord) conector(origemCoord, fullLine[0]);
      if (destinoCoord) conector(fullLine[fullLine.length - 1], destinoCoord);

      // Alternativa (a candidata não escolhida pela fusão LIA × TomTom): tracejada, por baixo.
      if (alternativa && alternativa.length > 1) {
        alternativaRef.current = L.polyline(alternativa, {
          color: theme.colors.textMuted, weight: 4, opacity: 0.75, dashArray: '8 8', lineCap: 'round',
        }).addTo(mapInstanceRef.current);
      }

      // Contorno largo na cor da superfície por baixo: a rota lê em qualquer estilo de tile.
      const traco = { lineCap: 'round', lineJoin: 'round' };
      contornoRef.current = L.polyline(fullLine, {
        ...traco,
        color: theme.colors.surface,
        weight: 9,
        opacity: 0.95,
      }).addTo(mapInstanceRef.current);
      polylineRef.current = L.polyline(fullLine, {
        ...traco,
        color: theme.colors.accent,
        weight: 5,
        opacity: 1,
      }).addTo(mapInstanceRef.current);

      // Folga para os painéis flutuantes (mesmo breakpoint de useDesktopLayout: 900 px).
      const largo = typeof window !== 'undefined' && window.innerWidth >= 900;
      mapInstanceRef.current.fitBounds(
        polylineRef.current.getBounds(),
        largo
          ? { paddingTopLeft: [448, 48], paddingBottomRight: [72, 48] }
          : { paddingTopLeft: [32, 240], paddingBottomRight: [72, 260] }
      );
      // Desenha depois do enquadramento (o zoom recalcula o caminho); fallback se o mapa não se mover.
      let desenhou = false;
      const animarLinha = () => {
        if (desenhou) return;
        desenhou = true;
        desenhar(contornoRef.current);
        desenhar(polylineRef.current);
      };
      mapInstanceRef.current.once('moveend', animarLinha);
      setTimeout(animarLinha, 700);

      if (origemCoord) {
        if (markerOrigemRef.current) markerOrigemRef.current.remove();
        const origemIcon = iconePonto(theme.colors.teal, theme.colors);
        markerOrigemRef.current = L.marker(origemCoord, { icon: origemIcon })
          .bindPopup('Origem')
          .addTo(mapInstanceRef.current);
      }
      if (destinoCoord) {
        if (markerDestinoRef.current) markerDestinoRef.current.remove();
        const destinoIcon = iconePino(theme.colors);
        markerDestinoRef.current = L.marker(destinoCoord, { icon: destinoIcon })
          .bindPopup('Destino')
          .addTo(mapInstanceRef.current);
      }
    },

    clearRoute() {
      [polylineRef, contornoRef, alternativaRef].forEach((r) => {
        if (r.current) r.current.remove();
        r.current = null;
      });
      conectoresRef.current.forEach((l) => l.remove());
      conectoresRef.current = [];
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
            const icon = iconePonto(theme.colors.accent, theme.colors, theme.colors.ring);
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
