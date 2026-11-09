/**
 * Mapa vetorial (web): MapLibre GL + tiles da OpenFreeMap com o estilo do Routify (estiloMapa.ts).
 * Mesma API imperativa do mapa Leaflet (MapaLeaflet.web.tsx), que fica de reserva sem WebGL.
 *
 * Rota: gradiente da marca (azul → ciano → teal) com brilho e contorno, desenhada do início ao fim;
 * por cima, os trechos com trânsito (nível 1–3 da API) nas cores de alerta; um "cometa" percorre a
 * rota de tempos em tempos. Tudo para quem pede menos movimento (prefers-reduced-motion).
 */
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ExpressionSpecification, GeoJSONSource, Map as MLMap, Marker as MLMarker, Popup, StyleSpecification } from 'maplibre-gl';
import { mapPalettes, trafficColors } from '../../constants/Theme';
import { useTheme } from '../../context/ThemeContext';
import { ATRIBUICAO, carregarBase, montarEstilo } from './estiloMapa';
import { acompanhar, localizarUsuario } from './geolocalizacao';
import { gruposTransito } from './transito';
import type { Radar } from '../../lib/radares';
import ICONES from '../../constants/icones.json';

type ML = typeof import('maplibre-gl');
type LatLon = [number, number];
type LonLat = [number, number];

const CSS_URL = 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css';
const CSS_SRI = 'sha384-uTttxo/aOKbdE5RlD/SPzSDoDmNvGlUYPjONi2MN/b7c9HPSvW07OIuyP7uL6jxK';
const CENTRO: LonLat = [-47.882778, -15.793889];
// DF e entorno: o grafo cobre 38 km em volta de Brasília; além disso o mapa não deixa arrastar.
const LIMITES: [LonLat, LonLat] = [[-48.95, -16.45], [-46.85, -15.05]];
const TRANSP = 'rgba(0,0,0,0)';
const DESENHO_MS = 1400;
const COMETA_MS = 2400;
const COMETA_PAUSA_MS = 1600;
const COMETA_VOLTAS = 2;

// Celular e tablet (tela estreita ou toque): o mapa é o que mais pesa no quadro. Arrastando no celular emulado (CPU 4×,
// DPR 3) ficava em ~17 fps. Aqui: densidade de pixel limitada a 2× (DPR 3 desenha 2,25× mais pixels), sem prédios 3D,
// sem a vinheta de tela cheia e com o pulso do marcador terminando.
const MEDIA_LEVE = '(max-width: 820px), (pointer: coarse)';
const LEVE = typeof window !== 'undefined' && !!window.matchMedia?.(MEDIA_LEVE).matches;

const ANIM_CSS = `
.rt-mapa-entra{animation:rtEntra .76s cubic-bezier(.16,1,.3,1) both}
@keyframes rtEntra{from{opacity:0;transform:scale(1.015)}to{opacity:1;transform:none}}
.rt-ponto{position:relative;width:18px;height:18px}
.rt-ponto i{position:absolute;inset:0;border-radius:50%;background:var(--rt-cor);border:3px solid var(--rt-borda);box-shadow:0 2px 10px var(--rt-sombra);box-sizing:border-box}
.rt-ponto::before{content:'';position:absolute;inset:0;border-radius:50%;background:var(--rt-cor);animation:rtPulso 2.4s cubic-bezier(.16,1,.3,1) infinite}
@keyframes rtPulso{0%{transform:scale(1);opacity:.5}100%{transform:scale(3.4);opacity:0}}
.rt-pino{width:30px;height:40px;transform-origin:50% 100%;animation:rtCai .56s cubic-bezier(.34,1.56,.64,1) both}
.rt-pino svg{display:block;filter:drop-shadow(0 8px 10px var(--rt-sombra))}
@keyframes rtCai{from{transform:translateY(-26px) scale(.55);opacity:0}to{transform:none;opacity:1}}
.rt-vinheta{position:absolute;inset:0;pointer-events:none;background:radial-gradient(130% 95% at 50% 45%,transparent 58%,var(--rt-vinheta) 100%)}
.maplibregl-ctrl-attrib,.maplibregl-ctrl-attrib a{font-family:Geist_500Medium,system-ui,sans-serif;font-size:10px}
.maplibregl-ctrl-bottom-right{bottom:var(--rt-margem-baixo,0px)}
.maplibregl-ctrl.maplibregl-ctrl-attrib{background:var(--rt-pop-fundo);color:var(--rt-pop-texto)}
.maplibregl-ctrl-attrib a{color:inherit}
.rt-popup .maplibregl-popup-content{background:var(--rt-pop-fundo);color:var(--rt-pop-texto);font:500 13px/18px Geist_500Medium,system-ui,sans-serif;border-radius:8px;padding:8px 12px;box-shadow:0 6px 20px var(--rt-sombra)}
.rt-popup.maplibregl-popup-anchor-bottom .maplibregl-popup-tip{border-top-color:var(--rt-pop-fundo)}
.rt-popup.maplibregl-popup-anchor-top .maplibregl-popup-tip{border-bottom-color:var(--rt-pop-fundo)}
@media ${MEDIA_LEVE}{.rt-vinheta{display:none}.rt-ponto::before{animation-iteration-count:3}}
@media (prefers-reduced-motion: reduce){.rt-mapa-entra,.rt-ponto::before,.rt-pino{animation:none}.rt-mapa-entra{opacity:1!important}}
`;

