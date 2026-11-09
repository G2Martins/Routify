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
