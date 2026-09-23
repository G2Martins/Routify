import { BarrasHora, SerieUso } from '@/components/graficos';
import { StatusApi } from '@/components/StatusApi';
import { Aviso, Cabecalho, Cartao, ErroConsulta, Kpi, SeletorJanela, Tabela } from '@/components/ui';
import { exigirAdmin } from '@/lib/auth';
import { fmtInt, fmtPct } from '@/lib/formato';
import type { ResumoUso } from '@/lib/tipos';

const JANELAS = [7, 30, 90];
const ROTULO_EVENTO: Record<string, string> = {
  busca: 'Busca selecionada',
  rota_solicitada: 'Rota solicitada',
  navegacao_iniciada: 'Navegação iniciada',
  navegacao_concluida: 'Navegação concluída',
  feedback: 'Feedback de tempo real',
};

export default async function VisaoGeral({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const { dias: diasParam } = await searchParams;
  const dias = JANELAS.includes(Number(diasParam)) ? Number(diasParam) : 30;
  const { sb } = await exigirAdmin();
  const { data, error } = await sb.rpc('admin_resumo_uso', { dias });
  const r = data as ResumoUso | null;

  const seletor = <SeletorJanela base="/admin" atual={dias} janelas={JANELAS} />;

  return (
    <>
      <Cabecalho titulo="Visão geral" sobre="Uso da plataforma e saúde dos serviços, com dados capturados pelo servidor." direita={seletor} />
      <div className="mb-6">
        <StatusApi />
      </div>
      <ErroConsulta erro={error} />
      {r ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi rotulo="Rotas calculadas" valor={fmtInt(r.rotas)} detalhe={`em ${r.janela_dias} dias`} />
            <Kpi rotulo="Usuários ativos" valor={fmtInt(r.usuarios_ativos)} detalhe={`de ${fmtInt(r.usuarios_total)} cadastrados`} atraso={40} />
            <Kpi
              rotulo="Erros 5xx"
              valor={r.requisicoes ? fmtPct((r.erros_5xx / r.requisicoes) * 100) : '—'}
              detalhe={`${fmtInt(r.erros_5xx)} de ${fmtInt(r.requisicoes)} requisições`}
              atraso={80}
            />
            <Kpi
              rotulo="Latência p95"
              valor={r.latencia_p95_ms === null ? '—' : `${fmtInt(r.latencia_p95_ms)} ms`}
              detalhe={r.rotas ? `${fmtPct((r.rotas_degradadas / r.rotas) * 100)} das rotas em modo só-LIA` : undefined}
              atraso={120}
            />
          </div>

          {r.rotas === 0 ? (
            <Aviso titulo="Nenhuma rota registrada nesta janela">
              A captura começa quando o app pede rotas à API. Peça uma rota no app e atualize esta página.
            </Aviso>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
              <Cartao titulo="Rotas e usuários por dia" atraso={160}>
                <SerieUso dados={r.serie_diaria} />
              </Cartao>
              <Cartao titulo="Rotas por hora de partida" atraso={200} nota="Horário de Brasília.">
                <BarrasHora dados={r.por_hora} />
              </Cartao>
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <Cartao titulo="Endpoints da API" atraso={240}>
              {r.por_endpoint.length ? (
                <Tabela cabecalho={['Rota', 'Requisições', 'Erros 5xx', 'p95']}>
                  {r.por_endpoint.map((e) => (
                    <tr key={e.rota}>
                      <td className="num">{e.rota}</td>
                      <td className="num">{fmtInt(e.n)}</td>
                      <td className={`num ${e.erros ? 'text-destructive' : ''}`}>{fmtInt(e.erros)}</td>
                      <td className="num">{e.p95_ms === null ? '—' : `${fmtInt(e.p95_ms)} ms`}</td>
                    </tr>
                  ))}
                </Tabela>
              ) : (
                <p className="text-sm text-muted-foreground">Sem requisições registradas.</p>
              )}
            </Cartao>
            <Cartao titulo="Eventos do app" atraso={280} nota="Enviados pelo app com login; sem coordenadas nem texto digitado.">
              {Object.keys(r.eventos_por_tipo).length ? (
                <ul className="space-y-2 text-sm">
                  {Object.entries(r.eventos_por_tipo).map(([tipo, n]) => (
                    <li key={tipo} className="flex justify-between border-b border-border/60 pb-2">
                      <span>{ROTULO_EVENTO[tipo] ?? tipo}</span>
                      <span className="num">{fmtInt(n)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum evento ainda.</p>
              )}
            </Cartao>
          </div>
        </div>
      ) : null}
    </>
  );
}
