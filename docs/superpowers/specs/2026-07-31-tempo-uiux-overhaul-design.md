# Tempo — UI/UX overhaul

Design record for a set of interaction and chrome changes. Three sessions, in
order: **Chrome**, **Overlays**, **Grid**. Session 3 depends on session 2 (its
range-select hands off to the entry modal).

---

## Decisions taken

Recorded here because the rest of the document assumes them.

1. **The grid never reflows.** In every state, in every view, the calendar
   occupies the full width of the content area. There is no side rail. Nothing
   opens beside the grid, so nothing ever pushes it off centre. This is the
   decision the rest of the document is built around; §"Why not a rail" states
   what it replaces.
2. **Forms and day detail are overlays.** Creating or editing an entry opens a
   centered modal over the grid. The day timeline and the day's task list open
   as a second, wider centered modal. Both are transient; the grid underneath is
   the only persistent surface.
3. **A task must be the loudest thing on a day.** Height carries importance:
   task > birthday > event > mark.
4. **The fixed row height survives.** `ROW_H` stays a compile-time constant.
   Variable bar heights are absorbed by a pixel budget per row, not by rows that
   measure themselves. See [DESIGN.md §6](../../DESIGN.md).
5. **One keymap.** New gestures are registered in the `SHORTCUTS` table in
   `Settings.tsx`, which the shell binds and the settings panel documents.

### Why not a rail

An earlier draft of this document put every form in an always-open 360px right
rail. Three objections killed it, and they are worth writing down so the rail
does not get reinvented:

- A panel that opens and closes moves the calendar sideways every time. The grid
  is the thing you are reading; it should not slide.
- Pinning the panel open to stop the sliding does not fix it — it just makes the
  grid permanently narrower and permanently off-centre, with a bright block of
  chrome parked in peripheral vision.
- Overlaying the panel on top of the grid stops the reflow but hides Friday and
  Saturday, which is worse than moving.

An overlay has none of these properties: it is centered, it is temporary, and
the grid behind it is unchanged when it closes. It is also the interaction the
app is being modelled on — content stays put, detail opens over it.

### The overlay stack

The shell holds an ordered stack rather than a single `rail` slot:

```ts
type Overlay =
  | { kind: 'day'; date: CivilDate }
  | { kind: 'entry'; seed: EntrySeed }         // new
  | { kind: 'entry'; occurrence: Occurrence }  // edit
  | { kind: 'settings' };

const [overlays, setOverlays] = useState<Overlay[]>([]);
```

Only the topmost overlay is rendered and only one scrim is drawn, so two stacked
modals never produce two layers of dimming. The stack exists so that returning
is defined: opening ENTRY from inside the DAY modal pushes, and dismissing it
pops back to DAY rather than to nothing.

Depth is capped at 2 in practice — nothing pushes a third — but the type does
not need to say so.

### Escape unwind order

Escape unwinds exactly one layer per press, and the shell owns the whole
sequence. Stated once here because three sections below touch it:

1. an open date picker (§2.6)
2. the topmost overlay — pop one off the stack (§2.1)
3. a non-empty selection (§3.4)

The picker is nearest the front, so it goes first; the selection lives on the
grid, which is furthest back, so it goes last. Escape while typing inside an
overlay still unwinds the overlay — blurring the field instead would make the
key mean two different things depending on where the caret was.

## Two pre-existing defects this work fixes

**The anniversary anchor never appears.** `EventForm.tsx` gates the anchor field
on `effectiveTemplate?.includes('{yearsSince}')`. The anniversary preset is
`'{title} — {ordinal(yearsSince)} anniversary'`, which does not contain that
substring. So the field never renders, `anchorDate` stays null, `yearsSince`
resolves to null, and `tidy()` cleans away the debris — leaving "Wedding
anniversary" with the number silently missing. The gate must match the token
inside its wrapper.

**Resize cannot cross a week boundary.** `EventBar.beginResize` computes
`delta = Math.round((clientX - originX) / colWidth)`. That is a horizontal
measure, so "extend into next week" is only expressible by dragging far off the
right edge of the screen, and the preview then renders the bar wider than its
own row. Resize must read the day cell under the pointer instead.

---

# Session 1 — Chrome

Independent of the other two. Nothing here touches layout or interaction.

## 1.1 Hide scrollbars

`globals.css` currently styles "instrument-panel scrollbars". Replace with
hidden-but-scrollable:

```css
* { scrollbar-width: none; -ms-overflow-style: none; }
*::-webkit-scrollbar { width: 0; height: 0; display: none; }
```

