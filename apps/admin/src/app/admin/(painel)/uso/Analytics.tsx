import { HeatmapCobertura } from '@/components/Heatmap';
import { Aviso, Cartao } from '@/components/ui';
import { fmtDec, fmtDuracao, fmtInt, fmtPct, num } from '@/lib/formato';
import type { AnalyticsUso } from '@/lib/tipos';

const ETAPAS = [
  { tipo: 'busca', rotulo: 'Busca selecionada' },
  { tipo: 'rota_solicitada', rotulo: 'Rota solicitada' },
  { tipo: 'navegacao_iniciada', rotulo: 'Navegação iniciada' },
  { tipo: 'navegacao_concluida', rotulo: 'Navegação concluída' },
];
const FONTES: Record<string, { rotulo: string; cor: string }> = {
  malha: { rotulo: 'Malha local', cor: 'var(--chart-1)' },
  tomtom: { rotulo: 'TomTom Search', cor: 'var(--chart-2)' },
  nominatim: { rotulo: 'Nominatim', cor: 'var(--chart-3)' },
  recente: { rotulo: 'Recentes', cor: 'var(--chart-neutro)' },
};
const PLATAFORMA: Record<string, string> = { web: 'Web', ios: 'iOS', android: 'Android', desconhecida: 'Desconhecida' };

const pct = (parte: number, total: number) => (total ? (parte / total) * 100 : null);
const comSinal = (seg: number | null) => (seg === null ? '—' : `${seg < 0 ? '−' : ''}${fmtDuracao(Math.abs(seg))}`);

function Mini({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{rotulo}</p>
      <p className="num mt-1 text-2xl font-medium leading-none">{valor}</p>
      {detalhe ? <p className="mt-1.5 text-[11px] text-muted-foreground">{detalhe}</p> : null}
    </div>
  );
}

function Funil({ a }: { a: AnalyticsUso }) {
  const escolhidas = Object.values(a.busca_por_fonte).reduce((s, n) => s + n, 0);
  const etapas = ETAPAS.map((e) => ({
    ...e,
    eventos: e.tipo === 'busca' ? escolhidas : (a.funil[e.tipo]?.eventos ?? 0),
    usuarios: a.funil[e.tipo]?.usuarios ?? 0,
  }));
  const maximo = Math.max(1, ...etapas.map((e) => e.eventos));
  return (
    <ol className="space-y-3">
      {etapas.map((e, i) => {
        const anterior = etapas[i - 1];
        return (
          <li key={e.tipo}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span>{e.rotulo}</span>
              <span className="num text-xs text-muted-foreground">
                {fmtInt(e.eventos)} eventos · {fmtInt(e.usuarios)} usuários
                {anterior ? (
                  <span className="ml-2 font-medium text-foreground">{anterior.eventos ? fmtPct(pct(e.eventos, anterior.eventos)) : '—'}</span>
                ) : null}
              </span>
            </div>
            <div className="mt-1 h-2.5 rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out-expo"
                style={{ width: `${Math.max(e.eventos ? 2 : 0, (e.eventos / maximo) * 100)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Busca({ a }: { a: AnalyticsUso }) {
  const fontes = Object.entries(a.busca_por_fonte).sort((x, y) => y[1] - x[1]);
  const escolhidas = fontes.reduce((s, [, n]) => s + n, 0);
  const posicao = num(a.busca_posicao_media);
  return (
    <div className="space-y-4">
      {escolhidas ? (
        <>
          <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label="Mistura de fontes da busca">
            {fontes.map(([f, n]) => (
              <span key={f} style={{ width: `${(n / escolhidas) * 100}%`, background: (FONTES[f] ?? FONTES.recente).cor }} />
            ))}
          </div>
          <ul className="space-y-1.5 text-sm">
            {fontes.map(([f, n]) => (
              <li key={f} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: (FONTES[f] ?? FONTES.recente).cor }} />
                  {FONTES[f]?.rotulo ?? f}
                </span>
                <span className="num text-xs">
                  {fmtInt(n)} · {fmtPct(pct(n, escolhidas))}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma sugestão escolhida na janela.</p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Mini
          rotulo="Sem resultado"
          valor={fmtPct(pct(a.busca_sem_resultado, a.busca_sem_resultado + escolhidas))}
          detalhe={`${fmtInt(a.busca_sem_resultado)} buscas vazias`}
        />
        <Mini rotulo="Posição média" valor={posicao === null ? '—' : `${fmtDec(posicao + 1)}ª`} detalhe="da sugestão escolhida" />
      </div>
      {Object.keys(a.plataformas).length ? (
        <p className="text-xs text-muted-foreground">
          Usuários por plataforma:{' '}
          {Object.entries(a.plataformas)
            .map(([p, n]) => `${PLATAFORMA[p] ?? p} ${fmtInt(n)}`)
            .join(' · ')}
        </p>
      ) : null}
    </div>
  );
}

/** Grade k-anônima como dispersão em CSS (sem tiles externos). */
function Calor({ celulas }: { celulas: { lat: number; lon: number; n: number }[] }) {
  const lats = celulas.map((c) => c.lat);
  const lons = celulas.map((c) => c.lon);
  const [minLat, maxLat] = [Math.min(...lats) - 0.01, Math.max(...lats) + 0.01];
  const [minLon, maxLon] = [Math.min(...lons) - 0.01, Math.max(...lons) + 0.01];
  const maximo = Math.max(...celulas.map((c) => c.n));
  // Proporção real do recorte (1° de longitude ≈ cos(lat) × 1° de latitude).
  const proporcao = ((maxLon - minLon) * Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)) / (maxLat - minLat);
  return (
    <div
      role="img"
      aria-label={`${celulas.length} células de origem ou destino; a mais movimentada tem ${maximo} pontas de rota`}
      className="fundo-mapa relative mx-auto max-h-80 w-full overflow-hidden rounded-lg border border-border bg-muted/30"
      style={{ aspectRatio: String(Math.min(2.5, Math.max(0.6, proporcao))) }}
    >
      {celulas.map((c) => {
        const f = c.n / maximo;
        const tam = 8 + 22 * Math.sqrt(f);
        return (
          <span
            key={`${c.lat},${c.lon}`}
            title={`${c.lat.toFixed(2)}, ${c.lon.toFixed(2)} — ${c.n} pontas de rota`}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${((c.lon - minLon) / (maxLon - minLon)) * 100}%`,
              top: `${((maxLat - c.lat) / (maxLat - minLat)) * 100}%`,
              width: tam,
              height: tam,
              background: `color-mix(in oklab, var(--chart-1) ${Math.round(30 + 60 * f)}%, transparent)`,
            }}
          />
        );
      })}
    </div>
  );
}

