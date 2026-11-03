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

/** Resposta do POST /search/recentes para um recente (mesma ordem do pedido). */
export interface RecenteConferido {
  lat: number;
  lon: number;
  area: string;
  corrigido: boolean;
}

const compacto = (s: string) => palavras(s).join('');

/**
 * Recentes depois da conferência da API: coordenada do marco quando o nome salvo era de um marco em outro lugar
 * (o "Park Shopping" de São Sebastião vira o do Guará), a RA na frente do sublabel e o mesmo lugar uma vez só.
 * `conferidos[i]` ausente = recente não conferido (fica como estava).
 */
export function aplicarConferencia(recentes: PlaceSuggestion[], conferidos: (RecenteConferido | null | undefined)[]): PlaceSuggestion[] {
  const out: PlaceSuggestion[] = [];
  recentes.forEach((r, i) => {
    const c = conferidos[i];
    const novo = c ? { ...r, lat: c.lat, lon: c.lon, sublabel: c.area ? `${c.area} · ${r.sublabel}` : r.sublabel } : r;
    if (!out.some((o) => compacto(o.label) === compacto(novo.label) && distanciaM(o, novo) < 1000)) out.push(novo);
  });
  return out;
}

/**
 * Nome que vai para o campo e para o histórico. Com homônimo a mais de 1 km na mesma lista, leva a área
 * ("Park Shopping · Guará"): o histórico só guarda nome + coordenada, e "Park Shopping" sozinho voltava nos
 * recentes sem dizer qual era.
 */
export function rotuloParaSalvar(item: PlaceSuggestion, lista: PlaceSuggestion[]): string {
  if (item.source === 'recente') return item.label;
  const area = item.sublabel.split(' · ')[0].trim();
  const homonimo = lista.some((o) => o !== item && semAcento(o.label) === semAcento(item.label) && distanciaM(o, item) > 1000);
  return homonimo && area && !semAcento(item.label).includes(semAcento(area)) ? `${item.label} · ${area}` : item.label;
}
