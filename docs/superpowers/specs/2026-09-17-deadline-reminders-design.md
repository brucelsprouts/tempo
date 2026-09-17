# Tempo — reminders that know where the deadline is

Every reminder used to count back from the day an entry *starts*. That was
fine while every entry was one day long. It stops being fine the moment an entry
is stretched across a week: "the day before, 09:00" arrives the day before the
work begins, and nothing arrives before it is due.

---

## What prompted this

In the user's words: an assignment spans a week, so when does the notification
come — before the week, before the last day, or every day? They want to be told
when to start, the day before it is due, and on the day. Not every day: that
trains you to swipe notifications away, including the one that matters.

Also, from the same conversation:

- They make an entry one day long and drag it out afterwards, and do not want
  to redo reminder times when they do.
- Everything with a deadline is due at 23:55 unless stated otherwise, but some
  things are due at 18:00 or 07:00.
- Later the same day, correcting that: plenty of entries have no deadline at
  all. Rent is due on the first, not at 23:55 on the first. One of those should
  leave the due time empty and get a single reminder, the morning before, which
  is what every all-day entry got before this work.
- They once had a final at 07:00 and thought it was 19:00. A notification has to
  say the time, and a 09:00 "today" reminder is useless for a 07:00 exam.
- One kind of entry (TASK was already retired on Sep 10), categorised, with the
  same reminders on everything — except repeats. A weekly lecture or the gym
  wants one reminder, half an hour before.
- Each of the reminders can be moved to another time, removed, or joined by more.

## Decisions

**Reminders stay on the entry.** Defaults are written onto an entry when it is
created, as today. A shared set in Settings was considered and declined: it
would change entries behind the user's back, and the form would have to show
whether an entry follows the set or its own list.

**A reminder counts back from one of three points.**

| Anchor | All-day entry | Entry with a time |
| --- | --- | --- |
| `start` (stored with no `from`) | midnight the first day | the start time |
| `dueDay` | midnight the last day | midnight the day it starts |
| `due` | the last day at the due time, or its end if none | the start time |

`start` is what every stored reminder already means, so nothing already on the
calendar changes meaning. On an entry with a time the due point *is* the start,
so the form writes its "before it starts" leads as `start` and they keep the
same shape and the same delivery identity they always had.

Because each reminder is anchored to an edge, dragging the edge carries it.

**All-day entries gain a due time**, `events.due_minutes`, which may be left
empty. Empty is what a new entry starts with, and it means due some time that
day: rent is due on the first, not at 23:55 on the first. Such an entry is due
when its last day ends, its notification says only the day, and no reminder of
it is moved earlier to beat a deadline nobody set. 23:55 sits on a button beside
the field for the things that are deadlines. It is only an entry property, not a
bar decoration — nothing on the grid shows it yet.

**Defaults**, chosen while the entry is being created. What decides them is
whether a due time is stated, not how many days the entry covers: entries are
made one day long and dragged out afterwards, so length would have decided
before there was anything to decide on. Typing the due time re-picks them, since
the form follows the defaults until a row is edited.

| Entry | Reminders |
| --- | --- |
| All day, no due time (repeating or not) | day before due 09:00 |
| One-off, all day, due time stated | start day 09:00 · day before due 09:00 · due day 09:00 |
| One-off, with a time | day before 09:00 · 1 hour before |
| Repeating, all day, due time stated | due day 09:00 |
| Repeating, with a time | 30 minutes before |
| Birthday | unchanged: 23:55 the night before · 09:00 that morning |

One reminder with no due time because nobody knows how early in the day it is
wanted, so the morning before is the last morning that still leaves a day to act
on it. Three with one, because a stated deadline can be approached later.

**Two reminders at the same moment are sent once.** A one-day entry's "start day
09:00" and "due day 09:00" are the same instant; the one nearer the deadline
wins (`due` over `dueDay` over `start`). So a one-day entry sends two and a
stretched one three, with no editing in between.

**A time-of-day reminder that would land at or after the due point is sent an
hour before it instead.** A 07:00 final's "today, 09:00" arrives at 06:00. Lead
reminders ("1 hour before") are never moved.

**Notifications say the time**, when there is one. `due tomorrow · 11:55pm`,
`due in 1 hour · 6pm`, `starts today · due in 4 days`, `tomorrow · 7am`,
`in 30 min · 2pm` — and `due tomorrow`, with nothing after it, for an entry that
states no due time. Birthdays keep their wording.

## The form

The chips are replaced with rows, one per reminder, up to five:

```
[06] REMIND ME
DUE AT [  —  ] [23:55]           (all-day entries only; empty by default)
[ ON START DAY      ▾ ]        AT [09:00]    ×
[ DAYS BEFORE DUE   ▾ ] [ 1 ] AT [09:00]    ×
[ ON DUE DAY        ▾ ]        AT [09:00]    ×
+ ADD REMINDER
```

What a row can be depends on the entry:

- **All day:** on start day · days before start · on due day · days before due ·
  before due time (an amount and a unit). With no due time the last is not
  offered — there is no moment to count back from — and a stored one reads as
  the day and time it was already landing on.
- **With a time:** on the day · days before · before it starts.
- **Birthday:** on the day · days before.

A row states a problem under itself when it has one: beyond four weeks, sent at
the same moment as another row, or after the entry is due. Those last two are
computed by the same function the dispatcher uses, against the dates in the form.

## Storage

- `Reminder` gains `from?: 'dueDay' | 'due'`. Parsing drops an explicit
  `'start'`, collapses duplicates by anchor and minutes, and sorts by anchor then
  longest lead.
- `events.due_minutes smallint null`, 0–1439. Null is "states no time", so a
  deadline at 23:55 stores 1435 rather than nothing.
- `reminder_deliveries` gains `anchor text not null default 'start'`, and the
  claim becomes `unique (event_id, occurrence_date, anchor, minutes)`. Without
  it, "start day 09:00" and "due day 09:00" (both `-540`) are one claim, and on a
  stretched entry the second would never send.
- One migration: `supabase/migrations/20260917_deadline_reminders.sql`. The
  dispatcher's 60-minute catch-up window covers the gap between running it and
  deploying.

## Out of scope

- Changing reminders already on the calendar. They keep their meaning.
- Showing the due time on a bar.
- A Settings default for 09:00.
- Daily reminders while an entry is running.
