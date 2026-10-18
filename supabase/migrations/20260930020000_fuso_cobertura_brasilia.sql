-- Corrige apontamento do orientador: painel.mv_qualidade_cobertura calculava
-- hora/dia da semana em UTC, enquanto o resto do painel (séries diárias de
-- combustível, formato de datas em apps/admin/src/lib/formato.ts) usa
-- America/Sao_Paulo. Resultado: o mapa de calor hora×dia de cobertura
-- aparecia deslocado ~3h do horário real de Brasília em relação às outras
-- telas. A UI já avisava "Horário do banco (UTC)" — o aviso ficava
-- correto, mas o certo é não precisar dele: alinhar ao fuso do resto do
-- painel.
--
-- data_hora_coleta é timestamptz (UTC internamente); "at time zone" converte
-- pra hora local de Brasília antes de extrair dia/hora.

drop materialized view if exists painel.mv_qualidade_cobertura;

create materialized view painel.mv_qualidade_cobertura as
select extract(isodow from data_hora_coleta at time zone 'America/Sao_Paulo')::int as dia_semana,  -- 1 = segunda … 7 = domingo
       extract(hour  from data_hora_coleta at time zone 'America/Sao_Paulo')::int as hora,
       count(*)                                                                   as n
from public.historico_trafego
group by 1, 2;
