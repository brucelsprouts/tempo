-- Tempo — the base schema.
--
-- Extracted from the live database on 2026-09-19. Everything else in this
-- directory is a patch that ALTERs these tables; until now nothing in the repo
-- actually created them, because the originals were made by hand in the
-- Supabase dashboard. That gap only shows up at the worst possible moment —
-- standing up a fresh database and finding the migrations have nothing to
-- alter — so it lives here now.
--
-- Run this FIRST against an empty project, then the dated migrations in order.
-- Idempotent: every statement guards itself, so a second run is harmless.
--
-- Assumes Supabase's own `auth` schema already exists (GoTrue creates it on
-- first start). The owner columns are foreign keys into `auth.users`.

-- ------------------------------------------------------------------- types

do $$
begin
  if not exists (select 1 from pg_type where typname = 'event_kind') then
    create type public.event_kind as enum ('event', 'assignment', 'milestone', 'birthday');
  end if;
  if not exists (select 1 from pg_type where typname = 'event_source') then
    create type public.event_source as enum ('tempo', 'google');
  end if;
  if not exists (select 1 from pg_type where typname = 'event_status') then
    create type public.event_status as enum ('todo', 'doing', 'done');
  end if;
end;
$$;

-- ------------------------------------------------------------------ tables

create table if not exists public.categories (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  color text not null default '#8a8a8a'::text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null,
  title text not null,
  notes text,
  kind event_kind not null default 'event'::event_kind,
  category_id uuid,
  all_day boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  start_date date,
  end_date date,
  timezone text not null default 'America/Toronto'::text,
  recurrence jsonb,
  anchor_date date,
  display_template text,
  status event_status,
  notify boolean not null default false,
  reminders jsonb,
  source event_source not null default 'tempo'::event_source,
  google_event_id text,
  google_calendar_id text,
  google_synced_at timestamptz,
  google_sync_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  due_minutes smallint
);

