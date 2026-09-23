-- Captura de uso da plataforma + leitura de ADM (fase final do TCC 2).
-- Aplicar DEPOIS de 20260923000000_security_hardening.sql. Idempotente.
--
-- Regras:
--   * Tudo é ESCRITO pelo servidor (API com service_role, que ignora RLS). O
--     cliente nunca insere direto nestas tabelas — cliente é hostil.
--   * Leitura só para admin: app_metadata.role = 'admin' no JWT. Só o
--     service_role grava app_metadata, então ninguém se promove sozinho.
--   * LGPD: coordenadas arredondadas a 3 casas (~110 m) pela API; dados brutos
--     expurgados após 90 dias (pg_cron); o ADM nunca vê trilha individual.

-- 0. Quem é admin ----------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
$$;

-- 1. Tabelas de uso ---------------------------------------------------------
create table if not exists public.api_requisicoes (
  id            bigint generated always as identity primary key,
  criado_em     timestamptz not null default now(),
  metodo        text not null,
  rota          text not null,
  status        smallint not null,
  latencia_ms   integer not null,
  user_id       uuid references auth.users (id) on delete set null,
  modelo_versao text,
  degradado     boolean,
  erro          text
);
create index if not exists idx_api_requisicoes_criado on public.api_requisicoes (criado_em desc);

create table if not exists public.rotas_calculadas (
  id                    bigint generated always as identity primary key,
  criado_em             timestamptz not null default now(),
  user_id               uuid references auth.users (id) on delete set null,
  origem_lat            numeric(7,3) not null,
  origem_lon            numeric(7,3) not null,
  destino_lat           numeric(7,3) not null,
  destino_lon           numeric(7,3) not null,
  distancia_km          numeric(8,2),
  tempo_lia_seg         integer,
  tempo_rota_curta_seg  integer,
  rotas_diferentes      boolean,
  lia_cobertura_pct     numeric(5,2),
  modelo_versao         text,
  hora_partida          smallint,
  dia_semana            smallint,
  tomtom_ativo          boolean,
  tomtom_degradado      boolean,
  vias_atualizadas      smallint,
  incidentes_na_rota    smallint,
  interdicoes_na_rota   smallint,
  referencia_tomtom_seg integer,
  referencia_atraso_seg integer,
  latencia_ms           integer
);
create index if not exists idx_rotas_calculadas_criado on public.rotas_calculadas (criado_em desc);

