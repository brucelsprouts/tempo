-- Tempo — how long a version is kept
--
-- Run this in the Supabase SQL editor after `20260801_history.sql`.
-- Idempotent: it replaces a function and a trigger, so running it twice is
-- harmless.
--
-- Replaces "keep the last 10 per entry", which answers the wrong question. Ten
-- versions is either far too many or nowhere near enough depending entirely on
-- how much you edited that day: drag one bar around for a minute and the ten
-- newest are all from that minute, and the shape it had last week — the one you
-- would actually come looking for — has already been pushed off the end.
--
-- So the versions are thinned by *age* rather than counted. Three tiers:
--
--   * under a day   — every version. This is the undo window, where the edits
--                     are still fresh enough that you remember making them and
--                     the difference between two of them matters.
--   * under a month — the newest version of each day. "What did this look like
--                     last Tuesday" is a question about a day, not a minute.
--   * under a year  — the newest version of each month.
--   * beyond a year — dropped.
--
-- Worst case per entry is bounded and small: a day of frantic editing, plus 29
-- dailies, plus 11 monthlies. A calendar entry edited once a week for a year
-- keeps about 16 versions instead of losing everything past the tenth.

create or replace function public.prune_event_versions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  with ranked as (
    select
      id,
      created_at,
      -- Which bucket this version competes in. Buckets are UTC calendar days
      -- and months, which is a deliberate simplification: the alternative is
      -- storing each client's zone alongside the row so the trigger can group
      -- by local midnight, and nobody reads a history list closely enough for
      -- the boundary hour to matter.
      case
        when created_at > now() - interval '1 day'   then 'live'
        when created_at > now() - interval '30 days' then to_char(created_at, 'YYYY-MM-DD')
        when created_at > now() - interval '1 year'  then to_char(created_at, 'YYYY-MM')
        else null
      end as bucket
    from public.event_versions
    where event_id = new.event_id
      and owner_id = new.owner_id
  ),
  -- Each branch is parenthesised, which is load-bearing rather than cosmetic:
  -- an ORDER BY or LIMIT written bare inside a UNION binds to the *whole*
  -- union, not to the branch it sits in, so Postgres rejects the second one
  -- outright. Without the parentheses this function does not compile.
  keep as (
    -- Everything inside the undo window.
    (select id from ranked where bucket = 'live')

    union

    -- The newest survivor of each older bucket.
    (select distinct on (bucket) id
       from ranked
      where bucket is not null
        and bucket <> 'live'
      order by bucket, created_at desc)

    union

    -- A floor, whatever the clock says. An entry edited once and then left
    -- alone for two years still has its history — without this, every one of
    -- its versions ages out of the last tier and the entry silently loses the
    -- only record of what it used to be.
    (select id from ranked order by created_at desc limit 5)
  )
  delete from public.event_versions
  where event_id = new.event_id
    and owner_id = new.owner_id
    and id not in (select id from keep);

  return null;
end;
$$;

drop trigger if exists event_versions_prune on public.event_versions;
create trigger event_versions_prune
  after insert on public.event_versions
  for each row
  execute function public.prune_event_versions();
