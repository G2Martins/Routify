-- Corrige apontamento do orientador: "a LIA continua se avaliando" — o card
-- lia_vs_curta comparava tempo_lia_seg com tempo_rota_curta_seg, os dois
-- calculados pela própria LIA (mesmo travel_time_lia nos dois A*). Não havia
-- referência externa nessa métrica agregada, embora a API já chame a TomTom
-- Routing pra reconstruir o mesmo trajeto (rota_reconstruida, ver trajeto.py)
-- e grave o resultado em rotas_calculadas.referencia_tomtom_seg — só nunca
-- tinha sido lido aqui.
--
-- Acrescenta 'referencia_tomtom' dentro de lia_vs_curta: compara tempo_lia_seg
-- com referencia_tomtom_seg (ETA da TomTom sob trânsito ao vivo, no MESMO
-- trajeto da LIA) só nas linhas onde a fusão de fato conseguiu essa
-- referência — não é 100% das rotas (ver tomtom_degradado/cota), então expõe
-- também quantas linhas sustentam a média, para não virar estatística de
-- amostra pequena disfarçada de robusta.
--
-- Não remove 'ganho_medio_seg' (LIA vs. menor distância) — continua útil como
-- "quanto a LIA se afasta do vetor estático", só deixa de ser a única fonte de
-- validação, que era o problema apontado.

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
                        'com_incidente', count(*) filter (where incidentes_na_rota > 0),
                        'referencia_tomtom', jsonb_build_object(
                          'n_com_referencia', count(*) filter (where referencia_tomtom_seg is not null),
                          'ganho_medio_seg', round(avg(referencia_tomtom_seg - tempo_lia_seg)
                                                   filter (where referencia_tomtom_seg is not null), 1),
                          'lia_mais_rapida_pct', round(100.0 * count(*) filter (
                                                   where referencia_tomtom_seg is not null
                                                     and referencia_tomtom_seg > tempo_lia_seg
                                                 ) / nullif(count(*) filter (where referencia_tomtom_seg is not null), 0), 1)
                        ))
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

revoke execute on function public.admin_analytics_uso(integer) from public, anon;
grant execute on function public.admin_analytics_uso(integer) to authenticated;
