import { Aviso, Cabecalho, ErroConsulta, SeletorJanela } from '@/components/ui';
import { exigirAdmin } from '@/lib/auth';
import { MIGRACAO_PROVEDORES } from '@/lib/erros';
import { modeloAtivo } from '@/lib/saude';
import type {
  AblacaoLia23,
  AvaliacaoForaDoTempo,
  CoberturaDataset,
  ComparacaoProvedores,
  Fase3Comparacao,
  LiaTreino,
} from '@/lib/tipos';
import {
  Ablacao,
  CartaoModelo,
  Fase3,
  ForaDoTempo,
  Grupo,
  KpisJanela,
  Metodologia,
  RotasReais,
  TabelaProvedores,
  UltimaRodada,
  ViesPorHora,
} from './secoes';

const JANELAS = [7, 30, 90];
// Análises publicadas por ml/publish_metrics.py que esta página lê.
const ANALISES = ['ablation_lia_2_3', 'avaliacao_fora_do_tempo', 'fase3_comparacao', 'cobertura_dataset'];

export default async function ProvedoresPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const { dias: diasParam } = await searchParams;
  const dias = JANELAS.includes(Number(diasParam)) ? Number(diasParam) : 30;
  const { sb } = await exigirAdmin();
  const [rpc, analises, treinos, ativo] = await Promise.all([
    sb.rpc('admin_lia_vs_provedores', { dias }),
    sb.from('lia_analises').select('chave, dados').in('chave', ANALISES),
    sb.from('lia_treinos').select('*'),
    modeloAtivo(),
  ]);

  // Sem a migration, a RPC não existe: o aviso aparece no lugar do comparador e o resto da página segue.
  const d = rpc.data as ComparacaoProvedores | null;
  const analise = <T,>(chave: string) => analises.data?.find((a) => a.chave === chave)?.dados as T | undefined;
  const ablacao = analise<AblacaoLia23>('ablation_lia_2_3');
  const treino = ((treinos.data ?? []) as LiaTreino[]).find((l) => l.versao === ativo);

  return (
    <>
      <Cabecalho
        titulo="LIA × provedores"
        sobre="A mesma viagem pedida à LIA e a outros roteadores em horários fixos, medida contra a TomTom com trânsito ao vivo. Todo número vem do banco ou de artefatos versionados em ml/artifacts."
        direita={<SeletorJanela base="/admin/provedores" atual={dias} janelas={JANELAS} />}
      />
      <ErroConsulta erro={analises.error ?? treinos.error} />

      <CartaoModelo ativo={ativo} treino={treino} ablacao={ablacao} />

      <Grupo titulo="Comparador ao vivo" />
      <ErroConsulta erro={rpc.error} migracao={MIGRACAO_PROVEDORES} />
      {d ? (
        <div className="space-y-5">
          {d.rodadas ? (
            <>
              <KpisJanela d={d} />
              <TabelaProvedores d={d} />
              <UltimaRodada d={d} />
              <ViesPorHora d={d} />
            </>
          ) : (
            <Aviso titulo="Nenhuma rodada do comparador nesta janela">
              O timer routify-comparador roda 8 vezes por dia na EC2 (03:00 a 22:00, Brasília) e grava em comparacao_provedores. Amplie a janela ou
              confira o serviço em services/collector/deploy.
            </Aviso>
          )}
          <RotasReais r={d.rotas_reais} />
        </div>
      ) : null}

      <Grupo titulo="Evidência do modelo" />
      <div className="space-y-5">
        <Ablacao a={ablacao} />
        <ForaDoTempo a={analise<AvaliacaoForaDoTempo>('avaliacao_fora_do_tempo')} />
      </div>

      <Grupo titulo="Histórico e método" />
      <div className="space-y-5">
        <Fase3 f={analise<Fase3Comparacao>('fase3_comparacao')} />
        <Metodologia d={d} cobertura={analise<CoberturaDataset>('cobertura_dataset')} />
      </div>
    </>
  );
}
