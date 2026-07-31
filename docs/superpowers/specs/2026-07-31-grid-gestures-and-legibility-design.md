# Tempo — grid gestures and legibility

A follow-up to [the UI/UX overhaul](2026-07-31-tempo-uiux-overhaul-design.md),
driven by defects found in use. Three sections, executed **one at a time in this
order**: **A — legibility**, **B — gestures**, **C — chrome**. B builds on A's
corrected row geometry. C is independent of both and goes last only because it is
small.

---

## What was actually wrong

Established by reading the code and by driving the running app, not by
inspection alone. Recorded because two of the four were misdiagnosed at first.

**Bars cover the day numbers.** `layout.ts` computes `WeekSegment.top` from the
top of the *lane area* and documents that "`WeekRow` adds the header height."
`WeekRow` does not: it renders the bar overlay at `absolute inset-0`. Measured
live, first-lane bars sit at offset 0 in a row whose header is `DAY_HEADER_H`
= 30px tall. `LANE_BUDGET` already subtracts the header, so every other figure
in the row is correct and only the overlay's origin is wrong.

**Dragging is not dead.** Synthetic pointer events against the grid show a bar
dragged one row down resolving to the correct day cell and calling
`moveOccurrence`. It looks dead in `/preview` because the harness's fixture ids
are not UUIDs, so the write fails and the optimistic update rolls back. Three
real defects sit underneath that:

- **Resize is horizontal-only.** `EventBar.beginResize` computes
  `Math.round((clientX - originX) / colWidth)` — a pure X measure. "Extend into
  next week" is only expressible by dragging off the right edge of the screen,
  and nothing renders in the destination row while you do it. This is the defect
  §3.2 of the previous spec described and never implemented.
- **A multi-day bar registers two draggables under one id.** A bar crossing a
  week boundary renders as two `EventBar`s that both call
  `useDraggable({ id: occ.key })`. dnd-kit keys its node registry by id, so the
  second clobbers the first: both segments translate together and the active
  node rect belongs to the wrong one.
- **There is no selection.** §3.4 was never written. No selection state exists
  anywhere in the codebase.

**Google Calendar sync does not exist.** No `/api/google/*` routes; only
`/api/export`. The "Mirror to Google for reminders" checkbox writes
`notify: true` to the row and nothing reads it. The DB columns and the
`GOOGLE_CLIENT_*` env keys are groundwork for a feature that was never built.
`README.md` and `docs/GOOGLE_SETUP.md` already say so accurately — only the
checkbox misrepresents it.

---

## Decisions taken

1. **Plain drag on the grid is the lasso.** Not range-create. The previous spec
   (§3.3/§3.4) gave plain drag to range-create and put the lasso behind
   Ctrl/Cmd; that is reversed here. Selection is the gesture being asked for, and
   a modified drag is not discoverable.
2. **Clicking empty whitespace creates nothing.** It clears the selection. An
   entry is created from the day header's hover `+`, the `N` key, or the top
   bar's `+ NEW` — and from nowhere else. The previous spec's plan to delete the
   hover `+` is therefore dropped: it is now the only pointer affordance for
   creating, so it stays.
3. **`ContinuousCalendar` owns every grid pointer gesture.** Move, resize and
   lasso all need the same primitive — pointer position resolved to a
   `CivilDate` — and all three must work across week rows. The current split,
   where dnd-kit owns move and `EventBar` owns resize through its own window
   listeners, is the direct cause of resize being X-only.
4. **dnd-kit stays, for move only.** The move path works; its one bug is the
   duplicate id, which is a two-line fix. Replacing it would be a rewrite with
   no payoff, and day cells being droppables rather than draggables is exactly
   what lets the lasso coexist — a pointer-down on whitespace never arms the
   `PointerSensor`.
5. **The interface stays achromatic.** Contrast is raised by widening the grey
   steps, not by introducing hue. Category colour remains the only hue on
   screen.
6. **`ROW_H` stays a compile-time constant.** Unchanged from the previous spec,
   and load-bearing: `TOTAL_H` is known before first paint, `jumpTo` is
   arithmetic, and the lasso's hit-testing below depends on it.

---

# Section A — Legibility

Contained. Touches no interaction.

## A.1 The bar overlay clears the day header

