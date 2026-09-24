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

function Moldura({ altura = 260, children }: { altura?: number; children: React.ReactElement }) {
  return (
    <div style={{ height: altura }} className="w-full">
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

export function Congestionamento({ geral, congestionado }: { geral: [number, number]; congestionado: [number, number] }) {
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
        <Bar dataKey="lia" name="LIA 2.1" fill="var(--chart-1)" radius={[4, 4, 0, 0]}>
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
