# Tempo — undo and the day timeline

Two sections. **H** gives every mutation an undo, not just deletion. **I**
rebuilds the focused-day timeline so a block occupies exactly the time it
occupies, the day can be seen whole, and dragging one lands where you meant.

Neither depends on `supabase/migrations/20260801_history.sql`. See
"Relationship to Section G" below — the two are designed to land in either
order.

---

## Relationship to Section G

Section G (`2026-08-01-history-design.md`) is specced and unimplemented. It adds
soft delete and a durable per-event `event_versions` log, and it removes the
in-memory `recentlyDeleted` pool. Section H must not collide with it.

They answer different questions, and the difference is the same one G already
draws between a trash and a version log:

- **G's versions** are durable, per-entry, and ordered by time — "what did this
  entry look like last Tuesday". Scoped to one event; ten kept per event.
- **H's undo** is in-memory, global, and ordered by action — "take back what I
  just did". A group move of six entries is *one* undo, which a per-entry
  version log structurally cannot express.

H is deliberately **not** built on `event_versions`, for three reasons. A group
move is one action across many rows and G stores one row per event. G's capture
fails soft by design, so an undo built on it would silently not exist whenever
the history table is unreachable — and "⌘Z did nothing" is a worse failure than
"no version list". And G's migration may not have been run, which would make the
undo stack a feature that appears to work and doesn't.

**Landing order does not matter.** H snapshots whatever the store holds and
reconciles it back, so:

- If H lands first, it snapshots `recentlyDeleted` alongside everything else.
- If G lands first, `recentlyDeleted` is gone and `deleteEvent` is an update
  setting `deleted_at`. H's reconciler sees a *changed row*, not a missing one,
  and restores it by upsert with no special case. This is the strongest argument
  for the reconciler design in H.2: soft delete is not a code path it has to
  know about.

When G lands, the only edit needed to H is dropping `recentlyDeleted` from the
snapshot type.

---

# Section H — Undo

## H.1 What this is

⌘Z takes back the last thing you did, repeatedly, for the life of the tab.

Today undo exists only for deletion: a `recentlyDeleted` pool, a toast, and a
⌘Z that is live only while that toast is up
(`CalendarShell.tsx`, the keymap). Every other mutation — dragging an
entry to another date, dragging its end day, retiming it on the timeline,
editing it in the form, flipping its status — is permanent the instant it
happens.

That is the gap. Dragging is the app's primary gesture and the easiest thing to
do by accident, and it is the one action with no way back.

## H.2 The mechanism

Every mutation already funnels through `optimistic(apply, persist)` in
`calendar-store.ts`, and it already captures exactly what undo needs:

```ts
const snapshot = {
  events: get().events,
  overrides: get().overrides,
  categories: get().categories,
  recentlyDeleted: get().recentlyDeleted,
};
```

Taken before `apply()`, used to roll back when the write fails, and otherwise
thrown away. Undo is that snapshot kept.

```ts
interface UndoEntry {
  /** What the toast says, and what ⌘Z is taking back. */
  label: string;
  at: number;
  before: Snapshot;
}
```

`optimistic` takes a `label` and pushes an entry **on success only**. A write the
server rejected has already been rolled back; an undo entry for it would offer to
take back something that never happened.

Undo itself pushes nothing, so it cannot loop.

### The reconciler

Restoring a snapshot to local state is an assignment. Putting it back on the
server is the part that needs building, and it is done **once, generically**,
rather than as an inverse per action.

`reconcile(before, live)` diffs the two by primary key across `events`,
`overrides` and `categories`, and emits:

| condition | write | undoes |
|---|---|---|
| in `before`, not in `live` | insert | a delete |
| in `live`, not in `before` | delete | a create |
| in both, not deep-equal | upsert | a move, resize, retime, edit, status flip |

One reconciler covers every mutation that exists and every mutation that will
exist. The alternative — an inverse operation per action — means a new inverse
for each future feature, and a forgotten one is not a crash but a silent
divergence between what the screen shows and what the database holds. That class
of bug is the reason this is worth the diff.

Deep-equality is a plain structural compare on the mapped row shape, not on the
`TempoEvent` object, so `updatedAt` drift does not manufacture writes.

### Scope and lifetime

In-memory, capped at 50 entries, gone when the tab closes — the same reasoning
already documented for `recentlyDeleted`. The failure this catches is noticed in
seconds. It is not an archive, and no surface may imply that it is; that is what
Section G is for.

No redo. ⌘⇧Z stays the browser's.

