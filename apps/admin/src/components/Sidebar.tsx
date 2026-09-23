'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { APP_URL } from '@/lib/app-url';
import { clienteNavegador } from '@/lib/supabase-navegador';

const ITENS = [
  { href: '/admin', rotulo: 'Visão geral', sigla: '01' },
  { href: '/admin/lia', rotulo: 'LIA · benchmarks', sigla: '02' },
  { href: '/admin/arquitetura', rotulo: 'Arquitetura viva', sigla: '03' },
  { href: '/admin/uso', rotulo: 'Uso da plataforma', sigla: '04' },
  { href: '/admin/qualidade', rotulo: 'Qualidade dos dados', sigla: '05' },
  { href: '/admin/usuarios', rotulo: 'Usuários', sigla: '06' },
  { href: '/admin/operacao', rotulo: 'Operação', sigla: '07' },
  { href: '/admin/auditoria', rotulo: 'Auditoria', sigla: '08' },
];

export async function sairParaApp() {
  await clienteNavegador().auth.signOut();
  window.location.assign(APP_URL);
}

export function Sidebar({ email }: { email: string }) {
  const rota = usePathname();

  return (
    <aside className="relative z-10 flex flex-col border-b border-border bg-card/80 px-4 py-6 backdrop-blur md:sticky md:top-0 md:h-dvh md:w-64 md:shrink-0 md:border-b-0 md:border-r">
      <div className="mb-8 px-2">
        <p className="font-display text-3xl leading-none">
          <span className="texto-marca">Routify</span>
        </p>
        <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">painel de operação</p>
        <div className="faixa-marca mt-4 h-0.75 w-12 rounded-full" />
      </div>
      <nav className="flex gap-1 overflow-x-auto md:flex-col" aria-label="Seções do painel">
        {ITENS.map((item) => {
          const ativo = item.href === '/admin' ? rota === '/admin' : rota.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={ativo ? 'page' : undefined}
              className={`relative flex shrink-0 items-baseline gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200 ease-out ${
                ativo
                  ? 'bg-accent/10 font-medium text-accent'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {ativo ? <span className="absolute inset-y-1.5 left-0 hidden w-0.75 rounded-full bg-accent md:block" /> : null}
              <span className={`num text-[10px] ${ativo ? 'opacity-80' : 'opacity-50'}`}>{item.sigla}</span>
              {item.rotulo}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto hidden space-y-3 px-2 pt-8 md:block">
        <a
          href={APP_URL}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground shadow-card transition-all duration-200 ease-out hover:border-accent hover:text-accent"
        >
          ← Voltar ao app
        </a>
        <p className="truncate text-xs text-muted-foreground" title={email}>
          {email}
        </p>
        <button
          type="button"
          onClick={sairParaApp}
          className="text-xs font-medium text-foreground underline-offset-4 hover:underline"
        >
          Sair
        </button>
      </div>
    </aside>
  );
}
