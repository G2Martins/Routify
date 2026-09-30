'use client';

import '@xyflow/react/dist/style.css';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { useMemo, useState } from 'react';
import type { Saude } from '@/lib/tipos';
import { Selo } from './ui';
import { useSaude } from './useSaude';

type Tom = 'ok' | 'alerta' | 'erro' | 'neutro';
type DadosNo = { titulo: string; sub: string; tom: Tom; estado: string; ativo: boolean; selecionado: boolean };
type NoRoutify = Node<DadosNo, 'routify'>;

type Fluxo = 'rota' | 'busca' | 'treino' | 'dados' | 'tudo';

const NOS: { id: string; titulo: string; sub: string; x: number; y: number; sobre: string }[] = [
  { id: 'app', titulo: 'App mobile', sub: 'Expo · iOS / Android / Web', x: 0, y: 60, sobre: 'Visão do usuário. Pede rotas e buscas à API com o JWT da sessão e grava o histórico pessoal direto no Supabase (RLS por dono).' },
  { id: 'admin', titulo: 'Painel ADM', sub: 'Next.js · este painel', x: 0, y: 320, sobre: 'Lê só por RPC/políticas admin (app_metadata.role). Consulta o /health da API para o status ao vivo.' },
  { id: 'api', titulo: 'API FastAPI', sub: '/route · /search · /eventos', x: 300, y: 190, sobre: 'Orquestra a rota: recência, TomTom sob demanda, pesos da LIA em todas as arestas e A*. Grava o uso com service_role.' },
  { id: 'cache', titulo: 'Cache de recência', sub: 'última razão por via · TTL 5 min', x: 640, y: 0, sobre: 'Última observação real por via (feature razao_lag1/delta_min_lag1 da LIA 2.1). Faz merge: a leitura ao vivo da TomTom vence o banco.' },
  { id: 'lia', titulo: 'Modelo LIA 2.1', sub: 'XGBoost · razão de congestionamento', x: 640, y: 120, sobre: 'Prevê a razão velocidade atual / livre por via; o tempo em segundos sai do comprimento real de cada aresta.' },
  { id: 'grafo', titulo: 'Grafo OSM', sub: 'OSMnx · transfer ≤ 500 m', x: 640, y: 240, sobre: 'Malha viária enriquecida na subida: velocidade livre por aresta e vínculo com a via monitorada mais próxima (confiança isotônica).' },
  { id: 'pool', titulo: 'Pool de chaves TomTom', sub: 'cooldown por chave e serviço', x: 640, y: 360, sobre: 'Rotação defensiva: 429 em sequência vira cooldown de cota (24 h), 403 tira a chave por 10 min, teto global por minuto. Todas esgotadas = modo degradado (só LIA).' },
  { id: 'tomtom', titulo: 'TomTom', sub: 'Flow v4 · Incidents v5 · Routing · Search', x: 960, y: 360, sobre: 'Complementa a LIA na hora da rota: velocidade ao vivo nas vias velhas do corredor, interdições (saem do A*), ETA de referência e busca.' },
  { id: 'nominatim', titulo: 'Nominatim', sub: 'OSM · último recurso', x: 960, y: 480, sobre: 'Só entra se a base local e a TomTom trouxeram menos de 3 resultados; com cache e 1 req/s (política da OSMF proíbe autocomplete).' },
  { id: 'supabase', titulo: 'Supabase', sub: 'Postgres · Auth · RLS', x: 300, y: 470, sobre: 'Dataset do TCC (1,5 mi leituras), histórico dos usuários, captura de uso e métricas da LIA. RLS em tudo; dataset só via service_role.' },
  { id: 'treino', titulo: 'Pipeline de treino', sub: 'silver → features → train', x: 640, y: 560, sobre: 'Offline: puxa historico_trafego, gera perfis e recência, valida com TimeSeriesSplit e publica os artefatos e as métricas deste painel.' },
  { id: 'coletor', titulo: 'Coletor TomTom', sub: 'pausado na fase final', x: 0, y: 560, sobre: 'Coletou Flow Segment Data de 630 pontos a cada 8 min (mar–jul/2026). Substituído pela consulta sob demanda.' },
];

