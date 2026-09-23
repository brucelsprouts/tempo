# Tempo — a timetable that stays out of the way

Agreed on 2026-09-22. A term's worth of lectures is ten or more entries a week,
and dropped into the continuous scroll they bury the thing the calendar is for:
the assignment due Thursday. But a schedule you can't see is not a schedule.

So: mark an entry as timetable and it leaves the main calendar, and a fourth
view exists where a week has room to hold it.

---

## What already worked

Nothing here is about storing a schedule. A course is already one row —
`recurrence: { freq: 'WEEKLY', byWeekday: [1, 3, 5], until: '2026-12-05' }`,
timed, categorised — and `expandAll` already draws it everywhere. The problem
was only ever density: a week row in the continuous grid is a thin band with
lane packing, and fifteen blocks a week squeeze out everything else in it.

A Mon–Sun grid has seven columns of vertical room. The same fifteen blocks sit
in it comfortably. That asymmetry is the whole design — the entries don't need
filtering, they need a surface with room.

## Decisions

- **A boolean on the entry, `timetable`.** Not a new `EventKind`: kinds in this
  codebase are presets that no logic branches on, and this is logic. Not
  inferred from `freq: 'WEEKLY'` either — that would sweep up the gym sessions
  that are meant to stay visible, and it would shut out a biweekly lab or a
  one-off makeup lecture, both of which belong beside their classmates.

- **Hidden by default, revealable.** Marked entries drop out of scroll, list and
  year; a `TIMETABLE` button in the top bar brings them back when the full
  picture is wanted. Off by default and remembered, so the clean calendar is the
  one normally on screen.

- **The week view shows everything.** It reads the unfiltered event list —
  lectures, gym, meetings, deadlines. A timetable-only grid would show a free
  Tuesday evening that has gym in it, which is a worse lie than clutter. And it
  means the new view holds no filtering logic at all.

- **Dated, not idealised.** The week view opens on the real current week and
  steps to others. A "typical week" pattern cannot show reading week, a term
  that has ended, or a single class cancelled or moved — all of which the
  existing override machinery already gets right, for free, as long as the view
  asks about real dates.

- **The filter runs on events, not occurrences.** Hiding by dropping rows before
  `expandAll` means a hidden series is never walked. The scroll view gets
  slightly faster with a term loaded, not slower.

## Shape

**Migration** `supabase/migrations/20260922_timetable.sql`, additive and
idempotent in the style of `20260919_retire_tasks.sql`:

```sql
alter table public.events
  add column if not exists timetable boolean not null default false;
```

Nothing waits for it. A client running against a database without the column
reads `undefined` as `false`, and an older client ignores it.

**`TempoEvent.timetable: boolean`**, threaded through `mappers.ts` in the four
places `dueMinutes` already is: the Zod schema, `eventFromRow` (`?? false`, so
rows written before the migration read as not-timetable), `rowFromEvent`, and
the export shape — where it is **emitted only when true**, since `/api/export`
maps 1:1 onto Obsidian frontmatter and `timetable: false` on every entry is
noise. `database.types.ts` is generated, so it is regenerated after the
migration runs.

**`src/lib/store/timetable-visibility.ts`**, mirroring `view-preference.ts`:
`useSyncExternalStore`, localStorage, a separate server snapshot so the first
paint is the default and the stored value arrives after hydration. Default
hidden.

**`useVisibleEvents()`** wraps `useCalendar((s) => s.events)` and drops
timetable entries unless revealed. Four call sites change: `ContinuousCalendar`,
`ListView`, `YearView`, `DayModal`. `History` and `Settings` keep reading the
unfiltered list — a hidden entry that was deleted still has to be recoverable,
and the counts in settings have to be true.

**The `TIMETABLE` button** sits beside the view switcher and lights when on. It
renders only in scroll, list and year: in the week view it has nothing to mean,
and a permanently inert control is worse than an absent one.

**`WeekView.tsx`**, the fourth view. `View` gains `'week'` and `VIEWS` gains
`{ value: 'week', label: 'WEEK', key: '4' }`, which inherits the existing
persistence and keymap. It opens on `startOfWeek(todayIn(timezone))` — already
in `civil.ts`, already tested — with `[` and `]` stepping weeks and a control
back to this one.

An all-day band across the top over seven day columns sharing one hour gutter.
It reuses `timeline.ts` wholesale — `daySegment`, `placeSegments`,
`resolveHourHeight`, the zoom store — which is pure, tested, and already solves
within-day overlap lanes. The hard part is written; this is seven of it.

Clicking an entry pushes the entry overlay onto the same stack, so notes are one
click away. Clicking empty space seeds a new entry at that day and time, as
`DayView` does.

**An `[08] TIMETABLE` toggle** in `EventForm`, using the existing `Toggle`
primitive, after `CATEGORY` — it is a property of the entry, not of its timing.

## Left out, on purpose

- **Drag in the week view.** `DayView` retimes by drag within one day; across
  seven columns that becomes moving between days, a different gesture needing
  its own scope prompt for repeating entries. Click-to-open covers the need.
  It can follow.
- **Dimming non-timetable entries in the week view.** A weight distinction worth
  ten minutes once the view has been lived with, and not obviously an
  improvement before then.
- **Any coupling between the toggle and reminders.** A new timetable entry still
  gets the default reminders for its shape, so five courses meeting three times
  a week is a set of pushes to clear by hand, once, per term. Every rule that
  would avoid this — clearing on toggle, restoring on untoggle — is either magic
  or wrong about an entry whose reminders were chosen deliberately. Accepted
  knowingly.
- **A course or term entity.** A course is an entry with a weekly recurrence and
  an `until`. That already works.
- **Timetable-only filtering in the week view**, and an undated term pattern.
  Both covered above.

## Testing

Pure logic first, as ever. The visibility filter: a timetable entry dropped when
hidden, present when revealed, an ordinary entry present either way, and an
empty list surviving both. The week's range: the Monday for a date mid-week, for
a Sunday, for a Monday itself, and across a month and a year boundary — `civil.ts`
owns this and is already tested, so this is a guard on the call, not the maths.

Then `mappers.ts`: a row without the column reading as `false`, a round trip
through `rowFromEvent`, and the export omitting the key when false and carrying
it when true.

Then the view, against the preview harness: a week rendering its entries in the
right columns, a hidden entry absent from the scroll view and present in the
week view, the toggle revealing it, and the preference surviving a reload.
