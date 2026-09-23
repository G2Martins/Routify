'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { clienteNavegador } from '@/lib/supabase-navegador';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    const { error } = await clienteNavegador().auth.signInWithPassword({ email: email.trim(), password: senha });
    setEnviando(false);
    if (error) {
      setErro(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : 'Não foi possível entrar agora. Tente de novo.');
      return;
    }
    router.replace('/');
    router.refresh();
  };

  return (
    <main className="fundo-mapa grid min-h-dvh place-items-center px-4">
      <form onSubmit={entrar} className="surgir w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-sm">
        <p className="font-display text-5xl leading-none">Routify</p>
        <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">painel de operação · acesso restrito</p>

        <label className="mt-8 block text-xs font-medium text-muted-foreground" htmlFor="email">
          E-mail
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        <label className="mt-4 block text-xs font-medium text-muted-foreground" htmlFor="senha">
          Senha
        </label>
        <input
          id="senha"
          type="password"
          autoComplete="current-password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        {erro ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {erro}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={enviando}
          className="mt-6 w-full rounded-md bg-foreground px-3 py-2.5 text-sm font-medium text-background transition-opacity disabled:opacity-60"
        >
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          Mesma conta do app Routify. Só contas com papel de administrador veem os dados.
        </p>
      </form>
    </main>
  );
}
