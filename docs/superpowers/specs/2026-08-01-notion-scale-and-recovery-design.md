# Tempo — Notion-scale entries, deletion recovery, time picker

An addendum to [grid gestures and legibility](2026-07-31-grid-gestures-and-legibility-design.md),
whose three sections are committed (`c82b406`, `cc6c8fb`, `e144f3e`). Three more
sections, executed **one at a time in this order**: **D — scale**, **E —
recovery**, **F — time picker**. D and E both touch `ContinuousCalendar`; F is
independent.

---

## What prompted this

In the user's words: "with the current view things can get lost and I feel a
little blind." The grid is legible now but it is still dense — a 21px bar
carrying an 11px title is readable when you look straight at it and invisible
when you are scanning. That is what D fixes.

Two smaller asks: an accidental delete has no way back (E), and the entry form
picks a date through a custom in-theme picker but a *time* through a bare
`<input type="time">` (F).

---

# Section D — Notion scale

## D.1 Bar heights

```ts
export const KIND_HEIGHT: Record<EventKind, number> = {
  milestone: 20,   // was 14
  event: 28,       // was 21
  birthday: 34,    // was 27
  assignment: 42,  // was 32
};

export const LANE_GAP = 4;  // was 3
```

The ordering that carries meaning is unchanged — task > birthday > event > mark,
per the original decision that height carries importance. Everything is roughly
+35%, so the *relative* weights survive; only the floor rises.

Bar text goes 11px → 12px, and a task's second line 10px → 11px.

## D.2 The row budget

```ts
export const ROW_H = 190;          // was 146
export const DAY_HEADER_H = 34;    // was 30
export const OVERFLOW_H = 15;      // was 13
export const LANE_BUDGET = ROW_H - DAY_HEADER_H - OVERFLOW_H;  // 141
```

`DAY_HEADER_H` rises with the rest: Section A took the day number to 12px and
the header strip was sized for 11px.

**The density is deliberately held, not improved.** Four events still fit —
lane tops 0, 32, 64, 96, last bottom 124 ≤ 141. Three tasks still fit — 0, 46,
92, last bottom 134 ≤ 141. Two tasks plus two events still draws three bars and
a `+1`. The row got 30% taller and everything in it got 35% taller, so the same
week that overflowed before overflows now; what changed is that the bars you can
see are legible at a glance. Trading lanes away for size would have been a
different decision and is not this one.

`ROW_H` remains a compile-time constant. Non-negotiable: `TOTAL_H` is known
before first paint, `jumpTo` is arithmetic rather than a measured scroll, and
the lasso's hit test in `occurrencesInMarquee` divides by it.

Approximately five week rows fit a 720px-tall window, down from about six.

## D.3 Side padding instead of a grid margin

Section A gave the whole grid an 8px right margin (`GRID_PAD_R`) so the Saturday
column's bars stopped butting the window edge. Replace it: **remove
`GRID_PAD_R` entirely** — from `constants.ts`, from `ContinuousCalendar`'s
weekday header, and from `WeekRow`'s column box — and inset every bar
horizontally instead.

A bar currently sits at `ml-[2px]` with `width: calc(<span%> - 3px)`. It becomes
a symmetric inset of 4px per side: `ml-[4px]`, `width: calc(<span%> - 8px)`.

Stated plainly: this gives back 4px of the 8px of clearance the margin bought on
the Saturday edge. It buys symmetry — every bar is now inset the same amount on
both sides in every column, rather than one column being special — and it is what
was asked for. The resize handle stays 8px wide, so the grab zone on a Saturday
bar's right edge runs from 4px to 12px inside the window rather than from 0.

The dashed draft/preview band in `WeekRow` uses the same inset, or it will sit
1px off the bars it is previewing.

---

# Section E — Deletion recovery

## E.1 What this is

An in-memory pool, not a soft-delete column. `events` has no `deleted_at`, and
adding one is a migration only the user can run. The failure mode being fixed is
"I deleted that by accident" — noticed within seconds — so a pool that lives as
long as the tab covers it. **Say so in the UI**: the pool's empty state and
header must not imply the entries are archived somewhere durable.

## E.2 Store

