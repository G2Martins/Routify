/**
 * Radares de velocidade do DF (arquivo estático /radares_df.json, gerado do OpenStreetMap). Só a web busca: o caminho é
 * relativo ao site. Baixado na primeira vez que um mapa abre, uma vez só por sessão.
 */
export interface Radar {
  lat: number;
  lon: number;
  limite_kmh: number | null;
  nome: string | null;
}

/** Descarta o que não for radar válido: o arquivo vem de terceiros. Nome só como texto. */
export function radaresValidos(dados: unknown): Radar[] {
  const lista = (dados as { radares?: unknown } | null)?.radares;
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((r) => Number.isFinite(r?.lat) && Number.isFinite(r?.lon))
    .map((r) => ({
      lat: r.lat,
      lon: r.lon,
      limite_kmh: Number.isFinite(r.limite_kmh) && r.limite_kmh > 0 ? r.limite_kmh : null,
      nome: typeof r.nome === 'string' && r.nome ? r.nome.slice(0, 80) : null,
    }));
}

export interface RadarNaRota {
  limite_kmh: number | null;
  km: number; // distância desde a partida, pela rota
  lat: number;
  lon: number;
}

/**
 * Radares a até `raioM` da rota (polyline [lat, lon]), na ordem em que aparecem.
 * ponytail: sem sentido da via no arquivo; 15 m separa a pista certa da oposta na maioria das vias duplas do DF,
 * mas uma via com canteiro estreito ainda pode contar o radar do outro lado. Upgrade: tag `direction` do OSM.
 */
export function radaresNaRota(polyline: number[][], radares: Radar[], raioM = 15): RadarNaRota[] {
  if (polyline.length < 2 || !radares.length) return [];
  const kx = 111320 * Math.cos((polyline[0][0] * Math.PI) / 180);
  const ky = 110540;
  const xy = polyline.map(([lat, lon]) => [lon * kx, lat * ky]);
  const acumulado = [0];
  for (let i = 1; i < xy.length; i++) acumulado.push(acumulado[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  const [minX, maxX] = [Math.min(...xy.map((p) => p[0])) - raioM, Math.max(...xy.map((p) => p[0])) + raioM];
  const [minY, maxY] = [Math.min(...xy.map((p) => p[1])) - raioM, Math.max(...xy.map((p) => p[1])) + raioM];
  const achados: RadarNaRota[] = [];
  for (const r of radares) {
    const px = r.lon * kx;
    const py = r.lat * ky;
    if (px < minX || px > maxX || py < minY || py > maxY) continue;
    let melhor = Infinity;
    let ao = 0;
    for (let i = 1; i < xy.length; i++) {
      const [ax, ay] = xy[i - 1];
      const dx = xy[i][0] - ax;
      const dy = xy[i][1] - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      if (d < melhor) [melhor, ao] = [d, acumulado[i - 1] + t * Math.sqrt(l2)];
    }
    if (melhor <= raioM) achados.push({ limite_kmh: r.limite_kmh, km: ao / 1000, lat: r.lat, lon: r.lon });
  }
  return achados.sort((a, b) => a.km - b.km);
}

let cache: Promise<Radar[]> | null = null;

export function carregarRadares(): Promise<Radar[]> {
  if (typeof document === 'undefined') return Promise.resolve([]); // nativo: sem arquivo no site, a camada só não aparece
  cache ??= fetch('/radares_df.json')
    .then((r) => (r.ok ? r.json() : null))
    .then(radaresValidos)
    .catch(() => {
      cache = null; // falhou: a próxima tela tenta de novo
      return [];
    });
  return cache;
}

const chave = (usuario?: string) => `@routify:radares:${usuario ?? 'anonimo'}`;

/** Ligados por padrão; a escolha fica no aparelho, por conta. */
export function radaresLigados(usuario?: string): boolean {
  try {
    return localStorage.getItem(chave(usuario)) !== '0';
  } catch {
    return true;
  }
}

export function guardarRadares(usuario: string | undefined, ligado: boolean): void {
  try {
    localStorage.setItem(chave(usuario), ligado ? '1' : '0');
  } catch {
    // navegador sem armazenamento: vale só nesta visita
  }
}
