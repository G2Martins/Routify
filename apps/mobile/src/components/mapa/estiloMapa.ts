/**
 * Estilo do mapa vetorial: o "positron" da OpenFreeMap (tiles vetoriais grátis, sem chave, esquema
 * OpenMapTiles) recolorido camada a camada com a paleta do Routify (constants/Theme.ts → mapPalettes).
 *
 * Por que não os tiles raster de antes: o tema escuro era o PNG do OSM invertido por filtro CSS
 * (cores lamacentas, texto borrado) e a política do tile.openstreetmap.org só aceita baixo volume.
 * Vetor dá texto nítido em qualquer zoom, prédios em 3D, rotação e transição suave de câmera.
 */
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { mapPalettes, MapPalette, mapSatelite, MapStyle } from '../../constants/Theme';

const BASE_URL = 'https://tiles.openfreemap.org/styles/positron';
const SATELITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
// Camadas sem uso no DF (escudos de rodovia dos EUA, gelo).
const FORA = /^(highway-shield-us|road_shield_us|landcover_ice|landcover_glacier)/;
// Nome em português ("Aeroporto Internacional de Brasília"), não o name_en que o positron prefere.
const NOME_PT = ['coalesce', ['get', 'name:pt'], ['get', 'name'], ['get', 'name:latin']];

let base: Promise<StyleSpecification> | null = null;

/** Baixa o estilo base uma vez por sessão. Falha não fica em cache: a próxima tentativa refaz. */
export function carregarBase(): Promise<StyleSpecification> {
  if (!base) {
    base = fetch(BASE_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`estilo do mapa: HTTP ${r.status}`);
        return r.json() as Promise<StyleSpecification>;
      })
      .catch((e) => {
        base = null;
        throw e;
      });
  }
  return base;
}

type Pinta = Record<string, unknown>;

/** Cor de cada camada pelo nome (o esquema OpenMapTiles nomeia por função). null = mantém. */
function pintura(id: string, tipo: LayerSpecification['type'], p: MapPalette): Pinta | null {
  if (tipo === 'background') return { 'background-color': p.fundo };
  if (tipo === 'fill') {
    if (/water/.test(id)) return { 'fill-color': p.agua };
    if (/park|wood|grass|landcover/.test(id)) return { 'fill-color': p.verde, 'fill-opacity': 0.9 };
    if (/residential|landuse/.test(id)) return { 'fill-color': p.residencial, 'fill-opacity': 0.7 };
    if (/building/.test(id)) return { 'fill-color': p.predio, 'fill-outline-color': p.predioBorda };
    if (/aeroway/.test(id)) return { 'fill-color': p.aerovia, 'fill-opacity': 1 };
    if (/pier/.test(id)) return { 'fill-color': p.fundo };
    return null;
  }
  if (tipo === 'line') {
    if (/waterway/.test(id)) return { 'line-color': p.aguaLinha };
    if (/boundary/.test(id)) return { 'line-color': p.limite };
    if (/railway/.test(id)) return { 'line-color': p.trilho };
    if (/aeroway/.test(id)) return { 'line-color': p.aerovia, 'line-opacity': 1 };
    if (/motorway.*casing/.test(id)) return { 'line-color': p.expressaBorda, 'line-opacity': 1 };
    if (/motorway/.test(id)) return { 'line-color': p.expressa };
    if (/major_casing/.test(id)) return { 'line-color': p.viaMaiorBorda };
    if (/major/.test(id)) return { 'line-color': p.viaMaior };
    if (/minor|path|pier/.test(id)) return { 'line-color': p.viaMenor, 'line-opacity': 1 };
    return null;
  }
  if (tipo === 'symbol') {
    const forte = /city|town|capital|state|country/.test(id);
    const agua = /water/.test(id);
    return {
      'text-color': agua ? p.aguaTexto : forte ? p.textoForte : p.texto,
      'text-halo-color': p.halo,
      'text-halo-width': 1.4,
      'text-halo-blur': 0.4,
    };
  }
  return null;
}

/** Prédios em 3D a partir do zoom 14, subindo junto com o zoom (entram sem "pular"). */
function predios3d(cor: string): LayerSpecification {
  return {
    id: 'predios-3d',
    type: 'fill-extrusion',
    source: 'openmaptiles',
    'source-layer': 'building',
    minzoom: 14,
    paint: {
      'fill-extrusion-color': cor,
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, ['coalesce', ['get', 'render_height'], 6]],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.88,
    },
  } as LayerSpecification;
}

/**
 * Estilo final para o modo escolhido. "satellite" = imagem da Esri com só os nomes do vetor por
 * cima (híbrido); "dark"/"street" = vetor recolorido. Não altera a base em cache.
 */
export function montarEstilo(estiloBase: StyleSpecification, modo: MapStyle): StyleSpecification {
  const satelite = modo === 'satellite';
  const p = mapPalettes[modo === 'street' ? 'claro' : 'escuro'];
  const camadas: LayerSpecification[] = [];
  for (const original of estiloBase.layers) {
    if (FORA.test(original.id)) continue;
    // Escudo de rodovia é ícone branco do sprite (não recolore): no escuro e no satélite só polui.
    if (modo !== 'street' && /shield/.test(original.id)) continue;
    if (satelite && original.type !== 'symbol' && original.type !== 'background') continue;
    const camada = { ...original, paint: { ...((original as { paint?: Pinta }).paint ?? {}) } } as LayerSpecification & { paint: Pinta };
    const layout = (original as { layout?: Pinta }).layout;
    if (camada.type === 'symbol' && layout && /name/.test(JSON.stringify(layout['text-field'] ?? ''))) {
      (camada as { layout?: Pinta }).layout = { ...layout, 'text-field': NOME_PT };
    }
    if (satelite && camada.type === 'symbol') {
      Object.assign(camada.paint, { 'text-color': mapSatelite.texto, 'text-halo-color': mapSatelite.halo, 'text-halo-width': 1.6 });
    } else {
      const nova = pintura(camada.id, camada.type, p);
      if (nova) Object.assign(camada.paint, nova);
    }
    camadas.push(camada);
    if (!satelite && camada.id === 'building') camadas.push(predios3d(p.predio3d));
  }
  const fontes = { ...estiloBase.sources } as StyleSpecification['sources'];
  if (satelite) {
    fontes.satelite = {
      type: 'raster',
      tiles: [SATELITE],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© Esri · World Imagery',
    };
    const fundo = camadas.findIndex((c) => c.type === 'background');
    camadas.splice(fundo + 1, 0, { id: 'satelite', type: 'raster', source: 'satelite' } as LayerSpecification);
  }
  return { ...estiloBase, sources: fontes, layers: camadas };
}