## H.3 Labels

The label is written by the action that started the mutation, not by the store
method that finished it. `moveOccurrence` for a whole series delegates to
`updateEvent`, and the toast must say "Moved Standup", not "Edited Standup", so
the label is threaded through rather than inferred at the bottom.

| action | label |
|---|---|
| `createEvent` | Created *title* |
| `updateEvent` / `updateEventFromDraft` | Edited *title* |
| `deleteEvent` | Deleted *title* |
| `deleteEvents` | Deleted *n* entries |
| `restoreDeleted` | Restored *title* |
| `moveOccurrence` | Moved *title* |
| `moveOccurrences` | Moved *n* entries |
| `gatherOccurrences` | Moved *n* entries |
| `resizeOccurrence` | Resized *title* |
| `setOccurrenceTime` | Rescheduled *title* |
| `cancelOccurrence` | Skipped *title* |
| `setStatus` | Marked *title* *status* |
| category methods | Added / Renamed / Deleted category *name* |

Titles truncate in the toast, which already bounds its own width.

## H.4 The toast, and ⌘Z

`Toast` becomes generic: a label, an UNDO button, a dismiss. It stops taking
`DeletedEntry[]` and stops composing its own copy. Everything else about it —
the lifetime, the lift above the footer, that it is not a layer and Escape
clears it on the way past — is unchanged and correct.

**⌘Z is no longer gated on a visible toast.** Today it fires only while one is
up, which means the undo you reach for eight seconds late does nothing. It now
fires whenever the stack is non-empty.

That makes silent success possible, so undoing raises its own toast — `Undid:
Moved Standup`, with no UNDO button, on the same clock. A keypress that changes
the calendar must always say what it changed.

The shell keeps announcing from state rather than being told: it currently
watches `recentlyDeleted` for a batch newer than the last announced, and now
watches the top of the undo stack the same way. Two surfaces mutate the calendar
without reporting upward, and that is why this is a subscription and not a
callback.

## H.5 Testing

Extends `calendar-store.test.ts`, which already has a mock Supabase harness.

- The stack is LIFO across mixed action types.
- Move, then undo, restores the original dates — for a one-off, for a whole
  series, and for a single overridden occurrence.
- Resize, then undo, restores the original `endDate`.
- A time drag, then undo, restores the original minutes.
- Delete, then undo, restores the event **and its overrides**. This is the case
  Section E had to work for; assert the behaviour regardless of mechanism.
- Create, then undo, deletes the row.
- A failed write pushes **no** undo entry and leaves the stack untouched.
- A failed *undo* leaves the stack entry in place, so it can be retried.
- The cap evicts oldest-first at 51 entries.

---

# Section I — The day timeline

`DayView` is the 24-hour column inside the DAY modal. It has four problems, and
they compound: you cannot see much of the day at once, blocks that cross
midnight are not drawn at all, dragging one does not land on the grid, and there
is no indication of when *now* is.

Design reference is Google Calendar and Notion Calendar, both of which solve
this surface well and agree on most of it. Where they disagree, the choice is
called out.

## I.1 Geometry — blocks that mean what they show

Today `DayView` splits occurrences into two piles:

```ts
const bars  = occurrences.filter((o) => o.allDay || diffDays(o.endDate, o.date) > 0);
const timed = occurrences.filter((o) => !o.allDay && diffDays(o.endDate, o.date) === 0);
```

Anything crossing midnight is swept into the ALL DAY strip and never drawn on
the timeline. A shift from 22:00 to 06:00 shows as a chip with no position and
no duration; the eight hours it actually occupies are invisible, and the morning
it eats looks free.

The data is already correct. `expandEvent` widens its search by the event's own
duration, so yesterday's overnight event is present in the day's occurrences
with `date` = yesterday. Only the render dropped it.

A new pure module `timeline.ts` — mirroring the existing `when.ts` /
`when.test.ts` pattern — owns the arithmetic:

```ts
interface DaySegment {
  top: number;        // minutes past midnight on this day
  bottom: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

daySegment(occ: Occurrence, date: CivilDate): DaySegment | null
```

- `continuesBefore = occ.date < date`; `top` is `0` when it does, else
  `occ.startMinutes`.
- `continuesAfter = occ.endDate > date`; `bottom` is `1440` when it does, else
  `occ.endMinutes`.
- Returns `null` when the segment has no height.

That last case is not defensive coding, it is a real event. Something ending at
exactly 00:00 has `endMinutes === 0` and `endDate` one day later, so it overlaps
the following day by the rules and occupies none of it. Without the null, every
morning after a late event carries a zero-height sliver pinned to the top of the
column.