const ARESTAS: { id: string; de: string; para: string; rotulo: string }[] = [
  { id: 'app-api', de: 'app', para: 'api', rotulo: 'rota · busca · eventos' },
  { id: 'app-sb', de: 'app', para: 'supabase', rotulo: 'Auth + histórico' },
  { id: 'admin-api', de: 'admin', para: 'api', rotulo: '/health' },
  { id: 'admin-sb', de: 'admin', para: 'supabase', rotulo: 'RPC admin' },
  { id: 'api-cache', de: 'api', para: 'cache', rotulo: 'recência' },
  { id: 'api-lia', de: 'api', para: 'lia', rotulo: 'razão por via' },
  { id: 'api-grafo', de: 'api', para: 'grafo', rotulo: 'A*' },
  { id: 'api-pool', de: 'api', para: 'pool', rotulo: 'fluxo · incidentes' },
  { id: 'pool-tomtom', de: 'pool', para: 'tomtom', rotulo: 'chave livre' },
  { id: 'api-nominatim', de: 'api', para: 'nominatim', rotulo: 'fallback' },
  { id: 'api-sb', de: 'api', para: 'supabase', rotulo: 'uso · malha local' },
  { id: 'sb-cache', de: 'supabase', para: 'cache', rotulo: 'refresh' },
  { id: 'sb-treino', de: 'supabase', para: 'treino', rotulo: 'historico_trafego' },
  { id: 'treino-lia', de: 'treino', para: 'lia', rotulo: 'artefatos' },
  { id: 'coletor-sb', de: 'coletor', para: 'supabase', rotulo: 'leituras' },
  { id: 'coletor-tomtom', de: 'coletor', para: 'tomtom', rotulo: 'Flow' },
];

const FLUXOS: Record<Fluxo, { rotulo: string; nos: string[]; arestas: string[] }> = {
  rota: {
    rotulo: 'Requisição /route',
    nos: ['app', 'api', 'cache', 'lia', 'grafo', 'pool', 'tomtom', 'supabase'],
    arestas: ['app-api', 'api-cache', 'api-lia', 'api-grafo', 'api-pool', 'pool-tomtom', 'api-sb', 'sb-cache'],
  },
  busca: {
    rotulo: 'Busca de endereços',
    nos: ['app', 'api', 'supabase', 'pool', 'tomtom', 'nominatim'],
    arestas: ['app-api', 'api-sb', 'api-pool', 'pool-tomtom', 'api-nominatim'],
  },
  treino: {
    rotulo: 'Treino da LIA',
    nos: ['coletor', 'tomtom', 'supabase', 'treino', 'lia', 'api'],
    arestas: ['coletor-tomtom', 'coletor-sb', 'sb-treino', 'treino-lia', 'api-lia'],
  },
  dados: {
    rotulo: 'Dados & Auth',
    nos: ['app', 'admin', 'supabase', 'api'],
    arestas: ['app-sb', 'admin-sb', 'admin-api', 'api-sb'],
  },
  tudo: { rotulo: 'Tudo', nos: NOS.map((n) => n.id), arestas: ARESTAS.map((a) => a.id) },
};

const TOM_BORDA: Record<Tom, string> = {
  ok: 'border-l-ok',
  alerta: 'border-l-alerta',
  erro: 'border-l-destructive',
  neutro: 'border-l-border',
};

function NoVisual({ data }: NodeProps<NoRoutify>) {
  return (
    <div
      className={`w-52 rounded-md border border-l-4 border-border bg-card px-3 py-2 shadow-sm transition-opacity ${TOM_BORDA[data.tom]} ${
        data.ativo ? 'opacity-100' : 'opacity-30'
      } ${data.selecionado ? 'ring-2 ring-accent' : ''}`}
    >
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-border" />
      <p className="text-sm font-medium leading-tight text-foreground">{data.titulo}</p>
      <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{data.sub}</p>
      <p className="num mt-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">{data.estado}</p>
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-border" />
    </div>
  );
}