create table if not exists public.eventos_app (
  id         bigint generated always as identity primary key,
  criado_em  timestamptz not null default now(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  tipo       text not null check (tipo in ('busca', 'rota_solicitada', 'navegacao_iniciada',
                                            'navegacao_concluida', 'feedback')),
  plataforma text check (plataforma in ('web', 'ios', 'android')),
  dados      jsonb not null default '{}'::jsonb check (pg_column_size(dados) <= 2048)
);
create index if not exists idx_eventos_app_criado on public.eventos_app (criado_em desc);

-- 2. Acompanhamento da LIA (publicado por ml/publish_metrics.py) ------------
create table if not exists public.lia_treinos (
  versao                          text primary key,
  registrado_em                   timestamptz not null default now(),
  validacao                       text not null check (validacao in ('temporal', 'nao_temporal')),
  fonte                           text not null,
  mae_seg                         numeric,
  mae_seg_std                     numeric,
  rmse_seg                        numeric,
  rmse_seg_std                    numeric,
  baseline_mae_seg                numeric,
  baseline_rmse_seg               numeric,
  rmse_congestionado_seg          numeric,
  baseline_rmse_congestionado_seg numeric,
  total_amostras                  integer,
  periodo_inicio                  timestamptz,
  periodo_fim                     timestamptz,
  detalhes                        jsonb not null default '{}'::jsonb
);

create table if not exists public.lia_analises (
  chave         text primary key,
  atualizado_em timestamptz not null default now(),
  dados         jsonb not null
);

-- 3. RLS: leitura só admin; escrita só service_role (nenhuma policy de escrita)
do $$
declare t text;
begin
  foreach t in array array['api_requisicoes', 'rotas_calculadas', 'eventos_app', 'lia_treinos', 'lia_analises'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on table public.%I from authenticated', t);
    execute format('drop policy if exists "Admin le" on public.%I', t);
    execute format('create policy "Admin le" on public.%I for select to authenticated using (public.is_admin())', t);
  end loop;
end $$;

-- 4. Qualidade da base: agregações pesadas (1,5 mi linhas) pré-calculadas num
--    schema NÃO exposto pelo PostgREST; o RPC admin só lê o resultado.
create schema if not exists painel;
revoke all on schema painel from public, anon, authenticated;

create materialized view if not exists painel.mv_qualidade_resumo as
select count(*)                                                                 as linhas,
       min(data_hora_coleta)                                                    as inicio,
       max(data_hora_coleta)                                                    as fim,
       count(*) filter (where velocidade_atual is null or velocidade_livre is null) as nulos,
       count(*) filter (where velocidade_livre > 0 and velocidade_atual > velocidade_livre * 1.5) as acima_da_livre,
       count(*) filter (where velocidade_atual = 0)                             as velocidade_zero,
       count(*) filter (where confianca < 0.5)                                  as baixa_confianca,
       count(distinct id_ponto)                                                 as vias_com_dado,
       now()                                                                    as calculado_em
from public.historico_trafego;

create materialized view if not exists painel.mv_qualidade_cobertura as
select extract(isodow from data_hora_coleta)::int as dia_semana,  -- 1 = segunda … 7 = domingo
       extract(hour from data_hora_coleta)::int   as hora,
       count(*)                                   as n
from public.historico_trafego
group by 1, 2;

create materialized view if not exists painel.mv_qualidade_por_via as
select v.id_ponto,
       v.nome_via,
       count(h.id_ponto)       as n,
       max(h.data_hora_coleta) as ultima
from public.vias_monitoradas v
left join public.historico_trafego h on h.id_ponto = v.id_ponto
group by v.id_ponto, v.nome_via;

create materialized view if not exists painel.mv_qualidade_duplicatas as
select count(*) as grupos_duplicados
from (select 1 from public.historico_trafego
      group by id_ponto, data_hora_coleta having count(*) > 1) d;

create or replace function painel.atualizar_qualidade()
returns void
language sql
security definer
set search_path = ''
as $$
  refresh materialized view painel.mv_qualidade_resumo;
  refresh materialized view painel.mv_qualidade_cobertura;
  refresh materialized view painel.mv_qualidade_por_via;
  refresh materialized view painel.mv_qualidade_duplicatas;
$$;

-- 5. RPCs do painel ADM (security definer + checagem explícita de admin) ----
create or replace function public.admin_resumo_uso(dias integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  janela integer := greatest(1, least(coalesce(dias, 30), 365));
  inicio timestamptz := now() - make_interval(days => janela);
begin
  if not public.is_admin() then
    raise exception 'acesso negado' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'janela_dias',      janela,
    'requisicoes',      (select count(*) from public.api_requisicoes where criado_em >= inicio),
    'erros_5xx',        (select count(*) from public.api_requisicoes where criado_em >= inicio and status >= 500),
    'latencia_p95_ms',  (select percentile_cont(0.95) within group (order by latencia_ms)
                           from public.api_requisicoes where criado_em >= inicio),
    'rotas',            (select count(*) from public.rotas_calculadas where criado_em >= inicio),
    'rotas_degradadas', (select count(*) from public.rotas_calculadas where criado_em >= inicio and tomtom_degradado),
    'usuarios_ativos',  (select count(distinct user_id) from public.rotas_calculadas
                           where criado_em >= inicio and user_id is not null),
    'usuarios_total',   (select count(*) from auth.users),
    'eventos',          (select count(*) from public.eventos_app where criado_em >= inicio),
    'serie_diaria', coalesce((
      select jsonb_agg(jsonb_build_object('dia', dia, 'rotas', rotas, 'usuarios', usuarios) order by dia)
      from (select to_char(date_trunc('day', criado_em at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD') as dia,
                   count(*) as rotas, count(distinct user_id) as usuarios
            from public.rotas_calculadas where criado_em >= inicio group by 1) s), '[]'::jsonb),
    'por_hora', coalesce((
      select jsonb_agg(jsonb_build_object('hora', hora_partida, 'rotas', n) order by hora_partida)
      from (select hora_partida, count(*) as n from public.rotas_calculadas
            where criado_em >= inicio and hora_partida is not null group by 1) s), '[]'::jsonb),
    'por_endpoint', coalesce((
      select jsonb_agg(jsonb_build_object('rota', rota, 'n', n, 'erros', erros, 'p95_ms', p95) order by n desc)
      from (select rota, count(*) as n, count(*) filter (where status >= 500) as erros,
                   percentile_cont(0.95) within group (order by latencia_ms) as p95
            from public.api_requisicoes where criado_em >= inicio group by 1 order by 2 desc limit 10) s), '[]'::jsonb),
    'eventos_por_tipo', coalesce((
      select jsonb_object_agg(tipo, n)
      from (select tipo, count(*) as n from public.eventos_app where criado_em >= inicio group by 1) s), '{}'::jsonb)
  );
end $$;

create or replace function public.admin_qualidade_dados()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'acesso negado' using errcode = '42501';
  end if;

  return (
    select jsonb_build_object(
      'resumo', to_jsonb(r),
      'duplicatas', (select grupos_duplicados from painel.mv_qualidade_duplicatas),
      'vias_monitoradas', (select count(*) from painel.mv_qualidade_por_via),
      'vias_sem_dado', (select count(*) from painel.mv_qualidade_por_via where n = 0),
      'amostras_por_via', (select jsonb_build_object(
                             'min', min(n), 'mediana', percentile_cont(0.5) within group (order by n), 'max', max(n))
                           from painel.mv_qualidade_por_via),
      'vias_menos_amostradas', (select coalesce(jsonb_agg(to_jsonb(v) order by v.n), '[]'::jsonb)
                                from (select id_ponto, nome_via, n, ultima from painel.mv_qualidade_por_via
                                      order by n limit 15) v),
      'cobertura_hora_dia', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from painel.mv_qualidade_cobertura c),
      'tamanho_tabelas_bytes', (select jsonb_object_agg(c.relname, pg_catalog.pg_total_relation_size(c.oid))
                                from pg_catalog.pg_class c
                                where c.relnamespace = 'public'::regnamespace and c.relkind = 'r')
    )
    from painel.mv_qualidade_resumo r
  );
end $$;

create or replace function public.admin_usuarios()
returns table (id uuid, email text, nome text, criado_em timestamptz, ultimo_login timestamptz,
               papel text, rotas bigint)
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
    select u.id, u.email::text, coalesce(p.nome, u.raw_user_meta_data ->> 'nome'),
           u.created_at, u.last_sign_in_at,
           coalesce(u.raw_app_meta_data ->> 'role', 'usuario'),
           (select count(*) from public.rotas_calculadas r where r.user_id = u.id)
    from auth.users u
    left join public.profiles p on p.id = u.id
    order by u.created_at;
end $$;

-- Erro real em produção: previsão × tempo informado pelo usuário (sem coordenadas).
create or replace function public.admin_validacao_feedback()
returns table (criado_em timestamptz, tempo_previsto_seg integer, tempo_real_seg integer,
               tempo_rota_curta_seg integer, lia_cobertura_pct numeric, rotas_diferentes boolean)
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
    select h.created_at, h.tempo_total_seg, h.tempo_real_seg, h.tempo_rota_curta_seg,
           h.lia_cobertura_pct, h.rotas_diferentes
    from public.route_history h
    where h.tempo_real_seg is not null
    order by h.created_at desc
    limit 500;
end $$;

-- 6. Permissões das funções -------------------------------------------------
revoke execute on function public.admin_resumo_uso(integer), public.admin_qualidade_dados(),
  public.admin_usuarios(), public.admin_validacao_feedback() from public, anon;
grant execute on function public.admin_resumo_uso(integer), public.admin_qualidade_dados(),
  public.admin_usuarios(), public.admin_validacao_feedback() to authenticated;
revoke execute on function painel.atualizar_qualidade() from public, anon, authenticated;

-- 7. Retenção (LGPD) e atualização diária da qualidade (pg_cron) ------------
create or replace function public.expurgar_uso_antigo()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.api_requisicoes  where criado_em < now() - interval '90 days';
  delete from public.rotas_calculadas where criado_em < now() - interval '90 days';
  delete from public.eventos_app      where criado_em < now() - interval '90 days';
$$;
revoke execute on function public.expurgar_uso_antigo() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;  -- forma documentada pelo Supabase
select cron.schedule('routify-expurgo-uso', '15 6 * * *', 'select public.expurgar_uso_antigo()');   -- 03:15 BRT
select cron.schedule('routify-qualidade',   '30 6 * * *', 'select painel.atualizar_qualidade()');   -- 03:30 BRT
