import { Cartao, Selo, Tabela } from '@/components/ui';
import { fmtDec, fmtInt } from '@/lib/formato';
import type { AblacaoLia24, PorPeriodo } from '@/lib/tipos';

/**
 * Erro da LIA por período do dia (ml/ablation_lia_2_4.py → ablation_lia_2.4.json). Mostra onde o modelo erra — o
 * pico da tarde de dia útil — e a candidata a 2.4 (pesos por período) que não corrigiu isso. Viés < 0 = previu mais
 * rápido que o real (subestimou o congestionamento). Erros em segundos por trecho de via.
 */
const PERIODOS: { chave: string; rotulo: string }[] = [
  { chave: 'pico_manha_util', rotulo: 'Pico da manhã (dia útil, 6–9 h)' },
  { chave: 'pico_tarde_util', rotulo: 'Pico da tarde (dia útil, 17–19 h)' },
  { chave: 'dia_util', rotulo: 'Dia útil, 10–16 h' },
  { chave: 'noite', rotulo: 'Noite (20–23 h)' },
  { chave: 'madrugada', rotulo: 'Madrugada (0–5 h)' },
  { chave: 'dia_fim_de_semana', rotulo: 'Fim de semana, 6–19 h' },
];

const sinal = (v: number | undefined) => (v === undefined ? 'n/d' : `${v > 0 ? '+' : ''}${fmtDec(v, 1)}`);

function TabelaPeriodos({ v, titulo }: { v: { nome: string; p: PorPeriodo }[]; titulo: string }) {
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">{titulo}</p>
      <Tabela cabecalho={['Período', ...v.map((x) => `${x.nome}: viés / MAE`), 'Persistência MAE']}>
        {PERIODOS.filter((p) => v[0]?.p.modelo[p.chave]).map((p) => (
          <tr key={p.chave}>
            <td>{p.rotulo}</td>
            {v.map((x) => {
              const e = x.p.modelo[p.chave];
              return (
                <td key={x.nome} className="num">
                  {e ? `${sinal(e.vies_seg)} / ${fmtDec(e.mae_seg, 1)} s` : 'n/d'}
                </td>
              );
            })}
            <td className="num">{v[0].p.persistencia[p.chave] ? `${fmtDec(v[0].p.persistencia[p.chave].mae_seg, 1)} s` : 'n/d'}</td>
          </tr>
        ))}
      </Tabela>
    </div>
  );
}

export function Periodos({ a }: { a: AblacaoLia24 | undefined }) {
  if (!a?.variantes?.length) return null;
  const base = a.variantes[0];
  const tarde = base.por_periodo.modelo.pico_tarde_util;
  return (
    <Cartao
      titulo="Erro por período do dia · candidata a LIA 2.4"
      siglas={['MAE', 'viés', 'persistência']}
      nota={`Mesmos 5 folds temporais da 2.3, ${fmtInt(a.linhas)} linhas. A candidata pesa cada linha por (hora, fim de semana) contra o viés de cobertura (23% das linhas às 21h). Não corrigiu o pico da tarde e piorou com leitura de 30 min: rejeitada em 2026-11-02; a 2.3 segue padrão.${a.smoke ? ' Execução de teste: não cite.' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Selo tom="alerta">pico da tarde: viés {sinal(tarde?.vies_seg)} s por trecho</Selo>
        <Selo tom="neutro">candidata rejeitada</Selo>
      </div>
      <TabelaPeriodos titulo="Leitura fresca" v={a.variantes.map((x) => ({ nome: x.nome, p: x.por_periodo }))} />
      <TabelaPeriodos titulo="Leitura de 30 min (perto da produção)" v={a.variantes.map((x) => ({ nome: x.nome, p: x.por_periodo_recencia_30min }))} />
    </Cartao>
  );
}
