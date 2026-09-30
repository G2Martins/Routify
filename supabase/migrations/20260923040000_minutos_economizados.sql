-- Minutos economizados contra o caminho mais curto (o que a LIA otimiza), na mesma
-- escala do tempo exibido (apps/api/combustivel.py: base_na_escala). Complementa a
-- 20260923030000_economia_combustivel.sql; a RPC do painel passa a somar os minutos.

alter table public.rotas_calculadas add column if not exists minutos_economizados numeric;
alter table public.route_history add column if not exists minutos_economizados numeric;

create or replace function public.admin_economia_combustivel(dias integer default 30)
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
    'janela_dias',          janela,
    'rotas_com_estimativa', (select count(*) from public.rotas_calculadas
                               where criado_em >= inicio and combustivel_economizado_l is not null),
    'rotas_otimizadas',     (select count(*) from public.rotas_calculadas
                               where criado_em >= inicio and combustivel_economizado_l > 0.005),
    -- Só a parte positiva: rota mais rápida que gasta um pouco mais não "desconta" economia.
    'litros_economizados',  (select coalesce(sum(greatest(combustivel_economizado_l, 0)), 0)
                               from public.rotas_calculadas where criado_em >= inicio),
    'litros_consumidos',    (select coalesce(sum(combustivel_rota_l), 0)
                               from public.rotas_calculadas where criado_em >= inicio),
    'minutos_economizados', (select coalesce(sum(greatest(minutos_economizados, 0)), 0)
                               from public.rotas_calculadas where criado_em >= inicio),
    'serie_diaria', coalesce((
      select jsonb_agg(jsonb_build_object('dia', dia, 'litros', litros, 'rotas', rotas) order by dia)
      from (select to_char(date_trunc('day', criado_em at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD') as dia,
                   round(sum(greatest(combustivel_economizado_l, 0))::numeric, 3) as litros,
                   count(*) filter (where combustivel_economizado_l > 0.005) as rotas
            from public.rotas_calculadas
            where criado_em >= inicio and combustivel_economizado_l is not null
            group by 1) s
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.admin_economia_combustivel(integer) from public, anon;
grant execute on function public.admin_economia_combustivel(integer) to authenticated;
