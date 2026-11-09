import Link from 'next/link';
import type { ReactNode } from 'react';
import { MIGRACAO_ACOES, faltaMigracao } from '@/lib/erros';
import { GLOSSARIO } from '@/lib/glossario';

export function Cabecalho({ titulo, sobre, direita }: { titulo: string; sobre?: ReactNode; direita?: ReactNode }) {
  return (
    <header className="surgir mb-6 flex md:mb-8 flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
      <div>
        <h1 className="font-display text-3xl leading-none tracking-tight sm:text-4xl">{titulo}</h1>
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
  leitura,
  siglas,
}: {
  titulo?: string;
  nota?: ReactNode;
  /** Frases geradas a partir do dado: o que o gráfico quer dizer. */
  leitura?: string[];
  /** Termos do glossário a legendar junto do gráfico. */
  siglas?: string[];
  children: ReactNode;
  className?: string;
  atraso?: number;
}) {
  return (
    <section
      className={`surgir min-w-0 rounded-lg border border-border bg-card p-4 sm:p-5 ${className}`}
      style={{ animationDelay: `${atraso}ms` }}
    >
      {titulo ? (
        <h2 className="mb-4 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{titulo}</h2>
      ) : null}
      {children}
      <Leitura frases={leitura} />
      {nota ? <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{nota}</p> : null}
      <Siglas termos={siglas} />
    </section>
  );
}

/** "O que isso quer dizer": texto gerado do dado, nunca digitado. */
export function Leitura({ frases }: { frases?: string[] }) {
  if (!frases?.length) return null;
  return (
    <div className="mt-4 rounded-md border-l-2 border-accent bg-accent/5 px-3 py-2 text-sm leading-relaxed">
      <p className="mb-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-accent">O que isso quer dizer</p>
      <p>{frases.join(' ')}</p>
    </div>
  );
}

/** Legenda de siglas, sempre visível junto do gráfico. */
export function Siglas({ termos }: { termos?: string[] }) {
  const lista = (termos ?? []).filter((t) => GLOSSARIO[t]);
  if (!lista.length) return null;
  return (
    <dl className="mt-4 grid gap-x-6 gap-y-1.5 border-t border-border/60 pt-3 text-xs leading-snug text-muted-foreground sm:grid-cols-2">
      {lista.map((t) => (
        <div key={t}>
          <dt className="inline font-medium text-foreground">{t}: </dt>
          <dd className="inline">{GLOSSARIO[t]}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Kpi({ rotulo, valor, detalhe, atraso = 0 }: { rotulo: string; valor: ReactNode; detalhe?: ReactNode; atraso?: number }) {
  return (
    <div className="surgir min-w-0 rounded-lg border border-border bg-card px-4 py-4 sm:px-5" style={{ animationDelay: `${atraso}ms` }}>
      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{rotulo}</p>
      <p className="num mt-2 text-2xl font-medium leading-none sm:text-3xl">{valor}</p>
      {detalhe ? <p className="mt-2 text-xs text-muted-foreground">{detalhe}</p> : null}
    </div>
  );
}

/** Número menor, sem animação: para blocos dentro de um Cartao. */
export function Mini({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{rotulo}</p>
      <p className="num mt-1 text-2xl font-medium leading-none">{valor}</p>
      {detalhe ? <p className="mt-1.5 text-[11px] text-muted-foreground">{detalhe}</p> : null}
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

/** Status sempre com texto, nunca só cor. */
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

/** Mensagem amigável para erro de RPC/consulta (42501 = não é admin).
 *  `acoes`: a consulta depende da migration das ações do ADM.
 *  `migracao`: nome do arquivo de outra migration de que a consulta depende. */
export function ErroConsulta({
  erro,
  acoes = false,
  migracao,
}: {
  erro: { code?: string; message?: string } | null;
  acoes?: boolean;
  migracao?: string;
}) {
  if (!erro) return null;
  const semAcesso = erro.code === '42501';
  const pendente = migracao ?? (acoes ? MIGRACAO_ACOES : undefined);
  if (pendente && faltaMigracao(erro)) {
    return (
      <Aviso titulo="Migration pendente">
        Aplique a migration <span className="num">{pendente}</span> (ver docs/core/rodar-local.md).
      </Aviso>
    );
  }
  return (
    <Aviso titulo={semAcesso ? 'Acesso negado pelo banco' : 'Não foi possível carregar os dados'}>
      {semAcesso
        ? 'Sua sessão não tem o papel admin no JWT. Saia e entre de novo depois da promoção.'
        : 'Confira se as migrations de captura de uso foram aplicadas no Supabase.'}
    </Aviso>
  );
}

/* Botões (raio 8, pressão 0,98, hover 160 ms). */
const BTN =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-1.5 pointer-fine:min-h-0 text-sm font-medium transition-all duration-150 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50';
export const BTN_PRIMARIO = `${BTN} bg-accent text-white shadow-cta hover:brightness-110`;
export const BTN_SECUNDARIO = `${BTN} border border-border bg-card text-foreground shadow-card hover:border-border-strong hover:shadow-card-hover`;
export const BTN_PERIGO = `${BTN} bg-destructive text-white hover:brightness-110`;
export const CAMPO =
  'min-h-11 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm pointer-fine:min-h-0 text-foreground transition-colors duration-150 placeholder:text-muted-foreground focus:border-accent focus:outline-none';

/** Seletor de janela 7/30/90 dias por link (Server Component). */
export function SeletorJanela({ base, atual, janelas = [7, 30, 90] }: { base: string; atual: number; janelas?: number[] }) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1 text-xs">
      {janelas.map((j) => (
        <Link
          key={j}
          href={`${base}?dias=${j}`}
          aria-current={j === atual ? 'page' : undefined}
          className={`inline-flex min-h-11 items-center rounded-full px-3 py-1 pointer-fine:min-h-0 ${j === atual ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {j} dias
        </Link>
      ))}
    </div>
  );
}

export function Tabela({ cabecalho, children }: { cabecalho: string[]; children: ReactNode }) {
  return (
    <div className="max-w-full overflow-x-auto overscroll-x-contain">
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