This covers the entry form's own overflow too — it is the same rule.

Update [DESIGN.md §10](../../DESIGN.md) — the visible-scrollbar decision is being
reversed and the record should say so rather than contradict the code.

## 1.2 Pad the day numbers

`DAY_HEADER_H` 26 → 30, and the header row in `WeekRow.DayCell` gains top
padding so the number is not flush against the cell's top edge.

The extra 4px comes out of the row's unused slack, which is 13px today and
nothing is drawn in it. All four lanes still render; they sit 4px lower. Session
3 raises `ROW_H` and replaces the fixed lane count entirely.

## 1.3 Year strip → dropdown

`YearView` renders all 16 epoch years into an `overflow-x-auto` sliver. Replace
the strip **and** the `[T]` button with a native `<select>` styled with
`inputClass`, listing every year in the epoch. Keep the `‹ ›` steppers.

Native `<select>` rather than a custom menu: the app already uses native selects
for timezone and category, so this is consistent, and a year list needs no
custom behaviour.

## 1.4 Keys section

The keymap renders at `label` weight — 10px, `0.14em` tracking, uppercase,
`--color-mute`. That is the least readable combination in the design system and
it is being used for the one block of text people actually read.

Replace with keycap chips: bordered `border-hairlit` on `bg-raised`, `text-dim`,
no letter-spacing, sitting against descriptions at `text-[11px] text-dim`
(not `text-mute`). Increase row spacing.

Add the new gestures from sessions 2 and 3 to `SHORTCUTS` as they land.

## 1.5 Cull descriptions

Remove:

- `Settings` — "One account, no registration. Nothing here is shared."
- `Settings` — the timezone paragraph ("Which square an instant lands on…")
- `Settings` — the export paragraph ("Every event and exception, as stored…")
- `Settings` — section meta `THE ONLY COLOUR IN THE INTERFACE`
- `EventForm` — hint "Computed per occurrence at render time, not stored."
- `EventForm` — hint "Counted from, to produce the number."
- `EventForm` — notes placeholder "Short context only — long-form lives in
  Obsidian." → `…`

Keep `Mirror to Google for reminders` — that is a control's label, not a
description of one.

The `hint` prop on `Field` stays in `ui.tsx`; it is simply unused after this.

## 1.6 Category CRUD

There is currently no way to create a category. Four are seeded on first load
and that is the entire lifecycle.

**Store** (`calendar-store.ts`) gains:

```ts
createCategory: (name: string, color: string) => Promise<void>;
updateCategory: (id: string, patch: { name?: string; color?: string }) => Promise<void>;
deleteCategory: (id: string) => Promise<void>;
```

All three follow the existing `optimistic()` snapshot-and-rollback pattern.

`deleteCategory` must **explicitly null `category_id` on affected events first**,
then delete the category row, and mirror both in local state. The generated
types confirm `events_category_id_fkey` exists but do not state its `ON DELETE`
behaviour; nulling explicitly is correct whether the constraint cascades, nulls,
or restricts.

**Settings** — the `CATEGORIES` section becomes editable. Each row: a colour
swatch that opens the 8-colour `CATEGORY_PALETTE` as a small grid, an inline
name input, the existing usage count, and a `×` to delete. Below the list, an
`+ ADD` row.

Colours may repeat once there are more than 8 categories. The palette stays
fixed — those 8 are tuned to sit on near-black and to stay distinguishable at
2px wide, which a free colour picker would give up.

Deleting a category that is in use should say how many entries it will
uncategorise before doing it.

## 1.7 Anniversary anchor fix

In `EventForm`, replace the substring test with one that matches the token
regardless of wrapper:

```ts
const needsAnchor = /\{(?:ordinal\(\s*)?yearsSince/.test(effectiveTemplate ?? '');
```

Cover it with a test in `tempo.test.ts`: every preset in `TEMPLATE_PRESETS` that
resolves `yearsSince` must be reported as needing an anchor. Asserting over the
preset table rather than over one string keeps a future preset from
reintroducing the same gap.

---

# Session 2 — Overlays

Removes the right rail and replaces it with two centered modals over an
unmoving grid.

## 2.1 Shape

