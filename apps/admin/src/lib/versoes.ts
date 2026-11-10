import { fmtDec, num, rotuloVersao } from './formato';
import { mesmaBase } from './leitura';
import type { LiaTreino } from './tipos';

/** Dados por versão já normalizados para os gráficos comparativos da página LIA. Todo campo pode faltar (versões antigas). */
export type Metrica = 'rmse' | 'mae';
export type Erro = { rmse: number | null; mae: number | null };
export type Fold = { modelo: Erro; pers: Erro; arvores: number | null };
export type Periodo = { n: number | null; vies: number | null; mae: number | null; rmse: number | null };
export type PorPeriodo = Record<'modelo' | 'baseline' | 'persistencia', Record<string, Periodo>>;

export type VersaoDados = {
  versao: string;
  rotulo: string;
  temporal: boolean;
  amostras: number | null;
  geral: Erro;
  desvio: Erro;
  base: Erro;
  pers: Erro;
  cong: { modelo: number | null; base: number | null };
  folds: Fold[] | null;
  idade: { min: number; modelo: Erro; base: Erro; pers: Erro }[] | null;
  periodo: PorPeriodo | null;
  periodo30: PorPeriodo | null;
  features: Record<string, number> | null;
};

export type Recurso = 'folds' | 'idade' | 'periodo' | 'periodo30' | 'features' | 'cong';

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const erro = (o: Record<string, unknown> | null, pre: string): Erro => ({ rmse: num(o?.[`${pre}rmse_seg`]), mae: num(o?.[`${pre}mae_seg`]) });

function lerPeriodo(v: unknown): PorPeriodo | null {
  const o = obj(v);
  if (!o) return null;
  const bloco = (b: unknown) => {
    const x = obj(b) ?? {};
    return Object.fromEntries(
      Object.entries(x).map(([k, p]) => {
        const q = obj(p);
        return [k, { n: num(q?.n), vies: num(q?.vies_seg), mae: num(q?.mae_seg), rmse: num(q?.rmse_seg) }];
      }),
    );
  };
  const r = { modelo: bloco(o.modelo), baseline: bloco(o.baseline), persistencia: bloco(o.persistencia) };
  return Object.keys(r.modelo).length ? r : null;
}

export function extrair(l: LiaTreino): VersaoDados {
  const d = obj(l.detalhes) ?? {};
  const folds = Array.isArray(d.cv_folds)
    ? d.cv_folds.map((f) => {
        const o = obj(f);
        return { modelo: erro(o, ''), pers: erro(o, 'persistencia_'), arvores: num(o?.arvores) };
      })
    : null;
  const idadeObj = obj(d.cv_por_idade_recencia_min);
  const idade = idadeObj
    ? Object.entries(idadeObj)
        .map(([min, v]) => ({ min: Number(min), modelo: erro(obj(v), 'modelo_'), base: erro(obj(v), 'baseline_'), pers: erro(obj(v), 'persistencia_') }))
        .filter((x) => Number.isFinite(x.min))
        .sort((a, b) => a.min - b.min)
    : null;
  const fi = obj(d.feature_importance);
  const features = fi ? Object.fromEntries(Object.entries(fi).filter(([, v]) => num(v) !== null).map(([k, v]) => [k, num(v) as number])) : null;
  return {
    versao: l.versao,
    rotulo: rotuloVersao(l.versao),
    temporal: l.validacao === 'temporal',
    amostras: num(l.total_amostras),
    geral: { rmse: num(l.rmse_seg), mae: num(l.mae_seg) },
    desvio: { rmse: num(l.rmse_seg_std), mae: num(l.mae_seg_std) },
    base: { rmse: num(l.baseline_rmse_seg), mae: num(l.baseline_mae_seg) },
    pers: { rmse: num(d.persistencia_rmse_seg), mae: num(d.persistencia_mae_seg) },
    cong: { modelo: num(l.rmse_congestionado_seg), base: num(l.baseline_rmse_congestionado_seg) },
    folds: folds?.length ? folds : null,
    idade: idade?.length ? idade : null,
    periodo: lerPeriodo(d.cv_por_periodo),
    periodo30: lerPeriodo(d.cv_por_periodo_recencia_30min),
    features: features && Object.keys(features).length ? features : null,
  };
}

