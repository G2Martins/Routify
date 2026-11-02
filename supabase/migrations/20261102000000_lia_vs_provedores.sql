-- LIA × provedores (painel ADM, /admin/provedores).
-- 1) comparacao_provedores: o comparador da EC2 (services/collector/comparar_provedores.py)
--    pede a mesma viagem à LIA de produção e a outros roteadores em horários fixos.
-- 2) admin_lia_vs_provedores(dias): agrega isso contra a TomTom ao vivo e junta as rotas
--    reais (rotas_calculadas: LIA × TomTom no MESMO trajeto), sem user_id, coordenada nem data.

create table if not exists public.comparacao_provedores (
  id           bigint generated always as identity primary key,
  rodada_em    timestamptz not null,
  corredor     text not null check (char_length(corredor) <= 60),
  provedor     text not null check (provedor in ('lia', 'routify', 'tomtom_mesmo_trajeto', 'tomtom',
                                                 'osrm', 'openrouteservice', 'mapbox')),
  com_transito boolean not null,
  tempo_s      numeric check (tempo_s is null or tempo_s > 0),
  distancia_km numeric check (distancia_km is null or distancia_km >= 0),
  erro         text check (erro is null or char_length(erro) <= 300),
  detalhes     jsonb
);
create index if not exists comparacao_provedores_rodada_idx on public.comparacao_provedores (rodada_em desc);

-- Leitura só admin; escrita só service_role (nenhuma policy de escrita), como as demais.
alter table public.comparacao_provedores enable row level security;
revoke all on table public.comparacao_provedores from anon;
revoke insert, update, delete, truncate on table public.comparacao_provedores from authenticated;
drop policy if exists "Admin le" on public.comparacao_provedores;
create policy "Admin le" on public.comparacao_provedores for select to authenticated using (public.is_admin());

