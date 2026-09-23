import { redirect } from 'next/navigation';
import { clienteServidor } from './supabase';

/**
 * Exige usuário logado com papel admin (app_metadata.role, que só o service_role
 * grava). É só UX: o banco recusa (RLS/RPC) quem não é admin de qualquer forma.
 * getUser() valida o token no Auth — getSession() só leria o cookie.
 */
export async function exigirAdmin() {
  const sb = await clienteServidor();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect('/login');
  if (user.app_metadata?.role !== 'admin') redirect('/sem-acesso');
  return { sb, user };
}