The ALL DAY strip then holds exactly what is genuinely all-day: entries with no
time of day, which have no position to occupy. This is the one place the design
follows Notion Calendar over Google Calendar, which files multi-day *timed*
events into its all-day strip. Notion clips them per day, and clipping is what
was asked for and what is true.

### Continuation is drawn, not implied

A clipped edge is drawn as cut rather than closed: no border on that side, a
short gradient fade, and a chevron with the far date — `↑ FROM AUG 1`,
`↓ TO AUG 3`.

Without it a block ending flush at the bottom of the column is ambiguous with
one that genuinely ends at midnight, and those mean different things to someone
scanning their evening.

### Lane packing is fixed while we are here

`packLanes` assigns lanes correctly and then reports the wrong width:

```ts
const total = Math.max(1, laneEnds.length);
return new Map([...assignment].map(([k, lane]) => [k, { lane, of: total }]));
```

`of` is the lane count for the **whole day**, so one overlapping pair at 09:00
renders every unrelated block in the day at half width, with a column of dead
space beside the afternoon. Lane counts become per-cluster, where a cluster is a
set of segments connected by transitive overlap.

Equal-width columns within a cluster are kept over Google's cascade-with-offset.
The cascade exists to keep a hidden event's title peeking out; with accurate
clipping and a fixed lane count there is nothing hidden to rescue, and equal
columns state the overlap honestly.

Packing operates on `DaySegment`, not on raw `startMinutes`, or an overnight
block would be packed against the wrong interval.

## I.2 The current time

A red rule at `nowMinutes / 60 × hourHeight`, drawn only when the focused date
is today **in the calendar's timezone** — `todayIn(timezone)`, not the browser's
local midnight, which is the bug this app's civil-date layer exists to prevent.

Both reference apps do the same three things, and all three matter:

- A filled dot at the gutter edge, so the line has an origin and does not read
  as a hairline border.
- The live time in the gutter in red, replacing that hour's label.
- Drawn above blocks, `pointer-events: none`, so it never intercepts a drag.

Ticks every 30 seconds. Computed in an effect with a `null` initial value, so
the server and the first client frame render identically — a clock read during
render is a hydration mismatch.

## I.3 Zoom and fit

24 hours × 44px is 1056px of content in a `52vh` pane: about five hours visible.
That is the "hard to see the entire timeline" complaint, and it has two halves —
the pane is small, and the scale is fixed.

**The pane grows.** `DayModal` moves from `h-[52vh]` to
`h-[min(72vh,calc(100vh-14rem))]` with a `min-h-[360px]` floor — the subtraction
leaves room for the modal's header, the stepper row and the viewport margin, and
the floor keeps a short window from collapsing the column to nothing.

**The scale becomes a preference.** Zoom lives in `day-zoom.ts`, a small external
store following the existing `view-preference.ts` pattern — `subscribe`,
`getSnapshot`, `getServerSnapshot`, `set`, persisted to `localStorage`.

The state is `'fit' | number`, not merely a pixel height. Storing the resolved
height would freeze FIT at whatever the window happened to be when it was
chosen, and it would stop being fit the moment the window resized. The pane
measures itself with a `ResizeObserver`; FIT resolves to `paneHeight / 24`.
Manual zoom clamps to 8–120px per hour.

Three controls, each routed through whichever component already owns that kind
of decision:

- A zoom control in `DayModal`'s toolbar beside the ‹ › steppers. `DayView`
  deliberately draws no chrome of its own and that does not change.
- `+`, `-`, and `0` in the shell keymap, live only while the day overlay is on
  top. The shell is the one place that decides what a key means.
- Ctrl/⌘-wheel over the grid, which is what a trackpad pinch sends.

**Hour labels thin out as the scale shrinks.** Below 26px per hour every third
hour is labelled; the gridlines stay. Twenty-four labels stacked at 20px is a
grey texture, not a scale.

**Half-hour gridlines** appear at or above 34px per hour, fainter than the hour
rules. Both reference apps do this and it is what makes a block read as "half
past" without counting pixels.

Both thresholds and the 8–120px clamp live beside `HOUR_H` in `constants.ts`
rather than inline, since the label-thinning and half-hour rules have to agree
about the same scale.

### Scroll anchoring

Today the column hard-scrolls to 07:00 on every date change. Instead:

- **Today** scrolls to put the current time in view.
- **Another day** scrolls to its first event.
- **An empty day** falls back to 07:00.

