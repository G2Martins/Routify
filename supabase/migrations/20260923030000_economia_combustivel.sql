-- Combustível economizado por rota — estimativa Evans–Herman–Lam (apps/api/combustivel.py,
-- parâmetros com fonte em ml/artifacts/consumo_combustivel.json): rota escolhida pela LIA
-- contra o caminho mais curto, no mesmo instante. A API grava; o painel ADM agrega.

alter table public.rotas_calculadas
  add column if not exists distancia_rota_curta_km numeric,
  add column if not exists combustivel_rota_l numeric,
  add column if not exists combustivel_economizado_l numeric;

-- Histórico do usuário: o app grava o que a API estimou (estatística pessoal do Painel).
alter table public.route_history
  add column if not exists combustivel_economizado_l numeric;

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
    'janela_dias',         janela,
    'rotas_com_estimativa', (select count(*) from public.rotas_calculadas
                              where criado_em >= inicio and combustivel_economizado_l is not null),
    'rotas_otimizadas',    (select count(*) from public.rotas_calculadas
                              where criado_em >= inicio and combustivel_economizado_l > 0.005),
    -- Só a parte positiva: rota mais rápida que gasta um pouco mais não "desconta" economia.
    'litros_economizados', (select coalesce(sum(greatest(combustivel_economizado_l, 0)), 0)
                              from public.rotas_calculadas where criado_em >= inicio),
    'litros_consumidos',   (select coalesce(sum(combustivel_rota_l), 0)
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
