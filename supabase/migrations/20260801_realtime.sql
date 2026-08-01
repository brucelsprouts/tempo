-- Tempo — let the calendar keep itself up to date
--
-- Run this in the Supabase SQL editor. Without it the app still works; it just
-- goes back to showing you what was true when the page loaded, which is what
-- the refresh key was for.
--
-- Two separate things have to be true for a change to reach another device.

-- ----------------------------------------------------- 1. broadcast at all
--
-- Realtime is opt-in per table. A table that is not in this publication emits
-- nothing, and the client subscribes successfully and simply never hears
-- anything — which is the failure mode worth knowing about, because it looks
-- exactly like "nobody else changed anything".

-- Guarded, because `add table` errors on a table that is already published and
-- there is no `if not exists` for it — so a straight ALTER would make this the
-- one migration here you cannot safely run twice.
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

-- ------------------------------------------- 2. say enough about a deletion
--
-- The client subscribes with `owner_id=eq.<me>`, and that filter is matched
-- against the row in the message. By default a DELETE carries only the primary
-- key — every other column, including `owner_id`, is absent — so the filter
-- cannot match and the deletion is silently dropped before it reaches anyone.
--
-- The visible symptom is oddly specific: every edit syncs, and purging an entry
-- from the trash syncs nowhere. `full` puts the whole old row in the message,
-- at the cost of a little more WAL per delete, which for a personal calendar is
-- nothing.
--
-- Ordinary deletes do not need this — those are soft now, and a soft delete is
-- an UPDATE, which has always carried the full new row. This is here for the
-- one genuine `delete` left in the app.

alter table public.events replica identity full;
alter table public.occurrence_overrides replica identity full;
alter table public.categories replica identity full;
