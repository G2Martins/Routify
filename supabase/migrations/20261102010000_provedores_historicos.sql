-- LIA × modelos históricos dos provedores (painel ADM, /admin/provedores).
-- O comparador grava, desde 2026-11-02, o ETA da TomTom pelo histórico dela no MESMO trajeto da LIA
-- (detalhes.historico_s da linha tomtom_mesmo_trajeto) e o ETA típico do Mapbox (detalhes.tipico_s).
-- São o equivalente da LIA nos provedores: previsão pelo histórico, sem a leitura de agora.
-- RPC separada: não mexe em admin_lia_vs_provedores; sem esta migration, a página só omite o cartão.

create or replace function public.admin_provedores_historicos(dias integer default 30)
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
      select rodada_em, corredor, provedor, tempo_s, detalhes
      from public.comparacao_provedores where rodada_em >= inicio
    ), hist as (           -- LIA e TomTom (ao vivo e histórico) no MESMO trajeto, mesma rodada
      select l.tempo_s as lia_s, t.tempo_s as vivo_s,
             case when jsonb_typeof(t.detalhes -> 'historico_s') = 'number'
                  then (t.detalhes ->> 'historico_s')::numeric end as hist_s
      from c l join c t using (rodada_em, corredor)
      where l.provedor = 'lia' and t.provedor = 'tomtom_mesmo_trajeto' and l.tempo_s > 0 and t.tempo_s > 0
    ), tipico as (         -- Mapbox (típico e ao vivo) contra a TomTom ao vivo na rota dela
      select m.tempo_s as mapbox_s, r.tempo_s as ref_s,
             case when jsonb_typeof(m.detalhes -> 'tipico_s') = 'number'
                  then (m.detalhes ->> 'tipico_s')::numeric end as tipico_s
      from c m join c r using (rodada_em, corredor)
      where m.provedor = 'mapbox' and r.provedor = 'tomtom' and m.tempo_s > 0 and r.tempo_s > 0
    ), series as (         -- pareadas: cada par de séries usa as mesmas rodadas
      select 'lia' as serie, 100.0 * (lia_s - vivo_s) / vivo_s as erro_pct from hist where hist_s > 0
      union all select 'tomtom_historico', 100.0 * (hist_s - vivo_s) / vivo_s from hist where hist_s > 0
      union all select 'lia_x_tomtom_historico', 100.0 * (lia_s - hist_s) / hist_s from hist where hist_s > 0
      union all select 'mapbox_tipico', 100.0 * (tipico_s - ref_s) / ref_s from tipico where tipico_s > 0
      union all select 'mapbox_ao_vivo', 100.0 * (mapbox_s - ref_s) / ref_s from tipico where tipico_s > 0
    )
    select jsonb_build_object(
      'janela_dias', janela,
      'series', coalesce((select jsonb_object_agg(serie, jsonb_build_object(
          'n', n, 'vies_mediano_pct', round(vies::numeric, 1), 'mape_pct', round(mape::numeric, 1),
          'pct_ate_20', round(dentro::numeric, 1)))
        from (select serie, count(*) as n, percentile_cont(0.5) within group (order by erro_pct) as vies,
                     avg(abs(erro_pct)) as mape, 100.0 * avg((abs(erro_pct) <= 20)::int) as dentro
              from series group by serie) s), '{}'::jsonb)
    )
  );
end;
$$;

revoke execute on function public.admin_provedores_historicos(integer) from public, anon;
grant execute on function public.admin_provedores_historicos(integer) to authenticated;
