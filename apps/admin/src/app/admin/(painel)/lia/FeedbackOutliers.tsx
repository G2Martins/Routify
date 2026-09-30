'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmarDialog, MensagemRetorno, useAcao } from '@/components/acoes';
import { BTN_SECUNDARIO, CAMPO, Selo, Tabela } from '@/components/ui';
import { fmtData, fmtDuracao, fmtInt } from '@/lib/formato';
import { clienteNavegador } from '@/lib/supabase-navegador';
import type { Feedback } from '@/lib/tipos';

const PASSO = 20;
const erroSeg = (f: Feedback) => (f.tempo_previsto_seg === null ? null : f.tempo_real_seg - f.tempo_previsto_seg);

/** Feedback de produção, maiores erros primeiro, com exclusão de outlier (motivo obrigatório, auditado). */
export function FeedbackOutliers({ linhas }: { linhas: Feedback[] }) {
  const router = useRouter();
  const { executar, ocupado, retorno, setRetorno } = useAcao();
  const [mostrar, setMostrar] = useState(PASSO);
  const [excluir, setExcluir] = useState<Feedback | null>(null);
  const [motivo, setMotivo] = useState('');

  const ordenadas = [...linhas].sort((a, b) => Math.abs(erroSeg(b) ?? -1) - Math.abs(erroSeg(a) ?? -1));

  const marcar = async (f: Feedback, excluido: boolean, texto = '') => {
    const r = await executar(
      f.id,
      () => clienteNavegador().rpc('admin_feedback_excluir', { p_id: f.id, p_excluir: excluido, p_motivo: texto }),
      excluido ? 'Viagem excluída da métrica de produção.' : 'Viagem reincluída na métrica.',
    );
    setExcluir(null);
    if (r.ok) router.refresh();
  };

  return (
    <div className="mt-6 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">Viagens com feedback · maiores erros primeiro</p>
        <p className="text-xs text-muted-foreground">Excluir tira a viagem do gráfico e do MAE real; o registro fica no banco e na auditoria.</p>
      </div>
      <MensagemRetorno retorno={retorno} onFechar={() => setRetorno(null)} />
      <Tabela cabecalho={['Quando', 'Previsto', 'Real', 'Erro (real − previsto)', 'Cobertura LIA', 'Situação', '']}>
        {ordenadas.slice(0, mostrar).map((f) => {
          const e = erroSeg(f);
          return (
            <tr key={f.id} className={f.feedback_excluido ? 'text-muted-foreground' : undefined}>
              <td className="num text-xs">{fmtData(f.criado_em)}</td>
              <td className="num">{fmtDuracao(f.tempo_previsto_seg)}</td>
              <td className="num">{fmtDuracao(f.tempo_real_seg)}</td>
              <td className="num">{e === null ? '—' : `${e > 0 ? '+' : e < 0 ? '−' : ''}${fmtDuracao(Math.abs(e))}`}</td>
              <td className="num">{f.lia_cobertura_pct === null ? '—' : `${fmtInt(f.lia_cobertura_pct)}%`}</td>
              <td>
                {f.feedback_excluido ? (
                  <div className="space-y-1">
                    <Selo tom="alerta">excluída</Selo>
                    {f.feedback_excluido_motivo ? <p className="max-w-56 text-[11px] leading-tight">{f.feedback_excluido_motivo}</p> : null}
                  </div>
                ) : (
                  <Selo tom="neutro">na métrica</Selo>
                )}
              </td>
              <td className="text-right">
                <button
                  type="button"
                  disabled={ocupado !== null}
                  onClick={() => {
                    if (f.feedback_excluido) marcar(f, false);
                    else {
                      setMotivo('');
                      setExcluir(f);
                    }
                  }}
                  className={`${BTN_SECUNDARIO} px-2.5 py-1 text-xs`}
                >
                  {ocupado === f.id ? 'Salvando…' : f.feedback_excluido ? 'Reincluir' : 'Excluir como outlier'}
                </button>
              </td>
            </tr>
          );
        })}
      </Tabela>
      {ordenadas.length > mostrar ? (
        <button type="button" onClick={() => setMostrar((m) => m + PASSO)} className={BTN_SECUNDARIO}>
          Mostrar mais ({fmtInt(ordenadas.length - mostrar)} restantes)
        </button>
      ) : null}

      <ConfirmarDialog
        aberto={excluir !== null}
        titulo="Excluir viagem como outlier?"
        rotuloConfirmar="Excluir da métrica"
        ocupado={ocupado !== null}
        podeConfirmar={motivo.trim().length >= 3}
        onFechar={() => setExcluir(null)}
        onConfirmar={() => excluir && marcar(excluir, true, motivo.trim())}
      >
        {excluir ? (
          <p>
            Previsto <span className="num text-foreground">{fmtDuracao(excluir.tempo_previsto_seg)}</span>, real{' '}
            <span className="num text-foreground">{fmtDuracao(excluir.tempo_real_seg)}</span>. A viagem sai do gráfico e do MAE real, mas
            continua no banco — dá para reincluir depois.
          </p>
        ) : null}
        <div>
          <label htmlFor="motivo-outlier" className="text-xs">
            Motivo (vai para a auditoria e para o texto da tese)
          </label>
          <input
            id="motivo-outlier"
            required
            minLength={3}
            maxLength={200}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: parada no caminho; tempo informado inclui estacionar"
            className={`${CAMPO} mt-1`}
          />
        </div>
      </ConfirmarDialog>
    </div>
  );
}