function injetarCss() {
  if (typeof document === 'undefined') return;
  if (!document.getElementById('maplibre-css')) {
    const link = document.createElement('link');
    link.id = 'maplibre-css';
    link.rel = 'stylesheet';
    link.href = CSS_URL;
    link.integrity = CSS_SRI;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  }
  if (!document.getElementById('routify-mapa-css')) {
    const style = document.createElement('style');
    style.id = 'routify-mapa-css';
    style.textContent = ANIM_CSS;
    document.head.appendChild(style);
  }
}

const reduzirMovimento = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lonLat = (p: number[]): LonLat => [p[1], p[0]];

/** Gradiente da marca até `p` (0–1) do comprimento; o resto transparente (a linha "se desenha"). */
function gradiente(cores: string[], p: number): ExpressionSpecification {
  if (p >= 1) return ['interpolate', ['linear'], ['line-progress'], 0, cores[0], 0.5, cores[1], 1, cores[2]];
  const q = Math.max(p, 0.002);
  return ['interpolate', ['linear'], ['line-progress'], 0, cores[0], q * 0.5, cores[1], q, cores[2], Math.min(q + 0.0005, 0.9999), TRANSP, 1, TRANSP];
}
function corAte(cor: string, p: number): ExpressionSpecification {
  if (p >= 1) return ['interpolate', ['linear'], ['line-progress'], 0, cor, 1, cor];
  const q = Math.max(p, 0.002);
  return ['interpolate', ['linear'], ['line-progress'], 0, cor, q, cor, Math.min(q + 0.0005, 0.9999), TRANSP, 1, TRANSP];
}

const linha = (coords: LonLat[]) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: coords } });
const colecao = (features: any[]) => ({ type: 'FeatureCollection' as const, features });

/** Trechos com trânsito (nível 1–3) viram uma linha cada (regra comum em mapa/transito.ts). */
function trechosTransito(coords: LonLat[], trafego: (number | null)[] | null | undefined) {
  return colecao(gruposTransito(coords.length, trafego).map(([a, b, nivel]) => ({ ...linha(coords.slice(a, b + 1)), properties: { nivel } })));
}

/** Distâncias acumuladas (m, aproximação plana: rota curta) para posicionar o cometa. */
function acumulado(coords: LonLat[]) {
  const k = Math.cos((coords[0][1] * Math.PI) / 180);
  const acc = [0];
  for (let i = 1; i < coords.length; i++) {
    const dx = (coords[i][0] - coords[i - 1][0]) * k;
    const dy = coords[i][1] - coords[i - 1][1];
    acc.push(acc[i - 1] + Math.hypot(dx, dy) * 111_320);
  }
  return acc;
}
function pontoEm(coords: LonLat[], acc: number[], f: number): LonLat {
  const alvo = f * acc[acc.length - 1];
  let lo = 0;
  let hi = acc.length - 1;
  while (hi - lo > 1) {
    const meio = (lo + hi) >> 1;
    if (acc[meio] < alvo) lo = meio;
    else hi = meio;
  }
  const t = acc[hi] === acc[lo] ? 0 : (alvo - acc[lo]) / (acc[hi] - acc[lo]);
  return [coords[lo][0] + (coords[hi][0] - coords[lo][0]) * t, coords[lo][1] + (coords[hi][1] - coords[lo][1]) * t];
}

