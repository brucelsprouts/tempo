-- Tempo — reminders that count back from the deadline, and due times
--
-- Run this once in the Supabase SQL editor. Idempotent: running it twice is
-- harmless.
--
-- Run it alongside deploying the code that reads it, in either order. The
-- dispatcher looks an hour back on every tick, so a reminder that falls in the
-- gap between the two is sent late rather than lost. Saving an entry is the one
-- thing that waits for the migration: a client that writes `due_minutes` to a
-- table without the column is refused, and the edit rolls back.
--
-- Nothing already on the calendar changes. A stored reminder with no `from`
-- still counts from the start, and an entry with no due time is due at 23:55.

-- ---------------------------------------------------------------- due times

-- Minutes past midnight on an all-day entry's last day. Null is 23:55, which is
-- when nearly everything is due, so only a deadline that says otherwise stores
-- one. An entry with a time is due when it starts and never holds one.
alter table public.events
  add column if not exists due_minutes smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'events_due_minutes_range'
  ) then
    alter table public.events
      add constraint events_due_minutes_range
      check (due_minutes is null or (due_minutes >= 0 and due_minutes < 1440));
  end if;
end;
$$;

-- --------------------------------------------------------------- deliveries

-- Which point the reminder counted back from: 'start', 'dueDay' or 'due'.
--
-- Part of the claim now, because minutes alone no longer name a reminder. An
-- entry stretched across a week sends "09:00 the day it starts" and "09:00 the
-- day it's due" — both stored as -540 — and under the old key the second would
-- find the first's claim and never be sent. Existing rows were all counted from
-- the start, which is what the default says.
alter table public.reminder_deliveries
  add column if not exists anchor text not null default 'start';

alter table public.reminder_deliveries
  drop constraint if exists reminder_deliveries_event_id_occurrence_date_minutes_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reminder_deliveries_claim'
  ) then
    alter table public.reminder_deliveries
      add constraint reminder_deliveries_claim
      unique (event_id, occurrence_date, anchor, minutes);
  end if;
end;
$$;
