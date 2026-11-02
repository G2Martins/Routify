'use client';

import { useId } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  ErrorBar,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { YAxisProps } from 'recharts';
import type { Benchmark, Calibracao } from '@/lib/tipos';

const TICK = { fill: 'var(--chart-eixo)', fontSize: 11, fontFamily: 'var(--font-plex-mono)' };
const DICA = {
  contentStyle: {
    background: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: { color: 'hsl(var(--foreground))', fontWeight: 500 },
  itemStyle: { color: 'hsl(var(--foreground))' },
  cursor: { fill: 'hsl(var(--muted))', opacity: 0.5 },
};
const LEGENDA = { wrapperStyle: { fontSize: 12, color: 'hsl(var(--muted-foreground))' } };
const br = (v: number, casas = 1) => v.toLocaleString('pt-BR', { maximumFractionDigits: casas });

function Moldura({ altura = 260, rotulo, children }: { altura?: number; rotulo?: string; children: React.ReactElement }) {
  return (
    <div style={{ height: altura }} className="w-full" role={rotulo ? 'img' : undefined} aria-label={rotulo}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- Uso ---------- */

export function SerieUso({ dados }: { dados: { dia: string; rotas: number; usuarios: number }[] }) {
  const pontos = dados.map((d) => ({ ...d, rotulo: d.dia.slice(5).split('-').reverse().join('/') }));
  return (
    <Moldura>
      <ComposedChart data={pontos} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grade)" />
        <XAxis dataKey="rotulo" tick={TICK} tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} tick={TICK} tickLine={false} axisLine={false} />
        <Tooltip {...DICA} />
        <Legend {...LEGENDA} />
        <Area type="monotone" dataKey="rotas" name="Rotas" stroke="var(--chart-1)" strokeWidth={2} fill="var(--chart-1)" fillOpacity={0.12} />
        <Line type="monotone" dataKey="usuarios" name="Usuários" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 3 }} />
      </ComposedChart>
    </Moldura>
  );
}

/** Litros economizados por dia (rota da LIA × caminho mais curto). */
export function BarrasCombustivel({ dados }: { dados: { dia: string; litros: number; rotas: number }[] }) {
  const pontos = dados.map((d) => ({ ...d, litros: Number(d.litros), rotulo: d.dia.slice(5).split('-').reverse().join('/') }));
  return (
    <Moldura altura={220}>
      <BarChart data={pontos} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grade)" />
        <XAxis dataKey="rotulo" tick={TICK} tickLine={false} axisLine={false} />
        <YAxis tick={TICK} tickLine={false} axisLine={false} />
        <Tooltip {...DICA} formatter={(v) => [`${br(Number(v), 2)} L`, 'Economizado']} />
        <Bar dataKey="litros" name="Litros economizados" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </Moldura>
  );
}

export function BarrasHora({ dados }: { dados: { hora: number; rotas: number }[] }) {
  const porHora = new Map(dados.map((d) => [d.hora, d.rotas]));
  const pontos = Array.from({ length: 24 }, (_, h) => ({ hora: `${h}h`, rotas: porHora.get(h) ?? 0 }));
  return (
    <Moldura altura={220}>
      <BarChart data={pontos} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grade)" />
        <XAxis dataKey="hora" tick={TICK} tickLine={false} axisLine={false} interval={2} />
        <YAxis allowDecimals={false} tick={TICK} tickLine={false} axisLine={false} />
        <Tooltip {...DICA} />
        <Bar dataKey="rotas" name="Rotas" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </Moldura>
  );
}

/* ---------- LIA ---------- */

export type BarraVersao = { versao: string; valor: number; desvio: number; comparavel: boolean; destaque: boolean };

