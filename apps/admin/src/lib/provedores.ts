/**
 * Regras de exibição da página LIA × provedores: puras e sem import do app, para ficar fácil de testar.
 * Nada aqui fixa a lista de séries: ela sai dos dados que a RPC devolve.
 */

/** Nome e cor na ordem de exibição do painel. A tabela comparacao_provedores só aceita estes ids. */
const PROVEDORES: Record<string, { nome: string; cor: string }> = {
  lia: { nome: 'LIA (A*)', cor: 'var(--chart-1)' },
  routify: { nome: 'Routify (LIA + TomTom)', cor: 'var(--chart-2)' },
  tomtom_mesmo_trajeto: { nome: 'TomTom no trajeto da LIA', cor: 'var(--chart-eixo)' },
  tomtom: { nome: 'TomTom (referência)', cor: 'hsl(var(--foreground))' },
  osrm: { nome: 'OSRM (sem trânsito)', cor: 'var(--chart-3)' },
  mapbox: { nome: 'Mapbox (trânsito)', cor: 'var(--chart-5)' },
};
const ORDEM = Object.keys(PROVEDORES);
const SEM_COR = 'var(--chart-neutro)';

export const nomeProvedor = (id: string) => PROVEDORES[id]?.nome ?? id;
const posicao = (id: string) => {
  const i = ORDEM.indexOf(id);
  return i < 0 ? ORDEM.length : i;
};
/** Ordem de exibição; id desconhecido vai para o fim, em ordem alfabética. */
export const porOrdem = (a: string, b: string) => posicao(a) - posicao(b) || a.localeCompare(b);

type SerieProvedor = { chave: string; nome: string; cor: string; tracejado: boolean };

/**
 * Séries do gráfico de viés por hora: quem aparece em `por_hora`, na ordem do painel.
 * Ficam de fora a referência (vira a linha zero) e "TomTom no trajeto da LIA" (mede a escolha
 * da rota, não o tempo: fica na tabela). Tracejado = sem trânsito, lido do próprio dado.
 */
export function seriesPorHora(
  porHora: { provedor: string }[],
  provedores: { provedor: string; com_transito: boolean }[],
): SerieProvedor[] {
  const semTransito = new Set(provedores.filter((p) => !p.com_transito).map((p) => p.provedor));
  return [...new Set(porHora.map((p) => p.provedor))]
    .filter((id) => id !== 'tomtom' && id !== 'tomtom_mesmo_trajeto')
    .sort(porOrdem)
    .map((id) => ({ chave: id, nome: nomeProvedor(id), cor: PROVEDORES[id]?.cor ?? SEM_COR, tracejado: semTransito.has(id) }));
}

/** Uma linha por hora de Brasília (0–23): `<id>` = viés mediano, `n_<id>` = pares. Hora sem dado = null. */
export function linhasPorHora(
  porHora: { provedor: string; hora: number; n: number; vies_mediano_pct: number | null }[],
  series: SerieProvedor[],
) {
  return Array.from({ length: 24 }, (_, hora) => {
    const linha: Record<string, number | null> = { hora };
    for (const s of series) {
      const p = porHora.find((x) => x.provedor === s.chave && Number(x.hora) === hora);
      linha[s.chave] = p?.vies_mediano_pct ?? null;
      linha[`n_${s.chave}`] = p?.n ?? null;
    }
    return linha;
  });
}

/** Desvio (%) de `tempo` contra a referência; null se faltar um dos dois. */
export const desvioPct = (tempo: number | null | undefined, ref: number | null | undefined) =>
  tempo && ref ? ((tempo - ref) / ref) * 100 : null;

/** Espelho de CORREDORES em services/collector/comparar_provedores.py: a tabela guarda só o slug. */
const CORREDORES: Record<string, string> = {
  'rodoviaria-aeroporto': 'Rodoviária → Aeroporto',
  'asanorte-asasul': 'Asa Norte → Asa Sul',
  'sudoeste-lagosul': 'Sudoeste → Lago Sul',
  'unb-esplanada': 'UnB → Esplanada dos Ministérios',
  'parque-torre': 'Parque da Cidade → Torre de TV',
  'lagonorte-scs': 'Lago Norte → Setor Comercial Sul',
  'cruzeiro-asanorte': 'Cruzeiro → Asa Norte',
  'guara-plano': 'Guará I → Plano Piloto (EPNB)',
  'taguatinga-plano': 'Taguatinga → Plano Piloto (EPTG)',
  'samambaia-plano': 'Samambaia → Plano Piloto (EPTG)',
  'aguasclaras-plano': 'Águas Claras → Plano Piloto (EPTG)',
  'plano-taguatinga': 'Plano Piloto → Taguatinga (EPTG, volta)',
  'plano-aguasclaras': 'Plano Piloto → Águas Claras (volta)',
  'ceilandia-plano': 'Ceilândia → Plano Piloto',
  'gama-plano': 'Gama → Plano Piloto',
  'sobradinho-plano': 'Sobradinho → Plano Piloto',
  // Viagens entre pontos famosos (CORREDORES_POI)
  'poi-aeroporto-parkshopping': 'Aeroporto → ParkShopping',
  'poi-aguasclarasshopping-aeroporto': 'Águas Claras Shopping → Aeroporto',
  'poi-venancio-parqueaguasclaras': 'Venâncio Shopping → Parque de Águas Claras',
  'poi-metrocentral-taguatingashopping': 'Estação Central → Taguatinga Shopping',
  'poi-parqueaguasclaras-rodoviaria': 'Parque de Águas Claras → Rodoviária',
  'poi-parkshopping-esplanada': 'ParkShopping → Esplanada',
  'poi-metrosamambaia-metrocentral': 'Estação Samambaia → Estação Central',
  'poi-eixaonorte-eixaosul': 'Eixão Norte → Eixão Sul',
  'poi-unb-aeroporto': 'UnB → Aeroporto',
  'poi-iguatemi-esplanada': 'Iguatemi → Esplanada',
  'poi-brasiliashopping-parkshopping': 'Brasília Shopping → ParkShopping',
  'poi-taguatingashopping-aguasclarasshopping': 'Taguatinga Shopping → Águas Claras Shopping',
  'poi-metroceilandia-hrt': 'Estação Ceilândia → HRT',
  'poi-jkshopping-rodoviaria': 'JK Shopping → Rodoviária',
};
const ORDEM_CORREDORES = Object.keys(CORREDORES);

