const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

/** Hora × dia (dia_semana 1 = segunda … 7 = domingo): um tom (azul), claro → escuro por quantidade. */
export function HeatmapCobertura({
  celulas,
  unidade = 'amostras',
}: {
  celulas: { dia_semana: number; hora: number; n: number }[];
  unidade?: string;
}) {
  const mapa = new Map(celulas.map((c) => [`${c.dia_semana}-${c.hora}`, c.n]));
  const maximo = Math.max(1, ...celulas.map((c) => c.n));
  const tom = (n: number) =>
    n === 0 ? 'hsl(var(--muted))' : `color-mix(in oklab, var(--chart-1) ${Math.round(18 + (n / maximo) * 82)}%, hsl(var(--card)))`;

  return (
    <div className="overflow-x-auto">
      <div className="inline-grid min-w-[640px] gap-[3px]" style={{ gridTemplateColumns: `36px repeat(24, minmax(18px, 1fr))` }}>
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="num text-center text-[10px] text-muted-foreground">
            {h % 3 === 0 ? h : ''}
          </span>
        ))}
        {DIAS.map((dia, i) => (
          <div key={dia} className="contents">
            <span className="text-[11px] leading-5 text-muted-foreground">{dia}</span>
            {Array.from({ length: 24 }, (_, h) => {
              const n = mapa.get(`${i + 1}-${h}`) ?? 0;
              return (
                <span
                  key={h}
                  title={`${dia} ${h}h — ${n.toLocaleString('pt-BR')} ${unidade}`}
                  className="h-5 rounded-[3px]"
                  style={{ background: tom(n) }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>menos</span>
        {[0.1, 0.35, 0.6, 0.85, 1].map((f) => (
          <span key={f} className="h-3 w-6 rounded-[2px]" style={{ background: tom(f * maximo) }} />
        ))}
        <span>
          mais {unidade} (máx. {maximo.toLocaleString('pt-BR')})
        </span>
      </div>
    </div>
  );
}
