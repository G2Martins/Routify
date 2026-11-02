import { BarrasVies, DispersaoRotasReais, GraficoLinhas, type SerieLinha } from '@/components/graficos';
import { Aviso, Cartao, Kpi, Mini, Selo, Tabela } from '@/components/ui';
import { fmtData, fmtDec, fmtDia, fmtInt, fmtMin, fmtPct, fmtPctSinal, num, rotuloVersao } from '@/lib/formato';
import {
  chipsReceita,
  corVersao,
  desvioPct,
  foldsMelhores,
  idadesOrdenadas,
  linhasPorHora,
  menores,
  nomeCorredor,
  nomeProvedor,
  porOrdem,
  porOrdemCorredor,
  resumoFase3,
  seriesPorHora,
} from '@/lib/provedores';
import type {
  AblacaoLia23,
  AvaliacaoForaDoTempo,
  CoberturaDataset,
  ComparacaoProvedores,
  Fase3Comparacao,
  LiaTreino,
  ProvedoresHistoricos,
  VarianteAblacao,
} from '@/lib/tipos';

/* Apresentação da página /admin/provedores. Tudo aqui é Server Component e recebe dado já buscado:
   cada seção tem o próprio estado vazio, sem número inventado. */

export function Grupo({ titulo }: { titulo: string }) {
  return <h2 className="surgir mb-4 mt-10 font-display text-2xl leading-none">{titulo}</h2>;
}

const DIAS_SEMANA = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const COD = 'num rounded border border-border bg-muted/50 px-1 py-0.5 text-[11px]';

/** "OSRM (sem trânsito)" → "OSRM". */
const curto = (id: string) => nomeProvedor(id).replace(/ \(.*\)$/, '');
/** A referência vem primeiro; o resto na ordem do painel. */
const referenciaPrimeiro = (a: string, b: string) => (a === 'tomtom' ? -1 : b === 'tomtom' ? 1 : porOrdem(a, b));
/** Menor erro da coluna/linha em destaque (negrito + sublinhado), nunca só cor. */
const melhor = (sim: boolean) => (sim ? 'font-semibold underline decoration-accent decoration-2 underline-offset-4' : '');

/** Desvio (%) contra a referência: régua centrada no zero (fundo de escala ±50%) e o número com sinal. */
function Desvio({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted-foreground">—</span>;
  const lado = Math.min(Math.abs(pct), 50);
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="relative block h-1.5 w-12 shrink-0 rounded-full bg-muted">
        <span className="absolute inset-y-[-2px] left-1/2 w-px bg-border-strong" />
        <span
          className="absolute inset-y-0 rounded-full"
          style={{
            left: pct < 0 ? `${50 - lado}%` : '50%',
            width: `${lado}%`,
            background: 'color-mix(in oklab, var(--chart-1) 80%, transparent)',
          }}
        />
      </span>
      <span className={`num text-xs ${Math.abs(pct) > 20 ? 'font-medium text-alerta' : 'text-muted-foreground'}`}>{fmtPctSinal(pct)}</span>
    </span>
  );
}

/* ---------- 1. Modelo em produção ---------- */

