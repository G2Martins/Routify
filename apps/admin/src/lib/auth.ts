import { redirect } from 'next/navigation';
import { APP_URL } from './app-url';
import { clienteServidor } from './supabase';

/**
 * Exige usuário logado com papel admin (app_metadata.role, que só o service_role
 * grava). É só UX: o banco recusa (RLS/RPC) quem não é admin de qualquer forma.
 * getUser() valida o token no Auth — getSession() só leria o cookie.
 * O login é único e mora no app: sem sessão, volta para ele.
 */
export async function exigirAdmin() {
  const sb = await clienteServidor();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect(APP_URL);
  if (user.app_metadata?.role !== 'admin') redirect('/admin/sem-acesso');
  return { sb, user };
}