export function Analytics({ a }: { a: AnalyticsUso }) {
  const l = a.lia_vs_curta;
  const ganho = num(l.ganho_medio_seg);
  const celulas = a.calor.map((c) => ({ lat: Number(c.lat), lon: Number(c.lon), n: c.n })).filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon));
  const semDados = !l.rotas && !Object.keys(a.funil).length;

  if (semDados) {
    return (
      <Aviso titulo={`Nada registrado nos últimos ${a.janela_dias} dias`}>
        Os agregados aparecem quando o app buscar endereços e pedir rotas com login.
      </Aviso>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Cartao
          titulo="Funil de uso"
          atraso={40}
          nota="Eventos do app com login. % = conversão sobre a etapa anterior. Cada rota usa até 2 buscas (origem e destino)."
        >
          <Funil a={a} />
        </Cartao>
        <Cartao titulo="Busca de endereços" atraso={80} nota="Só fonte, posição e contagens — o texto digitado nunca é gravado.">
          <Busca a={a} />
        </Cartao>
      </div>

      <Cartao titulo="LIA × menor distância" atraso={120} nota="Comparação feita pela API em cada rota calculada (previsão da LIA nos dois caminhos).">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Mini rotulo="Rotas diferentes" valor={fmtPct(pct(l.diferentes, l.rotas))} detalhe={`${fmtInt(l.diferentes)} de ${fmtInt(l.rotas)} rotas`} />
          <Mini rotulo="Ganho médio" valor={comSinal(ganho)} detalhe="quando a LIA muda o caminho" />
          <Mini rotulo="Cobertura LIA" valor={fmtPct(l.cobertura_media_pct)} detalhe="média do trajeto" />
          <Mini rotulo="Só LIA (degradadas)" valor={fmtPct(pct(l.degradadas, l.rotas))} detalhe={`${fmtInt(l.degradadas)} rotas sem TomTom`} />
          <Mini rotulo="Com incidente" valor={fmtPct(pct(l.com_incidente, l.rotas))} detalhe={`${fmtInt(l.com_incidente)} rotas`} />
        </div>
      </Cartao>

      <Cartao titulo="Rotas por hora × dia da semana" atraso={160} nota="Hora de partida no horário de Brasília.">
        <HeatmapCobertura celulas={a.hora_dia.map((c) => ({ dia_semana: c.dia + 1, hora: c.hora, n: c.n }))} unidade="rotas" />
      </Cartao>

      <Cartao
        titulo="Onde as rotas começam e terminam"
        atraso={200}
        nota="LGPD: grade de ~1,1 km (coordenadas em 2 casas) e só células com 3 ou mais usuários distintos (k-anonimato). Nenhuma trilha individual."
      >
        {celulas.length ? (
          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <Calor celulas={celulas} />
            <ol className="space-y-1.5 text-sm">
              {[...celulas]
                .sort((x, y) => y.n - x.n)
                .slice(0, 8)
                .map((c) => (
                  <li key={`${c.lat},${c.lon}`} className="flex justify-between border-b border-border/60 pb-1.5">
                    <span className="num text-xs">
                      {c.lat.toFixed(2)}, {c.lon.toFixed(2)}
                    </span>
                    <span className="num">{fmtInt(c.n)}</span>
                  </li>
                ))}
            </ol>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhuma célula atinge 3 usuários distintos nesta janela — o mapa fica vazio de propósito.
          </p>
        )}
      </Cartao>
    </div>
  );
}
