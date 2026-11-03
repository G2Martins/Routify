import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * Quem pode ver o painel: papel admin (app_metadata.role, que só o service_role grava) com a etapa 2 do login
 * concluída se tiver 2º fator; com ADMIN_EXIGE_MFA=1, admin sem 2º fator também fica de fora (junto com a migration
 * 20261103030000). Usado pelo proxy e pelo layout: quem não passa recebe o mesmo 404 de um endereço que não existe.
 * É só a porta; o banco (is_admin/aal_ok) e a API (exigir_admin) recusam de qualquer jeito.
 */
export async function podeVerPainel(sb: SupabaseClient, user: User | null): Promise<boolean> {
  if (!user || user.app_metadata?.role !== 'admin') return false;
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') return false;
  if (process.env.ADMIN_EXIGE_MFA === '1' && aal?.currentLevel !== 'aal2') return false;
  return true;
}