const TIPOS_NO = { routify: NoVisual };

function idade(iso: string | null) {
  if (!iso) return null;
  const min = (Date.now() - new Date(iso).getTime()) / 60000;
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 60 * 48) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} dias`;
}

function statusDe(id: string, saude: Saude | null, offline: boolean, supabaseOk: boolean): { tom: Tom; estado: string; linhas: string[] } {
  const semApi = { tom: 'erro' as Tom, estado: 'sem dados (API offline)', linhas: ['A API não respondeu ao /health.'] };
  switch (id) {
    case 'api':
      if (offline) return { tom: 'erro', estado: 'offline', linhas: ['/health não respondeu em 5 s.'] };
      return saude ? { tom: 'ok', estado: 'no ar', linhas: [`Modelo ativo: ${saude.modelo_ativo}`] } : { tom: 'neutro', estado: 'verificando…', linhas: [] };
    case 'cache': {
      if (!saude) return offline ? semApi : { tom: 'neutro', estado: '…', linhas: [] };
      const i = idade(saude.recencia.mais_recente);
      const velho = !saude.recencia.mais_recente || Date.now() - new Date(saude.recencia.mais_recente).getTime() > 86400000;
      return {
        tom: saude.recencia.vias === 0 ? 'erro' : velho ? 'alerta' : 'ok',
        estado: `${saude.recencia.vias} vias · mais nova há ${i ?? '—'}`,
        linhas: [`${saude.recencia.vias} vias em cache`, `Leitura mais recente: há ${i ?? '—'}${velho ? ' (peça uma rota para a TomTom renovar)' : ''}`],
      };
    }
    case 'lia':
      if (!saude) return offline ? semApi : { tom: 'neutro', estado: '…', linhas: [] };
      return { tom: 'ok', estado: `${saude.modelo_ativo} carregado`, linhas: [`RMSE de validação: ${saude.cv_rmse_seg ?? '—'} s`, `Amostras de treino: ${saude.total_amostras_treino?.toLocaleString('pt-BR') ?? '—'}`] };
    case 'grafo':
      if (!saude) return offline ? semApi : { tom: 'neutro', estado: '…', linhas: [] };
      return saude.vias_monitoradas
        ? { tom: 'ok', estado: `${saude.vias_monitoradas} vias vinculadas`, linhas: ['Arestas ligadas às vias monitoradas (transfer ≤ 500 m).'] }
        : { tom: 'alerta', estado: 'sem vínculo — heurística', linhas: ['O banco não respondeu na subida: a rota usa só a mediana global do horário.'] };
    case 'pool': {
      if (!saude) return offline ? semApi : { tom: 'neutro', estado: '…', linhas: [] };
      const d = saude.tomtom.disponiveis;
      const tom: Tom = !saude.tomtom.ativo ? 'alerta' : d.fluxo === 0 ? 'erro' : d.fluxo < saude.tomtom.chaves ? 'alerta' : 'ok';
      return {
        tom,
        estado: saude.tomtom.ativo ? `${d.fluxo}/${saude.tomtom.chaves} chaves livres` : 'sem chaves — só LIA',
        linhas: [`Fluxo ${d.fluxo} · Incidentes ${d.incidentes} · Busca ${d.busca} · Rota ${d.rota} (de ${saude.tomtom.chaves})`],
      };
    }
    case 'tomtom':
      if (!saude) return offline ? semApi : { tom: 'neutro', estado: '…', linhas: [] };
      return saude.tomtom.ativo ? { tom: 'ok', estado: 'sob demanda', linhas: ['Consultada só no corredor de cada rota.'] } : { tom: 'alerta', estado: 'desligada', linhas: [] };
    case 'supabase':
      return supabaseOk
        ? { tom: 'ok', estado: 'alcançável · RLS ativo', linhas: ['RPC admin respondeu nesta página.'] }
        : { tom: 'erro', estado: 'sem resposta', linhas: ['A RPC admin falhou: banco pausado, migration pendente ou sessão sem papel admin.'] };
    case 'coletor':
      return { tom: 'neutro', estado: 'pausado', linhas: [] };
    case 'treino':
      return { tom: 'neutro', estado: 'offline · roda local', linhas: ['Publica métricas com ml/publish_metrics.py.'] };
    default:
      return { tom: 'neutro', estado: '—', linhas: [] };
  }
}

export function Arquitetura({ supabaseOk }: { supabaseOk: boolean }) {
  const { saude, offline, atualizado } = useSaude(10000);
  const [fluxo, setFluxo] = useState<Fluxo>('rota');
  const [selecionado, setSelecionado] = useState<string>('api');

  const ativos = FLUXOS[fluxo];
  const nos: NoRoutify[] = useMemo(
    () =>
      NOS.map((n) => {
        const s = statusDe(n.id, saude, offline, supabaseOk);
        return {
          id: n.id,
          type: 'routify',
          position: { x: n.x, y: n.y },
          data: { titulo: n.titulo, sub: n.sub, tom: s.tom, estado: s.estado, ativo: ativos.nos.includes(n.id), selecionado: selecionado === n.id },
        };
      }),
    [saude, offline, supabaseOk, ativos, selecionado],
  );
  const arestas: Edge[] = useMemo(
    () =>
      ARESTAS.map((a) => {
        const ativa = ativos.arestas.includes(a.id);
        return {
          id: a.id,
          source: a.de,
          target: a.para,
          label: ativa ? a.rotulo : undefined,
          animated: ativa,
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
          style: { stroke: ativa ? 'var(--chart-1)' : 'var(--chart-grade)', strokeWidth: ativa ? 1.8 : 1 },
          labelStyle: { fontSize: 10, fill: 'var(--chart-eixo)' },
          labelBgStyle: { fill: 'hsl(var(--background))' },
        };
      }),
    [ativos],
  );

  const detalhe = NOS.find((n) => n.id === selecionado)!;
  const status = statusDe(selecionado, saude, offline, supabaseOk);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <div className="surgir overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          {(Object.keys(FLUXOS) as Fluxo[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFluxo(f)}
              aria-pressed={fluxo === f}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                fluxo === f ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {FLUXOS[f].rotulo}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-muted-foreground">
            {offline ? 'API offline' : atualizado ? `status de ${atualizado.toLocaleTimeString('pt-BR')}` : 'consultando…'}
          </span>
        </div>
        <div className="fundo-mapa h-[640px]">
          <ReactFlow
            nodes={nos}
            edges={arestas}
            nodeTypes={TIPOS_NO}
            fitView
            fitViewOptions={{ padding: 0.08 }}
            nodesDraggable={false}
            nodesConnectable={false}
            onNodeClick={(_, no) => setSelecionado(no.id)}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1} color="var(--chart-grade)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </div>

      <aside className="surgir space-y-4" style={{ animationDelay: '120ms' }}>
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">componente</p>
          <h2 className="mt-1 font-display text-2xl leading-tight">{detalhe.titulo}</h2>
          <div className="mt-2">
            <Selo tom={status.tom}>{status.estado}</Selo>
          </div>
          <p className="mt-4 text-sm leading-relaxed">{detalhe.sobre}</p>
          {status.linhas.length ? (
            <ul className="num mt-4 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
              {status.linhas.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="rounded-lg border border-border bg-card p-5 text-xs text-muted-foreground">
          <p className="mb-2 font-medium text-foreground">Legenda</p>
          <div className="flex flex-wrap gap-2">
            <Selo tom="ok">funcionando</Selo>
            <Selo tom="alerta">degradado / atenção</Selo>
            <Selo tom="erro">fora do ar</Selo>
            <Selo tom="neutro">sem status</Selo>
          </div>
          <p className="mt-3 leading-relaxed">
            Diagrama do item 3 do orientador: cache de recência, rotação defensiva de chaves e fallback da busca de endereços. Clique num componente para ver os detalhes.
          </p>
        </div>
      </aside>
    </div>
  );
}
