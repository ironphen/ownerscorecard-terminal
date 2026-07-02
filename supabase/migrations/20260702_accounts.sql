-- Phase 1 accounts spine: profiles, follows, wire subscriptions.
-- Apply manually in the Supabase SQL editor (the project's migration discipline).
-- docs/phase-2-plan.md §4 — a free account gates nothing that is free today; it powers
-- exactly two things: following a company and receiving the wire by email.
--
-- Row-Level Security is the gate, enforced at the database. Every table denies by
-- default; a user reaches only their own rows. The service role (used only by the
-- wire-mailer script) bypasses RLS by design.

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user, created by trigger on signup.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: read own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id);

-- Signup trigger: provision the profile row the moment auth.users gets the user,
-- so the app never has to "get or create" (and a failed first request can't leave
-- an account half-provisioned).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- follows — the companies a reader watches. Composite key = natural dedupe.
-- Ticker format is checked here as well as in the API (defense in depth); the
-- API additionally validates against the catalog at request time.
-- ---------------------------------------------------------------------------
create table public.follows (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  ticker     text not null check (ticker ~ '^[A-Z][A-Z0-9.\-]{0,9}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, ticker)
);

alter table public.follows enable row level security;

create policy "follows: read own"
  on public.follows for select
  using (auth.uid() = user_id);

create policy "follows: insert own"
  on public.follows for insert
  with check (auth.uid() = user_id);

create policy "follows: delete own"
  on public.follows for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- wire_subscriptions — the wire-by-email preference. One row per user; the
-- mailer (service role, run from the wire GitHub Action) reads enabled rows and
-- joins follows for scope 'follows'.
-- ---------------------------------------------------------------------------
create table public.wire_subscriptions (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  scope      text not null default 'follows' check (scope in ('follows', 'all')),
  frequency  text not null default 'weekly' check (frequency in ('daily', 'weekly')),
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.wire_subscriptions enable row level security;

create policy "wire: read own"
  on public.wire_subscriptions for select
  using (auth.uid() = user_id);

create policy "wire: insert own"
  on public.wire_subscriptions for insert
  with check (auth.uid() = user_id);

create policy "wire: update own"
  on public.wire_subscriptions for update
  using (auth.uid() = user_id);
