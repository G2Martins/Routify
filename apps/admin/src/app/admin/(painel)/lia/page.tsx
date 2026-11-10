import { BenchmarkFolds, CurvaCalibracao, DispersaoFeedback, TempoTreino } from '@/components/graficos';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Aviso, BTN_SECUNDARIO, Cabecalho, Cartao, ErroConsulta, Kpi, Selo, Tabela } from '@/components/ui';
import { exigirAdmin } from '@/lib/auth';
import { fmtData, fmtDec, fmtInt, num, rotuloVersao as rotulo, semTravessao } from '@/lib/formato';
import { MIGRACAO_ACOES } from '@/lib/erros';
import { anterior, lerBenchmark, lerCalibracao, lerFeedback, lerPortao, lerVersoes, mesmaBase, type Portao, versaoMaisNova } from '@/lib/leitura';
import { modeloAtivo } from '@/lib/saude';
import type { Benchmark, Calibracao, EstresseLia22, EstresseVersoes, Feedback, LiaTreino } from '@/lib/tipos';
import { extrair, maisNovaPrimeiro, seletavel } from '@/lib/versoes';
import {
  CartaoCongestionado,
  CartaoEstresse,
  CartaoFeatures,
  CartaoFolds,
  CartaoIdade,
  CartaoPeriodo30,
  CartaoPeriodoCv,
  PainelVersoes,
  SeletorPar,
} from './Comparativos';
import { Estresse } from './Estresse';
import { FeedbackOutliers } from './FeedbackOutliers';

const ganho = (valor: number | null, base: number | null) =>
  valor === null || base === null || base === 0 ? null : ((valor - base) / base) * 100;

function Secao({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="mb-3 mt-8">
      <h2 className="font-display text-2xl tracking-tight">{titulo}</h2>
      {children ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{children}</p> : null}
    </div>
  );
}

