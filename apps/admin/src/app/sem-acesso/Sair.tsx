'use client';

import { useRouter } from 'next/navigation';
import { clienteNavegador } from '@/lib/supabase-navegador';

export function Sair() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await clienteNavegador().auth.signOut();
        router.replace('/login');
        router.refresh();
      }}
      className="mt-6 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
    >
      Sair e entrar com outra conta
    </button>
  );
}
