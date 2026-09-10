# Tempo — entries you can read at a glance

A follow-up to [Notion-scale entries](2026-08-01-notion-scale-and-recovery-design.md),
which grew every bar about 35% and kept the rule that height carries importance.
That fixed "I can't see the entries". This fixes "I can see them and still can't
tell them apart". Three sections, executed **in this order**: **A — the bar**,
**B — category colours**, **C — grid fixes**. B reuses A's colour module; C is
independent of both.

---

## What prompted this

In the user's words: five finals are five entries titled "Final Exam", and the
only way to tell them apart is the category colour or opening each one. Entries
feel short next to Notion's calendar, and colour that only appears on the sides
of bars sitting close together, row after row, is hard to read.

Also asked for in the same pass: the month label in the top left doesn't match
where they're looking; an entry that wraps into the next week hovers as two
separate things; a busy day's entries touch the bottom of the row; and more
category colours, or custom ones.

## What is actually wrong

Established by reading the code and driving `/preview`.

- **Nothing on a bar names its category.** The category is two 2px end borders.
  Every bar has the same `bg-raised` fill and the same `text-ink` title, so five
  "Final Exam" bars are five identical grey rectangles. The palette was tuned for
  exactly that reading size (`Settings.tsx`: "distinguishable as a 2px left
  border") and repeats past eight categories — and this calendar has five course
  categories plus the general ones.
- **The colour is too small to read while scanning.** About 4px of colour on a
  bar 100–180px wide. Colour discrimination falls off for small fields and in
  peripheral vision, worst for orange and bluish hues
  ([field size](https://opg.optica.org/josa/abstract.cfm?uri=josa-42-11-837),
  [periphery](https://jov.arvojournals.org/article.aspx?articleid=2193447)) —
  which is rust and steel, glimpsed while scanning.
- **No room for text.** An event is 28px with a one-line title that truncates. On
  a 375px phone a one-day bar shows three characters: "Sta…".
- **The month readout names the wrong month.** `head` is the Wednesday of the
  topmost row with *any* pixel visible, so a week that has scrolled 90% out of
  view still names the month. It runs about a row ahead of the eye, and taller
  rows make it worse.
- **A split entry is two things.** A bar crossing a week boundary renders as two
  `EventBar`s with separate draggable ids (deliberately — see B.1 of
  [grid gestures and legibility](2026-07-31-grid-gestures-and-legibility-design.md)). Each has its own CSS `hover:`, and dnd-kit's `isDragging` dims
  only the half that was grabbed.
- **The lasso loses its place below tall rows.** `getWeekRange` starts its scan
  at `floor(y0 / ROW_H) - 10`. Rows above that have been measured taller than
  `ROW_H` push the true index below the guess; once they add up to roughly
  2000px of extra height the scan starts past the marquee and the lasso selects
  nothing. Latent today; taller bars make it routine within a semester.
- **A busy row has no floor.** Row height is
  `max(ROW_H, contentHeight + DAY_HEADER_H)`, so a row that grows to fit its
  entries puts the last bar flush on the row's bottom rule.

## Decisions taken

1. **Tinted fill plus a category chip.** Chosen over a grey bar with a coloured
   chip (least change, barely more scannable) and a solid fill (most scannable,
   dark titles at 4.7–6:1, multi-day entries become slabs). The strength was set
   by the user on a slider: **50%**.
2. **Category colour stays the only hue on screen.** The README's rule stands.
   What changes is how much of each bar the colour covers.
3. **Events and tasks double; birthdays and marks do not.** A birthday is one
   line ("Mom · 52") and a mark is a tick; neither needs the room.
4. **Every piece of text on a bar clears 4.5:1** on every palette colour and on
   every custom hue, and a test enforces it.
5. **Ten presets plus a constrained custom hue.** Stored as hex in
   `categories.color`, as now — no migration.
6. **Recurrence is its own spec.** Custom repeat intervals and "this and
   following" edits come next, building on the uncommitted recurrence changes
   already in the working tree, which this work does not touch.

---

# Section A — The bar

## A.1 Heights

```ts
export const KIND_HEIGHT: Record<EventKind, number> = {
  milestone: 20,   // unchanged
  event: 56,       // was 28
  birthday: 34,    // unchanged
  assignment: 84,  // was 42
};
```

`LANE_GAP` stays 4. `MIN_ROW_H` stays 190, so a quiet week looks exactly as it
does now and a busy one grows: the finals week in the design mockups comes out
around 240px. On a 900px-tall laptop that is about three busy weeks per screen
instead of four.

The importance ordering becomes task > event > birthday > mark. The birthday
dropping below the event is the request, not an accident, and the comment on
`KIND_HEIGHT` says so.

## A.2 Colour

A new pure module, `src/components/calendar/tint.ts`, owns every colour a bar
draws. Mixing happens in OKLab (perceptual) and in TypeScript rather than CSS
`color-mix()`, so the colour on screen is the colour the test measures.

```ts
export const BAR_FILL = 0.5;   // share of the category colour in the fill
export const BAR_SOFT = 0.85;  // share of ink in secondary text

export function mixOklab(a: string, b: string, t: number): string; // hex; t = share of a
export function contrast(a: string, b: string): number;           // WCAG ratio

export interface BarColors {
  fill: string;          // bar background
  edge: string;          // 3px leading edge
  ink: string;           // title
  soft: string;          // time, due date, status glyph
  chip: { bg: string; fg: string } | null;  // null: no category, no chip
}
export function barColors(color: string | null): BarColors;
```

- **Categorised:** `fill = mixOklab(color, RAISED, BAR_FILL)`, `edge = color`,
  `ink = INK`, `soft = mixOklab(INK, fill, BAR_SOFT)`,
  `chip = { bg: color, fg: VOID }`.
- **Uncategorised:** `fill = RAISED` (today's bar), `edge = DEFAULT_CATEGORY_COLOR`,
  `chip = null`. "No category" still looks different from every category.
- Memoised per colour. A screen draws dozens of bars from about ten colours.
- `RAISED`, `INK` and `VOID` mirror the `@theme` tokens in `globals.css` by
  hand, because the module cannot read CSS variables. The test reads
  `globals.css` and fails if they drift.

Why `soft` is not `--color-mute` or `--color-dim`: on a 50% fill, dim measures
2.9–3.6:1 and mute less. An 85% mix of ink toward the fill measures at least
4.9:1 on every preset.

Measured at 50%, across the ten presets: title 6.1–7.6:1, soft 4.9:1 or better,
chip 4.7:1 or better (plum is the floor).

## A.3 Anatomy

- **Fill and edge.** The fill, plus a 3px leading edge in the full colour. No
  other borders. A bar continued from the previous week has no edge on that side
  and keeps its `‹`, as now.
- **The right-hand edge goes.** Both ends carried colour because a single
  coloured edge on a grey bar read as a direction. A filled bar has its shape
  already, so the second edge is noise — a deliberate reversal, and the comment
  in `EventBar` says why.
- **Hover** is a 1px inset ring in the category colour
  (`box-shadow: inset 0 0 0 1px`), on every segment of the entry (C.2). Not a
  brighter fill: at 60% the soft text drops to 4.1:1.
- **Selected** keeps the 1px ink outline. **Done** keeps the strike-through and
  `.45` opacity. **Google read-only** keeps `.7`.
- **Resize grips** keep their gradient in the full colour, revealed by the
  linked hover (C.2) instead of `group-hover`.

### Per kind, at 90px of content or more

| kind | top | middle | bottom |
|---|---|---|---|
| event | `09:00` title, wrapping to 2 lines | — | chip |
| all-day event | title, 2 lines | — | chip |
| task | `[~]` title, 2 lines | time, or `DUE 12-09` | chip |
| birthday | title, one line, centred | — | no chip |
| milestone | `◆` title, one line | — | no chip |

A wrapped title hangs under itself, not under the time — the time is its own
flex column. `overflow-wrap: anywhere`, so a long unbroken word cannot push the
bar open. A task's status glyph moves from the meta line to the front of the
title, where it reads as the checkbox it is.

**The chip:** the category name in capitals, 11px, `line-height: 15px`,
`padding: 0 5px`, tracking `.03em`, cut with an ellipsis when it runs out of
room. Square corners, like everything else in Tempo.

### Width tiers

Container queries on `.tempo-bar`'s content box, extending the existing
`@container (max-width: 90px)` rules.

- **90px and up:** as above.
- **50–90px:** the time takes its own line at 9px, as now. An event's title
  clamps to **one** line so the chip still fits; chip text drops to 10px. Tasks
  hide the status glyph and the word `DUE`, as now.
- **Under 50px:** the chip is hidden and the title goes back to two lines. The
  fill still says which category it is. A one-day bar on a 375px phone has about
  25px of content, so this is the phone case.

The heights that have to fit: an event needs 5 + 28 + 3 + 15 + 5 = 56px in the
wide tier, 5 + 10 + 14 + 3 + 15 + 5 = 52 in the middle tier, and 5 + 10 + 28 + 5
= 48 narrow. A task needs 71 of its 84.

## A.4 Where it applies

**The grid.** `EventBar`; `DragGhost`, which draws the same fill, edge, title
and chip at its kind's height; and the entry form's draft band.

The draft band stays neutral — the form may not have a category yet — but its
label moves to the top like a bar's title instead of sitting centred in 56px.
Its placement changes, because the old clamp breaks at the new heights:

- **The form's draft** sits below everything in the row, at
  `contentHeight + LANE_GAP` rather than after the last lane (per-column
  stacking means the last lane is not always the lowest bar), and the row grows
  to hold it. The `LANE_BUDGET` clamp goes: at 56px it would put the draft over
  existing bars in nearly every busy week.
- **A move preview** keeps the clamp. Growing rows mid-drag would shift every
  row below, and with it the drop target under the pointer.

**The day panel.** `DayView`'s all-day rows get the fill, edge, and a
right-aligned chip. Its timed blocks get the fill and edge, a chip under the time
label when the block is at least 58px tall, and the hover ring in place of
`bg-sunken`. `TasksPane` rows get the chip after the time label.

**One chip.** A shared `CategoryChip` component, so the grid and the day panel
cannot drift apart.

**Data flow.** `colorFor(id) → string` becomes `categoryFor(id) → Category | null`
in `ContinuousCalendar`, `DayView` and `TasksPane`. It stays a `useCallback` on
`categories`, so `WeekRow`'s memo is no less stable than it is now. `EventBar`
takes `category: Category | null` and derives everything from `barColors`.

**Unchanged:** the List view, the Year view, and the category rows in Settings.

---

# Section B — Category colours

## B.1 Ten presets

`CATEGORY_PALETTE` grows from eight to ten. The new two go before graphite, so
the neutral stays last:

rust, sage, steel, sand, plum, teal, rose, **ochre `#947a30`**, **petrol `#128e99`**, graphite

Chosen by search, not by eye: within the existing palette's band (OKLCH
lightness 0.59–0.69, chroma 0.055–0.10), the hues with the largest minimum
distance from all eight existing colours, compared as 50% fills. Ochre (hue 90°)
is ΔE 4.6 from its nearest neighbour and petrol (205°) 4.2. Both are farther from
every existing colour than the palette's current closest pair, steel and
graphite, are from each other (2.9). Contrast at 50%: ochre title 7.4, soft 5.7,
chip 4.9; petrol 7.3, 5.7, 5.1.

The existing eight are untouched. They are stored as hex on each category, so
retuning one would mean rewriting the user's rows.

## B.2 Custom hue

The swatch popover becomes a 5 × 2 grid with a hue slider under it.

- The slider sets `customHue(h)`: OKLCH lightness 0.65, chroma 0.08, hue `h`,
  converted to hex. At that lightness and chroma every integer hue is inside
  sRGB and passes: chip at least 5.9:1, title 6.3:1, soft 5.0:1. You pick the
  hue; Tempo holds the rest.
- The track is painted with those same constrained hues, so it shows what you
  will get.
- Dragging previews; releasing commits. One `updateCategory` write, not one per
  pixel.
- Reopening a custom colour puts the slider at its hue (`hueOf(hex)`). A preset
  shows as the selected square.
- **No free-form picker.** An arbitrary colour can make titles or chips
  unreadable, and nothing could keep the promise in decision 4.
- `suggestColor` is unchanged: the first unused preset.

`customHue` and `hueOf` live in `tint.ts` beside the mixing they share.

---

# Section C — Grid fixes

## C.1 The month readout

A pure function in a new `src/components/calendar/readout.ts`:

```ts
interface Month { year: number; month: number }

export function monthReadout(
  rows: ReadonlyArray<{ weekStart: CivilDate; visible: number }>, // visible: 0–1
): { head: Month; next: Month | null };
```

- Each day of each row adds its row's visible fraction to that day's month. The
  **head** is the month with the most. A tie goes to the earlier month, so the
  label cannot flicker on an exact half.
- **next** is the month of the last visible day, when it is later than the head.
  `→ OCTOBER` still appears when October starts on screen.
- `ContinuousCalendar` builds the rows from the virtualiser's items. Overscan
  rows have nothing visible and drop out. With no rows yet, the current readout
  stands in.

## C.2 One entry, one thing

A small zustand store, `src/components/calendar/entry-focus.ts`:

```ts
interface EntryFocus {
  hovered: string | null;
  carried: ReadonlySet<string>;
  hover(key: string): void;
  unhover(key: string): void;           // clears only if `key` is still hovered
  carry(keys: Iterable<string>): void;
  drop(): void;
}
```

- `EventBar` calls `hover` on `pointerenter` from a mouse only (a touch has no
  hover) and `unhover` on `pointerleave`. Each bar subscribes with a selector —
  `s.hovered === occ.key` — so a hover re-renders that entry's segments and
  nothing else.
- A lit bar gets `data-lit`, which draws the ring and shows the grips.
- `handleDragStart` calls `carry` with the entries being moved — the selection
  when `carriesSelection(occ)`, otherwise just `occ.key` — and drag end and
  cancel call `drop`. Bars dim on `carried.has(key)` instead of on dnd-kit's
  per-segment `isDragging`, so both halves of a split entry, and every piece of a
  group move, dim together.

## C.3 The lasso over tall rows

`rowsInBand(rows, y0, y1)` in `layout.ts`: binary-search the first row whose
`end ≥ y0`, collect until `start > y1`. `getWeekRange` calls it over the
virtualiser's measurements, which are sorted by construction. It replaces the
`floor(y0 / ROW_H) - 10` starting guess.

## C.4 A floor under a busy row

`ROW_PAD_B = 8` in `constants.ts`. `WeekRow`'s height becomes
`max(ROW_H, bottom + DAY_HEADER_H + ROW_PAD_B)`, where `bottom` is the larger of
`contentHeight` and the form draft's bottom edge. Quiet rows sit at the 190px
minimum and do not change.

---

## Testing

- **`tint.test.ts`**
  - All ten presets at `BAR_FILL`: title, soft and chip each at least 4.5:1.
  - `customHue(h)` for every integer hue 0–359: in gamut, and the same three
    checks pass.
  - `hueOf(customHue(h))` round-trips within 1°.
  - The mirrored tokens match `globals.css`.
- **`layout.test.ts`**
  - The height cases restated at the new figures.
  - `rowsInBand`: forty 400px rows, where a band thirty rows down returns the
    right rows (the old guess returns none); an empty band; a band spanning
    several rows.
- **`readout.test.ts`**
  - A sliver of September at the top over a screen of October reads `OCTOBER`.
  - Mostly September with October starting at the bottom reads
    `SEPTEMBER → OCTOBER`.
  - A tie reads the earlier month.
  - December into January carries the year.
- **`entry-focus`**: `unhover(b)` leaves a hover on `a` alone.
- Everything else still passes (303 tests at baseline, including the
  uncommitted recurrence work).
- **The preview harness** gets the five course categories, coloured so all ten
  presets appear, and a finals week two weeks out: five "Final Exam" entries in
  five categories. Checked by eye at about 1440px, about 800px, and 375px.

## Records

- `DESIGN.md` gains **§15, "An entry says what it belongs to"**: why the bar
  moved from a 2px edge to a fill and a chip, the 50% figure and the contrast
  floor behind it, the birthday exception, and why custom colour is a hue rather
  than a free pick.
- Comments that describe the 2px reading size, the both-ends edge, or rows of
  fixed height are corrected where they stand: `constants.ts` (palette,
  `MIN_ROW_H`), `layout.ts` (`KIND_HEIGHT`), `Settings.tsx` (palette, swatch),
  `EventBar`.

## Out of scope

Custom repeat intervals and "this and following" edits (the next spec); the List
and Year views; retuning the existing eight colours; a tint-strength setting;
dimming past entries; colour in the entry form's category select.
