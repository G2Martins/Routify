import { BarrasCombustivel } from '@/components/graficos';
import { Cabecalho, Cartao, ErroConsulta, Kpi, SeletorJanela, Selo, Tabela } from '@/components/ui';
import { exigirAdmin } from '@/lib/auth';
import { fmtData, fmtDec, fmtDuracao, fmtInt } from '@/lib/formato';
import type { AnalyticsUso } from '@/lib/tipos';
import { Analytics } from './Analytics';

type Rota = {
  id: number;
  criado_em: string;
  user_id: string | null;
  origem_lat: number;
  origem_lon: number;
  destino_lat: number;
  destino_lon: number;
  distancia_km: number | null;
  tempo_lia_seg: number | null;
  tempo_rota_curta_seg: number | null;
  rotas_diferentes: boolean | null;
  lia_cobertura_pct: number | null;
  tomtom_degradado: boolean | null;
  vias_atualizadas: number | null;
  interdicoes_na_rota: number | null;
  referencia_tomtom_seg: number | null;
};
type Evento = { id: number; criado_em: string; tipo: string; plataforma: string | null; dados: Record<string, unknown> };
type Requisicao = { id: number; criado_em: string; metodo: string; rota: string; status: number; latencia_ms: number; user_id: string | null; erro: string | null };

type EconomiaCombustivel = {
  rotas_com_estimativa: number;
  rotas_otimizadas: number;
  litros_economizados: number;
  litros_consumidos: number;
  minutos_economizados?: number;
  serie_diaria: { dia: string; litros: number; rotas: number }[];
};
type ParamsCombustivel = { preco_litro_reais: number; co2_kg_por_litro: number; preco_fonte?: string; atualizado_em?: string };