/** MAE ou RMSE por versão × baseline. Não comparável = hachura (vale em P&B). */
export function BarrasVersao({ dados, baseline }: { dados: BarraVersao[]; baseline: number | null }) {
  const hachura = `hachura-${useId().replace(/:/g, '')}`;
  return (
    <Moldura altura={250}>
      <BarChart data={dados} margin={{ top: 22, right: 12, bottom: 0, left: -12 }}>
        <defs>
          <pattern id={hachura} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--chart-eixo)" strokeWidth="1.5" />
          </pattern>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--chart-grade)" />
        <XAxis dataKey="versao" tick={TICK} tickLine={false} axisLine={false} />
        <YAxis tick={TICK} tickLine={false} axisLine={false} unit=" s" />
        <Tooltip {...DICA} formatter={(v) => `${br(Number(v))} s`} />
        {baseline !== null ? (
          <ReferenceLine
            y={baseline}
            stroke="hsl(var(--muted-foreground))"
            strokeDasharray="5 4"
            label={{ value: `baseline ${br(baseline)} s`, position: 'insideTopRight', fill: 'var(--chart-eixo)', fontSize: 11 }}
          />
        ) : null}
        <Bar dataKey="valor" name="Erro" radius={[4, 4, 0, 0]}>
          {dados.map((d) => (
            <Cell
              key={d.versao}
              fill={d.destaque ? 'var(--chart-1)' : d.comparavel ? 'var(--chart-neutro)' : `url(#${hachura})`}
              stroke={d.comparavel ? 'none' : 'var(--chart-eixo)'}
            />
          ))}
          <ErrorBar dataKey="desvio" width={6} stroke="hsl(var(--muted-foreground))" />
          <LabelList dataKey="valor" position="top" formatter={(v) => br(Number(v))} fill="hsl(var(--foreground))" fontSize={11} />
        </Bar>
      </BarChart>
    </Moldura>
  );
}

export function CurvaCalibracao({ dados }: { dados: Calibracao }) {
  const { distancias_m, confiancas } = dados.curva_isotonica_grade_10m;
  const antiga = (d: number) => (d < 200 ? 1 : d < 500 ? 0.8 : 0.6);
  const grade = distancias_m.map((d, i) => ({ d, conf: confiancas[i], antiga: antiga(d) }));
  const faixas = dados.curva_erro_distancia_bins.map((b) => ({ d: b.centro_m, faixa: b.confianca_calibrada, n: b.n_pares }));
  return (
    <Moldura altura={320}>
      <ComposedChart data={grade} margin={{ top: 12, right: 16, bottom: 4, left: -8 }}>
        <CartesianGrid stroke="var(--chart-grade)" />
        <XAxis type="number" dataKey="d" domain={[0, dados.metodologia.dist_max_m]} tick={TICK} tickLine={false} unit=" m" />
        <YAxis domain={[0, 1.05]} tick={TICK} tickLine={false} axisLine={false} tickFormatter={(v) => br(Number(v), 2)} />
        <Tooltip {...DICA} formatter={(v) => br(Number(v), 3)} labelFormatter={(d) => `${d} m`} />
        <Legend {...LEGENDA} />
        <ReferenceLine x={500} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 3" label={{ value: 'raio do transfer', position: 'insideTopLeft', fill: 'var(--chart-eixo)', fontSize: 11 }} />
        <Line type="stepAfter" dataKey="antiga" name="Escala antiga (fixa)" stroke="var(--chart-2)" strokeDasharray="6 4" strokeWidth={1.8} dot={false} />
        <Line type="linear" dataKey="conf" name="Curva isotônica calibrada" stroke="var(--chart-1)" strokeWidth={2.2} dot={false} />
        <Scatter data={faixas} dataKey="faixa" name="Confiança do erro médio da faixa" fill="var(--chart-neutro)" />
      </ComposedChart>
    </Moldura>
  );
}

