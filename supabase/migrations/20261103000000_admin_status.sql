-- Status ao vivo do painel ADM (/admin/status): banco, coleta, comparador, uso da API e jobs do pg_cron numa
-- chamada só. Leve (índices em data_hora_coleta, rodada_em e criado_em): o painel chama a cada 30 s.
-- data_hora_coleta é timestamp sem fuso, gravado em UTC pelo coletor.
create or replace function public.admin_status_dados()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  agora_utc timestamp := now() at time zone 'utc';
begin
  if not public.is_admin() then
    raise exception 'acesso negado' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'agora',       now(),
    'banco_bytes', pg_catalog.pg_database_size(current_database()),
    'conexoes',    (select count(*) from pg_catalog.pg_stat_activity where datname = current_database()),
    'coleta', jsonb_build_object(
      'ultima',     (select max(data_hora_coleta) at time zone 'utc' from public.historico_trafego),
      'linhas_1h',  (select count(*) from public.historico_trafego where data_hora_coleta >= agora_utc - interval '1 hour'),
      'linhas_24h', (select count(*) from public.historico_trafego where data_hora_coleta >= agora_utc - interval '24 hours'),
      'pontos_24h', (select count(distinct id_ponto) from public.historico_trafego
                      where data_hora_coleta >= agora_utc - interval '24 hours')),
    'comparador', jsonb_build_object(
      'ultima_rodada', (select max(rodada_em) from public.comparacao_provedores),
      'rodadas_24h',   (select count(distinct rodada_em) from public.comparacao_provedores
                         where rodada_em >= now() - interval '24 hours')),
    'api', (select jsonb_build_object(
              'requisicoes',   count(*),
              'erros_5xx',     count(*) filter (where status >= 500),
              'limitadas_429', count(*) filter (where status = 429),
              'rota_p50_ms',   percentile_cont(0.5) within group (order by latencia_ms) filter (where rota = '/route' and status = 200),
              'rota_p95_ms',   percentile_cont(0.95) within group (order by latencia_ms) filter (where rota = '/route' and status = 200),
              'ultima',        max(criado_em))
            from public.api_requisicoes where criado_em >= now() - interval '24 hours'),
    'cron', coalesce((
      select jsonb_agg(jsonb_build_object('job', j.jobname, 'agenda', j.schedule, 'status', r.status,
                                          'inicio', r.start_time, 'mensagem', left(r.return_message, 200))
                       order by j.jobname)
      from cron.job j
      left join lateral (select d.status, d.start_time, d.return_message from cron.job_run_details d
                         where d.jobid = j.jobid order by d.start_time desc limit 1) r on true
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_status_dados() from public, anon;
grant execute on function public.admin_status_dados() to authenticated;