export const tem = (v: VersaoDados | undefined, r: Recurso): boolean => !!v && (r === 'cong' ? v.cong.modelo !== null : v[r] !== null);

/** Versões escolhíveis nos seletores: validação temporal e número limpo (sem repro nem re-treino). */
export const seletavel = (l: LiaTreino) => l.validacao === 'temporal' && /^lia_\d+\.\d+$/.test(l.versao);

const chave = (v: string) => v.match(/^lia_(\d+)\.(\d+)/)?.slice(1).map(Number) ?? [0, 0];
export const maisNovaPrimeiro = (a: string, b: string) => chave(b)[0] - chave(a)[0] || chave(b)[1] - chave(a)[1];

/** Par inicial de um cartão: o par da página, trocando por versões que têm o dado (a mais próxima abaixo). */
export function parInicial(vs: VersaoDados[], a: string, b: string, ok: (v: VersaoDados) => boolean): [string | '', string | ''] {
  const com = vs.filter(ok).map((v) => v.versao).sort(maisNovaPrimeiro);
  const escolhe = (v: string, fora: string) => {
    if (com.includes(v) && v !== fora) return v;
    const abaixo = com.filter((x) => x !== fora && maisNovaPrimeiro(x, v) >= 0);
    return abaixo[0] ?? com.find((x) => x !== fora) ?? '';
  };
  const pa = escolhe(a, '');
  return [pa, escolhe(b, pa)];
}

const pct = (de: number, para: number) => ((para - de) / de) * 100;
const fp = (p: number) => `${fmtDec(Math.abs(p))}%`;
const NOME_M = { rmse: 'RMSE', mae: 'MAE' } as const;

/** Leitura dos folds: em quantos A vence B e a persistência. */
export function lerFolds(a: VersaoDados | undefined, b: VersaoDados | undefined, m: Metrica): string[] {
  if (!a?.folds) return [];
  const n = a.folds.length;
  const frases: string[] = [];
  const venceP = a.folds.filter((f) => f.modelo[m] !== null && f.pers[m] !== null && (f.modelo[m] as number) < (f.pers[m] as number)).length;
  if (a.folds.some((f) => f.pers[m] !== null)) frases.push(`${a.rotulo} ganha da persistência em ${venceP} de ${n} folds no ${NOME_M[m]}.`);
  if (b?.folds) {
    const k = Math.min(n, b.folds.length);
    const vence = Array.from({ length: k }, (_, i) => i).filter((i) => (a.folds![i].modelo[m] ?? Infinity) < (b.folds![i].modelo[m] ?? Infinity)).length;
    frases.push(`${a.rotulo} ganha da ${b.rotulo} em ${vence} de ${k} folds.`);
    if (!mesmaBase(toLinha(a), toLinha(b))) frases.push('As duas treinaram em bases diferentes e os cortes dos folds não coincidem: a diferença por fold não prova ganho nem piora.');
  }
  return frases;
}

const toLinha = (v: VersaoDados) => ({ total_amostras: v.amostras }) as LiaTreino;
export const mesmaBaseV = (a: VersaoDados, b: VersaoDados) => mesmaBase(toLinha(a), toLinha(b));

export function lerIdade(a: VersaoDados | undefined, b: VersaoDados | undefined, m: Metrica): string[] {
  if (!a?.idade) return [];
  const fim = a.idade[a.idade.length - 1];
  const ini = a.idade[0];
  const par = (x: (typeof a.idade)[number]) => {
    const o = b?.idade?.find((y) => y.min === x.min);
    const partes = [`${a.rotulo} ${fmtDec(x.modelo[m])} s`];
    if (o && o.modelo[m] !== null) partes.push(`${b!.rotulo} ${fmtDec(o.modelo[m])} s`);
    if (x.pers[m] !== null) partes.push(`persistência ${fmtDec(x.pers[m])} s`);
    return `Com leitura de ${x.min} min, ${NOME_M[m]}: ${partes.join('; ')}.`;
  };
  const f = [par(ini)];
  if (fim !== ini) f.push(par(fim));
  if (fim.pers[m] !== null && fim.modelo[m] !== null) f.push(`Quanto mais velha a leitura, mais a persistência piora (${fmtDec(ini.pers[m])} s para ${fmtDec(fim.pers[m])} s); a LIA depende menos dela.`);
  return f;
}