/** Slug novo (ainda fora do espelho) vira texto legível em vez de quebrar a tela. */
export const nomeCorredor = (slug: string) => CORREDORES[slug] ?? slug.replace(/-/g, ' ');
const posicaoCorredor = (slug: string) => {
  const i = ORDEM_CORREDORES.indexOf(slug);
  return i < 0 ? ORDEM_CORREDORES.length : i;
};
export const porOrdemCorredor = (a: string, b: string) => posicaoCorredor(a) - posicaoCorredor(b) || a.localeCompare(b);

/** Receita do treino em frases curtas. Aceita o formato do metadata (train.py) e o da ablação. */
export function chipsReceita(receita: unknown): string[] {
  if (!receita || typeof receita !== 'object') return [];
  const r = receita as Record<string, unknown>;
  const oof = r.perfis_oof ?? r.oof;
  const velha = r.recencia_envelhecida ?? r.envelhecer;
  const interno = r.es_interno ?? (typeof r.early_stopping === 'string' ? r.early_stopping.startsWith('interno') : undefined);
  const idades = Array.isArray(r.idades_envelhecimento_min) ? r.idades_envelhecimento_min : [];
  const chips: string[] = [];
  if (typeof oof === 'boolean') chips.push(oof ? 'perfis fora da amostra (OOF)' : 'perfis na própria amostra');
  if (typeof velha === 'boolean') {
    chips.push(velha ? `recência envelhecida${idades.length ? ` (${idades.join(', ')} min)` : ''}` : 'recência sempre fresca');
  }
  if (typeof interno === 'boolean') chips.push(interno ? 'early stopping no treino' : 'early stopping na validação');
  return chips;
}

/** Em quantos folds o modelo erra menos que a persistência (repetir a última leitura da via). */
export function foldsMelhores(
  folds: { rmse_seg: number; mae_seg: number; persistencia_rmse_seg: number; persistencia_mae_seg: number }[] | undefined,
  metrica: 'rmse' | 'mae',
) {
  const [m, p] = metrica === 'rmse' ? (['rmse_seg', 'persistencia_rmse_seg'] as const) : (['mae_seg', 'persistencia_mae_seg'] as const);
  const validos = (folds ?? []).filter((f) => Number.isFinite(f[m]) && Number.isFinite(f[p]));
  return { melhores: validos.filter((f) => f[m] < f[p]).length, total: validos.length };
}

/** Idades (min) de um bloco `por_idade`, em ordem crescente. */
export const idadesOrdenadas = (porIdade: Record<string, unknown> | undefined) =>
  Object.keys(porIdade ?? {})
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

type Maybe = number | null | undefined;
const finitos = (xs: Maybe[]) => xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));

/** Índices dos menores valores (empate = todos); ignora null. Para pôr em negrito o melhor da coluna. */
export function menores(valores: Maybe[]): Set<number> {
  const v = finitos(valores);
  if (!v.length) return new Set();
  const min = Math.min(...v);
  return new Set(valores.flatMap((x, i) => (x === min ? [i] : [])));
}

/** Média dos valores válidos; null se não houver nenhum. */
function media(xs: Maybe[]): number | null {
  const v = finitos(xs);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

/** Mediana dos valores válidos; null se não houver nenhum. */
function mediana(xs: Maybe[]): number | null {
  const v = finitos(xs).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

type LinhaFase3 = {
  par: string | null;
  lia_tempo_seg: Maybe;
  menor_dist_tempo_seg: Maybe;
  tomtom_tempo_seg: Maybe;
};

/** Fase 3: médias por corredor (mantém a ordem em que aparecem) e viés mediano de todas as rodadas contra a TomTom. */
export function resumoFase3(linhas: LinhaFase3[]) {
  const validas = linhas.filter((l) => l.par);
  const grupos = new Map<string, LinhaFase3[]>();
  for (const l of validas) grupos.set(l.par as string, [...(grupos.get(l.par as string) ?? []), l]);
  const desvios = (campo: 'lia_tempo_seg' | 'menor_dist_tempo_seg') => validas.map((l) => desvioPct(l[campo], l.tomtom_tempo_seg));
  return {
    n: validas.length,
    corredores: [...grupos].map(([par, ls]) => ({
      par,
      n: ls.length,
      tomtom: media(ls.map((l) => l.tomtom_tempo_seg)),
      lia: media(ls.map((l) => l.lia_tempo_seg)),
      menor: media(ls.map((l) => l.menor_dist_tempo_seg)),
    })),
    viesLia: mediana(desvios('lia_tempo_seg')),
    viesMenor: mediana(desvios('menor_dist_tempo_seg')),
  };
}

/** Cor de cada versão da LIA nos gráficos: a mais nova em azul (destaque), as anteriores nas demais séries. */
export const corVersao = (i: number, total: number) =>
  i === total - 1 ? 'var(--chart-1)' : ['var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'][i % 3];