/** Preço e fator de CO₂ vêm da API (ml/artifacts/consumo_combustivel.json), com a fonte. */
async function paramsCombustivel(): Promise<ParamsCombustivel | null> {
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/metrics`, { next: { revalidate: 3600 } });
    return r.ok ? ((await r.json()).combustivel ?? null) : null;
  } catch {
    return null;
  }
}

const coord = (lat: number, lon: number) => `${Number(lat).toFixed(3)}, ${Number(lon).toFixed(3)}`;
const JANELAS = [7, 30, 90];

export default async function UsoPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const { dias: diasParam } = await searchParams;
  const dias = JANELAS.includes(Number(diasParam)) ? Number(diasParam) : 30;
  const { sb } = await exigirAdmin();
  const [analytics, rotas, eventos, requisicoes, economia, params] = await Promise.all([
    sb.rpc('admin_analytics_uso', { dias }),
    sb.from('rotas_calculadas').select('*').order('criado_em', { ascending: false }).limit(50),
    sb.from('eventos_app').select('id, criado_em, tipo, plataforma, dados').order('criado_em', { ascending: false }).limit(50),
    sb.from('api_requisicoes').select('*').order('criado_em', { ascending: false }).limit(50),
    sb.rpc('admin_economia_combustivel', { dias }),
    paramsCombustivel(),
  ]);
  const eco = economia.data as EconomiaCombustivel | null;
  const litros = Number(eco?.litros_economizados ?? 0);

  return (
    <>
      <Cabecalho
        titulo="Uso da plataforma"
        sobre="Funil, busca, LIA × menor distância e onde a plataforma é usada — agregados no banco. Abaixo, os últimos registros brutos (coordenadas a ~110 m, expurgo em 90 dias, LGPD)."
        direita={<SeletorJanela base="/admin/uso" atual={dias} janelas={JANELAS} />}
      />
      <div className="mb-10">
        <ErroConsulta erro={analytics.error} acoes />
        {analytics.data ? <Analytics a={analytics.data as AnalyticsUso} /> : null}
      </div>
      <h2 className="surgir mb-4 font-display text-2xl leading-none">Combustível economizado</h2>
      <div className="mb-10 space-y-5">
        <ErroConsulta erro={economia.error} acoes />
        {eco ? (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <Kpi rotulo="Tempo economizado" valor={`${fmtInt(eco.minutos_economizados ?? 0)} min`} detalhe="contra o caminho mais curto" />
              <Kpi rotulo="Litros economizados" valor={fmtDec(litros, 2)} detalhe={`em ${dias} dias`} atraso={20} />
              <Kpi
                rotulo="Economia em gasolina"
                valor={params ? `R$ ${fmtDec(litros * params.preco_litro_reais, 2)}` : '—'}
                detalhe={params ? `a R$ ${fmtDec(params.preco_litro_reais, 2)}/L (ANP, DF)` : 'parâmetros indisponíveis'}
                atraso={40}
              />
              <Kpi
                rotulo="CO₂ evitado"
                valor={params ? `${fmtDec(litros * params.co2_kg_por_litro, 1)} kg` : '—'}
                detalhe="gasolina C (E30), parte fóssil"
                atraso={80}
              />
              <Kpi
                rotulo="Rotas que economizaram"
                valor={`${fmtInt(eco.rotas_otimizadas)} de ${fmtInt(eco.rotas_com_estimativa)}`}
                detalhe={eco.litros_consumidos > 0 ? `${fmtDec(eco.litros_consumidos, 1)} L estimados no total` : undefined}
                atraso={120}
              />
            </div>
            {eco.serie_diaria.length ? (
              <Cartao titulo="Litros economizados por dia">
                <BarrasCombustivel dados={eco.serie_diaria} />
              </Cartao>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Estimativa por rota, feita pela API no momento do cálculo: litros = K1·km + K2·horas (Evans, Herman &amp; Lam,
              1976), com a rota escolhida pela LIA contra o caminho mais curto no mesmo instante. Só a parte positiva entra
              na soma. Parâmetros e fontes em <code>ml/artifacts/consumo_combustivel.json</code>.
            </p>
          </>
        ) : null}
      </div>

      <h2 className="surgir mb-4 font-display text-2xl leading-none">Últimos registros</h2>
      <ErroConsulta erro={rotas.error ?? eventos.error ?? requisicoes.error} />
      <div className="space-y-5">
        <Cartao titulo="Últimas rotas calculadas">
          <Tabela cabecalho={['Quando', 'Origem → destino (~110 m)', 'Distância', 'LIA', 'Menor distância', 'Cobertura', 'TomTom']}>
            {((rotas.data ?? []) as Rota[]).map((r) => (
              <tr key={r.id}>
                <td className="num text-xs">{fmtData(r.criado_em)}</td>
                <td className="num text-xs">
                  {coord(r.origem_lat, r.origem_lon)} → {coord(r.destino_lat, r.destino_lon)}
                  {r.user_id ? null : <span className="ml-2 text-muted-foreground">(anônimo)</span>}
                </td>
                <td className="num">{fmtDec(r.distancia_km)} km</td>
                <td className="num">{fmtDuracao(r.tempo_lia_seg)}</td>
                <td className="num">
                  {fmtDuracao(r.tempo_rota_curta_seg)}
                  {r.rotas_diferentes ? <span className="ml-1 text-xs text-muted-foreground">(outra rota)</span> : null}
                </td>
                <td className="num">{fmtInt(r.lia_cobertura_pct)}%</td>
                <td>
                  {r.tomtom_degradado ? (
                    <Selo tom="alerta">só LIA</Selo>
                  ) : (
                    <Selo tom="ok">
                      {fmtInt(r.vias_atualizadas)} vias ao vivo{r.interdicoes_na_rota ? ` · ${r.interdicoes_na_rota} interdição` : ''}
                    </Selo>
                  )}
                </td>
              </tr>
            ))}
          </Tabela>
          {!rotas.data?.length && !rotas.error ? <p className="mt-3 text-sm text-muted-foreground">Nenhuma rota ainda.</p> : null}
        </Cartao>

        <div className="grid gap-5 lg:grid-cols-2">
          <Cartao titulo="Últimos eventos do app">
            <Tabela cabecalho={['Quando', 'Evento', 'Plataforma', 'Dados']}>
              {((eventos.data ?? []) as Evento[]).map((e) => (
                <tr key={e.id}>
                  <td className="num text-xs">{fmtData(e.criado_em)}</td>
                  <td>{e.tipo.replace('_', ' ')}</td>
                  <td>{e.plataforma ?? '—'}</td>
                  <td className="num max-w-[220px] truncate text-xs text-muted-foreground" title={JSON.stringify(e.dados)}>
                    {JSON.stringify(e.dados)}
                  </td>
                </tr>
              ))}
            </Tabela>
            {!eventos.data?.length && !eventos.error ? <p className="mt-3 text-sm text-muted-foreground">Nenhum evento ainda.</p> : null}
          </Cartao>

          <Cartao titulo="Últimas requisições à API">
            <Tabela cabecalho={['Quando', 'Requisição', 'Status', 'Latência']}>
              {((requisicoes.data ?? []) as Requisicao[]).map((q) => (
                <tr key={q.id}>
                  <td className="num text-xs">{fmtData(q.criado_em)}</td>
                  <td className="num text-xs">
                    {q.metodo} {q.rota}
                  </td>
                  <td>
                    <Selo tom={q.status >= 500 ? 'erro' : q.status >= 400 ? 'alerta' : 'ok'}>
                      {q.status}
                      {q.erro ? ` · ${q.erro}` : ''}
                    </Selo>
                  </td>
                  <td className="num">{fmtInt(q.latencia_ms)} ms</td>
                </tr>
              ))}
            </Tabela>
            {!requisicoes.data?.length && !requisicoes.error ? <p className="mt-3 text-sm text-muted-foreground">Nenhuma requisição ainda.</p> : null}
          </Cartao>
        </div>
      </div>
    </>
  );
}
