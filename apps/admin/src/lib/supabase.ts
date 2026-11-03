import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { OPCOES_COOKIE } from './cookie';

/** Cliente do servidor (Server Components): sessão vem dos cookies. */
export async function clienteServidor() {
  const loja = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
    {
      cookieOptions: OPCOES_COOKIE,
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
