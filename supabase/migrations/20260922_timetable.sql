-- Tempo — a timetable flag on entries
--
-- Run this once in the Supabase SQL editor, whenever is convenient. Idempotent:
-- running it twice is harmless.
--
-- Nothing waits for it. A client running against a database without the column
-- reads the missing value as `false`, which is what every existing entry means;
-- an older client ignores the column entirely.
--
-- Marked entries drop out of the scroll, list and year views and appear in the
-- week view. It is a view concern and stops at the view: reminders, export,
-- exceptions and history all treat a marked entry as an ordinary one.

alter table public.events
  add column if not exists timetable boolean not null default false;
