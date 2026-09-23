import { HeatmapCobertura } from '@/components/Heatmap';
import { Cabecalho, Cartao, ErroConsulta, Kpi, Tabela } from '@/components/ui';
import { exigirAdmin } from '@/lib/auth';
import { fmtBytes, fmtData, fmtInt, fmtPct } from '@/lib/formato';
import type { Qualidade } from '@/lib/tipos';

export default async function QualidadePage() {
  const { sb } = await exigirAdmin();
  const { data, error } = await sb.rpc('admin_qualidade_dados');
  const q = data as Qualidade | null;
  const pct = (n: number) => (q && q.resumo.linhas ? (n / q.resumo.linhas) * 100 : null);

  return (
    <>
      <Cabecalho
        titulo="Qualidade dos dados"
        sobre="Saúde do dataset do TCC (leituras da TomTom no Supabase). Agregações recalculadas todo dia às 03:30 por pg_cron."
        direita={q ? <span className="num text-xs text-muted-foreground">calculado em {fmtData(q.resumo.calculado_em)}</span> : undefined}
      />
      <ErroConsulta erro={error} />
      {q ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi rotulo="Leituras" valor={fmtInt(q.resumo.linhas)} detalhe={`${fmtData(q.resumo.inicio)} → ${fmtData(q.resumo.fim)}`} />
            <Kpi rotulo="Vias com dado" valor={`${fmtInt(q.resumo.vias_com_dado)}/${fmtInt(q.vias_monitoradas)}`} detalhe={`${fmtInt(q.vias_sem_dado)} sem nenhuma leitura`} atraso={40} />
            <Kpi rotulo="Duplicatas" valor={fmtInt(q.duplicatas)} detalhe="grupos via + horário repetidos" atraso={80} />
            <Kpi
              rotulo="Amostras por via"
              valor={fmtInt(q.amostras_por_via.mediana)}
              detalhe={`mediana · mín ${fmtInt(q.amostras_por_via.min)} · máx ${fmtInt(q.amostras_por_via.max)}`}
              atraso={120}
            />
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi rotulo="Nulos" valor={fmtPct(pct(q.resumo.nulos))} detalhe={`${fmtInt(q.resumo.nulos)} leituras`} atraso={160} />
            <Kpi rotulo="Acima da vel. livre ×1,5" valor={fmtPct(pct(q.resumo.acima_da_livre))} detalhe={`${fmtInt(q.resumo.acima_da_livre)} leituras`} atraso={200} />
            <Kpi rotulo="Velocidade zero" valor={fmtPct(pct(q.resumo.velocidade_zero))} detalhe={`${fmtInt(q.resumo.velocidade_zero)} leituras`} atraso={240} />
            <Kpi rotulo="Confiança TomTom < 0,5" valor={fmtPct(pct(q.resumo.baixa_confianca))} detalhe={`${fmtInt(q.resumo.baixa_confianca)} leituras`} atraso={280} />
          </div>

          <Cartao titulo="Cobertura: leituras por hora × dia da semana" atraso={320} nota="Horário do banco (UTC). Lacunas aparecem como células vazias.">
            <HeatmapCobertura celulas={q.cobertura_hora_dia} />
          </Cartao>

          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <Cartao titulo="Vias menos amostradas" atraso={360}>
              <Tabela cabecalho={['Via', 'Ponto', 'Leituras', 'Última']}>
                {q.vias_menos_amostradas.map((v) => (
                  <tr key={v.id_ponto}>
                    <td>{v.nome_via ?? 'Via sem nome'}</td>
                    <td className="num">{v.id_ponto}</td>
                    <td className="num">{fmtInt(v.n)}</td>
                    <td className="num text-xs">{fmtData(v.ultima)}</td>
                  </tr>
                ))}
              </Tabela>
            </Cartao>
            <Cartao titulo="Tamanho das tabelas" atraso={400} nota="Plano free do Supabase: 500 MB por projeto.">
              <ul className="space-y-2 text-sm">
                {Object.entries(q.tamanho_tabelas_bytes)
                  .sort((a, b) => b[1] - a[1])
                  .map(([tabela, bytes]) => (
                    <li key={tabela} className="flex justify-between border-b border-border/60 pb-2">
                      <span className="num text-xs">{tabela}</span>
                      <span className="num">{fmtBytes(bytes)}</span>
                    </li>
                  ))}
              </ul>
            </Cartao>
          </div>
        </div>
      ) : null}
    </>
  );
}