create table if not exists public.occurrence_overrides (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null,
  event_id uuid not null,
  occurrence_date date not null,
  cancelled boolean not null default false,
  patch jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_versions (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null,
  event_id uuid not null,
  snapshot jsonb not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  failure_count integer not null default 0
);

create table if not exists public.reminder_deliveries (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null,
  event_id uuid not null,
  occurrence_date date not null,
  minutes integer not null,
  fire_at timestamptz not null,
  sent_at timestamptz not null default now(),
  anchor text not null default 'start'::text
);

-- Google Calendar mirroring: the schema is here, the feature is not wired up.
create table if not exists public.integrations (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null,
  provider text not null default 'google'::text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  calendar_id text,
  sync_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.google_events_cache (
  id text not null,
  owner_id uuid not null,
  calendar_id text not null,
  etag text,
  summary text,
  all_day boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  start_date date,
  end_date date,
  html_link text,
  raw jsonb,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------- constraints

do $$
declare
  stmt text;
begin
  foreach stmt in array array[
    'alter table public.categories add constraint categories_pkey primary key (id)',
    'alter table public.categories add constraint categories_owner_id_name_key unique (owner_id, name)',
    'alter table public.categories add constraint categories_owner_id_fkey foreign key (owner_id) references auth.users(id) on delete cascade',

    'alter table public.events add constraint events_pkey primary key (id)',
    'alter table public.events add constraint events_owner_id_fkey foreign key (owner_id) references auth.users(id) on delete cascade',
    'alter table public.events add constraint events_category_id_fkey foreign key (category_id) references public.categories(id) on delete set null',
    'alter table public.events add constraint events_due_minutes_range check (due_minutes is null or (due_minutes >= 0 and due_minutes < 1440))',
    'alter table public.events add constraint events_derived_needs_anchor check (display_template is null or display_template not like ''%{yearsSince}%'' or anchor_date is not null)',
    'alter table public.events add constraint events_timing_order check (case when all_day then end_date >= start_date else ends_at >= starts_at end)',
    'alter table public.events add constraint events_timing_shape check ((all_day and start_date is not null and end_date is not null and starts_at is null and ends_at is null) or ((not all_day) and starts_at is not null and ends_at is not null and start_date is null and end_date is null))',

    'alter table public.occurrence_overrides add constraint occurrence_overrides_pkey primary key (id)',
    'alter table public.occurrence_overrides add constraint occurrence_overrides_event_id_occurrence_date_key unique (event_id, occurrence_date)',
    'alter table public.occurrence_overrides add constraint occurrence_overrides_owner_id_fkey foreign key (owner_id) references auth.users(id) on delete cascade',
    'alter table public.occurrence_overrides add constraint occurrence_overrides_event_id_fkey foreign key (event_id) references public.events(id) on delete cascade',

    'alter table public.event_versions add constraint event_versions_pkey primary key (id)',
    'alter table public.event_versions add constraint event_versions_owner_id_fkey foreign key (owner_id) references auth.users(id) on delete cascade',

    'alter table public.push_subscriptions add constraint push_subscriptions_pkey primary key (id)',
    'alter table public.push_subscriptions add constraint push_subscriptions_endpoint_key unique (endpoint)',
    'alter table public.push_subscriptions add constraint push_subscriptions_owner_id_fkey foreign key (owner_id) references auth.users(id) on delete cascade',

    'alter table public.reminder_deliveries add constraint reminder_deliveries_pkey primary key (id)',
    'alter table public.reminder_deliveries add constraint reminder_deliveries_claim unique (event_id, occurrence_date, anchor, minutes)',
    'alter table public.reminder_deliveries add constraint reminder_deliveries_owner_id_fkey foreign key (owner_id) references auth.users(id) on delete cascade',

    'alter table public.integrations add constraint integrations_pkey primary key (id)',
    'alter table public.integrations add constraint integrations_owner_id_provider_key unique (owner_id, provider)',
    'alter table public.integrations add constraint integrations_owner_id_fkey foreign key (owner_id) references auth.users(id) on delete cascade',

    'alter table public.google_events_cache add constraint google_events_cache_pkey primary key (id)',
    'alter table public.google_events_cache add constraint google_events_cache_owner_id_fkey foreign key (owner_id) references auth.users(id) on delete cascade'
  ] loop
    begin
      execute stmt;
    exception
      -- Already there. There is no `add constraint if not exists`, and matching
      -- on the name in pg_constraint first would miss the ones Postgres names
      -- itself, so the cheap correct thing is to try and forgive.
      when duplicate_table or duplicate_object then null;
    end;
  end loop;
end;
$$;

-- ----------------------------------------------------------------- indexes

create index if not exists events_owner_idx on public.events using btree (owner_id);
create index if not exists events_live_idx on public.events using btree (owner_id) where (deleted_at is null);
create index if not exists events_owner_date_idx on public.events using btree (owner_id, start_date) where all_day;
create index if not exists events_owner_ts_idx on public.events using btree (owner_id, starts_at) where (not all_day);
create index if not exists events_recurring_idx on public.events using btree (owner_id) where (recurrence is not null);
create index if not exists events_google_id_idx on public.events using btree (google_event_id) where (google_event_id is not null);
create index if not exists overrides_event_idx on public.occurrence_overrides using btree (event_id, occurrence_date);
create index if not exists event_versions_lookup on public.event_versions using btree (owner_id, event_id, created_at desc);
create index if not exists push_subscriptions_owner_idx on public.push_subscriptions using btree (owner_id);
create index if not exists reminder_deliveries_sweep_idx on public.reminder_deliveries using btree (sent_at);
create index if not exists gcache_owner_date_idx on public.google_events_cache using btree (owner_id, start_date);
create index if not exists gcache_owner_ts_idx on public.google_events_cache using btree (owner_id, starts_at);

-- --------------------------------------------------------------- functions

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

-- Bodies for the two retention sweeps live in their own migrations
-- (`20260801_version_retention.sql`, `20260801_push.sql`); these are the
-- shapes as they stand, so a fresh database is correct before those run.
create or replace function public.prune_event_versions()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  with ranked as (
    select id, created_at,
      case
        when created_at > now() - interval '1 day'   then 'live'
        when created_at > now() - interval '30 days' then to_char(created_at, 'YYYY-MM-DD')
        when created_at > now() - interval '1 year'  then to_char(created_at, 'YYYY-MM')
        else null
      end as bucket
    from public.event_versions
    where event_id = new.event_id and owner_id = new.owner_id
  ),
  keep as (
    (select id from ranked where bucket = 'live')
    union
    (select distinct on (bucket) id from ranked
      where bucket is not null and bucket <> 'live'
      order by bucket, created_at desc)
    union
    (select id from ranked order by created_at desc limit 5)
  )
  delete from public.event_versions
  where event_id = new.event_id and owner_id = new.owner_id
    and id not in (select id from keep);
  return null;
end;
$function$;

create or replace function public.prune_reminder_deliveries()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  delete from public.reminder_deliveries
  where sent_at < now() - interval '30 days';
  return null;
end;
$function$;

-- PostgREST publishes everything in `public` as an RPC endpoint, which would
-- leave a SECURITY DEFINER sweep callable over HTTP by an anonymous request.
revoke execute on function public.prune_reminder_deliveries() from anon, authenticated, public;

-- ---------------------------------------------------------------- triggers

drop trigger if exists categories_touch on public.categories;
create trigger categories_touch before update on public.categories
  for each row execute function public.set_updated_at();

drop trigger if exists events_touch on public.events;
create trigger events_touch before update on public.events
  for each row execute function public.set_updated_at();

drop trigger if exists overrides_touch on public.occurrence_overrides;
create trigger overrides_touch before update on public.occurrence_overrides
  for each row execute function public.set_updated_at();

drop trigger if exists integrations_touch on public.integrations;
create trigger integrations_touch before update on public.integrations
  for each row execute function public.set_updated_at();

drop trigger if exists event_versions_prune on public.event_versions;
create trigger event_versions_prune after insert on public.event_versions
  for each row execute function public.prune_event_versions();

drop trigger if exists reminder_deliveries_prune on public.reminder_deliveries;
create trigger reminder_deliveries_prune after insert on public.reminder_deliveries
  for each statement execute function public.prune_reminder_deliveries();

-- --------------------------------------------------------------------- RLS

alter table public.categories            enable row level security;
alter table public.events                enable row level security;
alter table public.occurrence_overrides  enable row level security;
alter table public.event_versions        enable row level security;
alter table public.push_subscriptions    enable row level security;
alter table public.integrations          enable row level security;
alter table public.google_events_cache   enable row level security;

-- Enabled with no policies at all, so anon and authenticated reach nothing
-- here and only the service role — which bypasses RLS — can read or write.
alter table public.reminder_deliveries   enable row level security;

drop policy if exists owner_all on public.categories;
create policy owner_all on public.categories for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy if exists owner_all on public.events;
create policy owner_all on public.events for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy if exists owner_all on public.occurrence_overrides;
create policy owner_all on public.occurrence_overrides for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy if exists owner_all on public.google_events_cache;
create policy owner_all on public.google_events_cache for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy if exists event_versions_owner on public.event_versions;
create policy event_versions_owner on public.event_versions for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists push_subscriptions_owner on public.push_subscriptions;
create policy push_subscriptions_owner on public.push_subscriptions for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- `integrations` deliberately has no policy: it holds Google refresh tokens and
-- is reachable only by the service role.

-- ---------------------------------------------------------------- realtime

do $$
declare
  t text;
begin
  foreach t in array array['events', 'occurrence_overrides', 'categories'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- A DELETE carries only the primary key by default, so the client's
-- `owner_id=eq.<me>` filter cannot match and the deletion is dropped before it
-- reaches anyone. See `20260801_realtime.sql`.
alter table public.events               replica identity full;
alter table public.occurrence_overrides replica identity full;
alter table public.categories           replica identity full;
