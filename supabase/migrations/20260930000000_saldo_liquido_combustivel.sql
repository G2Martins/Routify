-- Corrige viés apontado pelo orientador: a métrica "litros/minutos economizados"
-- somava só a parte positiva (greatest(x,0)), escondendo as rotas em que a LIA
-- trocou tempo por combustível (mais rápida, mais longa, gasta mais). O card
-- de CO2 evitado herdava o mesmo viés. Mantém o "ganho quando ganha" (métrica
-- antiga, valor real e defensável) mas acrescenta o saldo líquido (pode ser
-- negativo) para não passar a impressão de que a LIA só economiza.
--
-- Não edita a migration original (20260923030000_economia_combustivel.sql) —
-- convenção do repo é migration imutável; esta substitui a function via
-- create or replace, idempotente, pode rodar quantas vezes precisar.

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
    -- Rotas onde a LIA trocou tempo por combustível (gastou mais pra chegar
    -- antes) — contagem nova, pro card deixar de parecer "só ganho".
    'rotas_que_gastaram_mais', (select count(*) from public.rotas_calculadas
                               where criado_em >= inicio and combustivel_economizado_l < -0.005),
    -- "Ganho quando ganha" — só a parte positiva, como antes. Sozinho é
    -- enganoso; por isso agora sempre exibido ao lado de saldo_litros_liquido.
    'litros_economizados',  (select coalesce(sum(greatest(combustivel_economizado_l, 0)), 0)
                               from public.rotas_calculadas where criado_em >= inicio),
    -- Saldo líquido real: soma sem clamp, pode ser negativo.
    'saldo_litros_liquido', (select coalesce(sum(combustivel_economizado_l), 0)
                               from public.rotas_calculadas where criado_em >= inicio),
    'litros_consumidos',    (select coalesce(sum(combustivel_rota_l), 0)
                               from public.rotas_calculadas where criado_em >= inicio),
    'minutos_economizados', (select coalesce(sum(greatest(minutos_economizados, 0)), 0)
                               from public.rotas_calculadas where criado_em >= inicio),
    'saldo_minutos_liquido', (select coalesce(sum(minutos_economizados), 0)
                               from public.rotas_calculadas where criado_em >= inicio),
    'serie_diaria', coalesce((
      select jsonb_agg(jsonb_build_object(
               'dia', dia, 'litros', litros, 'saldo_litros', saldo_litros, 'rotas', rotas
             ) order by dia)
      from (select to_char(date_trunc('day', criado_em at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD') as dia,
                   round(sum(greatest(combustivel_economizado_l, 0))::numeric, 3) as litros,
                   round(sum(combustivel_economizado_l)::numeric, 3) as saldo_litros,
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
