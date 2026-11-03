/**
 * Lógica pura do autocomplete (sem React Native): junta os destinos recentes do usuário com os resultados da
 * API. Testada com `npm test` em apps/mobile (tests/sugestoes.test.mjs, test runner do Node, sem dependências).
 */
export interface PlaceSuggestion {
  label: string;
  sublabel: string;
  lat: number;
  lon: number;
  source: 'malha' | 'tomtom' | 'nominatim' | 'recente';
  /** Categoria em português vinda da API (Shopping, Universidade, Via, Endereço, Região, Bairro…). */
  categoria?: string | null;
  id_ponto?: number;
}

export const semAcento = (s: string) =>
  (typeof s.normalize === 'function' ? s.normalize('NFD') : s).replace(/[̀-ͯ]/g, '').toLowerCase();

export const palavras = (s: string) => semAcento(s).split(/[^a-z0-9]+/).filter(Boolean);

/** Mesmo lugar: mesmo nome (sem acento) e a ~200 m. */
export const mesmoLugar = (a: PlaceSuggestion, b: PlaceSuggestion) =>
  semAcento(a.label) === semAcento(b.label) && Math.abs(a.lat - b.lat) < 0.002 && Math.abs(a.lon - b.lon) < 0.002;

/** Distância em metros (equiretangular: sobra para comparar lugares dentro do DF). */
export function distanciaM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const kx = 111_320 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((a.lat - b.lat) * 110_574, (a.lon - b.lon) * kx);
}

/**
 * Destinos recentes que casam com o digitado (cada termo é começo de alguma palavra, sem acento) vêm antes dos
 * resultados da API, e o mesmo lugar não aparece duas vezes. No máximo `limite` linhas.
 *
 * - O recente que é o mesmo lugar de um item da API herda o bairro/endereço dele: o histórico não guarda isso, e
 *   dois "Park Shopping" ficavam idênticos na lista.
 * - O recente homônimo do 1º resultado da API, a mais de 1 km dele, vai para depois desse resultado. Senão, um
 *   destino errado salvo antes passa na frente do lugar certo (2026-11-02: "Park Shopping" de São Sebastião, salvo
 *   em 09/2026 com o ranking antigo, aparecia antes do Park Shopping do Guará).
 */
export function combinar(q: string, recentes: PlaceSuggestion[] | null, itens: PlaceSuggestion[],
                         limite = 6, maxRecentes = 2): PlaceSuggestion[] {
  const termos = palavras(q);
  if (!recentes?.length || !termos.length) return itens;
  const casam = recentes
    .filter((r) => {
      const ps = palavras(r.label);
      return termos.every((t) => ps.some((p) => p.startsWith(t)));
    })
    .slice(0, maxRecentes)
    .map((r) => {
      const igual = itens.find((i) => mesmoLugar(r, i));
      return igual?.sublabel ? { ...r, sublabel: `${igual.sublabel} · ${r.sublabel}` } : r;
    });
  const resto = itens.filter((i) => !casam.some((r) => mesmoLugar(r, i)));
  const topo = itens[0];
  const homonimo = (r: PlaceSuggestion) =>
    !!topo && semAcento(r.label) === semAcento(topo.label) && !mesmoLugar(r, topo) && distanciaM(r, topo) > 1000;
  const depois = casam.filter(homonimo);
  const antes = casam.filter((r) => !homonimo(r));
  if (!depois.length || !resto.includes(topo)) return [...antes, ...depois, ...resto].slice(0, limite);
  return [...antes, topo, ...depois, ...resto.filter((i) => i !== topo)].slice(0, limite);
}
