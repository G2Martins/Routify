'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clienteNavegador } from '@/lib/supabase-navegador';

const ITENS = [
  { href: '/', rotulo: 'Visão geral', sigla: '01' },
  { href: '/lia', rotulo: 'LIA · benchmarks', sigla: '02' },
  { href: '/arquitetura', rotulo: 'Arquitetura viva', sigla: '03' },
  { href: '/uso', rotulo: 'Uso da plataforma', sigla: '04' },
  { href: '/qualidade', rotulo: 'Qualidade dos dados', sigla: '05' },
  { href: '/usuarios', rotulo: 'Usuários', sigla: '06' },
];

export function Sidebar({ email }: { email: string }) {
  const rota = usePathname();
  const router = useRouter();

  const sair = async () => {
    await clienteNavegador().auth.signOut();
    router.replace('/login');
    router.refresh();
  };

  return (
    <aside className="flex flex-col border-b border-border bg-card/70 px-5 py-6 backdrop-blur md:sticky md:top-0 md:h-dvh md:w-64 md:shrink-0 md:border-b-0 md:border-r">
      <div className="mb-8">
        <p className="font-display text-3xl leading-none">Routify</p>
        <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">painel de operação</p>
      </div>
      <nav className="flex gap-1 overflow-x-auto md:flex-col" aria-label="Seções do painel">
        {ITENS.map((item) => {
          const ativo = item.href === '/' ? rota === '/' : rota.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={ativo ? 'page' : undefined}
              className={`group flex shrink-0 items-baseline gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                ativo ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <span className={`num text-[10px] ${ativo ? 'opacity-70' : 'opacity-50'}`}>{item.sigla}</span>
              {item.rotulo}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto hidden pt-8 md:block">
        <p className="truncate text-xs text-muted-foreground" title={email}>
          {email}
        </p>
        <button
          type="button"
          onClick={sair}
          className="mt-2 text-xs font-medium text-foreground underline-offset-4 hover:underline"
        >
          Sair
        </button>
      </div>
    </aside>
  );
}
