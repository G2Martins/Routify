import { fmtDec, fmtInt, num, rotuloVersao } from './formato';
import { nomeProvedor } from './provedores';
import type { Benchmark, Calibracao, LiaTreino } from './tipos';

export type Metrica = 'mae_seg' | 'rmse_seg';
const NOME: Record<Metrica, string> = { mae_seg: 'MAE', rmse_seg: 'RMSE' };
const BASE: Record<Metrica, 'baseline_mae_seg' | 'baseline_rmse_seg'> = { mae_seg: 'baseline_mae_seg', rmse_seg: 'baseline_rmse_seg' };

/** "lia_2.3" → [2, 3]; sufixo (repro, retreino) não conta. Sem número = null. */
const numeroVersao = (v: string): number[] | null => {
  const m = v.match(/^lia_(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
};
const cmp = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1];

/** Versões cujo erro vale comparar: validação temporal e métrica publicada. */
export const comparaveis = (linhas: LiaTreino[], m: Metrica) =>
  linhas.filter((l) => l.validacao === 'temporal' && num(l[m]) !== null && numeroVersao(l.versao));

/**
 * Versão em destaque quando a API não responde: a de maior número entre as comparáveis.
 * Nada fixo no código: se a 2.4 for publicada, ela passa a ser a atual.
 */
export function versaoMaisNova(linhas: LiaTreino[]): string | null {
  const c = comparaveis(linhas, 'rmse_seg').sort((a, b) => cmp(numeroVersao(b.versao)!, numeroVersao(a.versao)!));
  return c[0]?.versao ?? null;
}

/** Anterior = maior número abaixo do da atual; entre variantes do mesmo número, a versão limpa (sem sufixo). */
export function anterior(linhas: LiaTreino[], atual: LiaTreino, m: Metrica): LiaTreino | null {
  const n = numeroVersao(atual.versao);
  if (!n) return null;
  const abaixo = comparaveis(linhas, m).filter((l) => cmp(numeroVersao(l.versao)!, n) < 0);
  abaixo.sort((a, b) => cmp(numeroVersao(b.versao)!, numeroVersao(a.versao)!) || a.versao.length - b.versao.length);
  return abaixo[0] ?? null;
}

const variacao = (de: number, para: number) => ((para - de) / de) * 100;

/** CV de bases diferentes usa cortes diferentes: o número não se compara entre elas. Sem total publicado, assume a mesma. */
export const mesmaBase = (a: LiaTreino, b: LiaTreino) => {
  const x = num(a.total_amostras);
  const y = num(b.total_amostras);
  return x === null || y === null || Math.abs(x - y) / y < 0.01;
};
const fmtPct = (p: number) => `${fmtDec(Math.abs(p))}%`;

/**
 * Frase de leitura do gráfico MAE/RMSE por versão, só com números do dado: atual × anterior × melhor × baseline.
 * Devolve uma lista de frases curtas.
 */
export function lerVersoes(linhas: LiaTreino[], versaoAtual: string, m: Metrica, contra?: string): string[] {
  const atual = linhas.find((l) => l.versao === versaoAtual);
  const v = atual ? num(atual[m]) : null;
  if (!atual || v === null) return [];
  const nome = NOME[m];
  const rot = rotuloVersao(atual.versao);
  const frases: string[] = [];

  if (atual.validacao !== 'temporal') {
    return [`${rot} usa validação não temporal: o ${nome} dela não é comparável com as outras versões.`];
  }

  const ant = linhas.find((l) => l.versao === contra && l.versao !== atual.versao) ?? anterior(linhas, atual, m);
  const vAnt = ant ? num(ant[m]) : null;
  if (ant && vAnt !== null && !mesmaBase(atual, ant)) {
    frases.push(`${rot} treinou com outra base (${fmtInt(num(atual.total_amostras))} amostras) e outros cortes: ${fmtDec(v)} s não se compara aos ${fmtDec(vAnt)} s da ${rotuloVersao(ant.versao)}. A comparação justa é o bloco "Atual × anterior em leituras novas", no topo.`);
  } else if (ant && vAnt !== null && vAnt > 0) {
    const p = variacao(vAnt, v);
    const verbo = Math.abs(p) < 0.5 ? 'manteve' : p < 0 ? 'reduziu' : 'aumentou';
    frases.push(
      verbo === 'manteve'
        ? `${rot} manteve o ${nome} da ${rotuloVersao(ant.versao)} (${fmtDec(v)} s contra ${fmtDec(vAnt)} s).`
        : `${rot} ${verbo} o ${nome} em ${fmtPct(p)} sobre a ${rotuloVersao(ant.versao)} (${fmtDec(v)} s contra ${fmtDec(vAnt)} s).${p > 0 ? ' É uma piora.' : ''}`,
    );
  } else {
    frases.push(`${rot} é a primeira versão comparável: não há anterior para medir a evolução.`);
  }

  const mesmas = comparaveis(linhas, m).filter((l) => mesmaBase(atual, l));
  const melhor = mesmas.reduce<LiaTreino | null>((b, l) => (b === null || num(l[m])! < num(b[m])! ? l : b), null);
  if (mesmas.length < 2) frases.push('Nenhuma outra versão tem a mesma base de treino: o CV dela não tem com quem se comparar.');
  else if (melhor) {
    if (melhor.versao === atual.versao) frases.push(`É o menor ${nome} entre as ${mesmas.length} versões da mesma base.`);
    else frases.push(`O menor ${nome} entre as versões da mesma base é o da ${rotuloVersao(melhor.versao)} (${fmtDec(num(melhor[m]))} s), ${fmtPct(variacao(v, num(melhor[m])!))} menor que o da atual.`);
  }

  const base = num(atual[BASE[m]]);
  if (base !== null && base > 0) {
    const p = variacao(base, v);
    frases.push(
      p < 0
        ? `Contra o baseline histórico (${fmtDec(base)} s), a atual erra ${fmtPct(p)} menos.`
        : `Contra o baseline histórico (${fmtDec(base)} s), a atual erra ${fmtPct(p)} mais: o modelo ainda não compensa neste critério.`,
    );
  }
  if (linhas.some((l) => l.validacao !== 'temporal')) {
    frases.push('A LIA 1.0 (hachura diagonal) usou validação não temporal e fica fora da comparação.');
  }
  return frases;
}

/** Leitura da curva de confiança × distância (Knowledge Transfer). */
export function lerCalibracao(c: Calibracao): string[] {
  const { distancias_m: d, confiancas: k } = c.curva_isotonica_grade_10m;
  if (!d.length || d.length !== k.length) return [];
  const ate = (lim: number) => {
    const i = k.findIndex((v) => v < lim);
    return i < 0 ? d[d.length - 1] : d[Math.max(0, i - 1)];
  };
  const m80 = ate(0.8);
  const m50 = ate(0.5);
  return [
    `A confiança no dado emprestado fica acima de 80% até cerca de ${Math.round(m80)} m do sensor e acima de 50% até cerca de ${Math.round(m50)} m.`,
    `Além disso a LIA confia mais no perfil histórico que no vizinho. A curva vale para ${Math.round(c.metodologia.dist_max_m)} m (${c.metodologia.n_pares_totais.toLocaleString('pt-BR')} pares).`,
  ];
}

/** Leitura do benchmark LSTM × XGBoost × XGBoost com recência. */
export function lerBenchmark(b: Benchmark): string[] {
  const x = b.xgboost.rmse_seg_media;
  const xr = b.xgboost_com_recencia.rmse_seg_media;
  const l = b.lstm.rmse_seg_media;
  if (!x || !xr || !l) return [];
  const frases = [
    `O LSTM erra ${fmtDec(l)} s de RMSE e o XGBoost, ${fmtDec(x)} s: ${fmtPct(variacao(x, l))} ${l < x ? 'menos' : 'mais'}.`,
    `Com a leitura recente como entrada, o XGBoost cai para ${fmtDec(xr)} s (${fmtPct(variacao(x, xr))} ${xr < x ? 'menos' : 'mais'}).`,
  ];
  if (l < x && xr < x) { const r = ((x - xr) / (x - l)) * 100; frases.push(`${r >= 100 ? 'Isso supera a vantagem do LSTM' : `Isso recupera ${fmtPct(r)} da vantagem do LSTM`}, sem GPU. Por isso a LIA usa a recência.`); };
  return frases;
}

/** Leitura do erro real em produção (minutos). */
export function lerFeedback(pontos: { previsto: number; real: number }[]): string[] {
  if (!pontos.length) return [];
  const n = pontos.length;
  const mae = pontos.reduce((s, p) => s + Math.abs(p.previsto - p.real), 0) / n;
  const vies = pontos.reduce((s, p) => s + (p.previsto - p.real), 0) / n;
  const lado = Math.abs(vies) < 0.05 ? 'sem tendência para um lado' : vies < 0 ? 'a LIA tende a prever mais rápido que o real' : 'a LIA tende a prever mais lento que o real';
  return [
    `Em ${n} ${n === 1 ? 'viagem informada' : 'viagens informadas'}, a previsão erra ${fmtDec(mae)} min em média; ${lado} (viés ${vies > 0 ? '+' : vies < 0 ? '−' : ''}${fmtDec(Math.abs(vies))} min).`,
    ...(n < 30 ? ['Amostra pequena: ainda não dá para concluir.'] : []),
  ];
}

/** Leitura da série diária de rotas: total, média e dia de pico. */
export function lerSerie(serie: { dia: string; rotas: number; usuarios: number }[]): string[] {
  if (!serie.length) return [];
  const total = serie.reduce((s, d) => s + d.rotas, 0);
  const pico = serie.reduce((b, d) => (d.rotas > b.rotas ? d : b), serie[0]);
  const dia = pico.dia.slice(5).split('-').reverse().join('/');
  return [`${total.toLocaleString('pt-BR')} rotas em ${serie.length} dias com registro (média de ${fmtDec(total / serie.length)} por dia). O pico foi em ${dia}, com ${pico.rotas.toLocaleString('pt-BR')} rotas e ${pico.usuarios} ${pico.usuarios === 1 ? 'usuário' : 'usuários'}.`];
}

/** Leitura do mapa de cobertura hora × dia: quanto da grade tem dado e onde concentra. */
export function lerCobertura(celulas: { dia_semana: number; hora: number; n: number }[]): string[] {
  const total = celulas.reduce((s, c) => s + c.n, 0);
  if (!total) return [];
  const cheias = celulas.filter((c) => c.n > 0).length;
  const topo = [...celulas].sort((a, b) => b.n - a.n).slice(0, 5);
  const share = (topo.reduce((s, c) => s + c.n, 0) / total) * 100;
  return [`${cheias} das 168 células (hora × dia) têm alguma leitura. As 5 mais cheias concentram ${fmtDec(share)}% de tudo${share > 15 ? ': a cobertura é concentrada, o que enviesa o treino.' : '.'}`];
}

/** Quem tem trânsito e quem não tem, e o que isso faz com o viés. Tudo lido do dado da RPC. */
export function lerTransito(d: {
  provedores: { provedor: string; com_transito: boolean }[];
  vs_tomtom: { provedor: string; vies_mediano_pct: number | null; mape_pct: number | null; n: number }[];
}): string[] {
  const ids = [...new Set(d.provedores.map((p) => p.provedor))].filter((id) => id !== 'lia' && id !== 'tomtom_mesmo_trajeto');
  const com = ids.filter((id) => d.provedores.find((p) => p.provedor === id)?.com_transito);
  const sem = ids.filter((id) => !d.provedores.find((p) => p.provedor === id)?.com_transito);
  const lista = (xs: string[]) => xs.map(nomeProvedor).join(', ');
  const frases: string[] = [];
  if (com.length) frases.push(`Têm trânsito: ${lista(com)}.`);
  if (sem.length) frases.push(`Sem trânsito (tempo de mapa): ${lista(sem)}.`);
  for (const id of sem) {
    const v = d.vs_tomtom.find((x) => x.provedor === id);
    if (v?.n && v.vies_mediano_pct !== null) {
      frases.push(`${nomeProvedor(id)} fica ${fmtDec(Math.abs(v.vies_mediano_pct))}% ${v.vies_mediano_pct < 0 ? 'abaixo' : 'acima'} da TomTom ao vivo: o trânsito é a parte que falta nele.`);
    }
  }
  const medidos = d.vs_tomtom.filter((x) => x.n > 0 && x.mape_pct !== null && x.provedor !== 'tomtom' && x.provedor !== 'tomtom_mesmo_trajeto');
  if (medidos.length > 1) {
    const m = medidos.reduce((b, x) => (x.mape_pct! < b.mape_pct! ? x : b));
    frases.push(`Menor MAPE contra a TomTom: ${nomeProvedor(m.provedor)} (${fmtDec(m.mape_pct)}%).`);
  }
  return frases;
}

export type Portao = { juntas?: Record<string, { n: number; rmse_seg: number; mae_seg: number }>; escolhida?: string | null };

/** Teste fora do tempo: atual e anterior nas mesmas leituras, que nenhuma das duas viu no treino. */
export function lerPortao(p: Portao | undefined, atual: string, anteriorNome: string): string[] {
  const novo = p?.escolhida ? p.juntas?.[p.escolhida] : undefined;
  const velho = p?.juntas?.[anteriorNome];
  if (!novo || !velho) return [];
  const r = variacao(velho.rmse_seg, novo.rmse_seg);
  const m = variacao(velho.mae_seg, novo.mae_seg);
  const como = (x: number) => (x < 0 ? `caiu ${fmtPct(x)}` : `subiu ${fmtPct(x)}`);
  return [`Nas mesmas ${fmtInt(novo.n)} leituras, a ${rotuloVersao(atual)} contra a ${rotuloVersao(anteriorNome)}: RMSE ${como(r)} e MAE ${como(m)}.`,
          'Treino só com dados anteriores às leituras testadas: é a medida que decide adotar uma versão.'];
}
