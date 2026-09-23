-- Ações do painel ADM.
--
-- Toda ação é uma RPC security definer que, na MESMA transação:
--   1. exige admin (is_admin(): app_metadata.role do JWT, que só o service_role grava);
--   2. serializa a mesma ação no mesmo alvo (advisory lock) e recusa repetição em
--      poucos segundos (duplo clique, dois admins ao mesmo tempo);
--   3. grava a auditoria (append-only) — se a ação falhar, a auditoria some junto.
-- O que depende do processo da API (testar chave TomTom, estado do pool em memória)
-- fica em /admin/* na API; o resto mora aqui.
--
-- Idempotente: pode rodar de novo.

-- 1. Auditoria (append-only) -------------------------------------------------
create table if not exists public.admin_auditoria (
  id        bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  ator      uuid not null, -- sem FK: a trilha sobrevive à exclusão da conta
  acao      text not null,
  alvo      text,
  detalhes  jsonb not null default '{}'::jsonb
);
create index if not exists admin_auditoria_criado_em_idx on public.admin_auditoria (criado_em desc);
create index if not exists admin_auditoria_ator_acao_idx on public.admin_auditoria (ator, acao, criado_em desc);

alter table public.admin_auditoria enable row level security;
drop policy if exists "Admin le" on public.admin_auditoria;
create policy "Admin le" on public.admin_auditoria for select to authenticated using (public.is_admin());
revoke all on table public.admin_auditoria from anon;
revoke insert, update, delete, truncate on table public.admin_auditoria from authenticated;
-- Nem a API (service_role) altera ou apaga o que já foi auditado.
revoke update, delete, truncate on table public.admin_auditoria from service_role;

-- 2. Configuração em runtime (lida pela API com TTL curto) --------------------
create table if not exists public.config_runtime (
  chave          text primary key check (chave in (
                   'tomtom_ativo', 'tomtom_orcamento_min', 'tomtom_chaves_pausadas',
                   'tomtom_reset_em', 'referencia_tomtom_ativa', 'modo_so_lia')),
  valor          jsonb not null,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid
);
insert into public.config_runtime (chave, valor) values
  ('tomtom_ativo', 'true'), ('tomtom_orcamento_min', '120'), ('tomtom_chaves_pausadas', '[]'),
  ('referencia_tomtom_ativa', 'true'), ('modo_so_lia', 'false')
on conflict (chave) do nothing;

alter table public.config_runtime enable row level security;
drop policy if exists "Admin le" on public.config_runtime;
create policy "Admin le" on public.config_runtime for select to authenticated using (public.is_admin());
revoke all on table public.config_runtime from anon;
revoke insert, update, delete, truncate on table public.config_runtime from authenticated;

-- 3. Avisos do app (banner de informação/manutenção) -------------------------
create table if not exists public.avisos_app (
  id         uuid primary key default gen_random_uuid(),
  mensagem   text not null check (char_length(mensagem) between 3 and 280),
  nivel      text not null default 'info' check (nivel in ('info', 'alerta', 'manutencao')),
  ativo      boolean not null default true,
  inicio     timestamptz not null default now(),
  fim        timestamptz,
  criado_por uuid,
  criado_em  timestamptz not null default now(),
  check (fim is null or fim > inicio)
);
alter table public.avisos_app enable row level security;
drop policy if exists "Todos leem vigentes" on public.avisos_app;
create policy "Todos leem vigentes" on public.avisos_app for select to anon, authenticated
  using (ativo and inicio <= now() and (fim is null or fim > now()));
drop policy if exists "Admin le tudo" on public.avisos_app;
create policy "Admin le tudo" on public.avisos_app for select to authenticated using (public.is_admin());
revoke insert, update, delete, truncate on table public.avisos_app from anon, authenticated;
grant select on table public.avisos_app to anon, authenticated;

-- 4. Feedback: exclusão de outlier + resposta única -------------------------
alter table public.route_history
  add column if not exists feedback_excluido boolean not null default false,
  add column if not exists feedback_excluido_motivo text;

-- O usuário informa o tempo real uma vez; regravar (duplo envio, corrida entre
-- abas) é recusado. RPCs security definer rodam como dono e não caem aqui.
create or replace function public.route_history_feedback_unico()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and old.tempo_real_seg is not null
     and new.tempo_real_seg is distinct from old.tempo_real_seg then
    raise exception 'feedback já registrado para esta rota' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists route_history_feedback_unico on public.route_history;
create trigger route_history_feedback_unico before update on public.route_history
  for each row execute function public.route_history_feedback_unico();

-- 5. Núcleo comum das ações --------------------------------------------------
create or replace function public._admin_acao(p_acao text, p_alvo text, p_detalhes jsonb,
                                              p_intervalo_s integer default 3)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_acao || ':' || coalesce(p_alvo, ''), 0));
  if exists (
    select 1 from public.admin_auditoria a
    where a.ator = v_ator and a.acao = p_acao and a.alvo is not distinct from p_alvo
      and a.criado_em > now() - make_interval(secs => p_intervalo_s)
  ) then
    raise exception 'ação repetida — aguarde alguns segundos' using errcode = 'P0001';
  end if;
  insert into public.admin_auditoria (ator, acao, alvo, detalhes)
  values (v_ator, p_acao, p_alvo, coalesce(p_detalhes, '{}'::jsonb));
end $$;

create or replace function public._admin_nao_eu(p_alvo uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_alvo = auth.uid() then
    raise exception 'não é permitido aplicar esta ação na própria conta' using errcode = 'P0001';
  end if;
end $$;

-- 6. Usuários ----------------------------------------------------------------
create or replace function public.admin_definir_papel(p_alvo uuid, p_papel text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admins integer;
begin
  if p_papel not in ('admin', 'usuario') then
    raise exception 'papel inválido' using errcode = '22023';
  end if;
  perform public._admin_acao('papel', p_alvo::text, jsonb_build_object('papel', p_papel));
  perform public._admin_nao_eu(p_alvo);
  -- Mudanças de papel em série: dois admins rebaixando um ao outro não zeram a lista.
  perform pg_advisory_xact_lock(hashtextextended('papel-global', 0));
  if p_papel = 'usuario' then
    select count(*) into v_admins from auth.users where raw_app_meta_data ->> 'role' = 'admin';
    if v_admins <= 1 then
      raise exception 'não é possível remover o último administrador' using errcode = 'P0001';
    end if;
  end if;

  update auth.users
  set raw_app_meta_data = case p_papel
        when 'admin' then coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role": "admin"}'::jsonb
        else coalesce(raw_app_meta_data, '{}'::jsonb) - 'role' end
  where id = p_alvo;
  if not found then
    raise exception 'usuário não encontrado' using errcode = 'P0002';
  end if;
  -- Rebaixado perde as sessões na hora (o JWT antigo ainda traria role=admin).
  if p_papel = 'usuario' then
    delete from auth.sessions where user_id = p_alvo;
  end if;
end $$;

create or replace function public.admin_definir_bloqueio(p_alvo uuid, p_bloqueado boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._admin_acao('bloqueio', p_alvo::text, jsonb_build_object('bloqueado', p_bloqueado));
  perform public._admin_nao_eu(p_alvo);
  update auth.users
  set banned_until = case when p_bloqueado then now() + interval '100 years' else null end
  where id = p_alvo;
  if not found then
    raise exception 'usuário não encontrado' using errcode = 'P0002';
  end if;
  if p_bloqueado then
    delete from auth.sessions where user_id = p_alvo;
  end if;
end $$;

create or replace function public.admin_encerrar_sessoes(p_alvo uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  perform public._admin_acao('encerrar_sessoes', p_alvo::text, '{}'::jsonb);
  delete from auth.sessions where user_id = p_alvo;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Pedido do titular (LGPD art. 18): cópia dos dados dele. Auditado.
create or replace function public.admin_exportar_dados(p_alvo uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public._admin_acao('exportar_dados', p_alvo::text, '{}'::jsonb, 10);
  select jsonb_build_object(
    'gerado_em', now(),
    'conta', (select jsonb_build_object('id', u.id, 'email', u.email, 'criado_em', u.created_at,
                                        'ultimo_login', u.last_sign_in_at)
              from auth.users u where u.id = p_alvo),
    'perfil', (select to_jsonb(p) from public.profiles p where p.id = p_alvo),
    'historico_rotas', coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at)
                                 from public.route_history h where h.user_id = p_alvo), '[]'::jsonb),
    'rotas_calculadas', coalesce((select jsonb_agg(to_jsonb(r) order by r.criado_em)
                                  from public.rotas_calculadas r where r.user_id = p_alvo), '[]'::jsonb),
    'eventos', coalesce((select jsonb_agg(to_jsonb(e) order by e.criado_em)
                         from public.eventos_app e where e.user_id = p_alvo), '[]'::jsonb)
  ) into v;
  if v -> 'conta' is null or v -> 'conta' = 'null'::jsonb then
    raise exception 'usuário não encontrado' using errcode = 'P0002';
  end if;
  return v;
end $$;

-- Pedido de exclusão: apaga os dados de uso; com p_apagar_conta, a conta também.
-- Confirmação = e-mail do alvo digitado pelo admin.
create or replace function public.admin_apagar_dados(p_alvo uuid, p_confirmacao text, p_apagar_conta boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_rotas integer; v_calc integer; v_eventos integer; v_req integer;
  v_admins integer;
begin
  perform public._admin_acao('apagar_dados', p_alvo::text, jsonb_build_object('apagar_conta', p_apagar_conta), 10);
  perform public._admin_nao_eu(p_alvo);
  select email into v_email from auth.users where id = p_alvo;
  if v_email is null then
    raise exception 'usuário não encontrado' using errcode = 'P0002';
  end if;
  if lower(trim(coalesce(p_confirmacao, ''))) <> lower(v_email) then
    raise exception 'confirmação não confere com o e-mail da conta' using errcode = 'P0001';
  end if;

  delete from public.route_history where user_id = p_alvo;     get diagnostics v_rotas = row_count;
  delete from public.rotas_calculadas where user_id = p_alvo;  get diagnostics v_calc = row_count;
  delete from public.eventos_app where user_id = p_alvo;       get diagnostics v_eventos = row_count;
  delete from public.api_requisicoes where user_id = p_alvo;   get diagnostics v_req = row_count;

  if p_apagar_conta then
    perform pg_advisory_xact_lock(hashtextextended('papel-global', 0));
    if (select raw_app_meta_data ->> 'role' from auth.users where id = p_alvo) = 'admin' then
      select count(*) into v_admins from auth.users where raw_app_meta_data ->> 'role' = 'admin';
      if v_admins <= 1 then
        raise exception 'não é possível apagar o último administrador' using errcode = 'P0001';
      end if;
    end if;
    delete from auth.users where id = p_alvo; -- cascata: perfil, sessões, identidades
  end if;

  return jsonb_build_object('historico_rotas', v_rotas, 'rotas_calculadas', v_calc,
                            'eventos', v_eventos, 'requisicoes', v_req, 'conta_apagada', p_apagar_conta);
end $$;

-- 7. TomTom / modos da API (config_runtime) ----------------------------------
create or replace function public.admin_definir_config(p_chave text, p_valor jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  case p_chave
    when 'tomtom_ativo', 'referencia_tomtom_ativa', 'modo_so_lia' then
      if jsonb_typeof(p_valor) <> 'boolean' then
        raise exception 'valor deve ser booleano' using errcode = '22023';
      end if;
    when 'tomtom_orcamento_min' then
      if jsonb_typeof(p_valor) <> 'number' or (p_valor #>> '{}')::numeric not between 1 and 600
         or (p_valor #>> '{}')::numeric <> trunc((p_valor #>> '{}')::numeric) then
        raise exception 'orçamento deve ser inteiro entre 1 e 600' using errcode = '22023';
      end if;
    when 'tomtom_chaves_pausadas' then
      if jsonb_typeof(p_valor) <> 'array' or jsonb_array_length(p_valor) > 200
         or exists (select 1 from jsonb_array_elements(p_valor) e
                    where jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') > 40) then
        raise exception 'lista de ids inválida' using errcode = '22023';
      end if;
    else
      raise exception 'chave de configuração desconhecida' using errcode = '22023';
  end case;

  perform public._admin_acao('config', p_chave, jsonb_build_object('valor', p_valor), 2);
  insert into public.config_runtime (chave, valor, atualizado_em, atualizado_por)
  values (p_chave, p_valor, now(), auth.uid())
  on conflict (chave) do update
    set valor = excluded.valor, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por;
end $$;

-- A API zera os cooldowns do pool quando vê um tomtom_reset_em novo.
create or replace function public.admin_tomtom_zerar_cooldowns()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._admin_acao('tomtom_zerar_cooldowns', null, '{}'::jsonb, 10);
  insert into public.config_runtime (chave, valor, atualizado_em, atualizado_por)
  values ('tomtom_reset_em', to_jsonb(now()), now(), auth.uid())
  on conflict (chave) do update
    set valor = excluded.valor, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por;
end $$;

-- 8. Avisos --------------------------------------------------------------------
create or replace function public.admin_aviso_salvar(p_id uuid, p_mensagem text, p_nivel text,
                                                    p_ativo boolean, p_inicio timestamptz, p_fim timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public._admin_acao('aviso_salvar', coalesce(p_id::text, 'novo'),
                             jsonb_build_object('nivel', p_nivel, 'ativo', p_ativo), 2);
  if p_id is null then
    insert into public.avisos_app (mensagem, nivel, ativo, inicio, fim, criado_por)
    values (trim(p_mensagem), p_nivel, p_ativo, coalesce(p_inicio, now()), p_fim, auth.uid())
    returning id into v_id;
  else
    update public.avisos_app
    set mensagem = trim(p_mensagem), nivel = p_nivel, ativo = p_ativo,
        inicio = coalesce(p_inicio, inicio), fim = p_fim
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'aviso não encontrado' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.admin_aviso_remover(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._admin_acao('aviso_remover', p_id::text, '{}'::jsonb);
  delete from public.avisos_app where id = p_id;
end $$;

-- 9. Dados e LIA ---------------------------------------------------------------
create or replace function public.admin_feedback_excluir(p_id uuid, p_excluir boolean, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._admin_acao('feedback_excluir', p_id::text, jsonb_build_object('excluir', p_excluir), 2);
  update public.route_history
  set feedback_excluido = p_excluir,
      feedback_excluido_motivo = case when p_excluir then left(nullif(trim(p_motivo), ''), 200) end
  where id = p_id and tempo_real_seg is not null;
  if not found then
    raise exception 'rota com feedback não encontrada' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.admin_recalcular_qualidade()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._admin_acao('recalcular_qualidade', null, '{}'::jsonb, 60);
  perform painel.atualizar_qualidade();
end $$;

create or replace function public.admin_expurgar_uso()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._admin_acao('expurgar_uso', null, '{}'::jsonb, 60);
  perform public.expurgar_uso_antigo();
end $$;

-- Validação em produção agora traz id e exclusão (o painel marca outliers).
drop function if exists public.admin_validacao_feedback();
create function public.admin_validacao_feedback()
returns table (id uuid, criado_em timestamptz, tempo_previsto_seg integer, tempo_real_seg integer,
               tempo_rota_curta_seg integer, lia_cobertura_pct numeric, rotas_diferentes boolean,
               feedback_excluido boolean, feedback_excluido_motivo text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  return query
    select h.id, h.created_at, h.tempo_total_seg, h.tempo_real_seg, h.tempo_rota_curta_seg,
           h.lia_cobertura_pct, h.rotas_diferentes, h.feedback_excluido, h.feedback_excluido_motivo
    from public.route_history h
    where h.tempo_real_seg is not null
    order by h.created_at desc
    limit 500;
end $$;

-- 10. Analytics de uso (agregado; LGPD) -----------------------------------------
-- Mapa de calor em grade de ~1,1 km (2 casas), só células com >= 3 usuários
-- distintos (k-anonimato). Busca: só contagens; o texto nunca é gravado.
create or replace function public.admin_analytics_uso(dias integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  janela integer := least(greatest(coalesce(dias, 30), 1), 90);
  inicio timestamptz := now() - make_interval(days => janela);
begin
  if not public.is_admin() then
    raise exception 'acesso negado' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'janela_dias', janela,
    'funil', (select coalesce(jsonb_object_agg(tipo, jsonb_build_object('eventos', n, 'usuarios', u)), '{}'::jsonb)
              from (select tipo, count(*) n, count(distinct user_id) u
                    from public.eventos_app where criado_em >= inicio group by tipo) f),
    'busca_por_fonte', (select coalesce(jsonb_object_agg(fonte, n), '{}'::jsonb)
                        from (select coalesce(dados ->> 'fonte', 'desconhecida') fonte, count(*) n
                              from public.eventos_app
                              where tipo = 'busca' and criado_em >= inicio and dados ? 'fonte'
                              group by 1) b),
    'busca_sem_resultado', (select count(*) from public.eventos_app
                            where tipo = 'busca' and criado_em >= inicio and (dados ->> 'sem_resultado')::boolean),
    'busca_posicao_media', (select round(avg((dados ->> 'posicao')::numeric), 2) from public.eventos_app
                            where tipo = 'busca' and criado_em >= inicio and dados ? 'posicao'),
    'plataformas', (select coalesce(jsonb_object_agg(coalesce(plataforma, 'desconhecida'), n), '{}'::jsonb)
                    from (select plataforma, count(distinct user_id) n from public.eventos_app
                          where criado_em >= inicio group by plataforma) p),
    'lia_vs_curta', (select jsonb_build_object(
                        'rotas', count(*),
                        'diferentes', count(*) filter (where rotas_diferentes),
                        'ganho_medio_seg', round(avg(tempo_rota_curta_seg - tempo_lia_seg)
                                                 filter (where rotas_diferentes), 1),
                        'cobertura_media_pct', round(avg(lia_cobertura_pct), 1),
                        'degradadas', count(*) filter (where tomtom_degradado),
                        'com_incidente', count(*) filter (where incidentes_na_rota > 0))
                     from public.rotas_calculadas where criado_em >= inicio),
    'hora_dia', (select coalesce(jsonb_agg(jsonb_build_object('hora', hora_partida, 'dia', dia_semana, 'n', n)), '[]'::jsonb)
                 from (select hora_partida, dia_semana, count(*) n from public.rotas_calculadas
                       where criado_em >= inicio and hora_partida is not null
                       group by 1, 2) h),
    'calor', (select coalesce(jsonb_agg(jsonb_build_object('lat', lat, 'lon', lon, 'n', n)), '[]'::jsonb)
              from (select round(lat, 2) lat, round(lon, 2) lon, count(*) n, count(distinct user_id) u
                    from (select origem_lat lat, origem_lon lon, user_id from public.rotas_calculadas where criado_em >= inicio
                          union all
                          select destino_lat, destino_lon, user_id from public.rotas_calculadas where criado_em >= inicio) pts
                    group by 1, 2) c
              where u >= 3)
  );
end $$;

-- 11. Permissões -----------------------------------------------------------------
revoke execute on function public._admin_acao(text, text, jsonb, integer), public._admin_nao_eu(uuid)
  from public, anon, authenticated;

revoke execute on function
  public.admin_definir_papel(uuid, text), public.admin_definir_bloqueio(uuid, boolean),
  public.admin_encerrar_sessoes(uuid), public.admin_exportar_dados(uuid),
  public.admin_apagar_dados(uuid, text, boolean), public.admin_definir_config(text, jsonb),
  public.admin_tomtom_zerar_cooldowns(), public.admin_aviso_salvar(uuid, text, text, boolean, timestamptz, timestamptz),
  public.admin_aviso_remover(uuid), public.admin_feedback_excluir(uuid, boolean, text),
  public.admin_recalcular_qualidade(), public.admin_expurgar_uso(), public.admin_validacao_feedback(),
  public.admin_analytics_uso(integer)
  from public, anon;

grant execute on function
  public.admin_definir_papel(uuid, text), public.admin_definir_bloqueio(uuid, boolean),
  public.admin_encerrar_sessoes(uuid), public.admin_exportar_dados(uuid),
  public.admin_apagar_dados(uuid, text, boolean), public.admin_definir_config(text, jsonb),
  public.admin_tomtom_zerar_cooldowns(), public.admin_aviso_salvar(uuid, text, text, boolean, timestamptz, timestamptz),
  public.admin_aviso_remover(uuid), public.admin_feedback_excluir(uuid, boolean, text),
  public.admin_recalcular_qualidade(), public.admin_expurgar_uso(), public.admin_validacao_feedback(),
  public.admin_analytics_uso(integer)
  to authenticated;

revoke execute on function public.route_history_feedback_unico() from public, anon, authenticated;
