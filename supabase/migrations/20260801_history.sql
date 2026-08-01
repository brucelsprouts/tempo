-- Tempo — deletion recovery and version history
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- It is idempotent: running it twice is harmless.
--
-- Two separate mechanisms, deliberately:
--   * `events.deleted_at` — an entry you removed, restorable whole.
--   * `event_versions`    — an entry you *changed*, restorable to a past shape.
-- A trash cannot answer "what did this look like last Tuesday", and a version
-- log cannot answer "what did I delete", so neither one substitutes for the other.

-- ---------------------------------------------------------------- soft delete

alter table public.events
  add column if not exists deleted_at timestamptz;

-- Every ordinary read filters on this, so it is worth the partial index rather
-- than a plain one: the live rows are the hot set and the deleted ones are a
-- tail nobody scans except the history panel.
create index if not exists events_live_idx
  on public.events (owner_id)
  where deleted_at is null;

-- ------------------------------------------------------------------ versions

create table if not exists public.event_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,

  -- Deliberately NOT a foreign key to `events`.
  --
  -- The whole point is to outlive the row: a hard delete must leave its history
  -- standing, or "restore what I deleted" and "roll back to an older shape"
  -- become the same button with the same blind spot. Orphans are bounded by the
  -- retention trigger below.
  event_id uuid not null,

  -- The full row as it was, so a restore is an insert of known values rather
  -- than a reconstruction from a diff.
  snapshot jsonb not null,

  -- What produced this version: 'edit', 'move', 'resize', 'status', 'delete'.
  reason text not null,

  created_at timestamptz not null default now()
);

alter table public.event_versions enable row level security;

drop policy if exists event_versions_owner on public.event_versions;
create policy event_versions_owner on public.event_versions
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create index if not exists event_versions_lookup
  on public.event_versions (owner_id, event_id, created_at desc);

-- ----------------------------------------------------------------- retention

-- Enforced here rather than in the client, because a retention policy the
-- client owns is one a client that crashes mid-write silently stops applying —
-- and this table grows on every edit.
create or replace function public.prune_event_versions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.event_versions
  where event_id = new.event_id
    and owner_id = new.owner_id
    and id not in (
      select id
      from public.event_versions
      where event_id = new.event_id
        and owner_id = new.owner_id
      order by created_at desc
      limit 10
    );
  return null;
end;
$$;

drop trigger if exists event_versions_prune on public.event_versions;
create trigger event_versions_prune
  after insert on public.event_versions
  for each row
  execute function public.prune_event_versions();
