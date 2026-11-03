-- Códigos de recuperação da verificação em duas etapas (TOTP).
--
-- O Supabase Auth não tem códigos de recuperação: sem eles, quem perdia o celular dependia de um admin
-- apagar o fator no painel do Supabase. A API gera 10 códigos por conta (sessão aal2) e aceita um deles
-- numa sessão aal1 (senha certa) para remover os fatores TOTP (apps/api/routers/mfa.py).
--
-- Só o SHA-256 de cada código fica aqui (80 bits aleatórios por código: força bruta offline inviável).
-- RLS sem policy + revoke: nem o dono da conta lê os hashes; só a service_role da API lê e grava.
-- Cada código vale uma vez: a API marca usado_em com UPDATE ... WHERE usado_em IS NULL (trava contra uso duplo).

create table if not exists public.mfa_codigos_recuperacao (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references auth.users (id) on delete cascade,
  hash      text not null check (hash ~ '^[0-9a-f]{64}$'),
  criado_em timestamptz not null default now(),
  usado_em  timestamptz,
  unique (user_id, hash)
);
create index if not exists mfa_codigos_recuperacao_livres_idx
  on public.mfa_codigos_recuperacao (user_id) where usado_em is null;

alter table public.mfa_codigos_recuperacao enable row level security;
revoke all on table public.mfa_codigos_recuperacao from anon, authenticated;
