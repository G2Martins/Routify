-- Uso real das chaves TomTom por dia, chave, serviço e origem (coletor na EC2, API), para /admin/operacao comparar
-- com a cota mensal (Flow 20 mil, Incidents 2,5 mil, Search 2,5 mil, Routing 20 mil por chave). Antes o painel só via
-- o pool em memória da API; o coletor, que gasta ~85% do Flow, ficava de fora.
-- Escrita: RPC registrar_tomtom_uso (só service_role; soma no conflito, sem corrida). Leitura: admin_tomtom_uso.
-- Só o id da chave entra aqui, nunca o valor.

create table if not exists public.tomtom_uso_dia (
  dia           date not null,
  chave_id      text not null check (chave_id ~ '^[A-Za-z0-9_.-]{1,40}$'),
  servico       text not null check (servico in ('fluxo', 'incidentes', 'busca', 'rota')),
  origem        text not null check (origem in ('coletor', 'api', 'comparador', 'ab')),
  chamadas      integer not null default 0 check (chamadas >= 0),
  falhas        integer not null default 0 check (falhas >= 0),
  ultimo_status smallint,
  cooldown_ate  timestamptz,
  atualizado_em timestamptz not null default now(),
  primary key (dia, chave_id, servico, origem)
);
alter table public.tomtom_uso_dia enable row level security;
revoke all on table public.tomtom_uso_dia from anon, authenticated;

create or replace function public.registrar_tomtom_uso(p_origem text, p_linhas jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.tomtom_uso_dia as u
    (dia, chave_id, servico, origem, chamadas, falhas, ultimo_status, cooldown_ate, atualizado_em)
  select (now() at time zone 'utc')::date, l->>'chave_id', l->>'servico', p_origem,
         coalesce((l->>'chamadas')::integer, 0), coalesce((l->>'falhas')::integer, 0),
         (l->>'ultimo_status')::smallint, (l->>'cooldown_ate')::timestamptz, now()
  from jsonb_array_elements(p_linhas) as l
  on conflict (dia, chave_id, servico, origem) do update set
    chamadas      = u.chamadas + excluded.chamadas,
    falhas        = u.falhas + excluded.falhas,
    ultimo_status = coalesce(excluded.ultimo_status, u.ultimo_status),
    cooldown_ate  = excluded.cooldown_ate,
    atualizado_em = now();
$$;
revoke all on function public.registrar_tomtom_uso(text, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_tomtom_uso(text, jsonb) to service_role;

create or replace function public.admin_tomtom_uso()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  hoje date := (now() at time zone 'utc')::date;
  inicio_mes date := date_trunc('month', now() at time zone 'utc')::date;
begin
  if not public.is_admin() then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'hoje', hoje,
    'dia_do_mes', extract(day from hoje)::integer,
    'dias_no_mes', extract(day from (inicio_mes + interval '1 month - 1 day'))::integer,
    'linhas', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.chave_id, x.servico, x.origem)
      from (select chave_id, servico, origem,
                   sum(chamadas)::integer as mes,
                   coalesce(sum(chamadas) filter (where dia = hoje), 0)::integer as hoje,
                   sum(falhas)::integer as falhas_mes,
                   (array_agg(ultimo_status order by atualizado_em desc))[1] as ultimo_status,
                   max(cooldown_ate) filter (where dia = hoje) as cooldown_ate,
                   max(atualizado_em) as atualizado_em
            from public.tomtom_uso_dia
            where dia >= inicio_mes
            group by chave_id, servico, origem) as x
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_tomtom_uso() from public, anon;
grant execute on function public.admin_tomtom_uso() to authenticated;
