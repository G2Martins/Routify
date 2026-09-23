import { BarrasVersao, BenchmarkFolds, Congestionamento, CurvaCalibracao, DispersaoFeedback, TempoTreino, type BarraVersao } from '@/components/graficos';
import { Aviso, Cabecalho, Cartao, ErroConsulta, Kpi, Tabela } from '@/components/ui';
import { exigirAdmin } from '@/lib/auth';
import { fmtData, fmtDec, fmtInt, num } from '@/lib/formato';
import type { Benchmark, Calibracao, LiaTreino } from '@/lib/tipos';

/** lia_2.1_retreino_20260923 → "LIA 2.1 re-treino 23/09" */
function rotulo(versao: string) {
  const m = versao.match(/^lia_([\d.]+)(?:_retreino_(\d{4})(\d{2})(\d{2}))?$/);
  if (!m) return versao;
  return m[2] ? `LIA ${m[1]} re-treino ${m[4]}/${m[3]}` : `LIA ${m[1]}`;
}

const ganho = (valor: number | null, base: number | null) =>
  valor === null || base === null || base === 0 ? null : ((valor - base) / base) * 100;

export default async function LiaPage() {
  const { sb } = await exigirAdmin();
  const [treinos, analises, feedback] = await Promise.all([
    sb.from('lia_treinos').select('*').order('versao'),
    sb.from('lia_analises').select('chave, dados, atualizado_em'),
    sb.rpc('admin_validacao_feedback'),
  ]);

  const linhas = (treinos.data ?? []) as LiaTreino[];
  const calibracao = analises.data?.find((a) => a.chave === 'calibracao_transfer')?.dados as Calibracao | undefined;
  const benchmark = analises.data?.find((a) => a.chave === 'benchmark_lstm_xgboost')?.dados as Benchmark | undefined;
  const lia21 = linhas.find((l) => l.versao === 'lia_2.1');
  const baseMae = num(lia21?.baseline_mae_seg);
  const baseRmse = num(lia21?.baseline_rmse_seg);

  const barras = (campo: 'mae_seg' | 'rmse_seg', desvio: 'mae_seg_std' | 'rmse_seg_std'): BarraVersao[] =>
    linhas
      .filter((l) => num(l[campo]) !== null)
      .map((l) => ({
        versao: rotulo(l.versao),
        valor: num(l[campo]) ?? 0,
        desvio: num(l[desvio]) ?? 0,
        comparavel: l.validacao === 'temporal',
        destaque: l.versao === 'lia_2.1',
      }));

  const pontosFeedback = ((feedback.data ?? []) as { tempo_previsto_seg: number | null; tempo_real_seg: number }[])
    .filter((p) => p.tempo_previsto_seg !== null)
    .map((p) => ({ previsto: (p.tempo_previsto_seg ?? 0) / 60, real: p.tempo_real_seg / 60 }));
  const maeReal = pontosFeedback.length
    ? pontosFeedback.reduce((s, p) => s + Math.abs(p.previsto - p.real), 0) / pontosFeedback.length
    : null;

  return (
    <>
      <Cabecalho
        titulo="LIA · desempenho e benchmarks"
        sobre="Acompanhamento contínuo dos resultados pedidos pelo orientador. Todo número vem dos artefatos versionados em ml/artifacts, publicados por ml/publish_metrics.py."
      />
      <ErroConsulta erro={treinos.error ?? analises.error} />

      {!linhas.length && !treinos.error ? (
        <Aviso titulo="Nenhuma métrica publicada ainda">
          Rode <span className="num">python ml/publish_metrics.py</span> depois de aplicar as migrations.
        </Aviso>
      ) : null}

      {lia21 ? (
        <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi rotulo="RMSE LIA 2.1" valor={`${fmtDec(lia21.rmse_seg)} s`} detalhe={`baseline ${fmtDec(baseRmse)} s`} />
          <Kpi
            rotulo="Ganho em RMSE"
            valor={`${fmtDec(Math.abs(ganho(num(lia21.rmse_seg), baseRmse) ?? 0))}%`}
            detalhe="menor que o baseline histórico"
            atraso={40}
          />
          <Kpi rotulo="MAE LIA 2.1" valor={`${fmtDec(lia21.mae_seg)} s`} detalhe={`baseline ${fmtDec(baseMae)} s`} atraso={80} />
          <Kpi rotulo="Amostras de treino" valor={fmtInt(lia21.total_amostras)} detalhe="validação temporal, 5 folds" atraso={120} />
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

      {lia21 && num(lia21.rmse_congestionado_seg) !== null ? (
        <Cartao
          titulo="Erro geral × trechos congestionados (razão < 0,95)"
          className="mb-5"
          atraso={360}
          nota="Limitação conhecida: o ganho sobre o baseline se mantém no congestionamento, mas o erro absoluto mais que dobra."
        >
          <Congestionamento
            geral={[baseRmse ?? 0, num(lia21.rmse_seg) ?? 0]}
            congestionado={[num(lia21.baseline_rmse_congestionado_seg) ?? 0, num(lia21.rmse_congestionado_seg) ?? 0]}
          />
        </Cartao>
      ) : null}

      <Cartao
        titulo="Erro real em produção — previsto × informado pelo usuário"
        className="mb-5"
        atraso={400}
        nota={maeReal !== null ? `MAE real: ${fmtDec(maeReal)} min em ${pontosFeedback.length} viagens. Linha tracejada = previsão perfeita.` : undefined}
      >
        {feedback.error ? (
          <ErroConsulta erro={feedback.error} />
        ) : pontosFeedback.length ? (
          <DispersaoFeedback pontos={pontosFeedback} />
        ) : (
          <Aviso titulo="Ainda sem feedback">
            O usuário informa o tempo real da viagem na tela Histórico do app. Cada resposta vira um ponto aqui.
          </Aviso>
        )}
      </Cartao>

      {linhas.length ? (
        <Cartao titulo="Histórico de versões publicadas" atraso={440}>
          <Tabela cabecalho={['Versão', 'Validação', 'MAE', 'RMSE', 'Amostras', 'Fonte', 'Publicado em']}>
            {linhas.map((l) => (
              <tr key={l.versao}>
                <td className="font-medium">{rotulo(l.versao)}</td>
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
