import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { podeVerPainel } from './lib/acesso';

/**
 * Renova a sessão Supabase (cookie compartilhado com o app) a cada requisição do painel. Quem não pode ver o
 * painel (sem sessão, sem papel admin, etapa 2 pendente) recebe o MESMO 404 de qualquer endereço que não existe: o
 * painel não se anuncia (auditoria de 2026-11-03). O login é no app; o botão "Painel ADM" de quem é admin traz aqui.
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

  if (!(await podeVerPainel(sb, user))) {
    return NextResponse.rewrite(new URL('/_routify-nao-existe', request.url), { status: 404 });
  }
  return response;
}

export const config = {
  matcher: ['/admin/:path*'],
};