In `WeekRow`, the bar overlay changes from `absolute inset-0` to a box whose top
edge is `DAY_HEADER_H`:

```tsx
<div className="pointer-events-none absolute inset-x-0 bottom-0" style={{ top: DAY_HEADER_H }}>
```

`segment.top` is already lane-area-relative and `LANE_BUDGET` already excludes
the header, so nothing else moves. The draft/ghost band inside the same overlay
inherits the offset for free.

A second effect worth naming: the hover `+` button and the day number stop being
overlapped by lane-0 bars, which is what made them unreliable to click.

## A.2 Type sizes

- Day number `text-[11px]` → `text-[12px]`.
- The 9px labels — the gutter's `W31`, the month abbreviation in a first-of-month
  cell, the `+N` chip — go to 10px.
- `.label` keeps 10px and uppercase but drops tracking `0.14em` → `0.1em`. At
  10px, 0.14em is the widest tracking in the system on the smallest text in the
  system.

## A.3 Palette

The surfaces currently span `#08090a`–`#121316`: four tokens inside 4% lightness,
which is why everything reads as one plane. Widen the steps and lift the two
text greys:

| token | from | to | carries |
|---|---|---|---|
| `--color-void` | `#08090a` | `#07080a` | grid canvas |
| `--color-sunken` | `#0e0f11` | `#0a0b0d` | hover wells |
| `--color-panel` | `#0b0c0e` | `#0d0f12` | chrome, modals |
| `--color-raised` | `#121316` | `#16181c` | bars, active nav |
| `--color-hair` | `#1b1d21` | `#202329` | ordinary rules |
| `--color-hairlit` | `#2a2d33` | `#31353d` | emphasised rules |
| `--color-mute` | `#4e5359` | `#6a7078` | labels, past dates, times |
| `--color-dim` | `#868b92` | `#9aa0a8` | secondary text |

`--color-mute` is the important one: at `#4e5359` on the grid it measures about
3.3:1, and it carries `.label`, past-date numbers, bar times and the `+N` chips —
most of the text that is hard to read. `#6a7078` puts it near 5.3:1 without
making it look like primary text.

`--color-ink` and `--color-bright` are unchanged. They were never the problem.

## A.4 Weekend bands

Saturday and Sunday get their own shade, composed with — not replacing — the
alternating month bands, so a weekend in an odd month stays distinguishable from
one in an even month. Four utilities rather than two:

```css
.band-even     { background: var(--color-void); }
.band-odd      { background: color-mix(in oklab, var(--color-raised) 55%, var(--color-void)); }
.band-even-wk  { background: color-mix(in oklab, var(--color-raised) 22%, var(--color-void)); }
.band-odd-wk   { background: color-mix(in oklab, var(--color-raised) 72%, var(--color-void)); }
```

A slight **lift**, not a further darkening: `--color-void` is within about 3% of
black, so there is no headroom below it and a darker band would be invisible.

`DayCell` picks its class from `month % 2` and `dayOfWeek(date)` (0 = Sunday,
6 = Saturday — `civil.ts` already exports `dayOfWeek`).

The weekday header row dims `SUN` and `SAT` to match.

## A.5 The Saturday edge

The last column's bar ends flush against the window's right edge — measured at
x=1279 in a 1280 viewport — and its 6px resize handle sits in those last pixels.
Since scrollbars are hidden there is no gutter at all on that side.

Add `GRID_PAD_R = 8` to `constants.ts` and apply it as a **right margin** on two
elements: the weekday header's 7-column grid in `ContinuousCalendar`, and each
week row's column box in `WeekRow`.

A margin rather than padding, deliberately. `colWidth` is measured from the
header grid's own `contentRect`, and the bars are absolutely positioned in
percentages against the column box; padding would put those two boxes out of
agreement by 8px, while a margin shrinks both identically. The week row's
`border-b` hairline stays on the outer row element, so the rule still runs the
full width and the margin reads as a deliberate edge rather than a gap.

## A.6 Focus outlines

Suppress focus rings globally in `globals.css`:

```css
*:focus, *:focus-visible { outline: none; }
```

Requested explicitly. Note that this trades away the keyboard-only affordance;
the `.focus-ring` utility stays defined for anything that later wants it back.