/** Símbolo do radar desenhado no canvas com os tokens do tema: nada de sprite externo. */
function imagemRadar(fundo: string, anel: string, tinta: string): ImageData | null {
  const icone = (ICONES as unknown as { prefix: string; icons: Record<string, { body: string }> }[]).find((c) => c.prefix === 'mdi')?.icons.cctv;
  const d = icone?.body.match(/ d="([^"]+)"/)?.[1];
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!d || !ctx) return null;
  const T = 56;
  ctx.canvas.width = ctx.canvas.height = T;
  ctx.beginPath();
  ctx.arc(T / 2, T / 2, T / 2 - 3, 0, Math.PI * 2);
  ctx.fillStyle = fundo;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = anel;
  ctx.stroke();
  const k = 32 / 24;
  ctx.setTransform(k, 0, 0, k, (T - 32) / 2, (T - 32) / 2);
  ctx.fillStyle = tinta;
  ctx.fill(new Path2D(d));
  return ctx.getImageData(0, 0, T, T);
}

// Marcadores em DOM montado só com tokens do tema (nenhum dado do usuário entra no HTML).
function elPonto(cor: string, borda: string, sombra: string, rotulo: string) {
  const el = document.createElement('div');
  el.className = 'rt-ponto';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', rotulo);
  el.style.setProperty('--rt-cor', cor);
  el.style.setProperty('--rt-borda', borda);
  el.style.setProperty('--rt-sombra', sombra);
  el.appendChild(document.createElement('i'));
  return el;
}
function elPino(c1: string, c2: string, borda: string, sombra: string) {
  // O MapLibre posiciona o marcador com transform no elemento externo; a animação (também transform)
  // fica no filho, senão a queda sobrescreve a posição e o pino vai parar no canto do mapa.
  const externo = document.createElement('div');
  externo.setAttribute('role', 'img');
  externo.setAttribute('aria-label', 'Destino');
  const el = document.createElement('div');
  externo.appendChild(el);
  el.className = 'rt-pino';
  el.style.setProperty('--rt-sombra', sombra);
  el.innerHTML =
    `<svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true"><defs><linearGradient id="rtPinoG" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>` +
    `<path d="M15 38.5c-1.2-6.4-13-13.6-13-23.5a13 13 0 1 1 26 0c0 9.9-11.8 17.1-13 23.5z" fill="url(#rtPinoG)" stroke="${borda}" stroke-width="2.5"/>` +
    `<circle cx="15" cy="15" r="5" fill="${borda}"/></svg>`;
  return externo;
}

type Rota = {
  coords: LonLat[];
  origem?: LatLon;
  destino?: LatLon;
  alternativa?: LonLat[] | null;
  trafego?: (number | null)[] | null;
};

/** Ponto de /trafego/agora (tela "Trânsito agora"). */
export type PontoTransito = { id: number; lat: number; lon: number; nivel: number };

/** Folga da rota nas bordas do mapa: quem desenha painel por cima (MapScreen, Planejar) informa quanto cobre. */
export type Margem = { top: number; left: number; right: number; bottom: number };
const MARGEM_PADRAO: Margem = { top: 48, left: 48, right: 48, bottom: 48 };
// Toque no mapa: o ponto é miúdo em zoom baixo, então o alvo é um quadrado de 44 px em volta do dedo.
const RAIO_TOQUE = 22;

const IDS_CAMADAS = ['rota-alt', 'rota-conector', 'rota-brilho', 'rota-contorno', 'rota-linha', 'rota-transito', 'rota-cometa-brilho', 'rota-cometa'];
const IDS_FONTES = ['rota', 'rota-alt', 'rota-conector', 'rota-transito', 'rota-cometa'];

type Props = { onFalha?: () => void; margem?: Margem; onPontoPress?: (id: number) => void };

