-- Tempo — birthdays remind you five minutes before midnight, and at 09:00
--
-- Run this once in the Supabase SQL editor. Idempotent: a birthday it has
-- already moved no longer holds a midnight reminder, so a second run finds
-- nothing to change.
--
-- New birthdays default to 23:55 the night before (time to have the message
-- typed when the day begins) plus 09:00 that morning (the catch for a night
-- you were asleep). This brings the birthdays already on the calendar in line.
--
-- Only the old default is touched. A birthday whose reminders were chosen by
-- hand and don't include midnight is left alone, and so is one with an empty
-- list, because the form writes [] only when every reminder was removed on
-- purpose. A null list predates reminders altogether and gets the new pair.
--
-- Offsets are minutes before the entry's midnight, so 5 is 23:55 the night
-- before and -540 is 09:00 that day. 09:00 is only added where it fits: the
-- client drops a list longer than five outright, which would silence the
-- birthday rather than add to it.

update public.events e
set
  reminders = (
    select jsonb_agg(jsonb_build_object('minutes', m) order by m desc)
    from (
      select distinct case when (r ->> 'minutes')::int = 0 then 5 else (r ->> 'minutes')::int end as m
      from jsonb_array_elements(e.reminders::jsonb) r
      union
      select -540 where jsonb_array_length(e.reminders::jsonb) < 5
    ) leads
  ),
  updated_at = now()
where e.kind = 'birthday'
  and jsonb_typeof(e.reminders::jsonb) = 'array'
  and e.reminders::jsonb @> '[{"minutes": 0}]';

update public.events
set
  reminders = '[{"minutes": 5}, {"minutes": -540}]',
  updated_at = now()
where kind = 'birthday'
  and reminders is null;