```ts
interface DeletedEntry {
  event: TempoEvent;
  overrides: OccurrenceOverride[];  // its exception rows, deleted with it
  at: number;                       // Date.now(), for ordering and the toast
}

recentlyDeleted: DeletedEntry[];
restoreDeleted: (eventId: string) => Promise<void>;
purgeDeleted: (eventId?: string) => void;   // undefined clears the pool
```

`deleteEvent` and `deleteEvents` capture the rows they are about to drop and
push them onto `recentlyDeleted` **before** the optimistic apply. `restoreDeleted`
re-inserts the event and its overrides through the same `optimistic()` path, so
a failed restore rolls back like any other write.

Two details that are easy to get wrong:

- **Capture the overrides too.** `deleteEvent` already drops
  `overrides.filter(o => o.eventId !== id)` from local state, and the DB almost
  certainly cascades. Restoring the event without them silently discards every
  per-occurrence exception — a recurring event would come back having forgotten
  which instances were moved or cancelled.
- **A restore is an insert, not an update.** The row is gone from the server;
  `updateEvent` would write to nothing and report success.

Cap the pool at 20 entries, dropping oldest-first. It is a safety net, not a log.

## E.3 Toast

One new component, `Toast.tsx`, rendered by `CalendarShell` — the shell already
owns the overlay stack and the keymap, and a toast is neither.

- Appears on any delete, single or bulk: `DELETED "<title>"` or
  `DELETED 3 ENTRIES`, with an `UNDO` action.
- Auto-dismisses after 8 seconds. A second delete replaces the first rather than
  stacking — two toasts would put the older one's UNDO under the newer one's.
- `Ctrl`/`Cmd` + `Z` while a toast is up does the same thing as clicking UNDO.
  Registered in the `SHORTCUTS` table in `Settings.tsx` like every other key.
- Bottom-centre, above the footer, and it must not sit over the grid's own
  bulk-delete confirmation strip.

The toast does **not** block. It is not part of the overlay stack and Escape
dismisses it without consuming the press — Escape's unwind order is already
spoken for.

## E.4 The pool

Reachable from `Settings` as a new section, `RECENTLY DELETED`. Each row: the
title, its kind glyph, when it was deleted, and a `RESTORE` button. A
`CLEAR` action empties the pool.

Empty state names the limitation directly — something to the effect that the
pool holds this session's deletions only and does not survive a reload. Do not
dress it up as an archive.

---

# Section F — Time picker

`EventForm` picks a date through `DatePicker.tsx`, an in-theme custom control,
and a time through a bare `<input type="time">`. The native control renders in
the browser's chrome, not the app's, which is the one place the interface stops
looking like itself.

New component `TimePicker.tsx`, built to match `DatePicker`'s shape so the two
read as one family:

- The **entire field** is the hit target.
- Opens a panel anchored under the field listing times on a fixed interval.
  15 minutes, which is 96 rows — scrollable, with the current value scrolled
  into view on open.
- Typing is accepted: `9`, `930`, `9:30`, `21:30` all resolve. 24-hour display
  throughout, matching `EventBar.timeLabel`.
- Keyboard: arrows move by one step, `Enter` selects, `Escape` closes the picker
  only and **stops propagation** — the same mechanism `DatePicker` uses, so the
  shell's single `window` keydown listener never sees it and "picker before
  modal" does not depend on listener registration order.
- Accepts an optional `min`, so the end time cannot precede the start time —
  the constraint the native input was carrying.

Values are minutes-from-midnight integers, which is what `EventDraft`,
`Occurrence.startMinutes` and `setOccurrenceTime` already speak. No `Date`
object holds a time-of-day.

---

## Testing

- `layout.test.ts` — the budget cases restated at the new figures: four events
  fit, three tasks fit, two tasks plus two events yields three drawn and one
  overflow. These are the assertions that catch a mis-sized `LANE_BUDGET`.
- `calendar-store.test.ts` — a deleted event's overrides come back with it; a
  restore is an insert; the pool caps at 20; a failed restore rolls back.
- `TimePicker`'s parsing (`"930"` → 570) is a pure function and is tested as
  one, separately from the component.
- `occurrencesInMarquee` already has coverage and must keep passing at the new
  `ROW_H` — it takes the metrics as parameters, so nothing there hardcodes 146.

## Out of scope

Google Calendar sync, a persistent trash requiring a migration, and any change
to which entries overflow into `+N` beyond what D.2's arithmetic produces.
