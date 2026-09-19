-- Tempo — TASK retired from the data
--
-- Run this once in the Supabase SQL editor, whenever is convenient. Idempotent:
-- running it twice is harmless.
--
-- Nothing waits for it. The app already reads a task as an entry and ignores its
-- status, and writes one back as an entry the next time it is saved; this only
-- makes the rows say what the app already shows.
--
-- Nothing is dropped. The `assignment` kind and the `status` column stay in the
-- schema, unused, so an older client — or a version rolled back to — still fits.

update public.events
set kind = 'event', updated_at = now()
where kind = 'assignment';

update public.events
set status = null, updated_at = now()
where status is not null;

-- An exception can carry a status of its own: one date of a repeating task,
-- ticked off. The key goes; everything else the exception says stays.
update public.occurrence_overrides
set patch = patch - 'status'
where patch ? 'status';
