'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { APP_URL } from '@/lib/app-url';
import { clienteNavegador } from '@/lib/supabase-navegador';

const ITENS = [
  { href: '/admin', rotulo: 'Visão geral', sigla: '01' },
  { href: '/admin/status', rotulo: 'Status ao vivo', sigla: '02' },
  { href: '/admin/lia', rotulo: 'LIA: benchmarks', sigla: '03' },
  { href: '/admin/provedores', rotulo: 'LIA × provedores', sigla: '04' },
  { href: '/admin/arquitetura', rotulo: 'Arquitetura viva', sigla: '05' },
  { href: '/admin/uso', rotulo: 'Uso da plataforma', sigla: '06' },
  { href: '/admin/qualidade', rotulo: 'Qualidade dos dados', sigla: '07' },
  { href: '/admin/usuarios', rotulo: 'Usuários', sigla: '08' },
  { href: '/admin/operacao', rotulo: 'Operação', sigla: '09' },
  { href: '/admin/auditoria', rotulo: 'Auditoria', sigla: '10' },
];

export async function sairParaApp() {
  await clienteNavegador().auth.signOut();
  window.location.assign(APP_URL);
}

/** Dentro do <Link>: gira enquanto a página clicada carrega. */
function Pendente() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={`ml-auto size-3.5 shrink-0 rounded-full border-2 border-accent border-t-transparent transition-opacity duration-150 ${
        pending ? 'giro opacity-100' : 'opacity-0'
      }`}
    />
  );
}

function Marca() {
  return (
    <div>
      <p className="font-display text-3xl leading-none">
        <span className="texto-marca">Routify</span>
      </p>
      <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">painel de operação</p>
    </div>
  );
}

function Itens({ email }: { email: string }) {
  const rota = usePathname();
  return (
    <>
      <nav className="flex flex-col gap-1 overflow-y-auto" aria-label="Seções do painel">
        {ITENS.map((item) => {
          const ativo = item.href === '/admin' ? rota === '/admin' : rota.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={ativo ? 'page' : undefined}
              className={`relative flex min-h-11 shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-200 ease-out pointer-fine:min-h-9 ${
                ativo ? 'bg-accent/10 font-medium text-accent' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {ativo ? <span className="absolute inset-y-1.5 left-0 w-0.75 rounded-full bg-accent" /> : null}
              <span className={`num text-[10px] ${ativo ? 'opacity-80' : 'opacity-50'}`}>{item.sigla}</span>
              {item.rotulo}
              <Pendente />
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto space-y-3 px-2 pt-8">
        <a
          href={APP_URL}
          className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground shadow-card transition-colors duration-200 ease-out hover:border-accent hover:text-accent pointer-fine:min-h-0"
        >
          ← Voltar ao app
        </a>
        <p className="truncate text-xs text-muted-foreground" title={email}>
          {email}
        </p>
        <button
          type="button"
          onClick={sairParaApp}
          className="min-h-11 text-xs font-medium text-foreground underline-offset-4 hover:underline pointer-fine:min-h-0"
        >
          Sair
        </button>
      </div>
    </>
  );
}

export function Sidebar({ email }: { email: string }) {
  const rota = usePathname();
  const [aberto, setAberto] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);

  // Troca de página fecha a gaveta; Esc também. Com a gaveta aberta, a página atrás não rola.
  useEffect(() => setAberto(false), [rota]);
  useEffect(() => {
    if (!aberto) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAberto(false);
        botao.current?.focus();
      }
    };
    document.addEventListener('keydown', esc);
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = antes;
    };
  }, [aberto]);

  return (
    <>
      {/* Celular e tablet em pé: barra fixa no topo + gaveta */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-card/90 px-4 py-2 backdrop-blur md:hidden">
        <p className="font-display text-2xl leading-none">
          <span className="texto-marca">Routify</span>
        </p>
        <button
          ref={botao}
          type="button"
          onClick={() => setAberto(true)}
          aria-expanded={aberto}
          aria-controls="gaveta"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium"
        >
          <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M2 4h12M2 8h12M2 12h12" />
          </svg>
          Menu
        </button>
      </div>
      <div
        className={`fixed inset-0 z-40 bg-foreground/40 transition-opacity duration-200 md:hidden ${aberto ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={() => setAberto(false)}
        aria-hidden
      />
      <aside
        id="gaveta"
        aria-label="Navegação do painel"
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-card px-4 py-6 transition-transform duration-200 ease-out md:sticky md:top-0 md:z-10 md:h-dvh md:w-64 md:max-w-none md:shrink-0 md:translate-x-0 md:bg-card/80 md:backdrop-blur ${
          aberto ? 'translate-x-0' : '-translate-x-full max-md:invisible'
        }`}
      >
        <div className="mb-6 flex items-start justify-between px-2 md:mb-8">
          <div>
            <Marca />
            <div className="faixa-marca mt-4 h-0.75 w-12 rounded-full" />
          </div>
          <button
            type="button"
            onClick={() => setAberto(false)}
            aria-label="Fechar menu"
            className="-mr-2 -mt-2 inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted md:hidden"
          >
            <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>
        <Itens email={email} />
      </aside>
    </>
  );
}
