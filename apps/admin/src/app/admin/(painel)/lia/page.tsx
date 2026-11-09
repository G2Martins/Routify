import { BarrasVersao, BenchmarkFolds, Congestionamento, CurvaCalibracao, DispersaoFeedback, TempoTreino, type BarraVersao } from '@/components/graficos';
import Link from 'next/link';
import { Aviso, BTN_SECUNDARIO, Cabecalho, Cartao, ErroConsulta, Kpi, Selo, Tabela } from '@/components/ui';
import { exigirAdmin } from '@/lib/auth';
import { fmtData, fmtDec, fmtInt, num, rotuloVersao as rotulo, semTravessao } from '@/lib/formato';
import { MIGRACAO_ACOES } from '@/lib/erros';
import { lerBenchmark, lerCalibracao, lerCongestionamento, lerFeedback, lerPortao, lerVersoes, type Portao, versaoMaisNova } from '@/lib/leitura';
import { modeloAtivo } from '@/lib/saude';
import type { Benchmark, Calibracao, EstresseLia22, Feedback, LiaTreino } from '@/lib/tipos';
import { Estresse } from './Estresse';
import { FeedbackOutliers } from './FeedbackOutliers';

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
  const portao = analises.data?.find((a) => a.chave === 'gate_lia_2_4')?.dados as Portao | undefined;
  // A versão em destaque é a que a API está servindo agora; os KPIs e o baseline seguem ela.
  // Sem resposta da API (/health), cai na versão comparável mais nova do dado, e a página avisa.
  const destaque = ativo ?? versaoMaisNova(linhas) ?? '';
  const ativa = linhas.find((l) => l.versao === destaque);
  const baseMae = num(ativa?.baseline_mae_seg);
  const baseRmse = num(ativa?.baseline_rmse_seg);
  const ganhoRmse = ativa ? ganho(num(ativa.rmse_seg), baseRmse) : null;

  const barras = (campo: 'mae_seg' | 'rmse_seg', desvio: 'mae_seg_std' | 'rmse_seg_std'): BarraVersao[] =>
    linhas
      .filter((l) => num(l[campo]) !== null)
      .map((l) => ({
        versao: l.versao === destaque ? `${rotulo(l.versao)} · atual` : rotulo(l.versao),
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

  return (
    <>
      <Cabecalho
        titulo="LIA: desempenho e benchmarks"
        sobre="Como a LIA atual se compara às versões anteriores. Os números vêm de ml/artifacts, publicados por ml/publish_metrics.py."
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
          {ativo ? <Selo tom="ok">ativa na API · {rotulo(ativo)}</Selo> : <Selo tom="alerta">API fora do ar · destacando {destaque ? rotulo(destaque) : 'nenhuma versão'}</Selo>}
          <span>KPIs, baseline e destaque seguem esta versão.</span>
        </div>
      ) : null}

      {ativa ? (
        <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi rotulo={`RMSE ${rotulo(ativa.versao)}`} valor={`${fmtDec(ativa.rmse_seg)} s`} detalhe={`baseline ${fmtDec(baseRmse)} s`} />
          <Kpi
            rotulo="RMSE contra o baseline"
            valor={`${fmtDec(Math.abs(ganhoRmse ?? 0))}%`}
            detalhe={ganhoRmse !== null && ganhoRmse > 0 ? 'pior que o baseline' : 'menor que o baseline'}
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
          <Cartao
            titulo="MAE por versão"
            nota="Erro típico, em segundos por trecho. Azul: versão atual. Hachura: validação não temporal, não comparável. Linha tracejada: baseline da atual."
            atraso={160}
            leitura={lerVersoes(linhas, destaque, 'mae_seg')}
            siglas={['MAE', 'baseline', 'CV']}
          >
            <BarrasVersao dados={barras('mae_seg', 'mae_seg_std')} baseline={baseMae} />
          </Cartao>
          <Cartao
            titulo="RMSE por versão"
            nota="Pesa mais os erros grandes. Barras de erro: desvio entre os 5 folds temporais."
            atraso={200}
            leitura={lerVersoes(linhas, destaque, 'rmse_seg')}
            siglas={['RMSE', 'fold']}
          >
            <BarrasVersao dados={barras('rmse_seg', 'rmse_seg_std')} baseline={baseRmse} />
          </Cartao>
          {portao?.escolhida && portao.juntas ? (
            <Cartao
              titulo="Teste fora do tempo: mesmas leituras para todos"
              nota="Segundos por trecho, em leituras que nenhum modelo viu no treino."
              atraso={220}
              leitura={lerPortao(portao, 'lia_2.4', 'lia_2.3')}
              siglas={['RMSE', 'MAE', 'persistência']}
              className="lg:col-span-2"
            >
              <Tabela cabecalho={['Modelo', 'RMSE (s)', 'MAE (s)']}>
                {([
                  ['LIA 2.4', portao.juntas[portao.escolhida]],
                  ['LIA 2.3', portao.juntas['lia_2.3']],
                  ['Persistência', portao.juntas.persistencia],
                  ['Estático (fluxo livre)', portao.juntas.estatico],
                ] as const).map(([nome, d]) => (
                  <tr key={nome}>
                    <td className="font-medium">{nome}</td>
                    <td>{fmtDec(d?.rmse_seg ?? null)}</td>
                    <td>{fmtDec(d?.mae_seg ?? null)}</td>
                  </tr>
                ))}
              </Tabela>
            </Cartao>
          ) : null}
        </div>
      ) : null}

      {calibracao ? (
        <Cartao
          titulo={`Knowledge Transfer: confiança × distância (${fmtInt(calibracao.metodologia.n_pares_totais)} pares)`}
          className="mb-5"
          atraso={240}
          nota="Pontos: confiança do erro médio de cada faixa. Curva: ajuste sobre a confiança de cada par (recortada em [0, 1]); por isso passa acima dos pontos além de ~600 m, fora do raio usado pela API."
          leitura={lerCalibracao(calibracao)}
          siglas={['Knowledge Transfer', 'isotônica']}
        >
          <CurvaCalibracao dados={calibracao} />
        </Cartao>
      ) : null}

      {benchmark ? (
        <div className="mb-5 grid gap-5 lg:grid-cols-[1.5fr_1fr]">
          <Cartao titulo="Benchmark LSTM × XGBoost: RMSE por fold temporal" atraso={280} nota={semTravessao(benchmark.conclusao)} leitura={lerBenchmark(benchmark)} siglas={['LSTM', 'XGBoost', 'RMSE', 'fold']}>
            <BenchmarkFolds dados={benchmark} />
          </Cartao>
          <Cartao titulo="Tempo de treino por fold" atraso={320} nota={`LSTM com ${fmtInt(benchmark.n_parametros_lstm)} parâmetros. Mesma máquina para os três.`}>
            <TempoTreino dados={benchmark} />
          </Cartao>
        </div>
      ) : null}

      {ativa && num(ativa.rmse_congestionado_seg) !== null ? (
        <Cartao
          titulo="Erro geral × trechos congestionados"
          className="mb-5"
          atraso={360}
          nota="Congestionado: razão de congestionamento abaixo de 0,95. Limitação conhecida: o erro absoluto sobe nesses trechos."
          leitura={lerCongestionamento(ativa)}
          siglas={['razão de congestionamento', 'RMSE', 'baseline']}
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
        titulo="Erro real em produção: previsto × informado"
        className="mb-5"
        atraso={400}
        nota={`Linha tracejada: previsão perfeita.${excluidas ? ` ${excluidas} viagem${excluidas > 1 ? 's' : ''} excluída${excluidas > 1 ? 's' : ''} como outlier.` : ''}`}
        leitura={lerFeedback(pontosFeedback)}
        siglas={['MAE', 'viés']}
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
        <Cartao titulo="Histórico de versões publicadas" atraso={440} siglas={['MAE', 'RMSE']}>
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