const MODELOS = [
  { chave: 'xgboost_com_recencia', nome: 'XGBoost + recência (LIA 2.1)', cor: 'var(--chart-1)' },
  { chave: 'xgboost', nome: 'XGBoost sem recência (LIA 2.0)', cor: 'var(--chart-2)' },
  { chave: 'lstm', nome: 'LSTM', cor: 'var(--chart-3)' },
] as const;

export function BenchmarkFolds({ dados }: { dados: Benchmark }) {
  const n = dados.xgboost.folds.length;
  const pontos = Array.from({ length: n }, (_, i) => ({
    fold: `fold ${i + 1}`,
    xgboost_com_recencia: dados.xgboost_com_recencia.folds[i]?.rmse_seg,
    xgboost: dados.xgboost.folds[i]?.rmse_seg,
    lstm: dados.lstm.folds[i]?.rmse_seg,
  }));
  return (
    <Moldura altura={280}>
      <LineChart data={pontos} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grade)" />
        <XAxis dataKey="fold" tick={TICK} tickLine={false} axisLine={false} />
        <YAxis tick={TICK} tickLine={false} axisLine={false} unit=" s" domain={['auto', 'auto']} />
        <Tooltip {...DICA} formatter={(v) => `${br(Number(v))} s`} />
        <Legend {...LEGENDA} />
        {MODELOS.map((m) => (
          <Line key={m.chave} type="monotone" dataKey={m.chave} name={m.nome} stroke={m.cor} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: 'hsl(var(--card))' }} />
        ))}
      </LineChart>
    </Moldura>
  );
}

