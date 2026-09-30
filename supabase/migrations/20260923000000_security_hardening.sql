-- Endurecimento de segurança — auditoria de 2026-09-23, logo após restaurar o
-- projeto pausado. Aplicar DEPOIS de 20260907000000_thesis_validation.sql.
-- Idempotente: pode rodar de novo sem efeito colateral.

-- 1. Dataset do TCC. RLS estava desligado e o papel anon tinha SELECT/INSERT/
--    DELETE (advisor 0013 rls_disabled_in_public, nível ERROR): qualquer um com
--    a chave pública do app lia e apagava o dataset via PostgREST.
--    Quem usa essas tabelas (API, coletor, ml/) conecta com service_role, que
--    ignora RLS; o app só lê profiles e route_history. RLS sem policy nenhuma =
--    acesso negado a anon/authenticated; o revoke é a segunda camada.
alter table public.historico_trafego enable row level security;
alter table public.vias_monitoradas  enable row level security;
alter table public.malha_completa    enable row level security;

revoke all on table public.historico_trafego, public.vias_monitoradas, public.malha_completa
  from anon, authenticated;

-- 2. route_history. A policy de UPDATE (thesis_validation) deixa o dono mudar
--    qualquer coluna da própria linha — inclusive o tempo previsto, que é o dado
--    de validação da tese. O cliente só precisa gravar o feedback de tempo real.
revoke update on table public.route_history from anon, authenticated;
grant update (tempo_real_seg, feedback_em) on table public.route_history to authenticated;

-- 3. handle_new_user é trigger de auth.users, não RPC (advisors 0028/0029):
--    tira o EXECUTE de quem chama pela API e fixa o search_path (advisor 0011;
--    o corpo já usa public.profiles qualificado).
revoke execute on function public.handle_new_user() from public, anon, authenticated;
alter function public.handle_new_user() set search_path = '';
