/** Esqueleto de página para os loading.tsx: cabeçalho, linha de KPIs e cartões. Mesmas medidas da página real. */
export function Esqueleto({ kpis = 4, cartoes = 2, titulo }: { kpis?: number; cartoes?: number; titulo?: string }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando{titulo ? ` ${titulo}` : ''}</span>
      <div className="mb-6 border-b border-border pb-5 md:mb-8">
        <div className="skeleton h-9 w-2/3 max-w-xs" />
        <div className="skeleton mt-3 h-4 w-full max-w-lg" />
      </div>
      {kpis ? (
        <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: kpis }, (_, i) => (
            <div key={i} className="skeleton h-24" />
          ))}
        </div>
      ) : null}
      <div className="space-y-5">
        {Array.from({ length: cartoes }, (_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-5">
            <div className="skeleton mb-4 h-3 w-40" />
            <div className="skeleton h-48 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