export function CartaoModelo({
  ativo,
  treino,
  ablacao,
}: {
  ativo: string | null;
  treino: LiaTreino | undefined;
  ablacao: AblacaoLia23 | undefined;
}) {
  if (!ativo) {
    return (
      <Cartao titulo="Modelo em produção" className="mb-5">
        <Aviso titulo="Versão ativa indisponível">
          A API não respondeu em <span className="num">/health</span> (fora do ar ou NEXT_PUBLIC_API_URL incorreta). Sem isso o
          painel não sabe qual LIA está servindo, e não adivinha.
        </Aviso>
      </Cartao>
    );
  }
  const titulo = (
    <div className="flex flex-wrap items-baseline gap-3">
      <p className="font-display text-3xl leading-none">{rotuloVersao(ativo)}</p>
      <Selo tom="ok">ativo na API</Selo>
    </div>
  );
  if (!treino) {
    return (
      <Cartao titulo="Modelo em produção" className="mb-5">
        {titulo}
        <div className="mt-4">
          <Aviso titulo="Métricas desta versão ainda não publicadas">
            Não há linha de <span className="num">{ativo}</span> em lia_treinos. Rode <span className="num">python ml/publish_metrics.py</span>.
          </Aviso>
        </div>
      </Cartao>
    );
  }

  const det = treino.detalhes ?? {};
  // A ablação mede a 2.2 e a 2.3 nos mesmos folds: serve de segunda fonte para a persistência e a receita.
  const variante = ablacao?.variantes?.find((v) => `lia_${v.nome}` === treino.versao);
  const chips = chipsReceita(det.receita ?? variante?.receita);
  const persRmse = num(det.persistencia_rmse_seg) ?? num(variante?.cv?.persistencia_rmse_seg);
  const persMae = num(det.persistencia_mae_seg) ?? num(variante?.cv?.persistencia_mae_seg);
  const persDaAblacao = num(det.persistencia_rmse_seg) === null && persRmse !== null;
  const linhas = [
    { rotulo: 'RMSE', modelo: num(treino.rmse_seg), desvio: num(treino.rmse_seg_std), pers: persRmse, perfil: num(treino.baseline_rmse_seg) },
    { rotulo: 'MAE', modelo: num(treino.mae_seg), desvio: num(treino.mae_seg_std), pers: persMae, perfil: num(treino.baseline_mae_seg) },
  ];
  const celula = (v: number | null, destaque: boolean) => (
    <span className={`num text-lg sm:text-xl ${melhor(destaque)}`}>{v === null ? '—' : `${fmtDec(v)} s`}</span>
  );

  return (
    <Cartao
      titulo="Modelo em produção"
      className="mb-5"
      nota={
        <>
          Validação cruzada temporal de 5 folds, em segundos por trecho de via; ± é o desvio entre folds. Persistência = repetir a
          última leitura da via; perfil = média histórica da via, hora e dia da semana. Menor erro de cada linha em destaque.
          {persDaAblacao ? ' Persistência medida na ablação, nos mesmos folds.' : ''}
          {persRmse === null ? ' Esta versão não registrou a persistência.' : ''}
        </>
      }
    >
      {titulo}
      {chips.length ? (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Receita do treino">
          {chips.map((c) => (
            <li key={c} className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground">
              {c}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">Receita não registrada no metadata desta versão.</p>
      )}
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Treino{' '}
          <span className="num">
            {fmtDia(treino.periodo_inicio)} → {fmtDia(treino.periodo_fim)}
          </span>
        </span>
        <span>
          <span className="num">{fmtInt(treino.total_amostras)}</span> amostras
        </span>
        <span>{treino.validacao === 'temporal' ? 'CV temporal' : 'CV não temporal'}</span>
      </p>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full max-w-2xl text-left">
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              <td className="pb-2 pr-4 sm:pr-6" />
              {[rotuloVersao(treino.versao), 'Persistência', 'Perfil histórico'].map((t) => (
                <th key={t} scope="col" className="pb-2 pr-4 font-normal sm:pr-6">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const m = menores([l.modelo, l.pers, l.perfil]);
              return (
                <tr key={l.rotulo}>
                  <th scope="row" className="py-1.5 pr-4 text-xs font-normal text-muted-foreground sm:pr-6">
                    {l.rotulo}
                  </th>
                  <td className="whitespace-nowrap py-1.5 pr-4 sm:pr-6">
                    {celula(l.modelo, m.has(0))}
                    {l.desvio !== null ? <span className="num ml-1 text-xs text-muted-foreground">± {fmtDec(l.desvio)}</span> : null}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-4 sm:pr-6">{celula(l.pers, m.has(1))}</td>
                  <td className="whitespace-nowrap py-1.5 pr-4 sm:pr-6">{celula(l.perfil, m.has(2))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Cartao>
  );
}

/* ---------- 2. KPIs da janela ---------- */

export function KpisJanela({ d }: { d: ComparacaoProvedores }) {
  const mt = d.lia_mesmo_trajeto;
  const vs = (id: string) => d.vs_tomtom.find((x) => x.provedor === id);
  const semTransito = new Set(d.provedores.filter((p) => !p.com_transito).map((p) => p.provedor));
  // Routify e OSRM são o núcleo do comparador e sempre aparecem; os opcionais só se vierem nos dados.
  const externos = [...new Set(['routify', 'osrm', ...d.vs_tomtom.map((x) => x.provedor)])]
    .filter((id) => !['lia', 'tomtom', 'tomtom_mesmo_trajeto'].includes(id))
    .sort(porOrdem);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi rotulo="Rodadas" valor={fmtInt(d.rodadas)} detalhe={`última: ${fmtData(d.ultima_rodada)}`} />
        <Kpi rotulo="Corredores" valor={fmtInt(d.corredores)} detalhe="pares origem → destino fixos" atraso={40} />
        <Kpi
          rotulo="LIA × TomTom · viés"
          valor={fmtPctSinal(mt.vies_mediano_pct)}
          detalhe={mt.n ? `mediana no mesmo trajeto · n = ${fmtInt(mt.n)}` : 'sem pares na janela'}
          atraso={80}
        />
        <Kpi
          rotulo="LIA × TomTom · MAPE"
          valor={fmtPct(mt.mape_pct)}
          detalhe={mt.n ? `${fmtPct(mt.pct_ate_20)} dentro de ±20%` : 'sem pares na janela'}
          atraso={120}
        />
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-4">
        {externos.map((id, i) => {
          const v = vs(id);
          return (
            <Kpi
              key={id}
              rotulo={`${curto(id)} × TomTom`}
              valor={fmtPctSinal(v?.vies_mediano_pct)}
              detalhe={
                v
                  ? `viés mediano · MAPE ${fmtPct(v.mape_pct)} · n = ${fmtInt(v.n)}${semTransito.has(id) ? ' · sem trânsito' : ''}`
                  : 'sem pares na janela'
              }
              atraso={160 + i * 40}
            />
          );
        })}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Mesmo trajeto = a TomTom estima o caminho que a LIA escolheu, então só muda o modelo de velocidade. Viés negativo = o
        provedor estima menos tempo que a TomTom; MAPE = erro absoluto médio.
      </p>
    </div>
  );
}

const COMPARA: Record<string, string> = {
  tomtom: 'referência: TomTom Routing com trânsito ao vivo',
  lia: 'tempo da LIA na rota da LIA × melhor rota da TomTom',
  routify: 'rota exibida ao usuário (fusão) × melhor rota da TomTom',
  tomtom_mesmo_trajeto: 'TomTom no caminho da LIA × melhor rota da TomTom (positivo = caminho da LIA mais lento)',
  osrm: 'tempo de mapa × TomTom ao vivo',
  openrouteservice: 'perfil driving-car × TomTom ao vivo',
  mapbox: 'driving-traffic × TomTom ao vivo',
};

export function TabelaProvedores({ d }: { d: ComparacaoProvedores }) {
  const ids = [...new Set(d.provedores.map((p) => p.provedor))].sort(referenciaPrimeiro);
  return (
    <Cartao
      titulo="Cada provedor contra a TomTom"
      atraso={200}
      nota="Pares = mesma viagem, mesma rodada. Traçado igual = quanto da rota coincide com a da TomTom (até 40 m, nos dois sentidos). Respostas e falhas contam todas as linhas gravadas na janela, inclusive as que não formaram par."
    >
      <Tabela cabecalho={['Provedor', 'Trânsito', 'Pares', 'Viés mediano', 'MAPE', 'Dentro de ±20%', 'Traçado igual', 'Respostas', 'Falhas']}>
        {ids.map((id) => {
          const p = d.provedores.find((x) => x.provedor === id);
          const v = d.vs_tomtom.find((x) => x.provedor === id);
          return (
            <tr key={id}>
              <td>
                <span className="font-medium">{nomeProvedor(id)}</span>
                {COMPARA[id] ? <span className="block max-w-72 text-[11px] leading-snug text-muted-foreground">{COMPARA[id]}</span> : null}
              </td>
              <td>{p?.com_transito ? <Selo tom="ok">ao vivo</Selo> : <Selo tom="neutro">tempo de mapa</Selo>}</td>
              <td className="num">{v ? fmtInt(v.n) : '—'}</td>
              <td className="num">{v ? fmtPctSinal(v.vies_mediano_pct) : '—'}</td>
              <td className="num">{v ? fmtPct(v.mape_pct) : '—'}</td>
              <td className="num">{v ? fmtPct(v.pct_ate_20) : '—'}</td>
              <td className="num">{v?.traco_comum_pct != null ? fmtPct(v.traco_comum_pct) : '—'}</td>
              <td className="num">{fmtInt(p?.n_ok)}</td>
              <td className={`num ${p?.n_falhas ? 'text-destructive' : ''}`}>{fmtInt(p?.n_falhas)}</td>
            </tr>
          );
        })}
      </Tabela>
    </Cartao>
  );
}

/* ---------- 2b. Modelos históricos dos provedores ---------- */

// Em pares: as duas primeiras usam as mesmas rodadas no trajeto da LIA; as duas últimas, as mesmas rodadas do Mapbox.
const HISTORICOS = [
  { id: 'lia', nome: 'LIA (Routify)', compara: 'trajeto da LIA × TomTom ao vivo no mesmo trajeto' },
  { id: 'tomtom_historico', nome: 'TomTom histórico', compara: 'o mesmo trajeto, só pelo histórico da TomTom × TomTom ao vivo' },
  { id: 'mapbox_tipico', nome: 'Mapbox típico', compara: 'trânsito típico do horário × TomTom ao vivo, rotas próprias' },
  { id: 'mapbox_ao_vivo', nome: 'Mapbox ao vivo', compara: 'as mesmas rodadas do típico × TomTom ao vivo' },
] as const;

export function ModelosHistoricos({ h }: { h: ProvedoresHistoricos }) {
  const linhas = HISTORICOS.map((x) => ({ ...x, v: h.series[x.id] }));
  if (!linhas.some((l) => l.v?.n)) {
    return (
      <Aviso titulo="Sem pares com ETA histórico nesta janela">
        O comparador grava o ETA histórico da TomTom e o típico do Mapbox desde 2026-11-02. Os pares aparecem nas próximas rodadas.
      </Aviso>
    );
  }
  // Melhor MAPE dentro de cada par (mesmas rodadas), nunca entre pares com referências diferentes.
  const destaque = [0, 2].flatMap((i) => [...menores([linhas[i].v?.mape_pct, linhas[i + 1].v?.mape_pct])].map((j) => i + j));
  const lxh = h.series.lia_x_tomtom_historico;
  return (
    <Cartao
      titulo="LIA × modelos históricos dos provedores"
      atraso={220}
      nota={
        <>
          A LIA prevê pelo histórico mais a última leitura da via; a TomTom e o Mapbox também têm um ETA só pelo histórico. Os dois são
          medidos contra a TomTom ao vivo. Em destaque, o menor MAPE de cada par.
          {lxh?.n ? ` LIA × TomTom histórico, mesmo trajeto: viés mediano ${fmtPctSinal(lxh.vies_mediano_pct)} (n = ${fmtInt(lxh.n)}).` : ''}
        </>
      }
    >
      <Tabela cabecalho={['Série', 'Pares', 'Viés mediano', 'MAPE', 'Dentro de ±20%']}>
        {linhas.map((l, i) => (
          <tr key={l.id}>
            <td>
              <span className="font-medium">{l.nome}</span>
              <span className="block max-w-72 text-[11px] leading-snug text-muted-foreground">{l.compara}</span>
            </td>
            <td className="num">{l.v ? fmtInt(l.v.n) : '—'}</td>
            <td className="num">{l.v ? fmtPctSinal(l.v.vies_mediano_pct) : '—'}</td>
            <td className={`num ${melhor(destaque.includes(i))}`}>{l.v ? fmtPct(l.v.mape_pct) : '—'}</td>
            <td className="num">{l.v ? fmtPct(l.v.pct_ate_20) : '—'}</td>
          </tr>
        ))}
      </Tabela>
    </Cartao>
  );
}

/* ---------- 3. Última rodada ---------- */

export function UltimaRodada({ d }: { d: ComparacaoProvedores }) {
  const colunas = [...new Set(d.ultima.map((u) => u.provedor))].sort(referenciaPrimeiro);
  const corredores = [...new Set(d.ultima.map((u) => u.corredor))].sort(porOrdemCorredor);
  const achar = (c: string, p: string) => d.ultima.find((u) => u.corredor === c && u.provedor === p);

  const provsMedia = [...new Set(d.por_corredor.map((x) => x.provedor))].sort(porOrdem);
  const corredoresMedia = [...new Set(d.por_corredor.map((x) => x.corredor))].sort(porOrdemCorredor);

  return (
    <Cartao
      titulo="Última rodada · corredor × provedor"
      atraso={240}
      nota={
        <>
          Rodada de {fmtData(d.ultima_rodada)} (Brasília). Desvio = (tempo − TomTom) ÷ TomTom; a régua vai de −50% a +50% e o número
          fica âmbar acima de ±20%. “falhou” = o provedor não respondeu (só o código HTTP é guardado, nunca a chave).
        </>
      }
    >
      {corredores.length ? (
        <Tabela cabecalho={['Corredor', ...colunas.map(nomeProvedor)]}>
          {corredores.map((c) => {
            const t = num(achar(c, 'tomtom')?.tempo_s);
            return (
              <tr key={c}>
                <td className="min-w-44 font-medium">{nomeCorredor(c)}</td>
                {colunas.map((p) => {
                  const l = achar(c, p);
                  const tempo = num(l?.tempo_s);
                  return (
                    <td key={p}>
                      {tempo !== null ? (
                        <div className="space-y-1">
                          <span className="num">{fmtMin(tempo)}</span>
                          {p === 'tomtom' ? null : (
                            <div>
                              <Desvio pct={desvioPct(tempo, t)} />
                            </div>
                          )}
                        </div>
                      ) : l ? (
                        <span className="text-xs text-destructive" title={l.erro ?? undefined}>
                          falhou{l.erro ? ` · ${l.erro}` : ''}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </Tabela>
      ) : (
        <Aviso titulo="Sem linhas na última rodada" />
      )}
      {corredoresMedia.length ? (
        <details className="mt-5">
          <summary className="cursor-pointer select-none text-sm font-medium">Erro médio da janela, por corredor</summary>
          <div className="mt-3">
            <Tabela cabecalho={['Corredor', ...provsMedia.map(nomeProvedor)]}>
              {corredoresMedia.map((c) => (
                <tr key={c}>
                  <td className="font-medium">{nomeCorredor(c)}</td>
                  {provsMedia.map((p) => {
                    const x = d.por_corredor.find((y) => y.corredor === c && y.provedor === p);
                    return (
                      <td key={p}>
                        {x ? (
                          <>
                            <span className="num">{fmtPctSinal(x.erro_medio_pct)}</span>
                            <span className="num ml-1.5 text-[11px] text-muted-foreground">n = {fmtInt(x.n)}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </Tabela>
            <p className="mt-2 text-xs text-muted-foreground">Média do erro com sinal contra a TomTom da mesma rodada, em todas as rodadas da janela.</p>
          </div>
        </details>
      ) : null}
    </Cartao>
  );
}

/* ---------- 4. Viés por hora ---------- */

export function ViesPorHora({ d }: { d: ComparacaoProvedores }) {
  const series = seriesPorHora(d.por_hora, d.provedores);
  const horas = [...new Set(d.por_hora.map((p) => Number(p.hora)))].sort((a, b) => a - b);
  return (
    <Cartao
      titulo="Viés mediano por hora do dia"
      atraso={280}
      nota="Horário de Brasília; cada ponto é uma das rodadas fixas (n no tooltip). A linha zero é a TomTom: abaixo dela o provedor estima menos tempo. Tracejado = sem trânsito (tempo de mapa)."
    >
      {series.length ? (
        <GraficoLinhas
          dados={linhasPorHora(d.por_hora, series)}
          x="hora"
          series={series}
          formatoX="hora"
          unidade="%"
          dominioY="incluiZero"
          zero="TomTom (referência)"
          comSinal
          ticksX={horas}
          altura={340}
          rotulo="Viés mediano de cada provedor contra a TomTom, por hora de Brasília"
        />
      ) : (
        <Aviso titulo="Sem pares nesta janela">Nenhum provedor formou par com a TomTom na mesma rodada.</Aviso>
      )}
    </Cartao>
  );
}

/* ---------- 5. Rotas reais ---------- */

export function RotasReais({ r }: { r: ComparacaoProvedores['rotas_reais'] }) {
  const pontos = (r.amostras ?? []).flatMap((a) => {
    const t = num(a.tomtom_s);
    const l = num(a.lia_s);
    return t && l ? [{ tomtom: t / 60, lia: l / 60, km: num(a.km), cobertura: num(a.cobertura_pct) }] : [];
  });
  const porHora = (r.por_hora ?? []).flatMap((h) => {
    const v = num(h.vies_mediano_pct);
    return v === null ? [] : [{ hora: Number(h.hora), vies: v, n: h.n }];
  });
  return (
    <Cartao
      titulo="Rotas reais · LIA × TomTom no mesmo trajeto"
      atraso={320}
      nota="Por enquanto só há rotas de usuários de teste: serve para ver o formato, não para concluir. A dispersão mostra as 300 rotas mais recentes da janela, sem usuário, coordenada nem data."
    >
      {r.n ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Mini rotulo="Rotas com referência" valor={fmtInt(r.n)} />
            <Mini rotulo="Viés mediano" valor={fmtPctSinal(r.vies_mediano_pct)} detalhe="negativo = LIA mais rápida" />
            <Mini rotulo="MAPE" valor={fmtPct(r.mape_pct)} />
            <Mini rotulo="Dentro de ±20%" valor={fmtPct(r.pct_ate_20)} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium">Tempo da LIA × tempo da TomTom, por rota</p>
              <DispersaoRotasReais pontos={pontos} />
              <p className="mt-1 text-xs text-muted-foreground">Diagonal tracejada = acerto; pontilhadas = ±20%.</p>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Viés mediano por hora de saída</p>
              {porHora.length ? (
                <BarrasVies dados={porHora} />
              ) : (
                <Aviso titulo="Sem hora de partida registrada" />
              )}
              <p className="mt-1 text-xs text-muted-foreground">Horário de Brasília; o n de cada barra aparece no tooltip.</p>
            </div>
          </div>
        </div>
      ) : (
        <Aviso titulo="Nenhuma rota real com referência da TomTom nesta janela">
          A comparação usa <span className="num">rotas_calculadas.referencia_tomtom_seg</span>. Amplie a janela ou peça rotas no app.
        </Aviso>
      )}
    </Cartao>
  );
}

/* ---------- 6. Ablação ---------- */

type LinhaAblacao = {
  chave: string;
  nome: string;
  sub: string;
  rmse: number | null;
  rmseStd: number | null;
  mae: number | null;
  maeStd: number | null;
  idade: Record<number, { rmse: number | null; mae: number | null }>;
  folds: string | null;
};

export function Ablacao({ a }: { a: AblacaoLia23 | undefined }) {
  const vs = a?.variantes ?? [];
  if (!a || !vs.length) {
    return (
      <Cartao titulo="Ablação 2.2 → 2.3" atraso={360}>
        <Aviso titulo="Ablação não publicada">
          Rode <span className="num">python ml/ablation_lia_2_3.py</span> e depois <span className="num">python ml/publish_metrics.py</span>.
        </Aviso>
      </Cartao>
    );
  }
  // Persistência e perfil não dependem da receita: são iguais nas variantes, então basta a primeira.
  const base = vs[0];
  const nova = vs.find((v) => v.nome === '2.3') ?? vs[vs.length - 1];
  const antiga = vs.find((v) => v.nome === '2.2') ?? vs[0];
  const idades = idadesOrdenadas(base.por_idade);
  const idadeDe = (v: VarianteAblacao, i: number, campo: string) => num((v.por_idade?.[i] as Record<string, unknown> | undefined)?.[campo]);

  const linhas: LinhaAblacao[] = [
    ...vs.map((v) => {
      const fr = foldsMelhores(v.folds, 'rmse');
      const fm = foldsMelhores(v.folds, 'mae');
      return {
        chave: v.nome,
        nome: /^\d/.test(v.nome) ? `LIA ${v.nome}` : v.nome,
        sub: chipsReceita(v.receita).join(' · '),
        rmse: num(v.cv?.modelo_rmse_seg),
        rmseStd: num(v.cv?.modelo_rmse_seg_std),
        mae: num(v.cv?.modelo_mae_seg),
        maeStd: num(v.cv?.modelo_mae_seg_std),
        idade: Object.fromEntries(idades.map((i) => [i, { rmse: idadeDe(v, i, 'modelo_rmse_seg'), mae: idadeDe(v, i, 'modelo_mae_seg') }])),
        folds: fr.total ? `${fr.melhores}/${fr.total} · ${fm.melhores}/${fm.total}` : null,
      };
    }),
    {
      chave: 'persistencia',
      nome: 'Persistência',
      sub: 'repete a última leitura da via',
      rmse: num(base.cv?.persistencia_rmse_seg),
      rmseStd: num(base.cv?.persistencia_rmse_seg_std),
      mae: num(base.cv?.persistencia_mae_seg),
      maeStd: num(base.cv?.persistencia_mae_seg_std),
      idade: Object.fromEntries(
        idades.map((i) => [i, { rmse: idadeDe(base, i, 'persistencia_rmse_seg'), mae: idadeDe(base, i, 'persistencia_mae_seg') }]),
      ),
      folds: null,
    },
    {
      chave: 'perfil',
      nome: 'Perfil histórico',
      sub: 'média da via, hora e dia da semana',
      rmse: num(base.cv?.baseline_rmse_seg),
      rmseStd: num(base.cv?.baseline_rmse_seg_std),
      mae: num(base.cv?.baseline_mae_seg),
      maeStd: num(base.cv?.baseline_mae_seg_std),
      idade: Object.fromEntries(idades.map((i) => [i, { rmse: idadeDe(base, i, 'baseline_rmse_seg'), mae: idadeDe(base, i, 'baseline_mae_seg') }])),
      folds: null,
    },
  ];
  const melhorRmse = menores(linhas.map((l) => l.rmse));
  const melhorMae = menores(linhas.map((l) => l.mae));
  const melhorIdade = Object.fromEntries(
    idades.map((i) => [i, { rmse: menores(linhas.map((l) => l.idade[i]?.rmse)), mae: menores(linhas.map((l) => l.idade[i]?.mae)) }]),
  );

  const dadosIdade = (m: 'rmse' | 'mae') =>
    idades.map((i) => ({
      idade: i,
      nova: idadeDe(nova, i, `modelo_${m}_seg`),
      antiga: idadeDe(antiga, i, `modelo_${m}_seg`),
      persistencia: idadeDe(base, i, `persistencia_${m}_seg`),
      perfil: idadeDe(base, i, `baseline_${m}_seg`),
    }));
  const series: SerieLinha[] = [
    { chave: 'nova', nome: `LIA ${nova.nome}`, cor: 'var(--chart-1)' },
    ...(antiga !== nova ? [{ chave: 'antiga', nome: `Receita ${antiga.nome}`, cor: 'var(--chart-3)' }] : []),
    { chave: 'persistencia', nome: 'Persistência', cor: 'var(--chart-2)', tracejado: true },
    { chave: 'perfil', nome: 'Perfil histórico', cor: 'var(--chart-neutro)', tracejado: true },
  ];

  return (
    <div className="space-y-5">
      <Cartao
        titulo="Ablação 2.2 → 2.3 · o que cada mudança da receita traz"
        atraso={360}
        nota={
          <>
            Mesmos 5 folds temporais e mesmas features da 2.2; muda uma coisa por linha. Perfis OOF = perfis históricos calculados fora da
            amostra (sem vazar o alvo); early stopping no treino = para no último 10% do próprio treino, e a validação só mede;
            recência envelhecida = parte do treino usa leituras de 15 a 480 min atrás, como chegam na API. Menor valor de cada coluna em
            destaque. “Folds melhores” = em quantos dos 5 folds o modelo erra menos que a persistência (RMSE · MAE).
          </>
        }
      >
        {a.smoke ? (
          <div className="mb-4">
            <Aviso titulo="Execução de teste (smoke)">
              150 mil linhas e 60 árvores: só valida o código. Não cite estes números; rode <span className="num">python ml/ablation_lia_2_3.py</span> sem
              <span className="num"> --smoke</span>.
            </Aviso>
          </div>
        ) : null}
        <p className="mb-3 text-xs text-muted-foreground">
          Gerado em {fmtData(a.gerado_em)} · <span className="num">{fmtInt(a.linhas)}</span> linhas · {fmtDia(a.periodo?.[0])} → {fmtDia(a.periodo?.[1])}. Colunas
          em minutos = idade da última leitura da via; cada célula mostra RMSE / MAE em segundos.
        </p>
        <Tabela
          cabecalho={['Variante e receita', 'RMSE (s)', 'MAE (s)', ...idades.map((i) => `${i} min`), 'Folds melhores']}
        >
          {linhas.map((l, k) => (
            <tr key={l.chave}>
              <td>
                <span className="font-medium">{l.nome}</span>
                {l.sub ? <span className="block max-w-60 text-[11px] leading-snug text-muted-foreground">{l.sub}</span> : null}
              </td>
              <td className="num whitespace-nowrap">
                <span className={melhor(melhorRmse.has(k))}>{fmtDec(l.rmse)}</span>
                {l.rmseStd !== null ? <span className="ml-1 text-[11px] text-muted-foreground">± {fmtDec(l.rmseStd)}</span> : null}
              </td>
              <td className="num whitespace-nowrap">
                <span className={melhor(melhorMae.has(k))}>{fmtDec(l.mae)}</span>
                {l.maeStd !== null ? <span className="ml-1 text-[11px] text-muted-foreground">± {fmtDec(l.maeStd)}</span> : null}
              </td>
              {idades.map((i) => (
                <td key={i} className="num whitespace-nowrap">
                  <span className={melhor(melhorIdade[i].rmse.has(k))}>{fmtDec(l.idade[i]?.rmse)}</span>
                  <span className="text-muted-foreground"> / </span>
                  <span className={melhor(melhorIdade[i].mae.has(k))}>{fmtDec(l.idade[i]?.mae)}</span>
                </td>
              ))}
              <td className="num whitespace-nowrap">{l.folds ?? '—'}</td>
            </tr>
          ))}
        </Tabela>
      </Cartao>
      <div className="grid gap-5 lg:grid-cols-2">
        <Cartao titulo="RMSE × idade da última leitura" atraso={400} nota="Quanto mais velha a leitura, mais o modelo precisa do perfil. A persistência degrada rápido; a 2.3 foi treinada para isso.">
          <GraficoLinhas dados={dadosIdade('rmse')} x="idade" series={series} formatoX="minutos" unidade=" s" dominioY="zero" rotulo="RMSE em segundos por idade da última leitura" />
        </Cartao>
        <Cartao titulo="MAE × idade da última leitura" atraso={440} nota="Erro típico, menos sensível a picos. Mesmos folds e mesmas séries do gráfico ao lado.">
          <GraficoLinhas dados={dadosIdade('mae')} x="idade" series={series} formatoX="minutos" unidade=" s" dominioY="zero" rotulo="MAE em segundos por idade da última leitura" />
        </Cartao>
      </div>
    </div>
  );
}

/* ---------- 7. Avaliação fora do tempo ---------- */

export function ForaDoTempo({ a }: { a: AvaliacaoForaDoTempo | undefined }) {
  const versoes = Object.entries(a?.versoes ?? {}).sort(([x], [y]) => x.localeCompare(y, 'pt-BR', { numeric: true }));
  if (!a || !versoes.length) {
    return (
      <Cartao titulo="Avaliação fora do tempo" atraso={480}>
        <Aviso titulo="Ainda não há avaliação fora do tempo publicada">
          <p>
            A coleta voltou em 02/11/2026. Quando houver leituras novas suficientes, rode <span className="num">ml/avaliar_fora_do_tempo.py</span> com os
            dados de novembro: ela mede cada versão só em leituras posteriores ao treino, ao lado da persistência e do perfil, e o{' '}
            <span className="num">publish_metrics.py</span> leva o resultado para cá.
          </p>
          <pre className={`${COD} mt-3 overflow-x-auto whitespace-pre p-3`}>
            {`cd ml
../apps/api/.venv/Scripts/python silver.py
../apps/api/.venv/Scripts/python fetch_contexto.py --fim AAAA-MM-DD
../apps/api/.venv/Scripts/python avaliar_fora_do_tempo.py --desde 2026-11-02 --versoes lia_2.2 lia_2.3
../apps/api/.venv/Scripts/python publish_metrics.py`}
          </pre>
        </Aviso>
      </Cartao>
    );
  }

  // Recharts lê "a.b" como caminho: a chave da série não pode ter ponto.
  const chave = (versao: string) => `m_${versao.replace(/\W/g, '_')}`;
  const series: SerieLinha[] = [
    ...versoes.map(([versao], i) => ({ chave: chave(versao), nome: rotuloVersao(versao), cor: corVersao(i, versoes.length) })),
    { chave: 'persistencia', nome: 'Persistência', cor: 'var(--chart-2)', tracejado: true },
  ];
  const horas = [...new Set(versoes.flatMap(([, v]) => (v.por_hora ?? []).map((h) => Number(h.hora))))].sort((x, y) => x - y);
  const idades = [...new Set(versoes.flatMap(([, v]) => idadesOrdenadas(v.por_idade)))].sort((x, y) => x - y);
  const dadosHora = horas.map((hora) => {
    const linha: Record<string, number | null> = { hora };
    versoes.forEach(([versao, v], i) => {
      const h = v.por_hora?.find((x) => Number(x.hora) === hora);
      linha[chave(versao)] = h?.modelo?.rmse_seg ?? null;
      linha[`n_${chave(versao)}`] = h?.n ?? null;
      if (i === 0) {
        linha.persistencia = h?.persistencia?.rmse_seg ?? null;
        linha.n_persistencia = h?.n ?? null;
      }
    });
    return linha;
  });
  const dadosIdade = idades.map((idade) => {
    const linha: Record<string, number | null> = { idade };
    versoes.forEach(([versao, v], i) => {
      const p = v.por_idade?.[idade];
      linha[chave(versao)] = p?.modelo?.rmse_seg ?? null;
      linha[`n_${chave(versao)}`] = p?.n ?? null;
      if (i === 0) {
        linha.persistencia = p?.persistencia?.rmse_seg ?? null;
        linha.n_persistencia = p?.n ?? null;
      }
    });
    return linha;
  });
  const descartadas = versoes.reduce((s, [, v]) => Math.max(s, v.n_descartadas_recencia_antiga ?? 0), 0);

  return (
    <div className="space-y-5">
      <Cartao
        titulo="Avaliação fora do tempo · leituras que nenhum modelo viu"
        atraso={480}
        nota={
          <>
            Leituras coletadas desde {fmtDia(a.desde)} (gerado em {fmtData(a.gerado_em)}), com a recência chegando como chega na API. Cada versão só é medida
            depois do fim do próprio treino.
            {descartadas ? ` A 1ª leitura nova de cada via tem recência de julho e fica fora (${fmtInt(descartadas)} linhas).` : ''} Menor erro de cada
            grupo em destaque.
          </>
        }
      >
        <Tabela
          cabecalho={[
            'Versão',
            'Fim do treino',
            'Linhas novas',
            'Idade mediana',
            'RMSE modelo',
            'RMSE persistência',
            'RMSE perfil',
            'MAE modelo',
            'MAE persistência',
            'MAE perfil',
          ]}
        >
          {versoes.map(([versao, v]) => {
            const f = v.fresca;
            const r = menores([f?.modelo?.rmse_seg, f?.persistencia?.rmse_seg, f?.perfil?.rmse_seg]);
            const m = menores([f?.modelo?.mae_seg, f?.persistencia?.mae_seg, f?.perfil?.mae_seg]);
            return (
              <tr key={versao}>
                <td className="font-medium">{rotuloVersao(versao)}</td>
                <td className="num text-xs">{fmtDia(v.fim_do_treino)}</td>
                <td className="num">{fmtInt(v.n_linhas)}</td>
                <td className="num">{v.idade_mediana_leitura_min === undefined ? '—' : `${fmtDec(v.idade_mediana_leitura_min)} min`}</td>
                <td className="num"><span className={melhor(r.has(0))}>{fmtDec(f?.modelo?.rmse_seg)}</span></td>
                <td className="num"><span className={melhor(r.has(1))}>{fmtDec(f?.persistencia?.rmse_seg)}</span></td>
                <td className="num"><span className={melhor(r.has(2))}>{fmtDec(f?.perfil?.rmse_seg)}</span></td>
                <td className="num"><span className={melhor(m.has(0))}>{fmtDec(f?.modelo?.mae_seg)}</span></td>
                <td className="num"><span className={melhor(m.has(1))}>{fmtDec(f?.persistencia?.mae_seg)}</span></td>
                <td className="num"><span className={melhor(m.has(2))}>{fmtDec(f?.perfil?.mae_seg)}</span></td>
              </tr>
            );
          })}
        </Tabela>
      </Cartao>
      <div className="grid gap-5 lg:grid-cols-2">
        <Cartao titulo="RMSE por hora do dia" atraso={520} nota="Horário de Brasília. Mostra se o erro muda com o horário, o que o dataset de treino (enviesado no tempo) não deixava ver.">
          <GraficoLinhas dados={dadosHora} x="hora" series={series} formatoX="hora" unidade=" s" dominioY="zero" ticksX={horas.filter((h) => h % 3 === 0)} rotulo="RMSE em segundos por hora do dia, fora do tempo" />
        </Cartao>
        <Cartao titulo="RMSE por idade da leitura" atraso={560} nota="Idades maiores simulam partidas no futuro, com a recência envelhecida.">
          <GraficoLinhas dados={dadosIdade} x="idade" series={series} formatoX="minutos" unidade=" s" dominioY="zero" rotulo="RMSE em segundos por idade da última leitura, fora do tempo" />
        </Cartao>
      </div>
    </div>
  );
}

/* ---------- 8. Fase 3 histórica ---------- */

export function Fase3({ f }: { f: Fase3Comparacao | undefined }) {
  const linhas = f?.linhas ?? [];
  const r = resumoFase3(linhas);
  if (!f || !r.n) {
    return (
      <Cartao titulo="Fase 3 histórica" atraso={600}>
        <Aviso titulo="Fase 3 não publicada">
          Rode <span className="num">python ml/publish_metrics.py</span> (lê <span className="num">ml/artifacts/fase3_comparacao.csv</span>).
        </Aviso>
      </Cartao>
    );
  }
  const quando = linhas.map((l) => l.timestamp).filter((t): t is string => !!t).sort();
  const horas = linhas.map((l) => num(l.hora)).filter((h): h is number => h !== null);
  const dias = [...new Set(linhas.map((l) => num(l.dia_semana)).filter((d): d is number => d !== null))].sort((x, y) => x - y);
  const rotuloModelo = rotuloVersao(f.modelo.split(' ')[0]);

  return (
    <Cartao
      titulo={`Fase 3 histórica · ${rotuloModelo} × TomTom × menor distância`}
      atraso={600}
      nota={
        <>
          {fmtInt(r.n)} rodadas de {fmtDia(quando[0])} a {fmtDia(quando.at(-1))}
          {horas.length ? `, entre ${Math.min(...horas)} h e ${Math.max(...horas)} h` : ''}
          {dias.length ? ` (${dias.map((d) => DIAS_SEMANA[d] ?? d).join(', ')})` : ''}. Modelo: {f.modelo}. Referência: TomTom Routing com trânsito ao vivo. Médias por corredor;
          a linha final é o viés mediano de todas as rodadas. Fonte: <span className="num">{f.fonte}</span>.
        </>
      }
    >
      <Tabela cabecalho={['Corredor', 'Rodadas', 'TomTom', rotuloModelo, 'Menor distância']}>
        {r.corredores.map((c) => (
          <tr key={c.par}>
            <td className="font-medium">{c.par}</td>
            <td className="num">{fmtInt(c.n)}</td>
            <td className="num">{fmtMin(c.tomtom)}</td>
            <td>
              <span className="num">{fmtMin(c.lia)}</span>
              <div className="mt-1">
                <Desvio pct={desvioPct(c.lia, c.tomtom)} />
              </div>
            </td>
            <td>
              <span className="num">{fmtMin(c.menor)}</span>
              <div className="mt-1">
                <Desvio pct={desvioPct(c.menor, c.tomtom)} />
              </div>
            </td>
          </tr>
        ))}
        <tr className="font-medium">
          <td>Todas as rodadas · viés mediano</td>
          <td className="num">{fmtInt(r.n)}</td>
          <td className="text-muted-foreground">—</td>
          <td>
            <Desvio pct={r.viesLia} />
          </td>
          <td>
            <Desvio pct={r.viesMenor} />
          </td>
        </tr>
      </Tabela>
    </Cartao>
  );
}

/* ---------- 9. Metodologia e limitações ---------- */

export function Metodologia({ d, cobertura }: { d: ComparacaoProvedores | null; cobertura: CoberturaDataset | undefined }) {
  // O OSRM é o provedor sem trânsito do núcleo; se o dono ligar outro (OpenRouteService), a frase acompanha o dado.
  const outrosSemTransito = (d?.provedores ?? []).filter((p) => !p.com_transito && p.provedor !== 'osrm').map((p) => nomeProvedor(p.provedor));
  return (
    <Cartao titulo="Metodologia e limitações" atraso={640}>
      <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
        <li>A referência é a TomTom Routing com trânsito ao vivo (mesma da Fase 3), não é verdade de campo.</li>
        <li>A LIA consome leituras da TomTom Flow, então LIA e referência não são independentes.</li>
        <li>
          O OSRM não usa trânsito: o tempo é o de mapa, um limite inferior.
          {outrosSemTransito.length ? ` Também sem trânsito nesta janela: ${outrosSemTransito.join(', ')}.` : ''}
        </li>
        <li>
          Viés conhecido: a velocidade livre do OSM é mais alta que a medida pela TomTom (β ≈ 22,9 s/km em{' '}
          <span className="num">ml/artifacts/semaforos_calibracao.json</span>).
        </li>
        <li>As rotas reais ainda são só de usuários de teste.</li>
        <li>Rodadas em 8 horários por dia (03:00, 07:30, 08:30, 12:30, 15:00, 17:30, 18:30, 22:00, horário de Brasília).</li>
        {cobertura ? (
          <li>
            O dataset de treino é enviesado no tempo: {fmtInt(cobertura.n_dias_cheios)} dias cheios concentram {fmtPct(cobertura.pct_linhas_em_dias_cheios)} das{' '}
            {fmtInt(cobertura.total_linhas)} linhas, a hora {cobertura.hora_mais_coberta} h (Brasília) tem {fmtPct(cobertura.pct_hora_mais_coberta)} e o fim de
            semana tem {fmtPct(cobertura.razao_fim_de_semana_vs_dia_util * 100)} do volume de um dia útil (
            <span className="num">ml/artifacts/cobertura_dataset.json</span>).
          </li>
        ) : null}
      </ul>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        Como ler: erro = (tempo do provedor − tempo da TomTom) ÷ tempo da TomTom, por par (mesma viagem, mesma rodada). Viés mediano é a mediana desse erro com
        sinal; MAPE é a média do valor absoluto; “dentro de ±20%” é a fatia dos pares com erro absoluto até 20%. Os números das rodadas vêm da tabela
        comparacao_provedores (RPC admin_lia_vs_provedores, sem usuário, coordenada nem data); os do modelo, de lia_treinos e lia_analises, publicados por{' '}
        <span className="num">ml/publish_metrics.py</span> a partir de <span className="num">ml/artifacts</span>.
      </p>
    </Cartao>
  );
}