create or replace function public.admin_lia_vs_provedores(dias integer default 30)
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

  return (
    with c as (
      select rodada_em, corredor, provedor, com_transito, tempo_s, distancia_km, erro, detalhes
      from public.comparacao_provedores where rodada_em >= inicio
    ), ref as (            -- referência: a TomTom com trânsito ao vivo, na rota dela
      select rodada_em, corredor, tempo_s as ref_s from c where provedor = 'tomtom' and tempo_s > 0
    ), pares as (
      select c.provedor, c.corredor, c.tempo_s, r.ref_s,
             100.0 * (c.tempo_s - r.ref_s) / r.ref_s as erro_pct,
             (c.detalhes ->> 'traco_comum_tomtom_pct')::numeric as traco,  -- % do traçado igual ao da TomTom
             extract(hour from c.rodada_em at time zone 'America/Sao_Paulo')::int as hora
      from c join ref r using (rodada_em, corredor)
      where c.tempo_s > 0 and c.provedor <> 'tomtom'
    ), mesmo as (          -- a LIA contra a TomTom no MESMO trajeto: só muda a velocidade
      select 100.0 * (l.tempo_s - t.tempo_s) / t.tempo_s as erro_pct
      from c l join c t using (rodada_em, corredor)
      where l.provedor = 'lia' and t.provedor = 'tomtom_mesmo_trajeto' and l.tempo_s > 0 and t.tempo_s > 0
    ), reais as (
      select tempo_lia_seg::numeric as lia_s, referencia_tomtom_seg::numeric as tomtom_s,
             distancia_km, lia_cobertura_pct, hora_partida, criado_em,
             100.0 * (tempo_lia_seg - referencia_tomtom_seg) / referencia_tomtom_seg as erro_pct
      from public.rotas_calculadas
      where criado_em >= inicio and tempo_lia_seg > 0 and referencia_tomtom_seg > 0
    )
    select jsonb_build_object(
      'janela_dias', janela,
      'rodadas', (select count(distinct rodada_em) from c),
      'ultima_rodada', (select max(rodada_em) from c),
      'corredores', (select count(distinct corredor) from c),
      'provedores', coalesce((select jsonb_agg(jsonb_build_object(
          'provedor', provedor, 'com_transito', com_transito, 'n_ok', n_ok, 'n_falhas', n_falhas) order by provedor)
        from (select provedor, bool_or(com_transito) as com_transito,
                     count(*) filter (where tempo_s > 0) as n_ok,
                     count(*) filter (where erro is not null) as n_falhas
              from c group by provedor) s), '[]'::jsonb),
      'vs_tomtom', coalesce((select jsonb_agg(jsonb_build_object(
          'provedor', provedor, 'n', n, 'vies_mediano_pct', round(vies::numeric, 1),
          'mape_pct', round(mape::numeric, 1), 'pct_ate_20', round(dentro::numeric, 1),
          'traco_comum_pct', round(traco::numeric, 1)) order by mape)
        from (select provedor, count(*) as n,
                     percentile_cont(0.5) within group (order by erro_pct) as vies,
                     avg(abs(erro_pct)) as mape, 100.0 * avg((abs(erro_pct) <= 20)::int) as dentro,
                     avg(traco) as traco
              from pares group by provedor) s), '[]'::jsonb),
      'lia_mesmo_trajeto', (select jsonb_build_object(
          'n', count(*), 'vies_mediano_pct', round((percentile_cont(0.5) within group (order by erro_pct))::numeric, 1),
          'mape_pct', round(avg(abs(erro_pct))::numeric, 1),
          'pct_ate_20', round(100.0 * avg((abs(erro_pct) <= 20)::int), 1)) from mesmo),
      'por_hora', coalesce((select jsonb_agg(jsonb_build_object(
          'provedor', provedor, 'hora', hora, 'n', n, 'vies_mediano_pct', round(vies::numeric, 1)) order by provedor, hora)
        from (select provedor, hora, count(*) as n, percentile_cont(0.5) within group (order by erro_pct) as vies
              from pares group by provedor, hora) s), '[]'::jsonb),
      'por_corredor', coalesce((select jsonb_agg(jsonb_build_object(
          'corredor', corredor, 'provedor', provedor, 'n', n, 'tempo_medio_s', round(t::numeric, 0),
          'ref_medio_s', round(r::numeric, 0), 'erro_medio_pct', round(e::numeric, 1),
          'traco_comum_pct', round(tr::numeric, 1)) order by corredor, provedor)
        from (select corredor, provedor, count(*) as n, avg(tempo_s) as t, avg(ref_s) as r, avg(erro_pct) as e,
                     avg(traco) as tr
              from pares group by corredor, provedor) s), '[]'::jsonb),
      'ultima', coalesce((select jsonb_agg(jsonb_build_object(
          'corredor', corredor, 'provedor', provedor, 'tempo_s', tempo_s, 'distancia_km', distancia_km, 'erro', erro)
          order by corredor, provedor)
        from c where rodada_em = (select max(rodada_em) from c)), '[]'::jsonb),
      'rotas_reais', (select jsonb_build_object(
          'n', count(*), 'vies_mediano_pct', round((percentile_cont(0.5) within group (order by erro_pct))::numeric, 1),
          'mape_pct', round(avg(abs(erro_pct))::numeric, 1),
          'pct_ate_20', round(100.0 * avg((abs(erro_pct) <= 20)::int), 1),
          'por_hora', coalesce((select jsonb_agg(jsonb_build_object('hora', hora_partida, 'n', n,
                                  'vies_mediano_pct', round(v::numeric, 1)) order by hora_partida)
                                from (select hora_partida, count(*) as n,
                                             percentile_cont(0.5) within group (order by erro_pct) as v
                                      from reais where hora_partida is not null group by hora_partida) h), '[]'::jsonb),
          -- Amostras sem user_id, coordenada ou data (LGPD): só o par de tempos e o contexto.
          'amostras', coalesce((select jsonb_agg(jsonb_build_object('lia_s', lia_s, 'tomtom_s', tomtom_s,
                                  'km', distancia_km, 'cobertura_pct', lia_cobertura_pct, 'hora', hora_partida))
                                from (select * from reais order by criado_em desc limit 300) a), '[]'::jsonb))
        from reais)
    )
  );
end;
$$;

revoke execute on function public.admin_lia_vs_provedores(integer) from public, anon;
grant execute on function public.admin_lia_vs_provedores(integer) to authenticated;
