import { notFound } from 'next/navigation';
import { podeVerPainel } from './acesso';
import { clienteServidor } from './supabase';

/**
 * Exige quem pode ver o painel (lib/acesso.ts); senão, o 404 padrão, igual a um endereço que não existe. O proxy já
 * barrou antes; isto é a segunda camada. getUser() valida o token no Auth — getSession() só leria o cookie.
 */
export async function exigirAdmin() {
  const sb = await clienteServidor();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user || !(await podeVerPainel(sb, user))) notFound();
  return { sb, user };
}

/** Mesma regra, sem trocar de página: para as rotas de API do painel (respondem 404). */
export async function souAdmin(): Promise<boolean> {
  const sb = await clienteServidor();
  const {
    data: { user },
  } = await sb.auth.getUser();
  return podeVerPainel(sb, user);
}