`CalendarShell` drops `Rail` and gains the stack from
[The overlay stack](#the-overlay-stack), plus `focusedDay: CivilDate`
defaulting to today. `focusedDay` is what `N` and `D` target and what the grid
marks as selected.

One new component, `Modal.tsx`, owns everything common to the three overlays:
the scrim, centering, the `Escape` registration, focus trapping, and restoring
focus to whatever was focused before it opened. `Settings.tsx` is refitted onto
it so there is one modal implementation rather than two.

```tsx
<Modal
  size="entry" | "day" | "settings"
  title={…}
  meta={…}
  onDismiss={pop}
/>
```

Sizes are `min(640px, 92vw)` for ENTRY, `min(880px, 94vw)` for DAY, and the
existing width for settings. All three cap at `min(85vh, …)` and scroll
internally past that — which is invisible after §1.1.

The grid does not know the modal exists. `ContinuousCalendar`, `YearView` and
`ListView` render at full width in every state, and `selectedDay` continues to
be the only prop that changes when focus moves.

## 2.2 ENTRY modal

`EventForm` moves into `Modal` for both `new` and `edit`. Its content is
unchanged apart from §2.5, §2.6 and the description cull in §1.5, but it
relayouts: 640px is wide enough for a two-column grid, so START/END, FROM/TO and
CATEGORY/REPEATS pair up and the form stops scrolling in the common case. Its
own `PanelHeader` and its `CANCEL` button are dropped — the modal supplies both.

Reached by:

- clicking empty whitespace in a day cell → `new`, seeded with that date (§3.3)
- finishing a range drag → `new`, seeded with the whole span (§3.3)
- clicking a bar → `edit`
- clicking an hour row in the DAY modal → `new`, seeded with date and time
- `N` → `new` on `focusedDay`
- the top bar's `+ NEW` → `new` on `focusedDay`

## 2.3 DAY modal

Opened by clicking a day number, clicking a `+N` overflow chip, or pressing `D`.
Two panes side by side under one header:

- **left** — the existing `DayView` 24-hour timeline, unchanged in substance.
  Its `onClose` prop is removed; the modal owns dismissal.
- **right** — new. For that date, everything due, tasks first, each with its
  status glyph and a control to advance it (`todo → doing → done`). Then
  birthdays and marks, then events.

The right pane is what absorbs the density the grid gives up in §3.1 — a day
whose bars overflow into `+N` is fully readable here, and the `+N` chip opens
exactly this.

Below `900px` the two panes collapse to a `SegmentedControl` switching DAY ↔
TASKS, which is the only place the earlier draft's segmented control survives.

The header carries `‹ ›` day steppers, so reading Tuesday after Monday does not
mean dismissing and re-opening.

The `+ NEW ON THIS DAY` button is dropped: clicking an hour row already creates
a timed entry, and all-day entries are created on the grid, which is visible
behind the modal.

## 2.4 The ghost bar

While the ENTRY modal is open in `new` mode, the calendar renders a **dashed,
muted ghost bar** at the draft's current start/end dates, updating live as the
form's dates change. This is what tells you where the entry will land now that
the form is over the middle of the screen rather than under your cursor.

`EventForm` reports its dates upward via `onDraftDatesChange(start, end)`.
`CalendarShell` holds `ghost: { start, end } | null` and passes it to
`ContinuousCalendar`, which draws it in the same overlay the real bars use.

The ghost is not draggable and takes no part in lane assignment, so it can never
displace real content. It is drawn on top of the row at the lane slot after the
last drawn one, clamped to stay inside the row when there is no free slot.

### The scrim is cut, not solid

A solid scrim would dim the ghost along with everything else, which defeats it.
So the scrim is drawn as **two rects with a gap**, leaving the ghost's week rows
undimmed: one from the top of the viewport to the first ghost row's top, one
from the last ghost row's bottom to the bottom of the viewport.

This is affordable precisely because of decision 4. `ContinuousCalendar` exposes

```ts
ghostBand(): { top: number; bottom: number } | null   // viewport px
```

on its imperative handle, computed as `index * ROW_H - scrollTop + gridTop` —
arithmetic, not measurement, and the same identity the ruler and `jumpTo`
already rely on. It returns `null` when the ghost is scrolled out of view or the
view is not `scroll`, and the scrim falls back to one solid rect.

`Modal` takes an optional `cutout` prop and knows nothing about calendars.

## 2.5 Not in List view

`ListView` gets the full width and the ENTRY modal, same as everywhere else.
Nothing view-specific is needed — an overlay is an overlay.

## 2.6 Custom date picker

New component `DatePicker.tsx`. Replaces every `<input type="date">` in
`EventForm` (start, end, anchor).

- The **entire field** is the hit target, not just the calendar glyph.
- Opens an in-theme month grid anchored under the field: `‹ ›` month steppers, a
  year select, a TODAY shortcut.
- Keyboard: arrows move by a day, `Enter` selects, `Escape` closes the picker
  only.
- Accepts an optional `min` so the end date cannot precede the start date, which
  is the constraint the native input was carrying.

**Escape ordering.** The shell owns one keymap and unwinds one layer at a time.
An open picker is a layer, so it must be unwound before its modal is. The picker
registers itself with the shell while open rather than binding its own
`keydown` — a second window listener would make the outcome depend on listener
order.

Built on `civil.ts` throughout. No `Date` object ever holds an all-day value.

---

# Session 3 — The grid

## 3.1 Variable bar heights

```ts
export const KIND_HEIGHT: Record<EventKind, number> = {
  milestone: 14,   // a moment, not a span — thin tick, title only
  event: 21,       // unchanged baseline
  birthday: 27,    // title + derived age
  assignment: 32,  // two lines: title, then status glyph + due
};
```

`milestone` currently has no behaviour anywhere in the codebase — the kind
exists in the type, in the form's `KINDS` list, and nowhere else. This is the
first thing that reads it.

### Lane layout

`layoutWeek` keeps its greedy interval-graph assignment unchanged. What changes
is what happens after:

1. Assign lanes exactly as today.
2. `laneHeights[i]` = tallest `KIND_HEIGHT` among segments in lane `i`.
3. `laneTops[i]` = `Σ(laneHeights[0..i-1]) + i * LANE_GAP`, measured from the
   top of the **lane area**, not of the row. `DAY_HEADER_H` is added once by
   `WeekRow` when it positions the overlay, so the header height appears in
   exactly one place and cannot be double-counted against the budget.
4. A lane is **hidden** when `laneTops[i] + laneHeights[i] > LANE_BUDGET`,
   replacing the `lane >= MAX_LANES` test. Hidden segments roll into the
   existing per-column `+N` counters exactly as now.

`WeekLayout` gains `laneTops: number[]` and `laneHeights: number[]`.
`laneTop()` in `constants.ts` is retired.

A bar's own height is `KIND_HEIGHT[kind]`, **not** its lane's height — a 21px
event sharing a lane row with a 32px task stays 21px, top-aligned. `EventBar`
takes `top` and `height` as props instead of deriving them.

### The row budget

```ts
export const ROW_H = 146;          // was 132
export const DAY_HEADER_H = 30;    // was 26, per §1.2
export const OVERFLOW_H = 13;      // room for the "+N" chip
export const LANE_BUDGET = ROW_H - DAY_HEADER_H - OVERFLOW_H;  // 103
```

`MAX_LANES` is removed.

`ROW_H` remains a constant, so `TOTAL_H` is still known at compile time, the
container is still correctly sized on first paint, jumping to a date is still
exact arithmetic rather than a measured scroll, and §2.4's cut scrim can locate
a row without measuring it. This is the invariant the whole scroll architecture
rests on and it is not being traded away.

**Density cost, stated plainly.** Four events still fit: lane offsets 0, 24, 48,
72, last bottom at 93 ≤ 103. Three tasks fit: offsets 0, 35, 70, last bottom at
102 ≤ 103. But a day with two tasks and two events draws three bars and a `+1`
where it previously drew four — the fourth lane starts at 94 and would end at
115. The DAY modal's task pane (§2.3) is where that day stays fully readable,
and the `+1` chip is the link to it.

## 3.2 Cross-week resize

Move the resize preview out of `EventBar` and into `ContinuousCalendar`:

```ts
const [resize, setResize] = useState<
  { key: string; edge: 'start' | 'end'; date: CivilDate } | null
>(null);
```

`EventBar` reports pointer-down on a handle upward and stops owning the
gesture. `ContinuousCalendar` resolves each `pointermove` to the day cell under
the pointer with `document.elementsFromPoint` — the same technique
`handleDragStart` already uses to find the grab date, so both gestures measure
the same thing, which is the lesson of [DESIGN.md §7](../../DESIGN.md).

The preview is applied as a post-pass over the expanded occurrences (clone the
one occurrence with adjusted `date`/`endDate`) before `byWeek` bucketing, **not**
by re-running `expandAll`. Every affected row then re-renders and a bar being
stretched into next week simply appears there.

Commit delta is `diffDays(hoveredDate, edge === 'start' ? occ.date : occ.endDate)`.

Resize handles are shown on any edge that is not clipped, unchanged — you still
lengthen a bar from the end that is actually in the row you are pointing at.

## 3.3 Click and drag to create

On a day cell's empty whitespace, with no modifier:

- **click** (no movement) → ENTRY modal, `new`, seeded with that date
- **drag** → the covered day cells highlight as the pointer moves → release
  opens the ENTRY modal, `new`, seeded with the whole inclusive span

The range highlight is inclusive and resolves per day cell, so dragging
backwards works and dragging into the following week works.

This does not fight dnd-kit: day cells are droppables, not draggables, so a
pointer-down on a cell never arms the `PointerSensor`.

The `+` hover button in the day header is removed here — whitespace is now the
affordance, and two overlapping ways to do the same thing on the same 30px strip
is worse than one.

Clicking the **day number** sets `focusedDay` and opens the DAY modal (§2.3).
That is the only remaining special target in the cell. The existing
double-click-to-open-day gesture is removed; a single click on the number does
it, and a double-click on whitespace would otherwise fire create twice.

## 3.4 Marquee selection

**Ctrl/Cmd + drag** on the grid draws a marquee and selects the bars it
intersects. Plain drag stays range-create (§3.3). **Ctrl/Cmd + click** on a bar
toggles it in or out of the selection.

Ctrl/Cmd rather than Shift: Shift already means "rewrite the series" at drop
time, and overloading it would make a shift-drag ambiguous between two
destructive-ish meanings.

Selection state is a `Set<string>` of occurrence keys in `ContinuousCalendar`.
Hit-testing compares the marquee rect against rendered bar rects, throttled with
`requestAnimationFrame` so the highlight is live rather than resolved on
release. Selected bars render with a `hairlit` outline.

With a selection active and no overlay open:

| gesture | effect |
|---|---|
| `Del` / `Backspace` | delete every selected entry (recurring → whole series) |
| `←` / `→` | move the selection ∓1 day |
| `↑` / `↓` | move the selection ∓7 days |
| drag any selected bar | move every selected entry by the same delta |
| `Escape` | clear the selection |

Clearing the selection is the last layer of the shell's unwind order — see
[Escape unwind order](#escape-unwind-order). A picker or an overlay, being
nearer the front, unwinds first.

Deleting more than one entry asks first. The others are reversible by dragging
back; a bulk delete is not.

### Store

Two new bulk methods, so a selection is one snapshot and one round-trip rather
than N of each:

```ts
deleteEvents: (ids: string[]) => Promise<void>;
moveOccurrences: (occs: Occurrence[], deltaDays: number, scope: EditScope) => Promise<void>;
```

Both reuse `optimistic()`. `moveOccurrences` must group by whether each
occurrence needs a series rewrite or an override row, and issue at most one
write per table — a per-occurrence loop would produce a partial state on failure
that the single-snapshot rollback cannot express.

---

## Keymap after this work

The full `SHORTCUTS` table, since three sections add to it:

| key | effect |
|---|---|
| `1` `2` `3` | scroll / list / year |
| `N` | new entry on `focusedDay` |
| `D` | open the DAY modal on `focusedDay` |
| `T` | today |
| `/` | search (list view) |
| `,` `?` | settings |
| `Esc` | unwind one layer |
| `Del` `Backspace` | delete selection |
| `←` `→` `↑` `↓` | move selection by ∓1 / ∓7 days |
| `Ctrl`/`Cmd` + drag | marquee select |
| `Ctrl`/`Cmd` + click | toggle a bar in the selection |
| `Shift` at drop | apply to the whole series |

## Testing

- `layout.test.ts` — lane heights, cumulative tops, and the budget cutoff.
  Specifically: four events fit; three tasks fit; two tasks plus two events
  yields three drawn segments and one overflow.
- `tempo.test.ts` — every `TEMPLATE_PRESETS` entry resolving `yearsSince` is
  reported as needing an anchor (§1.7).
- `calendar-store.test.ts` — `deleteCategory` nulls affected events;
  `deleteEvents` and `moveOccurrences` roll back cleanly as one unit on failure.
- Date arithmetic in `DatePicker` goes through `civil.ts` and is covered there;
  the component itself is verified in the preview harness.
- The grid's width must not depend on overlay state. Asserted in the harness by
  reading the grid's `clientWidth` with and without a modal open.

The preview harness renders `CalendarShell`, so it exercises the real overlays,
the real keymap and the real grid. Every gesture added here is reachable from
it.

## Out of scope

Not touched by this work, and not to be opportunistically refactored:
Google Calendar sync, the timeline ruler, the command palette, and the List view
beyond the description cull in §1.5 and the width change in §2.5.
