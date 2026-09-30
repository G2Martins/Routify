import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/** Cliente do servidor (Server Components): sessão vem dos cookies. */
export async function clienteServidor() {
  const loja = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
    {
      cookies: {
        getAll: () => loja.getAll(),
        setAll(lista) {
          try {
            lista.forEach(({ name, value, options }) => loja.set(name, value, options));
          } catch {
            // Server Component não grava cookie; o proxy.ts renova a sessão.
          }
        },
      },
    },
  );
}