Separately, event bars leave the tab order. dnd-kit's `attributes` stamps
`tabIndex={0}` and `role="button"` on every draggable, so Tab currently walks
through several dozen bars per screen. Spread `attributes` then override
`tabIndex={-1}`. `Modal.trapTab` already filters on `tabIndex >= 0`, so it needs
no change.

---

# Section B — Gestures

The bulk of the work. `ContinuousCalendar` becomes the single owner of pointer
gestures on the grid, per decision 3.

## B.0 The shared primitive

One resolver, used by all three gestures:

```ts
function dateUnderPointer(clientX: number, clientY: number): CivilDate | null {
  const el = document.elementsFromPoint(clientX, clientY).find((e) => e.hasAttribute('data-date'));
  return (el?.getAttribute('data-date') as CivilDate) ?? null;
}
```

This is the technique `handleDragStart` already uses to find the grab date. Every
gesture measuring the same thing is the point — it is the lesson of
[DESIGN.md §7](../../DESIGN.md), and the reason resize is broken today is that it
measured something else.

## B.1 Move: unique ids per segment

`EventBar`'s draggable id becomes `${occ.key}#${weekIndex}` with the occurrence
carried in `data`, so the two segments of a week-crossing bar are two distinct
draggables. `handleDragStart`/`handleDragEnd` already read the occurrence from
`e.active.data.current`, so they are unaffected.

Consequences: only the grabbed segment dims, the `DragOverlay` gets the right
active rect, and multi-day bars become draggable at all.

`WeekLayout` does not currently carry the week index; `WeekRow` receives it as a
prop from the virtualiser's `item.index`, which it already has in scope.

## B.2 Cross-week resize

`EventBar` stops owning the gesture. It reports pointer-down on a handle upward:

```ts
onResizeStart(occ: Occurrence, edge: 'start' | 'end', e: React.PointerEvent): void
```

`ContinuousCalendar` holds:

```ts
const [resize, setResize] = useState<{ key: string; edge: 'start' | 'end'; date: CivilDate } | null>(null);
```

and binds `pointermove`/`pointerup` on `window` for the duration. Each move
resolves `dateUnderPointer` and stores it.

**The preview is a post-pass over the expanded occurrences**, applied *before*
`byWeek` bucketing — clone the one occurrence with adjusted `date`/`endDate`.
Not by re-running `expandAll`, which would be a full re-expansion per pointer
move. Every affected row then re-renders, so a bar being stretched into next week
simply appears there. That is the missing feedback: the destination row shows the
actual bar, not a hint of one.

Inversion is clamped, not flipped: dragging the end handle above the start pins
the preview at a one-day span rather than inverting the bar.

Commit on pointer-up:
`diffDays(hoveredDate, edge === 'start' ? occ.date : occ.endDate)`, through the
existing `resizeOccurrence`.

Resize handles stay hidden on a clipped edge — you still lengthen a bar from an
end that is actually in the row you are pointing at — and widen from `w-1.5` to
`w-2`.

## B.3 Lasso

Pointer-down on a day cell arms a marquee, unless the target is an interactive
child (`e.target.closest('button')` covers the hover `+`, the `+N` chip, and the
day number if it becomes a button). Bars are draggables, so a pointer-down on one
goes to dnd-kit instead and never reaches here.

4px of slop before the marquee arms, matching the `PointerSensor`'s
`activationConstraint`, so a click still reads as a click. Below the threshold on
pointer-up, the gesture is a click: **clear the selection, create nothing**
(decision 2).

### Hit-testing is arithmetic, not measurement

The marquee is held in the scroll container's **content** coordinates
(`clientY - gridTop + scrollTop`), so it survives autoscroll without
recomputation. Because every row is exactly `ROW_H` tall and every segment's
geometry is known, intersection is computed rather than measured:

- week index range: `floor(contentY / ROW_H)` at each end
- column range: `floor((clientX - gridLeft) / colWidth)` at each end
- within a row, the marquee's y-band clipped to that row; a segment's own band is
  `[DAY_HEADER_H + segment.top, + segment.height]`

A segment is selected when its column range overlaps the marquee's **and** its
y-band overlaps the marquee's band in that row.

