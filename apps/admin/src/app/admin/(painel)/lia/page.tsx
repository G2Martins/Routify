import { BarrasVersao, BenchmarkFolds, Congestionamento, CurvaCalibracao, DispersaoFeedback, TempoTreino, type BarraVersao } from '@/components/graficos';
import Link from 'next/link';
import { Aviso, BTN_SECUNDARIO, Cabecalho, Cartao, ErroConsulta, Kpi, Selo, Tabela } from '@/components/ui';
import { exigirAdmin } from '@/lib/auth';
import { fmtData, fmtDec, fmtInt, num, rotuloVersao as rotulo } from '@/lib/formato';
import { MIGRACAO_ACOES } from '@/lib/erros';
import { modeloAtivo } from '@/lib/saude';
import type { Benchmark, Calibracao, EstresseLia22, Feedback, LiaTreino } from '@/lib/tipos';
import { Estresse } from './Estresse';
import { FeedbackOutliers } from './FeedbackOutliers';

// Sem resposta da API (/health), o destaque cai na versão que a tese cita, e a página avisa.
const VERSAO_DA_TESE = 'lia_2.1';

const ganho = (valor: number | null, base: number | null) =>
  valor === null || base === null || base === 0 ? null : ((valor - base) / base) * 100;

export default async function LiaPage() {
  const { sb } = await exigirAdmin();
  const [treinos, analises, feedback, ativo] = await Promise.all([
    sb.from('lia_treinos').select('*').order('versao'),
    sb.from('lia_analises').select('chave, dados, atualizado_em'),
    sb.rpc('admin_validacao_feedback'),
    modeloAtivo(),
  ]);

  const linhas = (treinos.data ?? []) as LiaTreino[];
  const calibracao = analises.data?.find((a) => a.chave === 'calibracao_transfer')?.dados as Calibracao | undefined;
  const benchmark = analises.data?.find((a) => a.chave === 'benchmark_lstm_xgboost')?.dados as Benchmark | undefined;
  const estresse = analises.data?.find((a) => a.chave === 'estresse_lia22')?.dados as EstresseLia22 | undefined;
  // A versão em destaque é a que a API está servindo agora; os KPIs e o baseline seguem ela.
  const destaque = ativo ?? VERSAO_DA_TESE;
  const ativa = linhas.find((l) => l.versao === destaque);
  const baseMae = num(ativa?.baseline_mae_seg);
  const baseRmse = num(ativa?.baseline_rmse_seg);
  const ganhoRmse = ativa ? ganho(num(ativa.rmse_seg), baseRmse) : null;

  const barras = (campo: 'mae_seg' | 'rmse_seg', desvio: 'mae_seg_std' | 'rmse_seg_std'): BarraVersao[] =>
    linhas
      .filter((l) => num(l[campo]) !== null)
      .map((l) => ({
        versao: rotulo(l.versao),
        valor: num(l[campo]) ?? 0,
        desvio: num(l[desvio]) ?? 0,
        comparavel: l.validacao === 'temporal',
        destaque: l.versao === destaque,
      }));

  const linhasFeedback = (feedback.data ?? []) as Feedback[];
  // Sem a migration das ações, a RPC antiga não traz id/feedback_excluido.
  const comExclusao = !linhasFeedback.length || 'feedback_excluido' in linhasFeedback[0];
  const excluidas = linhasFeedback.filter((p) => p.feedback_excluido).length;
  const pontosFeedback = linhasFeedback
    .filter((p) => p.tempo_previsto_seg !== null && !p.feedback_excluido)
    .map((p) => ({ previsto: (p.tempo_previsto_seg ?? 0) / 60, real: p.tempo_real_seg / 60 }));
  const maeReal = pontosFeedback.length
    ? pontosFeedback.reduce((s, p) => s + Math.abs(p.previsto - p.real), 0) / pontosFeedback.length
    : null;

  return (
    <>
      <Cabecalho
        titulo="LIA · desempenho e benchmarks"
        sobre="Acompanhamento contínuo dos resultados pedidos pelo orientador. Todo número vem dos artefatos versionados em ml/artifacts, publicados por ml/publish_metrics.py."
        direita={
          <Link href="/admin/provedores" className={BTN_SECUNDARIO}>
            LIA × provedores →
          </Link>
        }
      />
      <ErroConsulta erro={treinos.error ?? analises.error} />

      {!linhas.length && !treinos.error ? (
        <Aviso titulo="Nenhuma métrica publicada ainda">
          Rode <span className="num">python ml/publish_metrics.py</span> depois de aplicar as migrations.
        </Aviso>
      ) : null}

      {linhas.length ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {ativo ? <Selo tom="ok">ativa na API · {rotulo(ativo)}</Selo> : <Selo tom="alerta">API fora do ar · destacando {rotulo(destaque)}</Selo>}
          <span>KPIs, baseline e destaque dos gráficos seguem esta versão.</span>
        </div>
      ) : null}

      {ativa ? (
        <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi rotulo={`RMSE ${rotulo(ativa.versao)}`} valor={`${fmtDec(ativa.rmse_seg)} s`} detalhe={`baseline ${fmtDec(baseRmse)} s`} />
          <Kpi
            rotulo="Ganho em RMSE"
            valor={`${fmtDec(Math.abs(ganhoRmse ?? 0))}%`}
            detalhe={ganhoRmse !== null && ganhoRmse > 0 ? 'PIOR que o baseline histórico' : 'menor que o baseline histórico'}
            atraso={40}
          />
          <Kpi rotulo={`MAE ${rotulo(ativa.versao)}`} valor={`${fmtDec(ativa.mae_seg)} s`} detalhe={`baseline ${fmtDec(baseMae)} s`} atraso={80} />
          <Kpi rotulo="Amostras de treino" valor={fmtInt(ativa.total_amostras)} detalhe="validação temporal, 5 folds" atraso={120} />
        </div>
      ) : ativo && linhas.length ? (
        <div className="mb-5">
          <Aviso titulo="A versão ativa ainda não foi publicada">
            Não há linha de <span className="num">{ativo}</span> em lia_treinos. Rode <span className="num">python ml/publish_metrics.py</span>.
          </Aviso>
        </div>
      ) : null}

      {linhas.length ? (
        <div className="mb-5 grid gap-5 lg:grid-cols-2">
          <Cartao titulo="MAE por versão" nota="Erro típico, em segundos por trecho. Hachura = validação não temporal (LIA 1.0), não comparável." atraso={160}>
            <BarrasVersao dados={barras('mae_seg', 'mae_seg_std')} baseline={baseMae} />
          </Cartao>
          <Cartao titulo="RMSE por versão" nota="Penaliza erros grandes (congestionamento). Barras de erro: desvio entre os 5 folds temporais." atraso={200}>
            <BarrasVersao dados={barras('rmse_seg', 'rmse_seg_std')} baseline={baseRmse} />
          </Cartao>
        </div>
      ) : null}

      {calibracao ? (
        <Cartao
          titulo={`Knowledge Transfer: confiança × distância (${fmtInt(calibracao.metodologia.n_pares_totais)} pares)`}
          className="mb-5"
          atraso={240}
          nota="Pontos: confiança do erro médio de cada faixa. Curva: regressão isotônica não crescente sobre a confiança de cada par (já recortada em [0, 1]) — por isso passa acima dos pontos além de ~600 m, fora do raio usado pela API."
        >
          <CurvaCalibracao dados={calibracao} />
        </Cartao>
      ) : null}

      {benchmark ? (
        <div className="mb-5 grid gap-5 lg:grid-cols-[1.5fr_1fr]">
          <Cartao titulo="Benchmark LSTM × XGBoost — RMSE por fold temporal" atraso={280} nota={benchmark.conclusao}>
            <BenchmarkFolds dados={benchmark} />
          </Cartao>
          <Cartao titulo="Tempo de treino por fold" atraso={320} nota={`LSTM com ${fmtInt(benchmark.n_parametros_lstm)} parâmetros. Mesma máquina para os três.`}>
            <TempoTreino dados={benchmark} />
          </Cartao>
        </div>
      ) : null}

      {ativa && num(ativa.rmse_congestionado_seg) !== null ? (
        <Cartao
          titulo="Erro geral × trechos congestionados (razão < 0,95)"
          className="mb-5"
          atraso={360}
          nota="Limitação conhecida: o ganho sobre o baseline se mantém no congestionamento, mas o erro absoluto mais que dobra."
        >
          <Congestionamento
            geral={[baseRmse ?? 0, num(ativa.rmse_seg) ?? 0]}
            congestionado={[num(ativa.baseline_rmse_congestionado_seg) ?? 0, num(ativa.rmse_congestionado_seg) ?? 0]}
            modelo={rotulo(ativa.versao)}
          />
        </Cartao>
      ) : null}

      {estresse ? <Estresse e={estresse} ativo={ativo} /> : null}

      <Cartao
        titulo="Erro real em produção — previsto × informado pelo usuário"
        className="mb-5"
        atraso={400}
        nota={
          maeReal !== null
            ? `MAE real: ${fmtDec(maeReal)} min em ${pontosFeedback.length} viagens${excluidas ? ` (${excluidas} excluída${excluidas > 1 ? 's' : ''} como outlier)` : ''}. Linha tracejada = previsão perfeita.`
            : undefined
        }
      >
        {feedback.error ? (
          <ErroConsulta erro={feedback.error} />
        ) : pontosFeedback.length ? (
          <DispersaoFeedback pontos={pontosFeedback} />
        ) : (
          <Aviso titulo={linhasFeedback.length ? 'Todas as viagens estão excluídas' : 'Ainda sem feedback'}>
            {linhasFeedback.length
              ? 'Reinclua alguma viagem na tabela abaixo para voltar a ter pontos no gráfico.'
              : 'O usuário informa o tempo real da viagem na tela Histórico do app. Cada resposta vira um ponto aqui.'}
          </Aviso>
        )}
        {linhasFeedback.length && comExclusao ? <FeedbackOutliers linhas={linhasFeedback} /> : null}
        {linhasFeedback.length && !comExclusao ? (
          <div className="mt-4">
            <Aviso titulo="Exclusão de outliers indisponível">
              Aplique a migration <span className="num">{MIGRACAO_ACOES}</span> (ver docs/core/rodar-local.md).
            </Aviso>
          </div>
        ) : null}
      </Cartao>

      {linhas.length ? (
        <Cartao titulo="Histórico de versões publicadas" atraso={440}>
          <Tabela cabecalho={['Versão', 'Validação', 'MAE', 'RMSE', 'Amostras', 'Fonte', 'Publicado em']}>
            {linhas.map((l) => (
              <tr key={l.versao}>
                <td className="font-medium">
                  {rotulo(l.versao)}
                  {l.versao === ativo ? (
                    <span className="ml-2 align-middle">
                      <Selo tom="ok">ativa</Selo>
                    </span>
                  ) : null}
                </td>
                <td>{l.validacao === 'temporal' ? 'temporal' : 'não temporal'}</td>
                <td className="num">{fmtDec(l.mae_seg)} s</td>
                <td className="num">{fmtDec(l.rmse_seg)} s</td>
                <td className="num">{fmtInt(l.total_amostras)}</td>
                <td className="num text-xs text-muted-foreground">{l.fonte}</td>
                <td className="num text-xs">{fmtData(l.registrado_em)}</td>
              </tr>
            ))}
          </Tabela>
        </Cartao>
      ) : null}
    </>
  );
}
