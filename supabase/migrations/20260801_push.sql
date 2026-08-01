-- Tempo — push subscriptions and reminder delivery
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- It is idempotent: running it twice is harmless.
--
-- Two tables with opposite audiences, deliberately:
--   * `push_subscriptions`  — written by the browser, so RLS-owned like the
--                             rest of the calendar.
--   * `reminder_deliveries` — written only by the dispatcher, so RLS-enabled
--                             with no policies at all, reachable exclusively by
--                             the service role. Same shape as `integrations`.

-- ------------------------------------------------------------- subscriptions

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,

  -- The push service's URL for this device. Unique because it *is* the device
  -- identity as far as the Web Push spec is concerned: re-subscribing after
  -- iOS drops a registration hands back the same endpoint, and an upsert on it
  -- is what stops one phone accumulating a row per launch.
  endpoint text not null unique,

  -- The keys the payload is encrypted to. Useless without the VAPID private
  -- key, which never leaves the server environment.
  p256dh text not null,
  auth text not null,

  -- Which device this is, so the settings list can distinguish two phones.
  user_agent text,

  created_at timestamptz not null default now(),

  -- Touched on every launch. The gap between this and now() is how you tell a
  -- subscription Apple has quietly stopped delivering to from a live one.
  last_seen_at timestamptz not null default now(),

  -- Consecutive send failures. A subscription is pruned on a hard 404/410 from
  -- the push service; this counts the soft failures that don't justify one.
  failure_count integer not null default 0
);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_owner on public.push_subscriptions;
create policy push_subscriptions_owner on public.push_subscriptions
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create index if not exists push_subscriptions_owner_idx
  on public.push_subscriptions (owner_id);

-- ---------------------------------------------------------------- deliveries

-- What has already been sent, and the reason the dispatcher can run twice a
-- minute without ever notifying you twice.
--
-- There is no "pending" state here and there deliberately cannot be. Occurrences
-- are derived, never stored, so there is no row to mark as scheduled — the
-- dispatcher recomputes what came due and this table records only what went
-- out. That also means a reminder cannot outlive the event it belongs to: delete
-- the event and the reminder stops, with nothing to clean up.
create table if not exists public.reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,

  -- Not a foreign key, for the same reason `event_versions.event_id` isn't: a
  -- hard delete of the event must not take the record of what was sent with it
  -- mid-flight. Bounded by the retention sweep below.
  event_id uuid not null,

  -- The date the occurrence *would* have fallen on, before any override moved
  -- it. Dragging an occurrence must not make its reminder eligible again, so
  -- the identity has to be the stable one — the same key overrides use.
  occurrence_date date not null,

  -- Which reminder of the event's list. Two leads on one occurrence are two
  -- separate deliveries.
  minutes integer not null,

  -- When it was due, as opposed to when it actually went out. The difference is
  -- how late the ticker was running.
  fire_at timestamptz not null,
  sent_at timestamptz not null default now(),

  -- The claim. An insert that violates this is the dispatcher discovering
  -- another tick already took the reminder, which is the entire concurrency
  -- design: insert first, send only what the insert returned.
  unique (event_id, occurrence_date, minutes)
);

-- Enabled with no policies, so the anon and authenticated roles can reach
-- nothing here. Only the service role, which bypasses RLS, can read or write.
alter table public.reminder_deliveries enable row level security;

create index if not exists reminder_deliveries_sweep_idx
  on public.reminder_deliveries (sent_at);

-- ----------------------------------------------------------------- retention

-- This table gains a row per reminder per occurrence forever, and nothing reads
-- anything older than the dispatcher's catch-up window. Thirty days is far past
-- the point the record stops being able to suppress a duplicate, and keeps the
-- table small enough that the unique index stays in memory.
create or replace function public.prune_reminder_deliveries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.reminder_deliveries
  where sent_at < now() - interval '30 days';
  return null;
end;
$$;

drop trigger if exists reminder_deliveries_prune on public.reminder_deliveries;
create trigger reminder_deliveries_prune
  after insert on public.reminder_deliveries
  -- Statement-level, not per row: the dispatcher inserts a batch, and running a
  -- range delete once per reminder in that batch would be the same sweep
  -- repeated for no benefit.
  for each statement
  execute function public.prune_reminder_deliveries();

-- The trigger runs this as the table owner and needs no grant, but PostgREST
-- publishes everything in `public` as an RPC endpoint — so the default grant
-- left a SECURITY DEFINER retention sweep callable over HTTP by an anonymous
-- request. Caught by Supabase's own database linter, which is worth running
-- after any migration that adds a function.
revoke execute on function public.prune_reminder_deliveries() from anon, authenticated, public;

-- -------------------------------------------------------------------- ticker
--
-- The heartbeat. pg_cron calls the dispatcher every minute; the route works out
-- what came due and sends it. Living here rather than in `vercel.json` keeps it
-- independent of the hosting plan — Vercel's Hobby tier caps cron at once a day,
-- which cannot deliver a "15 minutes before" reminder at all.
--
-- Both extensions ship with Supabase but are off by default.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- MANUAL STEP. The two lines below cannot be committed with real values, so
-- fill them in and run this block yourself:
--
--   * <APP_URL>      your deployed origin, e.g. https://tempo.example.com
--   * <CRON_SECRET>  the same value as the CRON_SECRET environment variable
--
-- Localhost will not work: pg_cron runs inside Supabase and has to reach a
-- public URL.
--
--   select cron.schedule(
--     'tempo-reminders',
--     '* * * * *',
--     $$
--     select net.http_post(
--       url     := '<APP_URL>/api/push/dispatch',
--       headers := jsonb_build_object(
--         'Content-Type',  'application/json',
--         'Authorization', 'Bearer <CRON_SECRET>'
--       ),
--       timeout_milliseconds := 20000
--     );
--     $$
--   );
--
-- To inspect or remove it later:
--   select * from cron.job;
--   select cron.unschedule('tempo-reminders');
-- ---------------------------------------------------------------------------
