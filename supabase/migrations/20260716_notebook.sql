-- Owner's Notebook: private dated research notes and appraisal snapshots.
-- Apply manually in the Supabase SQL editor (the project's migration discipline).
-- docs/notebook-valuation-design.md Track B — the notebook is the reader's private record
-- beside the published one. Two tables with two different disciplines:
--
--   notebook_notes      — editable prose. The reader may rewrite or delete their notes freely.
--   notebook_snapshots  — APPEND-ONLY. A snapshot is the reader's dated appraisal ("my
--                         assumptions on this date"), frozen with the day's bond yield and the
--                         record vintage it was taken against. It can be deleted (delete means
--                         delete — privacy outranks the ledger ethos on the reader's own data)
--                         but never edited: there is deliberately NO update policy, so even a
--                         reader with their own JWT cannot rewrite a dated appraisal through
--                         PostgREST. The discipline is the product.
--
-- Row-Level Security is the gate, enforced at the database. Every row is scoped to its owner;
-- the publication can never read, aggregate, or mine a reader's notebook — no service-role
-- path touches these tables anywhere in the codebase, and scripts/notebookTest.mjs fails the
-- build if one appears.

-- ---------------------------------------------------------------------------
-- notebook_notes — editable, per-user, per-ticker prose.
-- ---------------------------------------------------------------------------
create table public.notebook_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  ticker     text not null check (ticker ~ '^[A-Z][A-Z0-9.\-]{0,9}$'),
  body       text not null check (char_length(body) between 1 and 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notebook_notes_user_ticker
  on public.notebook_notes (user_id, ticker, updated_at desc);

alter table public.notebook_notes enable row level security;

create policy "notebook_notes: read own"
  on public.notebook_notes for select
  using (auth.uid() = user_id);

create policy "notebook_notes: insert own"
  on public.notebook_notes for insert
  with check (auth.uid() = user_id);

create policy "notebook_notes: update own"
  on public.notebook_notes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "notebook_notes: delete own"
  on public.notebook_notes for delete
  using (auth.uid() = user_id);

-- The cap lives in the database, not just the API, so a direct PostgREST insert with the
-- reader's own JWT cannot bypass it (same construction as the follows cap).
create or replace function public.enforce_note_cap()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.notebook_notes where user_id = new.user_id) >= 2000 then
    raise exception 'note limit reached';
  end if;
  return new;
end;
$$;

create trigger notebook_notes_cap
  before insert on public.notebook_notes
  for each row execute function public.enforce_note_cap();

-- ---------------------------------------------------------------------------
-- notebook_snapshots — append-only dated appraisals. No update policy, on purpose.
-- ---------------------------------------------------------------------------
create table public.notebook_snapshots (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references public.profiles (id) on delete cascade,
  ticker   text not null check (ticker ~ '^[A-Z][A-Z0-9.\-]{0,9}$'),
  taken_at timestamptz not null default now(),
  because  text check (because is null or char_length(because) <= 500),
  payload  jsonb not null check (pg_column_size(payload) <= 16384)
);

create index notebook_snapshots_user_ticker
  on public.notebook_snapshots (user_id, ticker, taken_at desc);

alter table public.notebook_snapshots enable row level security;

create policy "notebook_snapshots: read own"
  on public.notebook_snapshots for select
  using (auth.uid() = user_id);

create policy "notebook_snapshots: insert own"
  on public.notebook_snapshots for insert
  with check (auth.uid() = user_id);

create policy "notebook_snapshots: delete own"
  on public.notebook_snapshots for delete
  using (auth.uid() = user_id);

create or replace function public.enforce_snapshot_cap()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.notebook_snapshots where user_id = new.user_id) >= 5000 then
    raise exception 'snapshot limit reached';
  end if;
  return new;
end;
$$;

create trigger notebook_snapshots_cap
  before insert on public.notebook_snapshots
  for each row execute function public.enforce_snapshot_cap();