export function TempoTreino({ dados }: { dados: Benchmark }) {
  const pontos = MODELOS.map((m) => ({ nome: m.nome.split(' (')[0], tempo: dados[m.chave].tempo_treino_s_media, cor: m.cor }));
  return (
    <Moldura altura={170}>
      <BarChart data={pontos} layout="vertical" margin={{ top: 4, right: 40, bottom: 0, left: 24 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="nome" tick={TICK} tickLine={false} axisLine={false} width={130} />
        <Tooltip {...DICA} formatter={(v) => `${br(Number(v))} s por fold`} />
        <Bar dataKey="tempo" name="Treino" radius={[0, 4, 4, 0]}>
          {pontos.map((p) => (
            <Cell key={p.nome} fill={p.cor} />
          ))}
          <LabelList dataKey="tempo" position="right" formatter={(v) => `${br(Number(v))} s`} fill="hsl(var(--foreground))" fontSize={11} />
        </Bar>
      </BarChart>
    </Moldura>
  );
}

export function Congestionamento({ geral, congestionado, modelo }: { geral: [number, number]; congestionado: [number, number]; modelo: string }) {
  const pontos = [
    { grupo: 'Todas as observações', baseline: geral[0], lia: geral[1] },
    { grupo: 'Trechos congestionados', baseline: congestionado[0], lia: congestionado[1] },
  ];
  return (
    <Moldura altura={250}>
      <BarChart data={pontos} margin={{ top: 22, right: 12, bottom: 0, left: -8 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grade)" />
        <XAxis dataKey="grupo" tick={TICK} tickLine={false} axisLine={false} />
        <YAxis tick={TICK} tickLine={false} axisLine={false} unit=" s" />
        <Tooltip {...DICA} formatter={(v) => `${br(Number(v))} s`} />
        <Legend {...LEGENDA} />
        <Bar dataKey="baseline" name="Baseline histórico" fill="var(--chart-neutro)" radius={[4, 4, 0, 0]}>
          <LabelList dataKey="baseline" position="top" formatter={(v) => br(Number(v))} fill="hsl(var(--foreground))" fontSize={11} />
        </Bar>
        <Bar dataKey="lia" name={modelo} fill="var(--chart-1)" radius={[4, 4, 0, 0]}>
          <LabelList dataKey="lia" position="top" formatter={(v) => br(Number(v))} fill="hsl(var(--foreground))" fontSize={11} />
        </Bar>
      </BarChart>
    </Moldura>
  );
}

export function DispersaoFeedback({ pontos }: { pontos: { previsto: number; real: number }[] }) {
  const maximo = Math.max(10, ...pontos.flatMap((p) => [p.previsto, p.real]));
  return (
    <Moldura altura={300}>
      <ScatterChart margin={{ top: 12, right: 16, bottom: 4, left: -8 }}>
        <CartesianGrid stroke="var(--chart-grade)" />
        <XAxis type="number" dataKey="previsto" name="Previsto" unit=" min" domain={[0, Math.ceil(maximo)]} tick={TICK} tickLine={false} />
        <YAxis type="number" dataKey="real" name="Real" unit=" min" domain={[0, Math.ceil(maximo)]} tick={TICK} tickLine={false} axisLine={false} />
        <Tooltip {...DICA} formatter={(v) => `${br(Number(v))} min`} />
        <ReferenceLine segment={[{ x: 0, y: 0 }, { x: maximo, y: maximo }]} stroke="hsl(var(--muted-foreground))" strokeDasharray="5 4" />
        <Scatter data={pontos} name="Viagens" fill="var(--chart-1)" />
      </ScatterChart>
    </Moldura>
  );
}

/* ---------- LIA × provedores ---------- */

export type SerieLinha = { chave: string; nome: string; cor: string; tracejado?: boolean };

// Só valores serializáveis cruzam de Server para Client Component: por isso enum, não função.
const FORMATO_X = {
  texto: (v: unknown) => String(v),
  hora: (v: unknown) => `${v}h`,
  minutos: (v: unknown) => `${v} min`,
};
const DOMINIO_Y: Record<'auto' | 'zero', YAxisProps['domain']> = { auto: ['auto', 'auto'], zero: [0, 'auto'] };

/** Eixo do desvio contra a referência: o zero sempre aparece e as marcas caem em passos redondos. */
function eixoComZero(dados: Record<string, number | string | null>[], chaves: string[]) {
  const v = dados.flatMap((d) => chaves.map((k) => d[k])).filter((x): x is number => typeof x === 'number');
  const [min, max] = [Math.min(0, ...v), Math.max(0, ...v)];
  const passo = [1, 2, 5, 10, 20, 25, 50, 100].find((p) => (max - min) / p <= 6) ?? 100;
  const ini = Math.floor(min / passo) * passo;
  const fim = Math.max(Math.ceil(max / passo) * passo, ini + passo);
  const ticks: number[] = [];
  for (let t = ini; t <= fim; t += passo) ticks.push(t);
  return { dominio: [ini, fim] as [number, number], ticks };
}
/** Sempre com 1 casa: 43,0 (e não 43) nos rótulos e tooltips. */
const br1 = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** −12,3 · +4,5 (com sinal) ou 38,5 (sem). `fixo` = 1 casa sempre; sem ele, 35 vira "35" (marcas do eixo). */
const comSinalBr = (v: number, sinal: boolean, fixo = false) => {
  const r = Math.round(v * 10) / 10;
  return `${r < 0 ? '−' : sinal && r > 0 ? '+' : ''}${(fixo ? br1 : br)(Math.abs(r))}`;
};

/**
 * Linhas por categoria do eixo X (hora, idade da leitura…). A lista de séries vem de quem chama, dos
 * dados. Coluna `n_<chave>` na linha de dados, se existir, entra no tooltip como "n = …".
 * `zero` liga a linha y = 0 com esse rótulo (a TomTom, quando o eixo mede desvio contra ela).
 */
export function GraficoLinhas({
  dados,
  x,
  series,
  formatoX = 'texto',
  unidade = '',
  dominioY = 'auto',
  zero,
  comSinal = false,
  altura = 280,
  ticksX,
  rotulo,
}: {
  dados: Record<string, number | string | null>[];
  x: string;
  series: SerieLinha[];
  formatoX?: keyof typeof FORMATO_X;
  unidade?: string;
  dominioY?: 'auto' | 'zero' | 'incluiZero';
  zero?: string;
  comSinal?: boolean;
  altura?: number;
  ticksX?: number[];
  rotulo?: string;
}) {
  const fx = FORMATO_X[formatoX];
  const eixo = dominioY === 'incluiZero' ? eixoComZero(dados, series.map((s) => s.chave)) : null;
  return (
    <Moldura altura={altura} rotulo={rotulo}>
      <LineChart data={dados} margin={{ top: 8, right: 16, bottom: 0, left: -4 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grade)" />
        <XAxis dataKey={x} tick={TICK} tickLine={false} axisLine={false} tickFormatter={fx} ticks={ticksX} interval={ticksX ? 0 : 'preserveStartEnd'} />
        <YAxis
          tick={TICK}
          tickLine={false}
          axisLine={false}
          unit={unidade}
          domain={eixo ? eixo.dominio : DOMINIO_Y[dominioY === 'zero' ? 'zero' : 'auto']}
          ticks={eixo?.ticks}
          tickFormatter={(v) => comSinalBr(Number(v), comSinal)}
        />
        <Tooltip
          {...DICA}
          labelFormatter={fx}
          formatter={(v, nome, item) => {
            const n = (item?.payload as Record<string, unknown> | undefined)?.[`n_${String(item?.dataKey)}`];
            return [`${comSinalBr(Number(v), comSinal, true)}${unidade}${typeof n === 'number' ? ` · n = ${n}` : ''}`, nome];
          }}
        />
        <Legend {...LEGENDA} itemSorter={null} />
        {zero ? (
          <ReferenceLine
            y={0}
            stroke="hsl(var(--muted-foreground))"
            label={{ value: zero, position: 'insideBottomRight', fill: 'var(--chart-eixo)', fontSize: 11 }}
          />
        ) : null}
        {series.map((s) => (
          <Line
            key={s.chave}
            type="linear"
            dataKey={s.chave}
            name={s.nome}
            stroke={s.cor}
            strokeWidth={2}
            strokeDasharray={s.tracejado ? '6 4' : undefined}
            dot={{ r: 3, strokeWidth: 2, fill: 'hsl(var(--card))' }}
            connectNulls
          />
        ))}
      </LineChart>
    </Moldura>
  );
}

export type PontoRota = { tomtom: number; lia: number; km: number | null; cobertura: number | null };

function DicaRota({ active, payload }: { active?: boolean; payload?: readonly { payload?: PontoRota }[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  const desvio = p.tomtom ? ((p.lia - p.tomtom) / p.tomtom) * 100 : null;
  return (
    <div style={DICA.contentStyle} className="space-y-0.5 px-3 py-2">
      <p>
        TomTom <b className="num">{br1(p.tomtom)} min</b> · LIA <b className="num">{br1(p.lia)} min</b>
      </p>
      <p className="text-muted-foreground">
        {desvio === null ? '' : `desvio ${comSinalBr(desvio, true, true)}%`}
        {p.km !== null ? ` · ${br(p.km)} km` : ''}
        {p.cobertura !== null ? ` · cobertura LIA ${br(p.cobertura, 0)}%` : ''}
      </p>
    </div>
  );
}

/** LIA × TomTom no mesmo trajeto, uma bolinha por rota real. Diagonal = acerto; pontilhadas = ±20%. */
export function DispersaoRotasReais({ pontos }: { pontos: PontoRota[] }) {
  const teto = Math.ceil(Math.max(10, ...pontos.flatMap((p) => [p.tomtom, p.lia])));
  return (
    <Moldura altura={320} rotulo="Dispersão do tempo previsto pela LIA contra o tempo da TomTom, em minutos, nas rotas reais">
      <ScatterChart margin={{ top: 12, right: 16, bottom: 4, left: -8 }}>
        <CartesianGrid stroke="var(--chart-grade)" />
        <XAxis type="number" dataKey="tomtom" name="TomTom" unit=" min" domain={[0, teto]} tick={TICK} tickLine={false} />
        <YAxis type="number" dataKey="lia" name="LIA" unit=" min" domain={[0, teto]} tick={TICK} tickLine={false} axisLine={false} />
        <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<DicaRota />} />
        <ReferenceLine segment={[{ x: 0, y: 0 }, { x: teto, y: teto }]} stroke="hsl(var(--muted-foreground))" strokeDasharray="5 4" />
        <ReferenceLine segment={[{ x: 0, y: 0 }, { x: teto, y: teto * 1.2 }]} stroke="var(--chart-eixo)" strokeDasharray="2 4" ifOverflow="hidden" />
        <ReferenceLine segment={[{ x: 0, y: 0 }, { x: teto, y: teto * 0.8 }]} stroke="var(--chart-eixo)" strokeDasharray="2 4" />
        <Scatter data={pontos} name="Rotas reais" fill="var(--chart-1)" fillOpacity={0.7} />
      </ScatterChart>
    </Moldura>
  );
}

/** Viés mediano (%) por hora de partida, com o n de cada barra no tooltip. */
export function BarrasVies({ dados }: { dados: { hora: number; vies: number; n: number }[] }) {
  const pontos = dados.map((d) => ({ ...d, rotulo: `${d.hora}h` }));
  const eixo = eixoComZero(pontos, ['vies']);
  return (
    <Moldura altura={320} rotulo="Viés mediano da LIA contra a TomTom, por hora de partida, nas rotas reais">
      <BarChart data={pontos} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grade)" />
        <XAxis dataKey="rotulo" tick={TICK} tickLine={false} axisLine={false} />
        <YAxis
          tick={TICK}
          tickLine={false}
          axisLine={false}
          unit="%"
          domain={eixo.dominio}
          ticks={eixo.ticks}
          tickFormatter={(v) => comSinalBr(Number(v), true)}
        />
        <Tooltip
          {...DICA}
          labelFormatter={(h) => `Saída às ${h}`}
          formatter={(v, _nome, item) => [`${comSinalBr(Number(v), true, true)}% · n = ${item?.payload?.n}`, 'Viés mediano']}
        />
        <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
        <Bar dataKey="vies" name="Viés mediano" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </Moldura>
  );
}

/** Estresse treino × produção: RMSE de duas versões da LIA por cenário de entrada degradada. */
export function EstresseCenarios({
  dados,
  nomeBase,
  nomeNova,
}: {
  dados: { cenario: string; base: number; nova: number }[];
  nomeBase: string;
  nomeNova: string;
}) {
  return (
    <Moldura altura={300} rotulo={`RMSE de ${nomeBase} e ${nomeNova} em cada cenário de estresse`}>
      <BarChart data={dados} margin={{ top: 22, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grade)" />
        <XAxis dataKey="cenario" tick={TICK} tickLine={false} axisLine={false} interval={0} />
        <YAxis tick={TICK} tickLine={false} axisLine={false} unit=" s" />
        <Tooltip {...DICA} formatter={(v) => `${br1(Number(v))} s`} />
        <Legend {...LEGENDA} itemSorter={null} />
        <Bar dataKey="base" name={nomeBase} fill="var(--chart-neutro)" radius={[4, 4, 0, 0]}>
          <LabelList dataKey="base" position="top" formatter={(v) => br1(Number(v))} fill="hsl(var(--foreground))" fontSize={11} />
        </Bar>
        <Bar dataKey="nova" name={nomeNova} fill="var(--chart-1)" radius={[4, 4, 0, 0]}>
          <LabelList dataKey="nova" position="top" formatter={(v) => br1(Number(v))} fill="hsl(var(--foreground))" fontSize={11} />
        </Bar>
      </BarChart>
    </Moldura>
  );
}