const MapaVetorial = forwardRef(({ onFalha, margem, onPontoPress }: Props, ref) => {
  const { mapStyle, theme } = useTheme();
  const c = theme.colors;
  const containerRef = useRef<HTMLDivElement>(null);
  const vinhetaRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const mlRef = useRef<ML | null>(null);
  const baseRef = useRef<StyleSpecification | null>(null);
  // isStyleLoaded() fica falso enquanto os tiles carregam: a flag é nossa (style.load / setStyle).
  const estiloPronto = useRef(false);
  // showRoute antes do mapa pronto (rede lenta, chunk do MapLibre ainda baixando): aplica depois.
  const pendente = useRef(false);
  const rotaRef = useRef<Rota | null>(null);
  const pontosRef = useRef<PontoTransito[] | null>(null);
  const selecionadoRef = useRef<number | null>(null);
  const radaresRef = useRef<Radar[] | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const margemRef = useRef<Margem>(MARGEM_PADRAO);
  margemRef.current = margem ?? MARGEM_PADRAO;
  const onPontoRef = useRef(onPontoPress);
  onPontoRef.current = onPontoPress;
  const marcadores = useRef<{ origem?: MLMarker; destino?: MLMarker; usuario?: MLMarker }>({});
  const quadros = useRef<{ desenho?: number; cometa?: number; espera?: ReturnType<typeof setTimeout> }>({});
  const pararSeguir = useRef<(() => void) | null>(null);
  const temaRef = useRef({ c, mapStyle });
  temaRef.current = { c, mapStyle };

  const paleta = () => mapPalettes[temaRef.current.mapStyle === 'street' ? 'claro' : 'escuro'];
  const coresMarca = () => temaRef.current.c.gradient as unknown as string[];

  function pararAnimacoes() {
    const q = quadros.current;
    if (q.desenho) cancelAnimationFrame(q.desenho);
    if (q.cometa) cancelAnimationFrame(q.cometa);
    if (q.espera) clearTimeout(q.espera);
    quadros.current = {};
  }

  function limparCamadas() {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;
    IDS_CAMADAS.forEach((id) => map.getLayer(id) && map.removeLayer(id));
    IDS_FONTES.forEach((id) => map.getSource(id) && map.removeSource(id));
  }

  /** Pontos do "Trânsito agora" (abaixo da rota, recriados depois de trocar o estilo). Nome só como texto. */
  function desenharPontos() {
    const map = mapRef.current;
    if (!map || !estiloPronto.current || !map.getStyle()) return;
    if (map.getLayer('transito-selecionado')) map.removeLayer('transito-selecionado');
    if (map.getLayer('transito-agora')) map.removeLayer('transito-agora');
    if (map.getSource('transito-agora')) map.removeSource('transito-agora');
    const pontos = pontosRef.current;
    if (!pontos?.length) return;
    const [moderado, lento, parado] = trafficColors[temaRef.current.mapStyle === 'street' ? 'light' : 'dark'];
    map.addSource('transito-agora', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: pontos.map((p) => ({
          type: 'Feature',
          properties: { id: p.id, nivel: p.nivel },
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        })),
      },
    });
    map.addLayer(
      {
        id: 'transito-agora',
        type: 'circle',
        source: 'transito-agora',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, ['+', 2.5, ['get', 'nivel']], 14, ['+', 6, ['*', 2, ['get', 'nivel']]]],
          'circle-color': ['match', ['get', 'nivel'], 1, moderado, 2, lento, 3, parado, temaRef.current.c.success],
          'circle-opacity': 0.9,
          'circle-stroke-width': 1,
          'circle-stroke-color': paleta().fundo,
        },
      },
      map.getLayer('rota-alt') ? 'rota-alt' : undefined,
    );
    // Anel no ponto aberto no painel: sabe-se de qual ponto são os dados.
    map.addLayer({
      id: 'transito-selecionado',
      type: 'circle',
      source: 'transito-agora',
      filter: ['==', ['get', 'id'], selecionadoRef.current ?? -1],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 9, 14, 16],
        'circle-color': TRANSP,
        'circle-stroke-width': 3,
        'circle-stroke-color': temaRef.current.c.accent,
      },
    });
  }

  /** Radares (/radares_df.json) por cima de tudo, recriados depois de trocar o estilo. O texto só vai em popup como texto. */
  function desenharRadares() {
    const map = mapRef.current;
    if (!map || !estiloPronto.current || !map.getStyle()) return;
    if (map.getLayer('radares')) map.removeLayer('radares');
    if (map.getSource('radares')) map.removeSource('radares');
    const lista = radaresRef.current;
    if (!lista?.length) return;
    const { c: cores } = temaRef.current;
    const img = imagemRadar(cores.surface, cores.warning, cores.text);
    if (!img) return;
    if (map.hasImage('radar')) map.removeImage('radar');
    map.addImage('radar', img, { pixelRatio: 2 });
    map.addSource('radares', {
      type: 'geojson',
      data: colecao(lista.map((r) => ({
        type: 'Feature',
        properties: { limite: r.limite_kmh, nome: r.nome },
        geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
      }))),
    });
    map.addLayer({
      id: 'radares',
      type: 'symbol',
      source: 'radares',
      minzoom: 11,
      layout: {
        'icon-image': 'radar',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        // Discreto de longe: 273 radares não podem tapar a rota. De perto, 28 px.
        'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 13, 0.6, 16, 1],
      },
    });
  }

  function popupRadar(coords: LonLat, props: { limite?: number | null; nome?: string | null }) {
    const ml = mlRef.current;
    const map = mapRef.current;
    if (!ml || !map) return;
    const texto = [props.nome || 'Radar', props.limite ? `${props.limite} km/h` : null].filter(Boolean).join(' · ');
    popupRef.current?.remove();
    popupRef.current = new ml.Popup({ closeButton: false, offset: 14, className: 'rt-popup' }).setLngLat(coords).setText(texto).addTo(map);
  }

  /** Cria (ou recria, depois de trocar o estilo) as camadas da rota. `animar`: desenha e solta o cometa. */
  function desenharRota(animar: boolean) {
    const map = mapRef.current;
    const rota = rotaRef.current;
    if (!map || !rota || !estiloPronto.current) return;
    pararAnimacoes();
    limparCamadas();
    const { c: cores } = temaRef.current;
    const p = paleta();
    const marca = coresMarca();
    const contorno = temaRef.current.mapStyle === 'street' ? p.viaMenor : p.fundo;
    const alerta = trafficColors[temaRef.current.mapStyle === 'street' ? 'light' : 'dark'];
    const antes = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;
    const mover = animar && !reduzirMovimento();
    const p0 = mover ? 0 : 1;

    map.addSource('rota', { type: 'geojson', lineMetrics: true, data: linha(rota.coords) });
    map.addSource('rota-alt', { type: 'geojson', data: colecao(rota.alternativa && rota.alternativa.length > 1 ? [linha(rota.alternativa)] : []) });
    const conectores: any[] = [];
    if (rota.origem) conectores.push(linha([lonLat(rota.origem), rota.coords[0]]));
    if (rota.destino) conectores.push(linha([rota.coords[rota.coords.length - 1], lonLat(rota.destino)]));
    map.addSource('rota-conector', { type: 'geojson', data: colecao(conectores) });
    map.addSource('rota-transito', { type: 'geojson', data: trechosTransito(rota.coords, rota.trafego) });
    map.addSource('rota-cometa', { type: 'geojson', data: colecao([]) });

    const tracos = { 'line-cap': 'round', 'line-join': 'round' } as const;
    map.addLayer({ id: 'rota-alt', type: 'line', source: 'rota-alt', layout: tracos,
      paint: { 'line-color': cores.textSubtle, 'line-width': 4, 'line-opacity': 0.85, 'line-dasharray': [1.4, 1.6] } }, antes);
    map.addLayer({ id: 'rota-conector', type: 'line', source: 'rota-conector', layout: tracos,
      paint: { 'line-color': cores.textMuted, 'line-width': 3, 'line-dasharray': [0.6, 2] } }, antes);
    map.addLayer({ id: 'rota-brilho', type: 'line', source: 'rota', layout: tracos,
      paint: { 'line-width': 18, 'line-blur': 12, 'line-opacity': temaRef.current.mapStyle === 'street' ? 0.28 : 0.45, 'line-gradient': corAte(marca[0], p0) } }, antes);
    map.addLayer({ id: 'rota-contorno', type: 'line', source: 'rota', layout: tracos,
      paint: { 'line-width': 10, 'line-gradient': corAte(contorno, p0) } }, antes);
    map.addLayer({ id: 'rota-linha', type: 'line', source: 'rota', layout: tracos,
      paint: { 'line-width': 6, 'line-gradient': gradiente(marca, p0) } }, antes);
    map.addLayer({ id: 'rota-transito', type: 'line', source: 'rota-transito', layout: tracos,
      paint: { 'line-width': 6, 'line-opacity': mover ? 0 : 1, 'line-opacity-transition': { duration: 500, delay: 0 },
        'line-color': ['match', ['get', 'nivel'], 1, alerta[0], 2, alerta[1], 3, alerta[2], TRANSP] } }, antes);
    map.addLayer({ id: 'rota-cometa-brilho', type: 'circle', source: 'rota-cometa',
      paint: { 'circle-radius': 14, 'circle-color': marca[1], 'circle-blur': 1, 'circle-opacity': 0.55 } }, antes);
    map.addLayer({ id: 'rota-cometa', type: 'circle', source: 'rota-cometa',
      paint: { 'circle-radius': 4.5, 'circle-color': cores.onAccent, 'circle-stroke-color': marca[1], 'circle-stroke-width': 2 } }, antes);

    if (!mover) return;
    const inicio = performance.now();
    const passo = (agora: number) => {
      const m = mapRef.current;
      if (!m || !m.getLayer('rota-linha')) return;
      const t = easeOutExpo(Math.min((agora - inicio) / DESENHO_MS, 1));
      m.setPaintProperty('rota-linha', 'line-gradient', gradiente(marca, t));
      m.setPaintProperty('rota-contorno', 'line-gradient', corAte(contorno, t));
      m.setPaintProperty('rota-brilho', 'line-gradient', corAte(marca[0], t));
      if (t < 1) {
        quadros.current.desenho = requestAnimationFrame(passo);
      } else {
        m.setPaintProperty('rota-transito', 'line-opacity', 1);
        soltarCometa();
      }
    };
    quadros.current.desenho = requestAnimationFrame(passo);
  }

  /**
   * Um ponto de luz percorre a rota COMETA_VOLTAS vezes depois do desenho (pausa com a aba escondida). Cada quadro
   * refaz a fonte do mapa (setData): em loop eterno o mapa nunca parava de redesenhar com uma rota aberta e o celular
   * perdia quadro ao arrastar. No celular, nenhuma passada.
   */
  function soltarCometa() {
    const rota = rotaRef.current;
    if (!rota || LEVE || reduzirMovimento() || rota.coords.length < 2) return;
    const acc = acumulado(rota.coords);
    let voltas = COMETA_VOLTAS;
    const volta = () => {
      const map = mapRef.current;
      const fonte = map?.getSource('rota-cometa') as GeoJSONSource | undefined;
      if (!map || !fonte) return;
      if (typeof document !== 'undefined' && document.hidden) {
        quadros.current.espera = setTimeout(volta, COMETA_PAUSA_MS);
        return;
      }
      const inicio = performance.now();
      const passo = (agora: number) => {
        const f = Math.min((agora - inicio) / COMETA_MS, 1);
        const fonteAgora = mapRef.current?.getSource('rota-cometa') as GeoJSONSource | undefined;
        if (!fonteAgora) return;
        const ponto = pontoEm(rota.coords, acc, easeInOut(f));
        fonteAgora.setData(colecao(f < 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: ponto } }] : []));
        if (f < 1) quadros.current.cometa = requestAnimationFrame(passo);
        else if (--voltas > 0) quadros.current.espera = setTimeout(volta, COMETA_PAUSA_MS);
      };
      quadros.current.cometa = requestAnimationFrame(passo);
    };
    volta();
  }

  function marcadorUsuario(lat: number, lon: number) {
    const ml = mlRef.current;
    const map = mapRef.current;
    if (!ml || !map) return;
    const { c: cores } = temaRef.current;
    if (marcadores.current.usuario) {
      marcadores.current.usuario.setLngLat([lon, lat]);
      return;
    }
    marcadores.current.usuario = new ml.Marker({ element: elPonto(cores.accent, cores.surface, cores.shadowMedium, 'Você está aqui') })
      .setLngLat([lon, lat])
      .addTo(map);
  }

  /** Enquadra a rota no vão que os painéis deixam livre (`margem`). Vão apertado demais: encolhe a folga, nunca desiste. */
  function enquadrar() {
    const map = mapRef.current;
    const ml = mlRef.current;
    const rota = rotaRef.current;
    if (!map || !ml || !rota) return;
    const limites = new ml.LngLatBounds(rota.coords[0], rota.coords[0]);
    rota.coords.forEach((p) => limites.extend(p));
    if (rota.origem) limites.extend(lonLat(rota.origem));
    if (rota.destino) limites.extend(lonLat(rota.destino));
    const { clientWidth: L, clientHeight: A } = map.getContainer();
    const m = margemRef.current;
    const kx = Math.min(1, (L * 0.8) / Math.max(1, m.left + m.right));
    const ky = Math.min(1, (A * 0.8) / Math.max(1, m.top + m.bottom));
    map.fitBounds(limites, {
      padding: { top: m.top * ky, bottom: m.bottom * ky, left: m.left * kx, right: m.right * kx },
      maxZoom: 16.5,
      pitch: 0,
      bearing: 0,
      duration: reduzirMovimento() ? 0 : 1200,
      easing: easeOutExpo,
    });
  }

  /** Enquadra a rota guardada, desenha (animada) e põe os marcadores. */
  function aplicarRota() {
    const map = mapRef.current;
    const ml = mlRef.current;
    const rota = rotaRef.current;
    if (!map || !ml || !rota) return;
    enquadrar();
    desenharRota(true);
    const { c: cores } = temaRef.current;
    marcadores.current.origem?.remove();
    marcadores.current.destino?.remove();
    marcadores.current.origem = rota.origem
      ? new ml.Marker({ element: elPonto(cores.teal, cores.surface, cores.shadowMedium, 'Origem') }).setLngLat(lonLat(rota.origem)).addTo(map)
      : undefined;
    marcadores.current.destino = rota.destino
      ? new ml.Marker({ element: elPino(cores.gradient[0], cores.gradient[1], cores.surface, cores.shadowMedium), anchor: 'bottom' })
          .setLngLat(lonLat(rota.destino))
          .addTo(map)
      : undefined;
  }

  // Monta o mapa uma vez.
  useEffect(() => {
    let vivo = true;
    injetarCss();
    (async () => {
      try {
        const mod: any = await import('maplibre-gl');
        const ml: ML = mod.default ?? mod;
        const base = await carregarBase();
        if (!vivo || !containerRef.current) return;
        mlRef.current = ml;
        baseRef.current = base;
        const map = new ml.Map({
          container: containerRef.current,
          style: montarEstilo(base, temaRef.current.mapStyle, !LEVE),
          pixelRatio: Math.min(window.devicePixelRatio || 1, LEVE ? 2 : 3),
          center: CENTRO,
          zoom: 12.4,
          minZoom: 8.5,
          maxPitch: 70,
          maxBounds: LIMITES,
          attributionControl: false,
          fadeDuration: 180,
        });
        map.addControl(new ml.AttributionControl({ compact: true, customAttribution: [ATRIBUICAO, 'Trânsito © TomTom · Tempo: Open-Meteo'] }), 'bottom-right');
        // O controle compacto nasce aberto e só fecha no primeiro arrasto. Numa tela de celular ele tapa o mapa: começa no "i".
        if (LEVE) {
          const creditos = containerRef.current.querySelector('.maplibregl-ctrl-attrib');
          creditos?.removeAttribute('open');
          creditos?.classList.remove('maplibregl-compact-show');
        }
        mapRef.current = map;
        const revelar = () => containerRef.current?.classList.add('rt-mapa-entra');
        setTimeout(revelar, 1500); // tile lento ou fora do ar: o mapa aparece assim mesmo
        map.once('style.load', revelar);
        // O style.load inicial pode sair antes deste ouvinte existir: o load cobre.
        const pronto = () => {
          if (estiloPronto.current) return;
          estiloPronto.current = true;
          if (pendente.current) {
            pendente.current = false;
            aplicarRota();
          } else if (rotaRef.current) {
            desenharRota(false); // trocar o estilo apaga as camadas da rota: recria sem animar
          }
          desenharPontos();
          desenharRadares();
        };
        map.on('load', () => {
          revelar();
          pronto();
        });
        map.on('style.load', pronto);
        // Um clique só decide entre ponto e radar: o mais perto do dedo, num alvo de 44 px.
        map.on('click', (e) => {
          const camadas = ['radares', 'transito-agora'].filter((id) => map.getLayer(id));
          if (!camadas.length) return;
          const { x, y } = e.point;
          const achados = map.queryRenderedFeatures([[x - RAIO_TOQUE, y - RAIO_TOQUE], [x + RAIO_TOQUE, y + RAIO_TOQUE]], { layers: camadas });
          const coordsDe = (f: (typeof achados)[number]) => (f.geometry as unknown as { coordinates: LonLat }).coordinates;
          const distancia = (f: (typeof achados)[number]) => {
            const p = map.project(coordsDe(f));
            return Math.hypot(p.x - x, p.y - y);
          };
          const perto = achados.sort((a, b) => distancia(a) - distancia(b))[0];
          if (!perto) return;
          if (perto.layer.id === 'radares') popupRadar(coordsDe(perto), perto.properties as { limite?: number; nome?: string });
          else onPontoRef.current?.(Number(perto.properties?.id));
        });
        ['radares', 'transito-agora'].forEach((id) => {
          map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
        });
      } catch (e) {
        console.warn('[Routify] mapa vetorial indisponível, voltando ao Leaflet', e);
        if (vivo) onFalha?.();
      }
    })();
    return () => {
      vivo = false;
      pararAnimacoes();
      pararSeguir.current?.();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Troca de estilo (Escuro / Padrão / Satélite).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !baseRef.current) return;
    estiloPronto.current = false;
    map.setStyle(montarEstilo(baseRef.current, mapStyle, !LEVE));
  }, [mapStyle]);

  // Vinheta e cores da rota acompanham o tema.
  useEffect(() => {
    vinhetaRef.current?.style.setProperty('--rt-vinheta', mapPalettes[mapStyle === 'street' ? 'claro' : 'escuro'].vinheta);
    containerRef.current?.style.setProperty('--rt-pop-fundo', c.surface);
    containerRef.current?.style.setProperty('--rt-pop-texto', c.text);
    containerRef.current?.style.setProperty('--rt-sombra', c.shadowMedium);
    if (rotaRef.current) desenharRota(false);
    desenharPontos();
    desenharRadares();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme.mode, mapStyle]);

  // Painel mudou de tamanho (rota aberta, detalhes expandidos): reenquadra. Navegando, quem manda é o GPS.
  const { top: mTopo, left: mEsq, right: mDir, bottom: mBaixo } = margemRef.current;
  useEffect(() => {
    containerRef.current?.style.setProperty('--rt-margem-baixo', `${Math.max(0, mBaixo - 32)}px`);
    if (rotaRef.current && estiloPronto.current && !pararSeguir.current) enquadrar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mTopo, mEsq, mDir, mBaixo]);

  useImperativeHandle(ref, () => ({
    centerOnUser(onError?: (msg: string) => void) {
      localizarUsuario((lat, lon, zoom) => {
        mapRef.current?.flyTo({ center: [lon, lat], zoom, speed: 1.4, curve: 1.42, essential: true });
        marcadorUsuario(lat, lon);
      }, onError);
    },

    showRoute(
      polyline: number[][],
      origemCoord?: LatLon,
      destinoCoord?: LatLon,
      alternativa?: number[][] | null,
      trafego?: (number | null)[] | null
    ) {
      if (!polyline || polyline.length < 2) return;
      rotaRef.current = {
        coords: polyline.map(lonLat),
        origem: origemCoord,
        destino: destinoCoord,
        alternativa: alternativa ? alternativa.map(lonLat) : null,
        trafego,
      };
      if (mapRef.current && estiloPronto.current) aplicarRota();
      else pendente.current = true;
    },

    clearRoute() {
      pararAnimacoes();
      limparCamadas();
      rotaRef.current = null;
      pendente.current = false;
      marcadores.current.origem?.remove();
      marcadores.current.destino?.remove();
      marcadores.current.origem = marcadores.current.destino = undefined;
    },

    startFollow(onError?: (msg: string) => void, onLocation?: (lat: number, lon: number) => void) {
      if (pararSeguir.current) return;
      pararSeguir.current = acompanhar((lat, lon, rumo) => {
        // Navegação em perspectiva: câmera inclinada, virada para onde o carro vai.
        mapRef.current?.easeTo({
          center: [lon, lat],
          zoom: 17,
          pitch: 55,
          bearing: rumo ?? mapRef.current.getBearing(),
          duration: reduzirMovimento() ? 0 : 900,
        });
        marcadorUsuario(lat, lon);
        onLocation?.(lat, lon);
      }, onError);
    },

    /** Troca só a pintura do trânsito, sem mexer na câmera nem redesenhar a rota (Planejar: outra saída). */
    atualizarTrafego(trafego: (number | null)[] | null) {
      const rota = rotaRef.current;
      const map = mapRef.current;
      if (!rota) return;
      rota.trafego = trafego;
      (map?.getSource('rota-transito') as GeoJSONSource | undefined)?.setData(trechosTransito(rota.coords, trafego));
    },

    showTrafficPoints(pontos: PontoTransito[] | null) {
      pontosRef.current = pontos;
      desenharPontos();
    },

    /** Marca o ponto aberto no painel e leva a câmera até ele, no vão que os painéis deixam livre. */
    selecionarPonto(id: number | null) {
      selecionadoRef.current = id;
      const map = mapRef.current;
      if (!map || !estiloPronto.current) return;
      if (map.getLayer('transito-selecionado')) map.setFilter('transito-selecionado', ['==', ['get', 'id'], id ?? -1]);
      const ponto = id == null ? null : pontosRef.current?.find((p) => p.id === id);
      if (!ponto) return;
      const m = margemRef.current;
      map.easeTo({
        center: [ponto.lon, ponto.lat],
        zoom: Math.max(map.getZoom(), 14),
        offset: [(m.left - m.right) / 2, (m.top - m.bottom) / 2],
        duration: reduzirMovimento() ? 0 : 700,
      });
    },

    mostrarRadares(radares: Radar[] | null) {
      radaresRef.current = radares;
      if (!radares) popupRef.current?.remove();
      desenharRadares();
    },

    stopFollow() {
      pararSeguir.current?.();
      pararSeguir.current = null;
      mapRef.current?.easeTo({ pitch: 0, bearing: 0, duration: reduzirMovimento() ? 0 : 700 });
    },
  }));

  return (
    <View style={[styles.container, { backgroundColor: mapPalettes[mapStyle === 'street' ? 'claro' : 'escuro'].fundo }]}>
      {/* @ts-ignore — div é válido no contexto web */}
      <div ref={containerRef} style={{ width: '100%', height: '100%', opacity: 0 }} />
      {/* @ts-ignore — div é válido no contexto web */}
      <div ref={vinhetaRef} className="rt-vinheta" />
    </View>
  );
});

MapaVetorial.displayName = 'MapaVetorial';

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
});

export default MapaVetorial;
