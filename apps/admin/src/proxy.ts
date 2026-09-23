import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { APP_URL } from './lib/app-url';

/**
 * Renova a sessão Supabase (cookie compartilhado com o app) a cada requisição do
 * painel. Sem sessão, manda para o login do app — sem parâmetro de retorno, para
 * não abrir redirecionamento arbitrário.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(lista, headers) {
          lista.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          lista.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          // Resposta com cookie de sessão não pode ir para cache compartilhado.
          Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    },
  );

  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) return NextResponse.redirect(new URL(APP_URL, request.url));
  return response;
}

export const config = {
  matcher: ['/admin/:path*'],
};
