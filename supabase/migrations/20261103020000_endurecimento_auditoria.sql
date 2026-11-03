-- Endurecimento da auditoria de segurança de 2026-11-03 (.planning/research/2026-11-03-auditoria-seguranca.md).
-- Só fecha portas: nenhum fluxo do app, da API, do coletor ou do painel usa o que sai daqui.

-- 1. Privilégios que nenhum papel da API usa. TRUNCATE passa por cima do RLS; TRIGGER e REFERENCES não servem ao
--    PostgREST. anon não lê nem grava histórico ou perfil (o app exige login). (Auditoria: B, extras de grant.)
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
revoke all on table public.route_history, public.profiles from anon;
alter default privileges for role postgres in schema public revoke truncate, trigger, references on tables from anon, authenticated;

-- 2. Dataset da tese só cresce (M7): o coletor só insere, a API e o ml só leem. Uma service_role vazada não apaga
--    nem reescreve historico_trafego, vias_monitoradas e malha_completa; o dono (postgres) mantém tudo.
revoke update, delete, truncate on table public.historico_trafego, public.vias_monitoradas, public.malha_completa from service_role;
revoke truncate on all tables in schema public from service_role;

-- 3. route_history: o app grava só as colunas que manda (M3). As de validação da tese (tempo_real_seg, feedback_em,
--    feedback_excluido*, eta_google_seg) e created_at não vêm do cliente; o feedback segue pelo UPDATE por coluna.
revoke insert on table public.route_history from authenticated;
grant insert (user_id, origem_label, origem_lat, origem_lon, destino_label, destino_lat, destino_lon, polyline,
              tempo_total_seg, distancia_km, via_principal, modelo_versao, tempo_rota_curta_seg, distancia_rota_curta_km,
              rotas_diferentes, lia_cobertura_pct, hora_partida, dia_semana, combustivel_economizado_l, minutos_economizados)
  on table public.route_history to authenticated;

-- 4. route_history com tamanho limitado (A1): qualquer conta grátis gravava sem limite e o plano grátis vira só
--    leitura em 500 MB, o que pararia o coletor. Folga larga sobre o real (maior polyline 9 KB, rótulo 42 caracteres,
--    11 rotas por pessoa por dia).
alter table public.route_history add constraint route_history_tamanhos_ck check (
      (polyline is null or (jsonb_typeof(polyline) = 'array' and jsonb_array_length(polyline) <= 20000
                            and octet_length(polyline::text) <= 500000))
  and char_length(coalesce(origem_label, '')) <= 300 and char_length(coalesce(destino_label, '')) <= 300
  and char_length(coalesce(via_principal, '')) <= 200 and char_length(coalesce(modelo_versao, '')) <= 40
  and char_length(coalesce(feedback_excluido_motivo, '')) <= 500
) not valid;
alter table public.route_history validate constraint route_history_tamanhos_ck;

alter table public.route_history add constraint route_history_valores_ck check (
      (origem_lat is null or origem_lat between -16.6 and -15.0) and (origem_lon is null or origem_lon between -48.8 and -46.8)
  and (destino_lat is null or destino_lat between -16.6 and -15.0) and (destino_lon is null or destino_lon between -48.8 and -46.8)
  and (tempo_total_seg is null or tempo_total_seg between 0 and 86400)
  and (tempo_real_seg is null or tempo_real_seg between 0 and 86400)
  and (tempo_rota_curta_seg is null or tempo_rota_curta_seg between 0 and 86400)
  and (distancia_km is null or distancia_km between 0 and 1000)
  and (distancia_rota_curta_km is null or distancia_rota_curta_km between 0 and 1000)
  and (hora_partida is null or hora_partida between 0 and 23)
  and (dia_semana is null or dia_semana between 0 and 6)
  and (lia_cobertura_pct is null or lia_cobertura_pct between 0 and 100)
) not valid;
alter table public.route_history validate constraint route_history_valores_ck;

create index if not exists route_history_usuario_criado_idx on public.route_history (user_id, created_at desc);

create or replace function public.limitar_historico_por_dia()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Teto suave por pessoa (A1): 300 rotas em 24 h (o maior uso real foi 11).
  if (select count(*) from public.route_history
      where user_id = new.user_id and created_at > now() - interval '24 hours') >= 300 then
    raise exception 'limite diário do histórico atingido' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.limitar_historico_por_dia() from public, anon, authenticated;
drop trigger if exists route_history_limite_diario on public.route_history;
create trigger route_history_limite_diario before insert on public.route_history
  for each row execute function public.limitar_historico_por_dia();

-- 5. is_admin() lê o papel e o bloqueio AO VIVO em auth.users (M6): antes lia o claim do JWT, e rebaixar ou bloquear
--    um admin só valia quando o token vencesse (até 1 h). Mesma fonte do claim (app_metadata.role), então quem é
--    admin hoje continua admin; segue exigindo aal_ok() (aal2 para quem tem 2º fator).
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
         and public.aal_ok()
$$;
