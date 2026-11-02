-- Verificação em duas etapas (TOTP do Supabase Auth): o banco exige aal2 de quem ativou o 2º fator.
--
-- aal_ok(): a sessão já passou pelo código (aal2) OU o usuário não tem fator verificado. Quem não ativou
-- o MFA nunca é barrado; quem ativou e entrou só com a senha (aal1) fica de fora até confirmar o código.
-- Vale no is_admin() (todas as RPCs e policies do painel) e no histórico de rotas (dado de localização).
-- O app mostra a etapa 2 (MfaVerificarScreen); a API repete a regra em seguranca.exigir_admin.
-- O Valerium só barrava na navegação do Next: aqui a regra mora no banco.

create or replace function public.aal_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = auth.uid() and f.status = 'verified'
      )
$$;

revoke execute on function public.aal_ok() from public, anon;
grant execute on function public.aal_ok() to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false) and public.aal_ok()
$$;

-- (select ...) avalia uma vez por consulta, não por linha.
alter policy "Users read own routes" on public.route_history
  using (auth.uid() = user_id and (select public.aal_ok()));
alter policy "Users insert own routes" on public.route_history
  with check (auth.uid() = user_id and (select public.aal_ok()));
alter policy "Users delete own routes" on public.route_history
  using (auth.uid() = user_id and (select public.aal_ok()));
alter policy "Users update own routes" on public.route_history
  using (auth.uid() = user_id and (select public.aal_ok()))
  with check (auth.uid() = user_id and (select public.aal_ok()));
