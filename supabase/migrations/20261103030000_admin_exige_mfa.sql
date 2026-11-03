-- ATENÇÃO: aplicar SÓ DEPOIS que cada conta que continua admin tiver o 2º fator ativo (app → Perfil → Segurança)
-- e códigos de recuperação gerados. Antes disso, tranca todo admin fora do painel e das RPCs admin_*.
-- Auditoria de 2026-11-03 (A2): as 5 contas eram admin e nenhuma tinha 2º fator; uma senha vazada dava acesso total,
-- inclusive à exportação do histórico de localização de qualquer pessoa. Ordem: rebaixar quem não precisa ser admin
-- → cada admin ativa o TOTP e gera os códigos → aplicar isto + ADMIN_EXIGE_MFA=1 na API.
-- Depende de 20261103020000 (is_admin lendo auth.users ao vivo).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (u.raw_app_meta_data ->> 'role') = 'admin'
                          and (u.banned_until is null or u.banned_until <= now())
                   from auth.users u where u.id = auth.uid()), false)
         and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;
