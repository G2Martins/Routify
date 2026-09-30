-- ============================================================
-- Routify — Instrumentação para validação da tese (TCC 2)
-- ============================================================
-- Rodar no SQL Editor do Supabase Dashboard, depois de 001_route_history.sql
--
-- MOTIVAÇÃO
-- A tabela route_history guardava apenas a PREDIÇÃO (tempo_total_seg), sem
-- nenhuma referência contra a qual compará-la. Com isso não é possível sustentar
-- a afirmação da página 7 do artigo do TCC 1:
--
--   "Comparado aos vetores estáticos, a precisão conquistada já é formidavelmente
--    superior, provando matematicamente a tese base da pesquisa."
--
-- Essa comparação nunca foi medida. As colunas abaixo são o que torna possível
-- medi-la: tempo real da viagem (verdade), rota mais curta em distância
-- (baseline interno) e ETA do Google (referência externa).
--
-- Idempotente: pode ser executado mais de uma vez sem efeito colateral.
-- ============================================================

-- ---------- Verdade terrestre, informada pelo usuário ----------
alter table public.route_history
  add column if not exists tempo_real_seg integer,
  add column if not exists feedback_em    timestamptz;

comment on column public.route_history.tempo_real_seg is
  'Duração real da viagem em segundos, informada pelo usuário ao chegar. NULL enquanto não reportado.';

-- ---------- Baseline interno: rota mais curta em distância ----------
alter table public.route_history
  add column if not exists tempo_rota_curta_seg    integer,
  add column if not exists distancia_rota_curta_km numeric(8,2),
  add column if not exists rotas_diferentes        boolean;

comment on column public.route_history.tempo_rota_curta_seg is
  'Tempo previsto pela LIA para a rota de menor distância. Permite medir se ponderar por IA muda a decisão e em quanto.';
comment on column public.route_history.rotas_diferentes is
  'true quando a rota da LIA difere da rota de menor distância.';

-- ---------- Referência externa ----------
alter table public.route_history
  add column if not exists eta_google_seg integer;

comment on column public.route_history.eta_google_seg is
  'ETA do Google Maps para o mesmo par origem-destino. É predição de terceiro, não verdade — declarar isso na análise.';

-- ---------- Contexto temporal, para separar pico de fora-pico ----------
alter table public.route_history
  add column if not exists hora_partida smallint,
  add column if not exists dia_semana   smallint;

comment on column public.route_history.hora_partida is
  'Hora (0-23) no fuso de Brasília em que a rota foi calculada.';
comment on column public.route_history.dia_semana is
  'Dia da semana (0=segunda ... 6=domingo), compatível com o encoding usado no treino.';

-- ---------- Qualidade da predição naquela rota ----------
alter table public.route_history
  add column if not exists lia_cobertura_pct numeric(5,2);

comment on column public.route_history.lia_cobertura_pct is
  'Percentual das arestas da rota cujo peso veio do modelo ou de transferência (não da heurística). Permite testar se rotas com mais cobertura preveem melhor.';

-- ---------- Índices para as consultas de análise ----------
-- Parcial: as análises filtram por viagens com tempo real reportado, que são
-- minoria. Um índice sobre a tabela toda seria desperdício.
create index if not exists idx_route_history_validacao
  on public.route_history (created_at desc)
  where tempo_real_seg is not null;

create index if not exists idx_route_history_hora
  on public.route_history (hora_partida, dia_semana);

-- ---------- RLS ----------
-- As políticas de 001 (select/insert/delete por dono) já cobrem as colunas
-- novas. Faltava UPDATE: sem ela o usuário não consegue preencher o tempo real
-- da própria viagem.
drop policy if exists "Users update own routes" on public.route_history;

create policy "Users update own routes"
  on public.route_history for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- Conferência
-- ============================================================
-- select column_name, data_type
--   from information_schema.columns
--  where table_name = 'route_history'
--  order by ordinal_position;