This deliberately does not read the DOM. Rows are virtualised, so a marquee
dragged past the viewport covers rows that do not exist as elements; `byWeek`
holds the whole expansion window regardless, and `layoutWeek` is cheap enough to
call for the handful of rows in the marquee's range. No `requestAnimationFrame`
throttle is needed because nothing is being measured.

Selection is `Set<string>` of occurrence keys. Selected bars render with a lit
outline (`--color-hairlit`, or brighter — it must survive against `bg-raised`).

### Autoscroll

Resize and lasso get edge-autoscroll on the scroll container: within 40px of the
top or bottom edge, scroll proportionally on a rAF loop. Without it, "extend this
into a week three rows down" still means dragging off-screen, which is half of
the original complaint. dnd-kit provides its own autoscroll for the move
gesture, so that path needs nothing.

## B.4 What a selection can do

Registered in the `SHORTCUTS` table in `Settings.tsx`, which the shell binds and
the settings panel documents — one keymap, per the previous spec's decision 5.

| gesture | effect |
|---|---|
| `Ctrl`/`Cmd` + click a bar | toggle it in or out of the selection |
| `Esc` | clear the selection |
| `Del` / `Backspace` | delete every selected entry |
| `←` / `→` | move the selection ∓1 day |
| `↑` / `↓` | move the selection ∓7 days |
| drag any selected bar | move every selected entry by the same delta |

Deleting more than one asks first. A move is reversible by dragging back; a bulk
delete is not.

Clearing the selection is the **last** layer of the shell's Escape unwind order,
after the date picker and the overlay stack — unchanged from the previous spec.

### Store

```ts
deleteEvents: (ids: string[]) => Promise<void>;
moveOccurrences: (occs: Occurrence[], deltaDays: number, scope: EditScope) => Promise<void>;
```

Both reuse the existing `optimistic()` snapshot-and-rollback. `moveOccurrences`
groups by whether each occurrence needs a series rewrite or an override row and
issues at most one write per table: a per-occurrence loop would produce a partial
state on failure that a single-snapshot rollback cannot express.

## B.5 Move feedback across rows

During a move drag, the destination footprint renders as a dashed band anchored
in the **target** row — reusing the `ghost` prop `WeekRow` already draws the
entry-form draft with, so there is one dashed-band implementation rather than
two. Computed from the hovered date plus the grab offset within the bar.

The `DragOverlay` chip following the cursor stays. Both together is the Notion
behaviour: a chip under the pointer, a placeholder showing where it will land.

---

# Section C — Chrome

Independent of A and B.

## C.1 Year dropdown

`YearView`'s option label drops the `· TODAY` suffix — the current year is
already the default value, and the suffix is what pushes the widest option past
the control. Widen `w-[116px]` → `w-[132px]` and add right padding so the native
arrow is not squished against the digits. The `‹ ›` steppers stay.

## C.2 The Google checkbox

Remove the "Mirror to Google for reminders" control from `EventForm` and stop
writing `notify` from the form. The column stays — a real mirror will want it,
and dropping it would need a migration for no gain.

Nothing else claims the feature works: `README.md` already says the Google
variables are "only needed for the calendar mirror, which isn't wired up yet"
and that sync is "designed but not built", and `docs/GOOGLE_SETUP.md` opens with
"Not built yet." The checkbox was the only thing overstating it.

**No synced indicator is added.** There is no sync, so there is no state to
indicate, and a glyph that never appears is worse than no glyph.

---

## Testing

- `layout.test.ts` — unchanged in substance; A.1 does not alter lane arithmetic,
  and a regression test asserting `WeekSegment.top` stays lane-relative (not
  row-relative) guards against the offset being "fixed" a second time in
  `layout.ts`.
- New coverage for the lasso's intersection helper: a pure function from
  (marquee rect, week layouts, colWidth) to a set of occurrence keys, tested
  without a DOM. This is why B.3 is arithmetic rather than measurement.
- `calendar-store.test.ts` — `deleteEvents` and `moveOccurrences` roll back
  cleanly as one unit on failure.
- The preview harness renders the real shell, so every gesture here is reachable
  from it. Its fixture ids are not UUIDs, so writes fail and roll back —
  verifying a gesture there means asserting the optimistic state, not the
  settled state.

## Out of scope

Google Calendar sync itself, the timeline ruler, the command palette, the List
view, and range-create by dragging (explicitly reversed by decision 2).