Changing zoom holds the **centre time** fixed, not the pixel offset. Zooming out
and finding yourself at a different hour is the single most disorienting thing a
timeline can do.

## I.4 Dragging

### Snapping is absolute

Today the *delta* is snapped, not the result:

```ts
const snap = (dy: number) => {
  const minutes = (dy / HOUR_H) * 60;
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
};
```

An entry starting at 09:07 moves in clean 15-minute steps and is therefore at
09:07, 09:22, 09:37 forever. It can never reach the grid, which is the opposite
of what snapping is for.

The resulting time is snapped instead:

- **move** — `newStart = snap(origStart + rawDelta)`, end follows at the original
  duration, so the length of a block never changes by moving it.
- **resize** — `newEnd = snap(origEnd + rawDelta)`, floored at `newStart + 15`.
- **Alt** drops granularity to 1 minute for the rare deliberate 09:07.

Granularity stays 15 minutes at every zoom. Tying it to the scale was
considered and rejected: it makes the same gesture produce different results
depending on a view setting, and the failure is silent.

### Out of range clamps

```ts
if (start < 0 || end > DAY_MINUTES || end <= start) return;
```

An overshoot at either end of the day currently discards the entire gesture with
no feedback — the block springs back and nothing says why. It clamps instead.

Blocks that cross midnight clamp so the **dates cannot change**, because
`setOccurrenceTime` takes only minutes and has no way to express "and also move
it a day". Honest and narrow, rather than a drag that appears to work and
silently truncates the event.

### Affordances

- `cursor: grab` on a block, `grabbing` while held, `ns-resize` on the handle.
- **A live time chip follows the drag**, reading `09:15 – 10:15` and updating as
  it moves. Both reference apps do this, and it is the largest single
  improvement to "moving entries" available here: it turns a drag from an
  estimate into a readout. It also makes snapping legible — you watch the value
  step in quarter-hours.
- The block being dragged carries a shadow and full opacity; its original
  position stays as a faint outline until release, so the gesture has a
  reference point.
- The end grip appears **only when the block actually ends on this day**. There
  is nothing to grab on an edge that is a clip rather than an end.

### Content adapts to height

Every block currently renders a title line and a time line regardless of size,
inside a box with `Math.max(18, …)` of height. A 15-minute meeting overflows its
own box.

Three densities, on the rendered height:

- **≥ 40px** — title, then time on its own line.
- **≥ 22px** — title and time on one line, time dimmed.
- **below** — title only, single line, truncated.

## I.5 Chrome

- The gutter is a fixed left column that does not scroll horizontally, with
  hour labels right-aligned against the rules. Currently each label is absolutely
  positioned inside its own hour row.
- The ALL DAY strip gains a bottom shadow once the timeline is scrolled, so it
  reads as pinned rather than as the first thing in the scroll.
- Empty-hour rows keep the existing click-to-create and `cursor-copy`.
- Transitions respect `prefers-reduced-motion`.

## I.6 Testing

`timeline.ts` is pure and gets `timeline.test.ts`:

- A same-day block segments to its own minutes with neither continuation flag.
- A block starting yesterday segments to `top === 0`, `continuesBefore`.
- A block ending tomorrow segments to `bottom === 1440`, `continuesAfter`.
- A block spanning a whole day segments edge to edge with both flags.
- A block ending at exactly 00:00 returns `null` on the following day, and a
  full-height segment on the day before.
- Clusters pack independently: two overlapping at 09:00 and one alone at 15:00
  give the third `of: 1`, not `of: 2`.
- Snap-to-absolute pulls 09:07 to 09:00 and 09:08 to 09:15.
- Clamping holds a drag at the end of the day instead of discarding it.

Component-level behaviour — the time line only on today, zoom persistence, drag
chip — is left to manual verification against the preview harness, which already
carries fixtures including overnight and overlapping entries.

## I.7 Out of scope

- **Drag on empty space to create an entry of that duration.** A natural
  companion to this work and a real Google Calendar behaviour, but it changes
  `EntrySeed` and the form's seeding path, and the request here was about
  reading the timeline and moving what is already on it.
- **A start grip.** The timeline has only an end grip today; a symmetric one is
  the obvious next thing and is not what was asked for.
- **Magnetising to neighbouring block edges** and to the current-time line.
  Considered and deferred: it is a refinement of snapping, and absolute snapping
  is the fix for the actual defect.
- **Multi-day drags that change the date.** See I.4.
- Google sync, reminders, and anything in Section G.
