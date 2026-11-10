'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { BarrasComparadas, BarrasVersao, type BarraVersao, type GrupoComparado } from '@/components/graficos';
import { Aviso, Cartao, Tabela } from '@/components/ui';
import { fmtDec, fmtDia, num } from '@/lib/formato';
import type { EstresseVersoes } from '@/lib/tipos';
import {
  PERIODOS,
  lerCongVersao,
  lerFeatures,
  lerFolds,
  lerIdade,
  lerPeriodo30,
  mesmaBaseV,
  parInicial,
  tem,
  type Metrica,
  type Recurso,
  type VersaoDados,
} from '@/lib/versoes';

const SEL =
  'min-h-11 pointer-fine:min-h-0 max-w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-foreground transition-colors duration-150 focus:border-accent focus:outline-none';

function SelVersao({ rotulo, valor, onChange, vs, ok, motivo }: { rotulo: string; valor: string; onChange: (v: string) => void; vs: VersaoDados[]; ok: (v: VersaoDados) => boolean; motivo: string }) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>{rotulo}</span>
      <select className={SEL} value={valor} onChange={(e) => onChange(e.target.value)}>
        {valor === '' ? <option value="">nenhuma</option> : null}
        {vs.map((v) => (
          <option key={v.versao} value={v.versao} disabled={!ok(v)}>
            {v.rotulo}
            {ok(v) ? '' : ` · ${motivo}`}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Par de versões da página inteira, guardado na URL (?a=lia_2.4&b=lia_2.3) para o link ser compartilhável. */
export function SeletorPar({ vs, a, b }: { vs: VersaoDados[]; a: string; b: string }) {
  const router = useRouter();
  const caminho = usePathname();
  const [pendente, comecar] = useTransition();
  const ir = (na: string, nb: string) => comecar(() => router.replace(`${caminho}?a=${na}&b=${nb}`, { scroll: false }));
  return (
    <div className="surgir mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-3" aria-busy={pendente}>
      <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Comparar</span>
      <SelVersao rotulo="A" valor={a} vs={vs} ok={() => true} motivo="" onChange={(v) => ir(v, v === b ? a : b)} />
      <span aria-hidden className="text-muted-foreground">
        ×
      </span>
      <SelVersao rotulo="B" valor={b} vs={vs} ok={() => true} motivo="" onChange={(v) => ir(v === a ? b : a, v)} />
      <span className="text-xs text-muted-foreground">{pendente ? 'Atualizando…' : 'Vale para todos os gráficos; cada cartão pode trocar o par só nele.'}</span>
    </div>
  );
}

/**
 * Cartão com dropdowns próprios de versão (e de métrica, se pedido). O par da página é o ponto de partida:
 * se a versão não tem o dado, cai na mais próxima que tem. Opção sem dado fica desabilitada, com o motivo.
 */
function CartaoVersoes({
  titulo, vs, a, b, ok, motivo, metrica = false, nota, siglas, className, atraso, render,
}: {
  titulo: string;
  vs: VersaoDados[];
  a: string;
  b: string;
  ok: (v: VersaoDados) => boolean;
  motivo: string;
  metrica?: boolean;
  nota?: ReactNode;
  siglas?: string[];
  className?: string;
  atraso?: number;
  render: (va: VersaoDados, vb: VersaoDados | undefined, m: Metrica) => { grafico: ReactNode; leitura?: string[]; extra?: ReactNode };
}) {
  const [[pa, pb], setPar] = useState(() => parInicial(vs, a, b, ok));
  const [m, setM] = useState<Metrica>('rmse');
  const va = vs.find((v) => v.versao === pa);
  const vb = vs.find((v) => v.versao === pb);
  const r = va ? render(va, vb, m) : null;
  return (
    <Cartao titulo={titulo} nota={nota} siglas={siglas} className={className} atraso={atraso} leitura={r?.leitura}>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <SelVersao rotulo="A" valor={pa} vs={vs} ok={ok} motivo={motivo} onChange={(v) => setPar(v === pb ? [v, pa] : [v, pb])} />
        <SelVersao rotulo="B" valor={pb} vs={vs} ok={ok} motivo={motivo} onChange={(v) => setPar(v === pa ? [pb, v] : [pa, v])} />
        {metrica ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Métrica</span>
            <select className={SEL} value={m} onChange={(e) => setM(e.target.value as Metrica)}>
              <option value="rmse">RMSE</option>
              <option value="mae">MAE</option>
            </select>
          </label>
        ) : null}
      </div>
      {r ? (
        <>
          {r.grafico}
          {!vb ? <p className="mt-2 text-xs text-muted-foreground">Só uma versão tem este dado ({motivo}); não há outra para comparar.</p> : null}
          {r.extra}
        </>
      ) : (
        <Aviso titulo="Nenhuma versão publicada tem este dado">Rode o treino atual e ml/publish_metrics.py para publicá-lo.</Aviso>
      )}
    </Cartao>
  );
}

const por = (rec: Recurso) => (v: VersaoDados) => tem(v, rec);
const NOME = { rmse: 'RMSE', mae: 'MAE' } as const;
const SUFIXO = (m: Metrica) => `Segundos por trecho, ${NOME[m]}. Barra cinza: B; azul: A; ponto laranja: persistência da A (repete a última leitura).`;

export function CartaoFolds({ vs, a, b }: { vs: VersaoDados[]; a: string; b: string }) {
  return (
    <CartaoVersoes
      titulo="CV por fold temporal"
      vs={vs} a={a} b={b} ok={por('folds')} motivo="sem folds publicados" metrica atraso={200}
      siglas={['CV', 'fold', 'persistência']}
      nota={`${SUFIXO('rmse')} Cada fold valida num período posterior ao que treinou.`}
      render={(va, vb, m) => {
        const dados: GrupoComparado[] = (va.folds ?? []).map((f, i) => ({ x: `fold ${i + 1}`, a: f.modelo[m], b: vb?.folds?.[i]?.modelo[m] ?? null, pers: f.pers[m] }));
        return {
          grafico: <BarrasComparadas dados={dados} nomeA={va.rotulo} nomeB={vb?.rotulo} nomeRef={`Persistência (${va.rotulo})`} />,
          leitura: lerFolds(va, vb, m),
        };
      }}
    />
  );
}

export function CartaoIdade({ vs, a, b }: { vs: VersaoDados[]; a: string; b: string }) {
  return (
    <CartaoVersoes
      titulo="Erro por idade da leitura"
      vs={vs} a={a} b={b} ok={por('idade')} motivo="medido a partir da 2.3" metrica atraso={220}
      siglas={['persistência', 'CV']}
      nota="Quão velha é a última leitura da via no momento da previsão. A persistência piora rápido com a idade; a LIA, menos."
      render={(va, vb, m) => {
        const dados: GrupoComparado[] = (va.idade ?? []).map((x) => ({
          x: `${x.min} min`, a: x.modelo[m], b: vb?.idade?.find((y) => y.min === x.min)?.modelo[m] ?? null, pers: x.pers[m],
        }));
        return {
          grafico: <BarrasComparadas dados={dados} nomeA={va.rotulo} nomeB={vb?.rotulo} nomeRef={`Persistência (${va.rotulo})`} ligar />,
          leitura: lerIdade(va, vb, m),
        };
      }}
    />
  );
}

function CartaoPeriodo({ vs, a, b, fonte, titulo, nota, atraso }: { vs: VersaoDados[]; a: string; b: string; fonte: 'periodo' | 'periodo30'; titulo: string; nota: string; atraso: number }) {
  return (
    <CartaoVersoes
      titulo={titulo}
      vs={vs} a={a} b={b} ok={por(fonte)} motivo="medido a partir da 2.4" metrica atraso={atraso}
      siglas={['persistência', 'viés']}
      nota={nota}
      render={(va, vb, m) => {
        const pa = va[fonte]!;
        const pb = vb?.[fonte];
        const dados: GrupoComparado[] = PERIODOS.filter((p) => pa.modelo[p.chave]).map((p) => ({
          x: p.curto, a: pa.modelo[p.chave]?.[m] ?? null, b: pb?.modelo[p.chave]?.[m] ?? null, pers: pa.persistencia[p.chave]?.[m] ?? null,
        }));
        return {
          grafico: <BarrasComparadas dados={dados} nomeA={va.rotulo} nomeB={vb?.rotulo} nomeRef={`Persistência (${va.rotulo})`} />,
          leitura: lerPeriodo30(pa, pb ?? null, va.rotulo, vb?.rotulo, m),
        };
      }}
    />
  );
}

export const CartaoPeriodoCv = (p: { vs: VersaoDados[]; a: string; b: string }) => (
  <CartaoPeriodo {...p} fonte="periodo" titulo="Erro por período do dia" atraso={240} nota="Faixas: pico da manhã 6–9 h e da tarde 17–19 h (dia útil), dia útil 10–16 h, noite 20–23 h, madrugada 0–5 h, fim de semana 6–19 h." />
);
export const CartaoPeriodo30 = (p: { vs: VersaoDados[]; a: string; b: string }) => (
  <CartaoPeriodo {...p} fonte="periodo30" titulo="Erro por período com leitura de 30 min" atraso={260} nota="Mesmas faixas, mas a última leitura da via tem 30 min: o caso mais comum fora do corredor monitorado." />
);

export function CartaoFeatures({ vs, a, b }: { vs: VersaoDados[]; a: string; b: string }) {
  return (
    <CartaoVersoes
      titulo="Importância das features"
      vs={vs} a={a} b={b} ok={por('features')} motivo="sem importância publicada" atraso={280}
      nota="Peso de cada variável nas árvores do XGBoost (soma 100%). As 12 maiores entre as duas versões."
      render={(va, vb) => {
        const fa = va.features!;
        const fb = vb?.features ?? {};
        const nomes = [...new Set([...Object.keys(fa), ...Object.keys(fb)])]
          .sort((x, y) => Math.max(fb[y] ?? 0, fa[y] ?? 0) - Math.max(fb[x] ?? 0, fa[x] ?? 0))
          .slice(0, 12);
        const dados: GrupoComparado[] = nomes.map((k) => ({ x: k, a: k in fa ? fa[k] * 100 : null, b: vb ? (k in fb ? fb[k] * 100 : null) : null }));
        return { grafico: <BarrasComparadas horizontal altura={420} dados={dados} nomeA={va.rotulo} nomeB={vb?.rotulo} unidade="%" />, leitura: lerFeatures(va, vb) };
      }}
    />
  );
}

export function CartaoCongestionado({ vs, a, b }: { vs: VersaoDados[]; a: string; b: string }) {
  return (
    <CartaoVersoes
      titulo="Erro geral × trechos congestionados"
      vs={vs} a={a} b={b} ok={por('cong')} motivo="sem erro congestionado publicado" atraso={300}
      siglas={['razão de congestionamento', 'RMSE', 'baseline']}
      nota="RMSE em segundos por trecho. Congestionado: razão de congestionamento abaixo de 0,95. Limitação conhecida: o erro absoluto sobe nesses trechos. Ponto laranja: baseline histórico da A."
      render={(va, vb) => {
        const dados: GrupoComparado[] = [
          { x: 'Todas as observações', a: va.geral.rmse, b: vb?.geral.rmse ?? null, pers: va.base.rmse },
          { x: 'Trechos congestionados', a: va.cong.modelo, b: vb?.cong.modelo ?? null, pers: va.cong.base },
        ];
        return {
          grafico: <BarrasComparadas dados={dados} nomeA={va.rotulo} nomeB={vb?.rotulo} nomeRef={`Baseline histórico (${va.rotulo})`} altura={250} />,
          leitura: lerCongVersao(va, vb),
        };
      }}
    />
  );
}

/* ---------- MAE/RMSE por versão, com filtro de quais versões aparecem ---------- */

export function PainelVersoes({ todas, a, leituraMae, leituraRmse }: { todas: VersaoDados[]; a: string; leituraMae: string[]; leituraRmse: string[] }) {
  // Re-treinos e a 2.1 refeita (repro) nascem desligados: poluem o gráfico e não são versões de produção.
  const [ocultas, setOcultas] = useState<string[]>(() => todas.filter((v) => /_repro$|_retreino_/.test(v.versao)).map((v) => v.versao));
  const alternar = (v: string) => setOcultas((o) => (o.includes(v) ? o.filter((x) => x !== v) : [...o, v]));
  const va = todas.find((v) => v.versao === a);
  const barras = (m: Metrica): BarraVersao[] =>
    todas
      .filter((v) => !ocultas.includes(v.versao) && v.geral[m] !== null)
      .map((v) => ({
        versao: v.versao === a ? `${v.rotulo} · A` : v.rotulo,
        valor: v.geral[m] ?? 0,
        desvio: v.desvio[m] ?? 0,
        tipo: v.versao === a ? 'atual' : !v.temporal ? 'nao_temporal' : va && !mesmaBaseV(va, v) ? 'outra_base' : 'comparavel',
      }));
  return (
    <>
      <fieldset className="mb-4 rounded-lg border border-border bg-card px-4 py-3">
        <legend className="px-1 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Versões no gráfico</legend>
        <div className="flex flex-wrap gap-2">
          {todas.map((v) => {
            const on = !ocultas.includes(v.versao);
            return (
              <button
                key={v.versao}
                type="button"
                aria-pressed={on}
                onClick={() => alternar(v.versao)}
                className={`min-h-11 pointer-fine:min-h-0 rounded-full border px-3 py-1 text-xs transition-colors duration-150 ${on ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:text-foreground'}`}
              >
                {v.rotulo}
                
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="grid gap-5 lg:grid-cols-2">
        <Cartao titulo="MAE por versão" atraso={160} leitura={leituraMae} siglas={['MAE', 'baseline', 'CV']}
          nota="Erro típico, em segundos por trecho. Linha tracejada: baseline da A. Versões de outra base (hachura quadriculada) tiveram o CV medido em dados diferentes: não se comparam com a A.">
          <BarrasVersao dados={barras('mae')} baseline={va?.base.mae ?? null} />
        </Cartao>
        <Cartao titulo="RMSE por versão" atraso={200} leitura={leituraRmse} siglas={['RMSE', 'fold']}
          nota="Pesa mais os erros grandes. Barras de erro: desvio entre os 5 folds temporais. Outra base = não se compara com a A.">
          <BarrasVersao dados={barras('rmse')} baseline={va?.base.rmse ?? null} />
        </Cartao>
      </div>
    </>
  );
}

/* ---------- Estresse por versão: os modelos de produção nas mesmas leituras novas ---------- */

const CENARIOS: Record<string, { curto: string; muda: string }> = {
  como_chega: { curto: 'Como chega', muda: 'A entrada real, do jeito que a API recebe.' },
  leitura_60min: { curto: 'Leitura 60 min', muda: 'Última leitura da via com 60 min de idade, sem vizinhos.' },
  leitura_120min: { curto: 'Leitura 120 min', muda: 'Última leitura da via com 120 min de idade, sem vizinhos.' },
  sem_vizinhos: { curto: 'Sem vizinhos', muda: 'Via lida agora, nenhum vizinho recente.' },
  chuva_zero: { curto: 'Chuva = 0', muda: 'Open-Meteo fora do ar: a API manda chuva 0.' },
  tudo_velho: { curto: 'Tudo velho', muda: 'Fora do corredor: recência = perfil de 24 h, sem vizinhos.' },
};
// Cenário → referência de persistência com a mesma idade de leitura. Sem correspondente, sem referência.
const REF: Record<string, string> = { como_chega: 'persistencia', leitura_60min: 'persistencia_60min', leitura_120min: 'persistencia_120min' };
const sinal = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtDec(Math.abs(v))} s`;

export function CartaoEstresse({ vs, a, b, e }: { vs: VersaoDados[]; a: string; b: string; e: EstresseVersoes }) {
  const publicadas = e.versoes ?? {};
  const ids = e.cenarios?.length ? e.cenarios : Object.keys(Object.values(publicadas)[0] ?? {});
  return (
    <CartaoVersoes
      titulo="Estresse treino × produção"
      vs={vs} a={a} b={b} ok={(v) => !!publicadas[v.versao]} motivo="não entrou neste teste" metrica atraso={220}
      siglas={['RMSE', 'MAE', 'persistência']}
      className="lg:col-span-2"
      nota={`Os modelos de produção de cada versão, nas mesmas ${e.n_linhas ? e.n_linhas.toLocaleString('pt-BR') + ' ' : ''}leituras${e.periodo ? ` de ${fmtDia(e.periodo[0])} a ${fmtDia(e.periodo[1])}` : e.desde ? ` desde ${fmtDia(e.desde)}` : ''}, que nenhum viu no treino. Só a entrada muda entre os cenários. Ponto laranja: persistência com a mesma idade de leitura.`}
      render={(va, vb, m) => {
        const chave = `${m}_seg` as const;
        const v = (ver: string | undefined, c: string) => (ver ? num(publicadas[ver]?.[c]?.[chave]) : null);
        const linhas = ids.map((c) => ({
          id: c, curto: CENARIOS[c]?.curto ?? c, muda: CENARIOS[c]?.muda ?? '',
          a: v(va.versao, c), b: v(vb?.versao, c), pers: REF[c] ? num(e.referencias?.[REF[c]]?.[chave]) : null,
        }));
        const piora = vb ? linhas.filter((l) => l.a !== null && l.b !== null && l.a > l.b) : [];
        const leitura = vb
          ? [piora.length
              ? `${va.rotulo} perde para ${vb.rotulo} em: ${piora.map((l) => `${l.curto.toLowerCase()} (${sinal((l.a as number) - (l.b as number))})`).join('; ')}. Δ = ${NOME[m]} da ${va.rotulo} menos o da ${vb.rotulo}; positivo = pior.`
              : `${va.rotulo} não perde para ${vb.rotulo} em nenhum cenário (${NOME[m]}).`]
          : [];
        return {
          leitura,
          grafico: <BarrasComparadas dados={linhas.map((l) => ({ x: l.curto, a: l.a, b: l.b, pers: l.pers }))} nomeA={va.rotulo} nomeB={vb?.rotulo} nomeRef="Persistência" altura={300} />,
          extra: (
            <div className="mt-5">
              <Tabela cabecalho={['Cenário', 'O que muda na entrada', `${NOME[m]} ${va.rotulo}`, ...(vb ? [`${NOME[m]} ${vb.rotulo}`, 'Δ'] : []), 'Persistência']}>
                {linhas.map((l) => (
                  <tr key={l.id}>
                    <td className="font-medium">{l.curto}</td>
                    <td className="max-w-64 text-xs text-muted-foreground">{l.muda}</td>
                    <td className="num">{l.a === null ? 'n/d' : `${fmtDec(l.a)} s`}</td>
                    {vb ? (
                      <>
                        <td className="num">{l.b === null ? 'n/d' : `${fmtDec(l.b)} s`}</td>
                        <td className={`num ${l.a !== null && l.b !== null && l.a > l.b ? 'font-medium text-alerta' : ''}`}>{l.a !== null && l.b !== null ? sinal(l.a - l.b) : 'n/d'}</td>
                      </>
                    ) : null}
                    <td className="num">{l.pers === null ? 'n/d' : `${fmtDec(l.pers)} s`}</td>
                  </tr>
                ))}
              </Tabela>
            </div>
          ),
        };
      }}
    />
  );
}
