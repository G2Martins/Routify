import type { ReactNode } from 'react';

export function Cabecalho({ titulo, sobre, direita }: { titulo: string; sobre?: ReactNode; direita?: ReactNode }) {
  return (
    <header className="surgir mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
      <div>
        <h1 className="font-display text-4xl leading-none tracking-tight">{titulo}</h1>
        {sobre ? <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{sobre}</p> : null}
      </div>
      {direita}
    </header>
  );
}

export function Cartao({
  titulo,
  nota,
  children,
  className = '',
  atraso = 0,
}: {
  titulo?: string;
  nota?: ReactNode;
  children: ReactNode;
  className?: string;
  atraso?: number;
}) {
  return (
    <section
      className={`surgir rounded-lg border border-border bg-card p-5 ${className}`}
      style={{ animationDelay: `${atraso}ms` }}
    >
      {titulo ? (
        <h2 className="mb-4 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{titulo}</h2>
      ) : null}
      {children}
      {nota ? <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{nota}</p> : null}
    </section>
  );
}

export function Kpi({ rotulo, valor, detalhe, atraso = 0 }: { rotulo: string; valor: ReactNode; detalhe?: ReactNode; atraso?: number }) {
  return (
    <div className="surgir rounded-lg border border-border bg-card px-5 py-4" style={{ animationDelay: `${atraso}ms` }}>
      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{rotulo}</p>
      <p className="num mt-2 text-3xl font-medium leading-none">{valor}</p>
      {detalhe ? <p className="mt-2 text-xs text-muted-foreground">{detalhe}</p> : null}
    </div>
  );
}

type Tom = 'ok' | 'alerta' | 'erro' | 'neutro';

const TOM: Record<Tom, string> = {
  ok: 'text-ok border-ok/40',
  alerta: 'text-alerta border-alerta/40',
  erro: 'text-destructive border-destructive/40',
  neutro: 'text-muted-foreground border-border',
};

/** Status sempre com texto — nunca só cor. */
export function Selo({ tom, children }: { tom: Tom; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TOM[tom]}`}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function Aviso({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/40 px-5 py-6 text-sm">
      <p className="font-medium">{titulo}</p>
      {children ? <div className="mt-1 text-muted-foreground">{children}</div> : null}
    </div>
  );
}

/** Mensagem amigável para erro de RPC/consulta (42501 = não é admin). */
export function ErroConsulta({ erro }: { erro: { code?: string; message?: string } | null }) {
  if (!erro) return null;
  const semAcesso = erro.code === '42501';
  return (
    <Aviso titulo={semAcesso ? 'Acesso negado pelo banco' : 'Não foi possível carregar os dados'}>
      {semAcesso
        ? 'Sua sessão não tem o papel admin no JWT. Saia e entre de novo depois da promoção.'
        : 'Confira se as migrations de captura de uso foram aplicadas no Supabase.'}
    </Aviso>
  );
}

export function Tabela({ cabecalho, children }: { cabecalho: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-[0.1em] text-muted-foreground">
            {cabecalho.map((c) => (
              <th key={c} className="px-3 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:px-3 [&_td]:py-2 [&_tr]:border-b [&_tr]:border-border/60">{children}</tbody>
      </table>
    </div>
  );
}
