/**
 * Mapa Leaflet (web) — reserva do mapa vetorial (mapa/MapaVetorial.web.tsx) quando o navegador
 * não tem WebGL ou o estilo vetorial não carrega. Tiles raster (escuro/padrão/satélite).
 * Mesma API imperativa; a geolocalização vem de mapa/geolocalizacao.ts.
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
import { MAP_TILE_URLS, trafficColors } from '../constants/Theme';
import type { Radar } from '../lib/radares';
import { acompanhar, localizarUsuario } from './mapa/geolocalizacao';
import { gruposTransito } from './mapa/transito';

let L: any = null;

function injectLeafletCSS() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('leaflet-css')) return;
  const link = document.createElement('link');
  link.id = 'leaflet-css';
  link.rel = 'stylesheet';
  link.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
  // SRI (auditoria de 2026-11-03, B11): o CDN não troca o CSS sem o navegador recusar. Mesmo hash do node_modules.
  link.integrity = 'sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H';
  link.crossOrigin = 'anonymous';
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

type Margem = { top: number; left: number; right: number; bottom: number };

const MapaLeaflet = forwardRef(({ margem }: { margem?: Margem }, ref) => {
  const { mapStyle, theme } = useTheme();
  const margemRef = useRef<Margem>({ top: 48, left: 48, right: 48, bottom: 48 });
  if (margem) margemRef.current = margem;
  const transitoRef = useRef<any[]>([]);
  const radaresRef = useRef<any[]>([]);
  const coordsRef = useRef<[number, number][]>([]);
  // Pedido feito antes do chunk do Leaflet chegar: aplica assim que o mapa existir.
  const pendentes = useRef<(() => void)[]>([]);
  const apiRef = useRef<any>(null);
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
  const pararRef = useRef<(() => void) | null>(null);
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
      pendentes.current.splice(0).forEach((f) => f());
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

  const pintarTransito = (trafego?: (number | null)[] | null) => {
    transitoRef.current.forEach((l) => l.remove());
    transitoRef.current = [];
    const coords = coordsRef.current;
    if (!mapInstanceRef.current || !L || coords.length < 2) return;
    const alerta = trafficColors[mapStyle === 'street' ? 'light' : 'dark'];
    for (const [a, b, nivel] of gruposTransito(coords.length, trafego)) {
      transitoRef.current.push(
        L.polyline(coords.slice(a, b + 1), { color: alerta[nivel - 1], weight: 5, lineCap: 'round', lineJoin: 'round' }).addTo(mapInstanceRef.current)
      );
    }
  };

  useImperativeHandle(ref, () => (apiRef.current = {
    atualizarTrafego: pintarTransito,

    mostrarRadares(radares: Radar[] | null) {
      if (!mapInstanceRef.current) {
        pendentes.current.push(() => apiRef.current?.mostrarRadares(radares));
        return;
      }
      radaresRef.current.forEach((m) => m.remove());
      radaresRef.current = [];
      if (!radares) return;
      for (const r of radares) {
        // Texto em nó DOM: o Leaflet trata string como HTML, e o nome vem do OSM.
        const rotulo = document.createElement('span');
        rotulo.textContent = [r.nome || 'Radar', r.limite_kmh ? `${r.limite_kmh} km/h` : null].filter(Boolean).join(' · ');
        radaresRef.current.push(
          L.circleMarker([r.lat, r.lon], { radius: 6, color: theme.colors.warning, weight: 2, fillColor: theme.colors.surface, fillOpacity: 1 })
            .bindPopup(rotulo)
            .addTo(mapInstanceRef.current)
        );
      }
    },

    centerOnUser(onError?: (msg: string) => void) {
      if (!mapInstanceRef.current) return;
      localizarUsuario((lat, lon, zoom) => {
        mapInstanceRef.current?.setView([lat, lon], zoom, { animate: true });
        if (markerUserRef.current) {
          markerUserRef.current.setLatLng([lat, lon]);
        } else if (L && mapInstanceRef.current) {
          const icon = iconePonto(theme.colors.accent, theme.colors, theme.colors.ring);
          markerUserRef.current = L.marker([lat, lon], { icon }).addTo(mapInstanceRef.current);
        }
      }, onError);
    },

    showRoute(
      polyline: [number, number][],
      origemCoord?: [number, number],
      destinoCoord?: [number, number],
      alternativa?: [number, number][] | null,
      trafego?: (number | null)[] | null
    ) {
      if (!mapInstanceRef.current) {
        pendentes.current.push(() => apiRef.current?.showRoute(polyline, origemCoord, destinoCoord, alternativa, trafego));
        return;
      }
      coordsRef.current = polyline ?? [];

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

      pintarTransito(trafego);

      const m = margemRef.current;
      mapInstanceRef.current.fitBounds(polylineRef.current.getBounds(), {
        paddingTopLeft: [m.left, m.top],
        paddingBottomRight: [m.right, m.bottom],
      });
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
      coordsRef.current = [];
      pintarTransito(null);
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

    startFollow(onError?: (msg: string) => void, onLocation?: (lat: number, lon: number) => void) {
      if (!mapInstanceRef.current || pararRef.current) return;
      pararRef.current = acompanhar((lat, lon) => {
        if (!mapInstanceRef.current) return;
        mapInstanceRef.current.setView([lat, lon], 17, { animate: true });
        if (markerUserRef.current) {
          markerUserRef.current.setLatLng([lat, lon]);
        } else if (L) {
          const icon = iconePonto(theme.colors.accent, theme.colors, theme.colors.ring);
          markerUserRef.current = L.marker([lat, lon], { icon }).addTo(mapInstanceRef.current);
        }
        onLocation?.(lat, lon);
      }, onError);
    },

    stopFollow() {
      pararRef.current?.();
      pararRef.current = null;
    },
  }));

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* @ts-ignore — div é válido no contexto web */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </View>
  );
});

MapaLeaflet.displayName = 'MapaLeaflet';

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject },
});

export default MapaLeaflet;