export default async function LiaPage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const { sb } = await exigirAdmin();
  const pedido = await searchParams;
  const [treinos, analises, feedback, ativo] = await Promise.all([
    sb.from('lia_treinos').select('*').order('versao'),
    sb.from('lia_analises').select('chave, dados, atualizado_em'),
    sb.rpc('admin_validacao_feedback'),
    modeloAtivo(),
  ]);

  const linhas = (treinos.data ?? []) as LiaTreino[];
  const analise = <T,>(chave: string) => analises.data?.find((x) => x.chave === chave)?.dados as T | undefined;
  const calibracao = analise<Calibracao>('calibracao_transfer');
  const benchmark = analise<Benchmark>('benchmark_lstm_xgboost');
  const estresseAntigo = analise<EstresseLia22>('estresse_lia22');
  const estresse = analise<EstresseVersoes>('estresse_versoes');
  const portao = analise<Portao>('gate_lia_2_4');

  // Par A × B: a URL manda; sem ela, A = versão ativa na API (ou a mais nova do dado) e B = a anterior a ela.
  // Sem resposta da API (/health), a página avisa em vez de adivinhar.
  const seletaveis = linhas.filter(seletavel);
  const vs = seletaveis.map(extrair).sort((x, y) => maisNovaPrimeiro(x.versao, y.versao));
  const existe = (v?: string) => !!v && seletaveis.some((l) => l.versao === v);
  const padraoA = existe(ativo ?? undefined) ? (ativo as string) : (versaoMaisNova(linhas) ?? '');
  const a = existe(pedido.a) ? (pedido.a as string) : padraoA;
  const ativa = linhas.find((l) => l.versao === a);
  const padraoB = ativa ? (anterior(linhas, ativa, 'rmse_seg')?.versao ?? '') : '';
  const b = existe(pedido.b) && pedido.b !== a ? (pedido.b as string) : existe(padraoB) && padraoB !== a ? padraoB : (vs.find((v) => v.versao !== a)?.versao ?? '');
  const outra = linhas.find((l) => l.versao === b);

  const baseMae = num(ativa?.baseline_mae_seg);
  const baseRmse = num(ativa?.baseline_rmse_seg);
  const ganhoRmse = ativa ? ganho(num(ativa.rmse_seg), baseRmse) : null;

  const todas = linhas.filter((l) => num(l.rmse_seg) !== null || num(l.mae_seg) !== null).map(extrair);

  const linhasFeedback = (feedback.data ?? []) as Feedback[];
  // Sem a migration das ações, a RPC antiga não traz id/feedback_excluido.
  const comExclusao = !linhasFeedback.length || 'feedback_excluido' in linhasFeedback[0];
  const excluidas = linhasFeedback.filter((p) => p.feedback_excluido).length;
  const pontosFeedback = linhasFeedback
    .filter((p) => p.tempo_previsto_seg !== null && !p.feedback_excluido)
    .map((p) => ({ previsto: (p.tempo_previsto_seg ?? 0) / 60, real: p.tempo_real_seg / 60 }));

  // O teste fora do tempo (gate) só existe para a 2.4 contra a 2.3; o resto do bloco segue o par.
  const gateServe = a === 'lia_2.4' && b === 'lia_2.3';
  const bases = ativa && outra && ativa.validacao === 'temporal' && outra.validacao === 'temporal' ? mesmaBase(ativa, outra) : true;
  const cvMaior = ativa && outra && num(ativa.rmse_seg) !== null && num(outra.rmse_seg) !== null && (num(ativa.rmse_seg) as number) > (num(outra.rmse_seg) as number);
  const novoGate = portao?.escolhida ? portao.juntas?.[portao.escolhida] : undefined;
  const velhoGate = portao?.juntas?.['lia_2.3'];

  return (
    <>
      <Cabecalho
        titulo="LIA: desempenho e benchmarks"
        sobre="Como as versões da LIA se comparam. Escolha o par A × B abaixo; os números vêm de ml/artifacts, publicados por ml/publish_metrics.py."
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
        <>
          <SeletorPar key={`${a}-${b}`} vs={vs} a={a} b={b} />
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {ativo ? <Selo tom="ok">ativa na API · {rotulo(ativo)}</Selo> : <Selo tom="alerta">API fora do ar · A padrão: {padraoA ? rotulo(padraoA) : 'nenhuma versão'}</Selo>}
            <span>Os KPIs seguem a versão A.</span>
          </div>
        </>
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

      {ativa && outra ? (
        <>
          <Secao titulo="Atual × anterior em leituras novas">
            A comparação justa: as duas versões nas mesmas leituras, que nenhuma viu no treino.
          </Secao>
          <div className="surgir mb-5 rounded-lg border-l-2 border-accent bg-accent/5 px-4 py-3 text-sm leading-relaxed">
            {!bases && cvMaior ? (
              <p>
                <b>{rotulo(a)} não piorou.</b> O CV dela ({fmtDec(ativa.rmse_seg)} s de RMSE) é maior que o da {rotulo(b)} ({fmtDec(outra.rmse_seg)} s) porque foi medido numa base maior
                ({fmtInt(ativa.total_amostras)} contra {fmtInt(outra.total_amostras)} amostras), com as leituras de novembro, que cobrem os picos o dia todo e são mais difíceis. CV de bases diferentes não se compara.
                {gateServe && novoGate && velhoGate
                  ? ` Nas mesmas ${fmtInt(novoGate.n)} leituras novas, a ${rotulo(a)} erra ${fmtDec(novoGate.rmse_seg)} s de RMSE e ${fmtDec(novoGate.mae_seg)} s de MAE, contra ${fmtDec(velhoGate.rmse_seg)} s e ${fmtDec(velhoGate.mae_seg)} s da ${rotulo(b)}.`
                  : ' Veja o teste abaixo.'}
              </p>
            ) : !bases ? (
              <p>
                {rotulo(a)} e {rotulo(b)} treinaram em bases diferentes ({fmtInt(ativa.total_amostras)} contra {fmtInt(outra.total_amostras)} amostras): o CV de uma não se compara com o da outra. Use os blocos desta seção, que medem as duas nas mesmas leituras.
              </p>
            ) : (
              <p>
                {rotulo(a)} e {rotulo(b)} usam a mesma base de treino: o CV abaixo é comparável. Os blocos desta seção medem as duas em leituras que nenhuma viu.
              </p>
            )}
          </div>

          <div className="mb-5 space-y-5">
            {portao?.escolhida && portao.juntas ? (
              <Cartao
                titulo="Teste fora do tempo: mesmas leituras para todos"
                nota={`Segundos por trecho, em leituras que nenhum modelo viu no treino. ${gateServe ? '' : 'Este teste existe só para a LIA 2.4 contra a 2.3, qualquer que seja o par escolhido. '}Para outros pares, use o estresse abaixo.`}
                atraso={220}
                leitura={lerPortao(portao, 'lia_2.4', 'lia_2.3')}
                siglas={['RMSE', 'MAE', 'persistência']}
              >
                <Tabela estreita cabecalho={['Modelo', 'RMSE (s)', 'MAE (s)']}>
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
            ) : (
              <Aviso titulo="Teste fora do tempo ainda não publicado">
                Rode <span className="num">python ml/publish_metrics.py</span> para publicar <span className="num">gate_lia_2_4</span>.
              </Aviso>
            )}
            {estresse?.versoes && Object.keys(estresse.versoes).length ? (
              <CartaoEstresse key={`e-${a}-${b}`} vs={vs} a={a} b={b} e={estresse} />
            ) : (
              <Aviso titulo="Estresse por versão ainda não publicado">
                Rode <span className="num">ml/estresse_versoes.py</span> e depois <span className="num">ml/publish_metrics.py</span>.
              </Aviso>
            )}
          </div>
        </>
      ) : null}

      {linhas.length ? (
        <>
          <Secao titulo="Validação cruzada (CV)">
            Cada versão é medida na própria base de treino, com cortes no tempo. Só vale comparar CV entre versões da mesma base; as outras aparecem hachuradas.
          </Secao>
          <div className="mb-5">
            <PainelVersoes
              key={`p-${a}`}
              todas={todas}
              a={a}
              leituraMae={lerVersoes(linhas, a, 'mae_seg', b)}
              leituraRmse={lerVersoes(linhas, a, 'rmse_seg', b)}
            />
          </div>
          <div className="mb-5 grid gap-5 lg:grid-cols-2">
            <CartaoFolds key={`f-${a}-${b}`} vs={vs} a={a} b={b} />
            <CartaoIdade key={`i-${a}-${b}`} vs={vs} a={a} b={b} />
            <CartaoPeriodoCv key={`pc-${a}-${b}`} vs={vs} a={a} b={b} />
            <CartaoPeriodo30 key={`p3-${a}-${b}`} vs={vs} a={a} b={b} />
            <CartaoFeatures key={`ft-${a}-${b}`} vs={vs} a={a} b={b} />
            <CartaoCongestionado key={`c-${a}-${b}`} vs={vs} a={a} b={b} />
          </div>
        </>
      ) : null}

      {calibracao || benchmark ? <Secao titulo="Análises sem versão">Valem para a LIA como um todo, não para uma versão: não mudam com o par A × B.</Secao> : null}

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

      {estresseAntigo && !estresse?.versoes ? <Estresse e={estresseAntigo} ativo={ativo} /> : null}

      <Secao titulo="Produção" />
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
