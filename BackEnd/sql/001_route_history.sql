-- ============================================================
-- Routify — Histórico de rotas otimizadas (auth Supabase)
-- ============================================================
-- Rodar no SQL Editor do Supabase Dashboard

-- Tabela de histórico
create table if not exists public.route_history (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  origem_label    text not null,
  origem_lat      double precision not null,
  origem_lon      double precision not null,
  destino_label   text not null,
  destino_lat     double precision not null,
  destino_lon     double precision not null,
  polyline        jsonb not null,                  -- [[lat, lon], ...]
  tempo_total_seg integer not null,
  distancia_km    numeric(8,2) not null,
  via_principal   text,
  modelo_versao   text,
  created_at      timestamptz default now()
);

create index if not exists idx_route_history_user_created
  on public.route_history (user_id, created_at desc);

-- ============================================================
-- Row Level Security: cada usuário só vê seu próprio histórico
-- ============================================================
alter table public.route_history enable row level security;

drop policy if exists "Users read own routes"   on public.route_history;
drop policy if exists "Users insert own routes" on public.route_history;
drop policy if exists "Users delete own routes" on public.route_history;

create policy "Users read own routes"
  on public.route_history for select
  using (auth.uid() = user_id);

create policy "Users insert own routes"
  on public.route_history for insert
  with check (auth.uid() = user_id);

create policy "Users delete own routes"
  on public.route_history for delete
  using (auth.uid() = user_id);

-- ============================================================
-- (Opcional) Profile do usuário com nome + avatar
-- ============================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text,
  avatar_url  text,
  preferencia_tema text default 'auto',  -- 'light' | 'dark' | 'auto'
  preferencia_mapa text default 'dark',  -- 'dark' | 'street' | 'satellite'
  created_at  timestamptz default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Profiles select own"  on public.profiles;
drop policy if exists "Profiles upsert own"  on public.profiles;
drop policy if exists "Profiles update own"  on public.profiles;

create policy "Profiles select own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Profiles upsert own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Profiles update own"
  on public.profiles for update
  using (auth.uid() = id);

-- Trigger: criar profile vazio ao registrar
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, nome)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