export const PERIODOS: { chave: string; curto: string; completo: string }[] = [
  { chave: 'pico_manha_util', curto: 'Pico manhã', completo: 'Pico da manhã (dia útil, 6–9 h)' },
  { chave: 'pico_tarde_util', curto: 'Pico tarde', completo: 'Pico da tarde (dia útil, 17–19 h)' },
  { chave: 'dia_util', curto: 'Dia útil', completo: 'Dia útil, 10–16 h' },
  { chave: 'noite', curto: 'Noite', completo: 'Noite (20–23 h)' },
  { chave: 'madrugada', curto: 'Madrugada', completo: 'Madrugada (0–5 h)' },
  { chave: 'dia_fim_de_semana', curto: 'Fim de semana', completo: 'Fim de semana, 6–19 h' },
];

export function lerPeriodo30(a: PorPeriodo | null, b: PorPeriodo | null, nomeA: string, nomeB: string | undefined, m: Metrica): string[] {
  if (!a) return [];
  const itens = PERIODOS.map((p) => ({ p, v: a.modelo[p.chave] })).filter((x) => x.v && x.v[m] !== null);
  if (!itens.length) return [];
  const pior = itens.reduce((x, y) => ((y.v![m] as number) > (x.v![m] as number) ? y : x));
  const vies = pior.v!.vies;
  const frases = [
    `O pior período da ${nomeA} é ${pior.p.curto.toLowerCase()}: ${NOME_M[m]} de ${fmtDec(pior.v![m])} s${vies !== null ? ` e viés de ${vies > 0 ? '+' : vies < 0 ? '−' : ''}${fmtDec(Math.abs(vies))} s (${vies < 0 ? 'prevê mais rápido que o real' : 'prevê mais lento que o real'})` : ''}.`,
  ];
  if (b) {
    const o = b.modelo[pior.p.chave];
    if (o && o[m] !== null) frases.push(`No mesmo período a ${nomeB} erra ${fmtDec(o[m])} s (${fp(pct(o[m] as number, pior.v![m] as number))} ${(pior.v![m] as number) < (o[m] as number) ? 'a menos' : 'a mais'} na ${nomeA}).`);
  }
  return frases;
}

export function lerFeatures(a: VersaoDados | undefined, b: VersaoDados | undefined): string[] {
  if (!a?.features) return [];
  const top = Object.entries(a.features).sort((x, y) => y[1] - x[1]).slice(0, 3);
  const f = [`Na ${a.rotulo}, ${top.map(([k, v]) => `${k} (${fmtDec(v * 100)}%)`).join(', ')} somam ${fmtDec(top.reduce((s, [, v]) => s + v, 0) * 100)}% da importância.`];
  if (b?.features) {
    const dif = Object.keys(a.features)
      .filter((k) => k in b.features!)
      .map((k) => [k, a.features![k] - b.features![k]] as const)
      .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))[0];
    if (dif && Math.abs(dif[1]) >= 0.01) f.push(`A maior mudança contra a ${b.rotulo} é ${dif[0]}: ${dif[1] > 0 ? 'ganhou' : 'perdeu'} ${fmtDec(Math.abs(dif[1]) * 100)} pontos percentuais de importância.`);
  }
  return f;
}

export function lerCongVersao(a: VersaoDados | undefined, b: VersaoDados | undefined): string[] {
  if (!a || a.cong.modelo === null || a.geral.rmse === null) return [];
  const f = [`Nos trechos congestionados o RMSE da ${a.rotulo} é ${fmtDec(a.cong.modelo)} s, ${fmtDec(a.cong.modelo / a.geral.rmse)} vezes o erro geral (${fmtDec(a.geral.rmse)} s).`];
  if (b && b.cong.modelo !== null) f.push(`Na ${b.rotulo} era ${fmtDec(b.cong.modelo)} s.${mesmaBaseV(a, b) ? '' : ' Bases diferentes: não se compara direto.'}`);
  return f;
}
