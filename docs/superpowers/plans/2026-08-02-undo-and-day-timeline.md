# Undo and the Day Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every mutation an undo, and rebuild the focused-day timeline so a
block occupies exactly the time it occupies, the whole day can be seen at once,
and dragging one lands where you meant.

**Architecture:** Two independent sections. **I** (tasks 1–9) extracts the
timeline's arithmetic into a pure, tested `timeline.ts` and rewrites `DayView`
against it — per-day clipping, a current-time rule, zoom, and absolute snapping.
**H** (tasks 10–13) keeps the snapshot `optimistic()` already takes, and adds a
generic reconciler that writes any snapshot back to the server, scoped to the
rows the action touched.

Section I is built first: it is self-contained, it touches no file Section H
touches, and it delivers the visible half.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zustand, Supabase, Tailwind 4,
Vitest.

## Global Constraints

- **Read `node_modules/next/dist/docs/` before writing Next.js-specific code.**
  Per `AGENTS.md`, this Next.js has breaking changes from training data.
- Vitest runs `environment: 'node'` and `include: ['src/**/*.test.ts']` — **only
  `.ts` files are collected.** Component behaviour is not unit-testable here; it
  is verified manually against `/preview`.
- All dates are `CivilDate` (`'YYYY-MM-DD'` strings). Never construct a local
  `Date` from one. Times are minutes past midnight.
- Timezone comes from the store (`useCalendar(s => s.timezone)`), never from the
  browser. Use `todayIn(timezone)`.
- Run `npx tsc --noEmit` before every commit. It must exit 0.
- Baseline at plan start: **167 tests passing**, `tsc` clean, working tree clean
  at `9c437c7`.
- Do not modify `History.tsx`, `reminders.ts`, `push/`, or the service worker.
- Spec: `docs/superpowers/specs/2026-08-01-undo-and-day-timeline-design.md`.

---

# Section I — The day timeline

## File structure

| File | Responsibility |
|---|---|
| `src/components/calendar/timeline.ts` | **Create.** All timeline arithmetic: per-day clipping, overlap clustering, drag snapping, zoom resolution. Pure — no React, no store. |
| `src/components/calendar/timeline.test.ts` | **Create.** Unit tests for the above. |
| `src/lib/store/day-zoom.ts` | **Create.** `useSyncExternalStore` source for the zoom preference, persisted to localStorage. Plumbing only, mirroring `view-preference.ts`. |
| `src/components/calendar/DayView.tsx` | **Modify.** Renders against `timeline.ts`. |
| `src/components/calendar/DayModal.tsx` | **Modify.** Taller pane, zoom control in the toolbar. |
| `src/components/calendar/CalendarShell.tsx` | **Modify.** `+` / `-` / `0` keys while the day overlay is on top. |
| `src/components/calendar/constants.ts` | **Modify.** Zoom constants beside the existing layout constants. |

---

### Task 1: Per-day clipping

**Files:**
- Create: `src/components/calendar/timeline.ts`
- Create: `src/components/calendar/timeline.test.ts`

**Interfaces:**
- Consumes: `Occurrence` from `@/lib/tempo/types`, `CivilDate` from `@/lib/tempo/civil`.
- Produces: `DAY_MINUTES: number`, `interface DaySegment`, `daySegment(occ: Occurrence, date: CivilDate): DaySegment | null`.

- [ ] **Step 1: Write the failing test**

Create `src/components/calendar/timeline.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { daySegment } from './timeline';
import type { Occurrence, TempoEvent } from '@/lib/tempo/types';
import type { CivilDate } from '@/lib/tempo/civil';

/**
 * The clipping rules are the whole of "a block covers the duration it occupies".
 * They are pure arithmetic over four values, and every one of the interesting
 * cases — midnight, a fully-enclosed day, a zero-height tail — is unreachable
 * from a rendering test without building a calendar to hold it.
 */

const event = {} as TempoEvent;

function occ(over: Partial<Occurrence>): Occurrence {
  return {
    key: 'e1:2026-08-10',
    eventId: 'e1',
    event,
    date: '2026-08-10',
    endDate: '2026-08-10',
    seriesDate: '2026-08-10',
    index: 1,
    title: 'Thing',
    allDay: false,
    startMinutes: 9 * 60,
    endMinutes: 10 * 60,
    kind: 'event',
    status: null,
    categoryId: null,
    isOverride: false,
    readOnly: false,
    ...over,
  };
}

const DAY: CivilDate = '2026-08-10';

describe('daySegment', () => {
  it('gives a same-day block its own minutes and no continuation', () => {
    expect(daySegment(occ({}), DAY)).toEqual({
      top: 540,
      bottom: 600,
      continuesBefore: false,
      continuesAfter: false,
    });
  });

  it('clips the top of a block that started on an earlier day', () => {
    const o = occ({ date: '2026-08-09', endDate: DAY, startMinutes: 22 * 60, endMinutes: 6 * 60 });
    expect(daySegment(o, DAY)).toEqual({
      top: 0,
      bottom: 360,
      continuesBefore: true,
      continuesAfter: false,
    });
  });

  it('clips the bottom of a block that ends on a later day', () => {
    const o = occ({ endDate: '2026-08-11', startMinutes: 22 * 60, endMinutes: 6 * 60 });
    expect(daySegment(o, DAY)).toEqual({
      top: 1320,
      bottom: 1440,
      continuesBefore: false,
      continuesAfter: true,
    });
  });

  it('runs a fully-enclosed day edge to edge', () => {
    const o = occ({ date: '2026-08-09', endDate: '2026-08-12' });
    expect(daySegment(o, DAY)).toEqual({
      top: 0,
      bottom: 1440,
      continuesBefore: true,
      continuesAfter: true,
    });
  });

  /**
   * The case that puts a 0px sliver at the top of every morning after a late
   * event. It overlaps the day by the range rules and occupies none of it.
   */
  it('returns null for a block ending at exactly 00:00 on this day', () => {
    const o = occ({ date: '2026-08-09', endDate: DAY, startMinutes: 22 * 60, endMinutes: 0 });
    expect(daySegment(o, DAY)).toBeNull();
  });

  it('still gives that block a full-height tail on the day before', () => {
    const o = occ({ date: '2026-08-09', endDate: DAY, startMinutes: 22 * 60, endMinutes: 0 });
    expect(daySegment(o, '2026-08-09')).toEqual({
      top: 1320,
      bottom: 1440,
      continuesBefore: false,
      continuesAfter: true,
    });
  });

  it('returns null for an all-day occurrence, which has no position', () => {
    expect(daySegment(occ({ allDay: true, startMinutes: null, endMinutes: null }), DAY)).toBeNull();
  });

  it('returns null for a day the occurrence does not touch', () => {
    expect(daySegment(occ({}), '2026-08-12')).toBeNull();
  });

  it('defaults a missing end to 30 minutes past the start', () => {
    expect(daySegment(occ({ endMinutes: null }), DAY)).toMatchObject({ top: 540, bottom: 570 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/calendar/timeline.test.ts`
Expected: FAIL — `Failed to resolve import "./timeline"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/calendar/timeline.ts`:

```ts
import type { CivilDate } from '@/lib/tempo/civil';
import type { Occurrence } from '@/lib/tempo/types';

/**
 * The arithmetic behind the 24-hour column.
 *
 * Separated from `DayView` because none of it is about React and all of it is
 * about cases you cannot click your way to: a block that started yesterday, one
 * that ends at exactly midnight, an overlap cluster that must not shrink the
 * blocks either side of it. Rendering tests reach none of those; these are
 * four numbers in and four numbers out.
 */

export const DAY_MINUTES = 24 * 60;

/** What one occurrence occupies on one day, in minutes past that day's midnight. */
export interface DaySegment {
  top: number;
  bottom: number;
  /** Started before this day: the top edge is a cut, not a start. */
  continuesBefore: boolean;
  /** Ends after this day: the bottom edge is a cut, not an end. */
  continuesAfter: boolean;
}

/**
 * Where an occurrence sits on one particular day, or `null` if it does not sit
 * there at all.
 *
 * All-day entries return null deliberately: they have no time of day, so they
 * have no position to occupy, and they belong in the strip above the column.
 *
 * The null for a zero-height segment is not defensive. An entry ending at
 * exactly 00:00 has `endMinutes === 0` and an `endDate` one day later, so it
 * genuinely overlaps the following day and genuinely occupies none of it.
 * Without this, every morning after a late night carries a 0px sliver pinned to
 * the top of the column.
 */
export function daySegment(occ: Occurrence, date: CivilDate): DaySegment | null {
  if (occ.allDay) return null;
  // CivilDate is 'YYYY-MM-DD', so string comparison is date comparison.
  if (date < occ.date || date > occ.endDate) return null;

  const start = occ.startMinutes ?? 0;
  const end = occ.endMinutes ?? start + 30;

  const continuesBefore = occ.date < date;
  const continuesAfter = occ.endDate > date;

  const top = continuesBefore ? 0 : start;
  const bottom = continuesAfter ? DAY_MINUTES : end;

  if (bottom <= top) return null;
  return { top, bottom, continuesBefore, continuesAfter };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/calendar/timeline.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/calendar/timeline.ts src/components/calendar/timeline.test.ts
git commit -m "Clip a block to the day it is drawn on"
```

---

### Task 2: Overlap clusters

**Files:**
- Modify: `src/components/calendar/timeline.ts`
- Modify: `src/components/calendar/timeline.test.ts`

**Interfaces:**
- Consumes: `DaySegment` from Task 1.
- Produces: `interface Placed { key: string; segment: DaySegment; lane: number; of: number }`, `placeSegments(items: Array<{ key: string; segment: DaySegment }>): Placed[]`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/calendar/timeline.test.ts`:

```ts
import { placeSegments } from './timeline';

/**
 * The existing `packLanes` assigns lanes correctly and then reports the wrong
 * width: `of` is the lane count for the whole day, so one overlapping pair at
 * 09:00 renders every unrelated block in the day at half width. These tests are
 * about `of`, not about `lane`.
 */
describe('placeSegments', () => {
  const seg = (top: number, bottom: number) => ({
    top,
    bottom,
    continuesBefore: false,
    continuesAfter: false,
  });

  it('gives a lone block the full width', () => {
    expect(placeSegments([{ key: 'a', segment: seg(540, 600) }])).toEqual([
      { key: 'a', segment: seg(540, 600), lane: 0, of: 1 },
    ]);
  });

  it('splits two overlapping blocks into two lanes', () => {
    const out = placeSegments([
      { key: 'a', segment: seg(540, 660) },
      { key: 'b', segment: seg(600, 720) },
    ]);
    expect(out.map((p) => [p.key, p.lane, p.of])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
    ]);
  });

  /** The bug: the lone afternoon block must not be narrowed by the morning pair. */
  it('does not let one cluster narrow another', () => {
    const out = placeSegments([
      { key: 'a', segment: seg(540, 660) },
      { key: 'b', segment: seg(600, 720) },
      { key: 'c', segment: seg(900, 960) },
    ]);
    expect(out.find((p) => p.key === 'c')).toMatchObject({ lane: 0, of: 1 });
  });

  it('reuses a lane once its block has ended', () => {
    const out = placeSegments([
      { key: 'a', segment: seg(540, 600) },
      { key: 'b', segment: seg(570, 630) },
      { key: 'c', segment: seg(600, 660) },
    ]);
    // a and b overlap; c starts as a ends, so c takes a's lane. All three are
    // one cluster because b bridges them, so all three are of: 2.
    expect(out.map((p) => [p.key, p.lane, p.of])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
      ['c', 0, 2],
    ]);
  });

  it('treats blocks that merely touch as non-overlapping', () => {
    const out = placeSegments([
      { key: 'a', segment: seg(540, 600) },
      { key: 'b', segment: seg(600, 660) },
    ]);
    expect(out.every((p) => p.of === 1)).toBe(true);
  });

  it('returns an empty list unchanged', () => {
    expect(placeSegments([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/calendar/timeline.test.ts`
Expected: FAIL — `placeSegments is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/components/calendar/timeline.ts`:

```ts
/** A segment with its column assigned. */
export interface Placed {
  key: string;
  segment: DaySegment;
  lane: number;
  /** How many lanes to divide the width by — the count for *this* cluster. */
  of: number;
}

/**
 * Side-by-side columns for blocks that overlap, cluster by cluster.
 *
 * The width divisor is per-cluster rather than per-day, which is the fix for a
 * real defect: computed across the whole day, a single overlapping pair at
 * 09:00 halved every unrelated block in the calendar and left a column of dead
 * space beside the afternoon.
 *
 * A cluster is a set of segments connected by transitive overlap — a and c need
 * not overlap each other to share a width, if b overlaps both. Anything else
 * would let two blocks in the same visual stack disagree about how wide a lane
 * is.
 *
 * Touching is not overlapping: a block ending at 10:00 and one starting at
 * 10:00 are consecutive, and drawing them half-width side by side would be a
 * lie about a back-to-back schedule.
 */
export function placeSegments(items: Array<{ key: string; segment: DaySegment }>): Placed[] {
  const sorted = [...items].sort(
    (a, b) => a.segment.top - b.segment.top || a.segment.bottom - b.segment.bottom,
  );

  const out: Placed[] = [];
  /** The run of segments currently connected by overlap. */
  let cluster: Placed[] = [];
  /** Lane end times within the open cluster. */
  let laneEnds: number[] = [];

  const closeCluster = () => {
    const of = Math.max(1, laneEnds.length);
    for (const placed of cluster) out.push({ ...placed, of });
    cluster = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    const { top, bottom } = item.segment;

    // The cluster is open while anything in it is still running. `every` over
    // the lane ends is exactly "nothing overlaps this segment".
    if (laneEnds.length > 0 && laneEnds.every((end) => end <= top)) closeCluster();

    let lane = laneEnds.findIndex((end) => end <= top);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(bottom);
    } else {
      laneEnds[lane] = bottom;
    }

    cluster.push({ key: item.key, segment: item.segment, lane, of: 1 });
  }
  closeCluster();

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/calendar/timeline.test.ts`
Expected: PASS — 15 tests total.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/calendar/timeline.ts src/components/calendar/timeline.test.ts
git commit -m "Size overlap columns per cluster, not per day"
```

---

### Task 3: Drag arithmetic

**Files:**
- Modify: `src/components/calendar/timeline.ts`
- Modify: `src/components/calendar/timeline.test.ts`

**Interfaces:**
- Consumes: `DAY_MINUTES` from Task 1.
- Produces: `SNAP_MINUTES: number`, `FINE_MINUTES: number`, `snapMinutes(minutes: number, step?: number): number`, `interface DragResult { start: number; end: number }`, `applyDrag(input: { start: number; end: number; deltaMinutes: number; mode: 'move' | 'resize'; step?: number; lockDates?: boolean }): DragResult`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/calendar/timeline.test.ts`:

```ts
import { applyDrag, snapMinutes } from './timeline';

/**
 * The old code snapped the *distance travelled*, which meant an entry starting
 * at 09:07 moved in clean quarter-hours and was therefore at 09:07, 09:22,
 * 09:37 forever — it could never reach the grid, which is the opposite of what
 * snapping is for.
 */
describe('snapMinutes', () => {
  it('pulls a time down to the nearest quarter hour', () => {
    expect(snapMinutes(9 * 60 + 7)).toBe(9 * 60);
  });

  it('pulls a time up to the nearest quarter hour', () => {
    expect(snapMinutes(9 * 60 + 8)).toBe(9 * 60 + 15);
  });

  it('leaves a time already on the grid alone', () => {
    expect(snapMinutes(9 * 60 + 15)).toBe(9 * 60 + 15);
  });

  it('honours a finer step', () => {
    expect(snapMinutes(9 * 60 + 7, 1)).toBe(9 * 60 + 7);
  });
});

describe('applyDrag', () => {
  const base = { start: 9 * 60, end: 10 * 60 };

  it('moves both edges and preserves the duration', () => {
    expect(applyDrag({ ...base, deltaMinutes: 37, mode: 'move' })).toEqual({
      start: 9 * 60 + 30,
      end: 10 * 60 + 30,
    });
  });

  it('pulls an off-grid start onto the grid when moved', () => {
    expect(applyDrag({ start: 9 * 60 + 7, end: 10 * 60 + 7, deltaMinutes: 5, mode: 'move' })).toEqual({
      start: 9 * 60 + 15,
      end: 10 * 60 + 15,
    });
  });

  it('moves only the end when resizing', () => {
    expect(applyDrag({ ...base, deltaMinutes: 37, mode: 'resize' })).toEqual({
      start: 9 * 60,
      end: 10 * 60 + 30,
    });
  });

  it('refuses to resize an end above its start', () => {
    expect(applyDrag({ ...base, deltaMinutes: -600, mode: 'resize' })).toEqual({
      start: 9 * 60,
      end: 9 * 60 + 15,
    });
  });

  /**
   * The old code discarded the whole gesture on an overshoot and sprang the
   * block back with no explanation. Clamping is the feedback.
   */
  it('clamps a move at the end of the day instead of discarding it', () => {
    expect(applyDrag({ ...base, deltaMinutes: 10 * 60, mode: 'move' })).toEqual({
      start: 23 * 60,
      end: 24 * 60,
    });
  });

  it('clamps a move at the start of the day', () => {
    expect(applyDrag({ ...base, deltaMinutes: -10 * 60, mode: 'move' })).toEqual({
      start: 0,
      end: 60,
    });
  });

  it('clamps a resize at the end of the day', () => {
    expect(applyDrag({ ...base, deltaMinutes: 20 * 60, mode: 'resize' })).toEqual({
      start: 9 * 60,
      end: 24 * 60,
    });
  });

  it('takes a fine step when asked', () => {
    expect(applyDrag({ ...base, deltaMinutes: 7, mode: 'move', step: 1 })).toEqual({
      start: 9 * 60 + 7,
      end: 10 * 60 + 7,
    });
  });

  /**
   * A block crossing midnight is longer than a day, so the ordinary clamp would
   * squash it. `lockDates` holds both edges still instead, because
   * `setOccurrenceTime` speaks only minutes and cannot say "and also move it a
   * day" — a drag that appeared to work and silently truncated the event would
   * be worse than one that does not move.
   */
  it('refuses to move a block that would have to change dates', () => {
    expect(
      applyDrag({ start: 22 * 60, end: 6 * 60, deltaMinutes: 120, mode: 'move', lockDates: true }),
    ).toEqual({ start: 22 * 60, end: 6 * 60 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/calendar/timeline.test.ts`
Expected: FAIL — `applyDrag is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/components/calendar/timeline.ts`:

```ts
/** The grid a dragged edge lands on. */
export const SNAP_MINUTES = 15;
/** What Alt buys: deliberate, off-grid placement. */
export const FINE_MINUTES = 1;

/** Round a time onto the grid. The *time*, not the distance travelled. */
export function snapMinutes(minutes: number, step: number = SNAP_MINUTES): number {
  return Math.round(minutes / step) * step;
}

export interface DragResult {
  start: number;
  end: number;
}

/**
 * Where a drag leaves a block.
 *
 * Snapping applies to the resulting time rather than to the delta, which is the
 * defect this replaces: snapping a distance preserves whatever offset the block
 * already had, so an entry starting at 09:07 could step in perfect quarter-hours
 * and never once be on the grid.
 *
 * Out-of-range clamps rather than returning nothing. The old guard discarded the
 * whole gesture at either end of the day, which reads as the drag having failed
 * for no reason.
 */
export function applyDrag({
  start,
  end,
  deltaMinutes,
  mode,
  step = SNAP_MINUTES,
  lockDates = false,
}: {
  start: number;
  end: number;
  deltaMinutes: number;
  mode: 'move' | 'resize';
  step?: number;
  lockDates?: boolean;
}): DragResult {
  // A block whose end reads earlier than its start crosses midnight. It has no
  // room to move inside one day, and the store cannot express a date change
  // from a time drag, so it stays put.
  if (lockDates) return { start, end };

  if (mode === 'resize') {
    const nextEnd = Math.min(DAY_MINUTES, Math.max(start + step, snapMinutes(end + deltaMinutes, step)));
    return { start, end: nextEnd };
  }

  const duration = end - start;
  const nextStart = Math.min(
    DAY_MINUTES - duration,
    Math.max(0, snapMinutes(start + deltaMinutes, step)),
  );
  return { start: nextStart, end: nextStart + duration };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/calendar/timeline.test.ts`
Expected: PASS — 28 tests total.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/calendar/timeline.ts src/components/calendar/timeline.test.ts
git commit -m "Snap the resulting time, and clamp instead of refusing"
```

---

### Task 4: Zoom resolution and constants

**Files:**
- Modify: `src/components/calendar/constants.ts`
- Modify: `src/components/calendar/timeline.ts`
- Modify: `src/components/calendar/timeline.test.ts`

**Interfaces:**
- Produces (constants.ts): `HOUR_H_DEFAULT = 44`, `HOUR_H_MIN = 8`, `HOUR_H_MAX = 120`, `HALF_HOUR_FLOOR = 34`, `HOUR_LABEL_FLOOR = 26`, `ZOOM_STEP = 6`.
- Produces (timeline.ts): `type ZoomMode = 'fit' | number`, `resolveHourHeight(mode: ZoomMode, paneHeight: number): number`, `zoomIn(mode, paneHeight): number`, `zoomOut(mode, paneHeight): number`, `labelEvery(hourHeight: number): number`, `showsHalfHours(hourHeight: number): boolean`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/calendar/timeline.test.ts`:

```ts
import { labelEvery, resolveHourHeight, showsHalfHours, zoomIn, zoomOut } from './timeline';
import { HOUR_H_MAX, HOUR_H_MIN } from './constants';

describe('resolveHourHeight', () => {
  /**
   * FIT is a mode rather than a stored pixel height. Storing the resolved
   * number would freeze it at whatever the window was when it was chosen, and
   * it would stop being a fit the moment the window resized.
   */
  it('divides the pane across 24 hours in fit mode', () => {
    expect(resolveHourHeight('fit', 720)).toBe(30);
  });

  it('never fits below the floor', () => {
    expect(resolveHourHeight('fit', 24)).toBe(HOUR_H_MIN);
  });

  it('returns a manual height unchanged', () => {
    expect(resolveHourHeight(44, 720)).toBe(44);
  });

  it('clamps a manual height to the range', () => {
    expect(resolveHourHeight(500, 720)).toBe(HOUR_H_MAX);
    expect(resolveHourHeight(1, 720)).toBe(HOUR_H_MIN);
  });
});

describe('zoomIn / zoomOut', () => {
  it('steps up from a manual height', () => {
    expect(zoomIn(44, 720)).toBeGreaterThan(44);
  });

  it('steps down from a manual height', () => {
    expect(zoomOut(44, 720)).toBeLessThan(44);
  });

  /** Zooming out of FIT has nowhere to go; zooming in leaves it. */
  it('leaves fit mode by resolving it first', () => {
    expect(zoomIn('fit', 720)).toBeGreaterThan(30);
  });

  it('does not exceed the ceiling', () => {
    expect(zoomIn(HOUR_H_MAX, 720)).toBe(HOUR_H_MAX);
  });

  it('does not fall below the floor', () => {
    expect(zoomOut(HOUR_H_MIN, 720)).toBe(HOUR_H_MIN);
  });
});

describe('labelEvery / showsHalfHours', () => {
  it('labels every hour when there is room', () => {
    expect(labelEvery(44)).toBe(1);
  });

  it('thins labels when there is not', () => {
    expect(labelEvery(20)).toBe(3);
  });

  it('draws half-hour rules only when they can be told apart', () => {
    expect(showsHalfHours(44)).toBe(true);
    expect(showsHalfHours(20)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/calendar/timeline.test.ts`
Expected: FAIL — `resolveHourHeight is not a function`.

- [ ] **Step 3: Add the constants**

Append to `src/components/calendar/constants.ts`:

```ts
/**
 * The 24-hour column's scale, and the thresholds that depend on it.
 *
 * Here rather than in `DayView` because three separate decisions read the same
 * number and have to agree about it: how tall an hour row is, whether a
 * half-hour rule is distinguishable, and whether there is room to label every
 * hour. Two of those living inline is how they drift.
 */
export const HOUR_H_DEFAULT = 44;
/** Below this an hour row is thinner than the text in it. */
export const HOUR_H_MIN = 8;
/** Above this a single event needs scrolling to read, which defeats the column. */
export const HOUR_H_MAX = 120;
/** One click of + or -. */
export const ZOOM_STEP = 6;
/** Half-hour rules appear at or above this; below it they are noise. */
export const HALF_HOUR_FLOOR = 34;
/** Every hour is labelled at or above this; below it, every third. */
export const HOUR_LABEL_FLOOR = 26;
```

- [ ] **Step 4: Write the implementation**

Append to `src/components/calendar/timeline.ts`:

```ts
import {
  HALF_HOUR_FLOOR,
  HOUR_H_MAX,
  HOUR_H_MIN,
  HOUR_LABEL_FLOOR,
  ZOOM_STEP,
} from './constants';

/**
 * How tall an hour is, or the instruction to work it out from the pane.
 *
 * `'fit'` is deliberately not a number. Storing the resolved height would
 * freeze the fit at whatever the window happened to be when it was chosen, and
 * it would silently stop being a fit on the next resize.
 */
export type ZoomMode = 'fit' | number;

function clampHeight(h: number): number {
  return Math.min(HOUR_H_MAX, Math.max(HOUR_H_MIN, h));
}

export function resolveHourHeight(mode: ZoomMode, paneHeight: number): number {
  if (mode === 'fit') return clampHeight(paneHeight / 24);
  return clampHeight(mode);
}

export function zoomIn(mode: ZoomMode, paneHeight: number): number {
  return clampHeight(resolveHourHeight(mode, paneHeight) + ZOOM_STEP);
}

export function zoomOut(mode: ZoomMode, paneHeight: number): number {
  return clampHeight(resolveHourHeight(mode, paneHeight) - ZOOM_STEP);
}

/**
 * Label every Nth hour. Twenty-four labels stacked at 20px is a grey texture
 * rather than a scale, so below the floor only every third hour is named — the
 * rules stay, which is what carries the rhythm.
 */
export function labelEvery(hourHeight: number): number {
  return hourHeight >= HOUR_LABEL_FLOOR ? 1 : 3;
}

export function showsHalfHours(hourHeight: number): boolean {
  return hourHeight >= HALF_HOUR_FLOOR;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/calendar/timeline.test.ts`
Expected: PASS — 40 tests total.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/calendar/timeline.ts src/components/calendar/timeline.test.ts src/components/calendar/constants.ts
git commit -m "Resolve the timeline's scale, and the thresholds that follow it"
```

---

### Task 5: The zoom preference store

**Files:**
- Create: `src/lib/store/day-zoom.ts`

**Interfaces:**
- Consumes: `ZoomMode` from `@/components/calendar/timeline`.
- Produces: `subscribeZoom(cb: () => void): () => void`, `getZoomSnapshot(): ZoomMode`, `getServerZoomSnapshot(): ZoomMode`, `setZoom(mode: ZoomMode): void`.

**No test.** This is storage plumbing with no branching logic, exactly like
`view-preference.ts`, which is likewise untested. All the arithmetic it feeds
was tested in Task 4.

- [ ] **Step 1: Write the implementation**

Create `src/lib/store/day-zoom.ts`:

```ts
'use client';

/**
 * How tall an hour is in the day timeline, remembered across reloads.
 *
 * An external store rather than state seeded from an effect, for the same
 * reason `view-preference.ts` is one: the server has no localStorage, so the
 * first paint must be the default and the stored value must arrive after
 * hydration. `useSyncExternalStore` takes a separate server snapshot and
 * reconciles the client one itself, which is the only way to say that without a
 * cascading render.
 */

import type { ZoomMode } from '@/components/calendar/timeline';

const KEY = 'tempo.dayZoom';
const DEFAULT: ZoomMode = 'fit';

function parse(raw: string | null): ZoomMode {
  if (raw === 'fit') return 'fit';
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT;
}

/** Cached so `getSnapshot` is cheap and returns a stable value per change. */
let current: ZoomMode | null = null;

const listeners = new Set<() => void>();

export function subscribeZoom(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getZoomSnapshot(): ZoomMode {
  if (current === null) {
    try {
      current = parse(window.localStorage.getItem(KEY));
    } catch {
      current = DEFAULT;
    }
  }
  return current;
}

export function getServerZoomSnapshot(): ZoomMode {
  return DEFAULT;
}

export function setZoom(mode: ZoomMode): void {
  if (current === mode) return;
  current = mode;
  try {
    window.localStorage.setItem(KEY, String(mode));
  } catch {
    // storage disabled: the choice just doesn't survive a reload
  }
  for (const listener of listeners) listener();
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/store/day-zoom.ts
git commit -m "Remember the timeline's scale across reloads"
```

---

### Task 6: DayView draws clipped blocks

**Files:**
- Modify: `src/components/calendar/DayView.tsx`

**Interfaces:**
- Consumes: `daySegment`, `placeSegments`, `DAY_MINUTES` (Tasks 1–2); `HOUR_H_DEFAULT` (Task 4).
- Produces: no new exports. `DayView`'s props are unchanged.

This task replaces the two filters and the local `packLanes` with the tested
module. Zoom, the time rule and the drag rewrite arrive in Tasks 7–9; keep
`HOUR_H_DEFAULT` as a fixed height here so this task is independently reviewable.

- [ ] **Step 1: Replace the imports and delete the local `packLanes`**

In `src/components/calendar/DayView.tsx`, replace the import block and the
`packLanes` function (the whole `const HOUR_H = 44;` … `}` run through the end
of `packLanes`) with:

```tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCalendar } from '@/lib/store/calendar-store';
import type { CivilDate } from '@/lib/tempo/civil';
import { parts } from '@/lib/tempo/civil';
import type { Occurrence } from '@/lib/tempo/types';
import { DEFAULT_CATEGORY_COLOR, HOUR_H_DEFAULT, MONTHS } from './constants';
import { DAY_MINUTES, daySegment, placeSegments, type DaySegment } from './timeline';

const HOUR_H = HOUR_H_DEFAULT;
const SNAP_MINUTES = 15;
```

- [ ] **Step 2: Replace the two filters with a segment pass**

Inside `DayView`, replace:

```tsx
  const bars = occurrences.filter((o) => o.allDay || diffDays(o.endDate, o.date) > 0);
  const timed = occurrences.filter((o) => !o.allDay && diffDays(o.endDate, o.date) === 0);
  const lanes = useMemo(() => packLanes(timed), [timed]);
```

with:

```tsx
  /**
   * The strip holds only what genuinely has no time of day. A multi-day *timed*
   * entry used to land here too, which is why an overnight shift showed as a
   * chip with no position and left the morning it ate looking free.
   */
  const bars = occurrences.filter((o) => o.allDay);

  /** Every timed entry that touches this day, clipped to it. */
  const placed = useMemo(() => {
    const segments = occurrences
      .map((occ) => ({ occ, segment: daySegment(occ, date) }))
      .filter((s): s is { occ: Occurrence; segment: DaySegment } => s.segment !== null);

    const byKey = new Map(segments.map((s) => [s.occ.key, s.occ]));
    return placeSegments(segments.map((s) => ({ key: s.occ.key, segment: s.segment }))).map(
      (p) => ({ ...p, occ: byKey.get(p.key)! }),
    );
  }, [occurrences, date]);
```

- [ ] **Step 3: Render from the placement**

Replace the whole `{timed.map((occ) => { … })}` block with:

```tsx
            {placed.map(({ key, occ, segment, lane, of }) => {
              const active = drag?.key === key ? drag : null;
              const top = segment.top + (active?.startDelta ?? 0);
              const bottom = segment.bottom + (active?.endDelta ?? 0);
              const color = colorFor(occ.categoryId);
              const height = Math.max(18, ((bottom - top) / 60) * HOUR_H - 2);

              return (
                <div
                  key={key}
                  onPointerDown={(e) => beginTimeDrag(e, occ, segment, 'move')}
                  onClick={() => !drag && onOpen(occ)}
                  style={{
                    position: 'absolute',
                    top: (top / 60) * HOUR_H,
                    height,
                    left: `${(lane / of) * 100}%`,
                    width: `calc(${100 / of}% - 3px)`,
                    borderLeft: `2px solid ${color}`,
                    zIndex: active ? 20 : 1,
                  }}
                  className={[
                    'group overflow-hidden border-r border-hair bg-raised px-1.5 py-1',
                    'text-[11px] text-ink transition-colors hover:border-hairlit hover:bg-sunken',
                    // A cut edge gets no border: a block ending flush at the
                    // bottom of the column would otherwise be indistinguishable
                    // from one that genuinely ends at midnight.
                    segment.continuesBefore ? '' : 'border-t',
                    segment.continuesAfter ? '' : 'border-b',
                  ].join(' ')}
                >
                  {segment.continuesBefore && (
                    <div className="label leading-none opacity-70">↑ FROM {shortDate(occ.date)}</div>
                  )}
                  <div className="truncate leading-tight">{occ.title}</div>
                  <div className="label mt-0.5">{clockLabel(top)}</div>
                  {segment.continuesAfter && (
                    <div className="label absolute inset-x-1.5 bottom-0.5 leading-none opacity-70">
                      ↓ TO {shortDate(occ.endDate)}
                    </div>
                  )}
                  {/* Nothing to grab on an edge that is a clip rather than an end. */}
                  {!segment.continuesAfter && (
                    <span
                      onPointerDown={(e) => beginTimeDrag(e, occ, segment, 'resize')}
                      className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
                      style={{ background: `linear-gradient(0deg, ${color}, transparent)` }}
                    />
                  )}
                </div>
              );
            })}
```

- [ ] **Step 4: Add the two label helpers**

At the bottom of `src/components/calendar/DayView.tsx`, outside the component:

```tsx
/** `2026-08-11` → `AUG 11`. What a continuation chevron points at. */
function shortDate(d: CivilDate): string {
  const { month, day } = parts(d);
  return `${MONTHS[month - 1]} ${day}`;
}

function clockLabel(minutes: number): string {
  const m = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
```

- [ ] **Step 5: Update `beginTimeDrag`'s signature**

Change the signature to accept the segment, and use it as the source of the
current times, so a clipped block drags from what is drawn rather than from
`startMinutes`:

```tsx
  function beginTimeDrag(
    e: React.PointerEvent,
    occ: Occurrence,
    segment: DaySegment,
    mode: 'move' | 'resize',
  ) {
    e.stopPropagation();
    e.preventDefault();
    if (occ.readOnly) return;

    const originY = e.clientY;
    const snap = (dy: number) => {
      const minutes = (dy / HOUR_H) * 60;
      return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
    };

    const move = (ev: PointerEvent) => {
      const d = snap(ev.clientY - originY);
      setDrag({ key: occ.key, startDelta: mode === 'move' ? d : 0, endDelta: d });
    };

    const finish = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      setDrag(null);
      const d = snap(ev.clientY - originY);
      if (d === 0) return;

      const start = segment.top + (mode === 'move' ? d : 0);
      const end = segment.bottom + d;
      if (start < 0 || end > DAY_MINUTES || end <= start) return;

      setOccurrenceTime(occ, start, end, ev.shiftKey ? 'series' : 'occurrence');
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  }
```

Add `DaySegment` to the `timeline` import. Task 9 replaces this body entirely;
this step only keeps the file compiling.

- [ ] **Step 6: Typecheck and run the suite**

Run: `npx tsc --noEmit && npm test`
Expected: `tsc` exits 0; **207 tests passing** (167 baseline + 40 from Tasks 1–4).

- [ ] **Step 7: Verify in the browser**

Start the preview and open a day with an overnight entry:

```bash
npm run dev
```

Use `preview_start` with `{name: "dev"}`, navigate to `/preview`, open a day
modal, and confirm: an entry crossing midnight now draws as a block reaching the
bottom edge with a `↓ TO …` chevron, and the ALL DAY strip holds only true
all-day entries.

- [ ] **Step 8: Commit**

```bash
git add src/components/calendar/DayView.tsx
git commit -m "Draw every timed entry on the timeline, clipped to the day"
```

---

### Task 7: The current-time rule

**Files:**
- Modify: `src/components/calendar/DayView.tsx`

**Interfaces:**
- Consumes: `todayIn`, `minutesInZone` from `@/lib/tempo/civil`; `DAY_MINUTES` from `./timeline`.
- Produces: no new exports.

- [ ] **Step 1: Add the hook**

At the bottom of `src/components/calendar/DayView.tsx`:

```tsx
/**
 * Minutes past midnight, now, in the calendar's zone — or null until mounted.
 *
 * Null first, deliberately. A clock read during render is a hydration mismatch:
 * the server renders one minute and the client another, and React replaces the
 * tree. The rule appears a frame later instead, which nobody sees.
 *
 * Thirty seconds is the tick. A minute would let the line sit visibly wrong for
 * up to a minute against a gridline it is meant to be read alongside.
 */
function useNowMinutes(timezone: string): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const read = () => setNow(minutesInZone(new Date(), timezone));
    read();
    const timer = window.setInterval(read, 30_000);
    return () => window.clearInterval(timer);
  }, [timezone]);

  return now;
}
```

- [ ] **Step 2: Call it and render the rule**

In `DayView`, after the existing `const setOccurrenceTime = …`:

```tsx
  const timezone = useCalendar((s) => s.timezone);
  const nowMinutes = useNowMinutes(timezone);
  const isToday = date === todayIn(timezone);
```

Then, immediately before the closing `</div>` of the `style={{ height: 24 * HOUR_H }}`
container — **after** the blocks, so it paints above them:

```tsx
          {isToday && nowMinutes !== null && (
            <div
              // Never intercepts a drag: this is a readout, not a target.
              className="pointer-events-none absolute inset-x-0 z-30"
              style={{ top: (nowMinutes / 60) * HOUR_H }}
              aria-hidden="true"
            >
              <div className="absolute inset-x-11 h-px bg-[#c8553d]" />
              {/* An origin for the line, so it does not read as a hairline border. */}
              <div className="absolute left-[42px] top-[-2.5px] h-[5px] w-[5px] rounded-full bg-[#c8553d]" />
              <span className="absolute left-1 top-[-6px] text-[10px] leading-none text-[#c8553d]">
                {clockLabel(nowMinutes)}
              </span>
            </div>
          )}
```

Add `minutesInZone` and `todayIn` to the `@/lib/tempo/civil` import.

- [ ] **Step 3: Typecheck and test**

Run: `npx tsc --noEmit && npm test`
Expected: `tsc` exits 0; 207 tests passing.

- [ ] **Step 4: Verify in the browser**

Open today's day modal in the preview. A red rule with a dot and a time readout
sits at the current time. Open another day: no rule. Confirm dragging a block
across the rule still works — the rule must not swallow the pointer.

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/DayView.tsx
git commit -m "Mark now on the timeline"
```

---

### Task 8: Zoom, gridlines and scroll anchoring

**Files:**
- Modify: `src/components/calendar/DayView.tsx`
- Modify: `src/components/calendar/DayModal.tsx`
- Modify: `src/components/calendar/CalendarShell.tsx`

**Interfaces:**
- Consumes: `day-zoom.ts` (Task 5); `resolveHourHeight`, `zoomIn`, `zoomOut`, `labelEvery`, `showsHalfHours`, `ZoomMode` (Task 4).
- Produces: no new exports.

- [ ] **Step 1: Read the zoom and measure the pane in DayView**

Replace `const HOUR_H = HOUR_H_DEFAULT;` with a measured, subscribed height.
Inside `DayView`:

```tsx
  const zoom = useSyncExternalStore(subscribeZoom, getZoomSnapshot, getServerZoomSnapshot);
  const [paneHeight, setPaneHeight] = useState(0);

  /**
   * FIT has to know how tall the column is, and the column is sized by flexbox
   * rather than by anything this component states — so it is measured, and
   * re-measured on resize. A stored pixel height would have stopped being a fit
   * the first time the window changed.
   */
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setPaneHeight(entry.contentRect.height));
    observer.observe(el);
    setPaneHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  const hourHeight = resolveHourHeight(zoom, paneHeight || 1);
  const everyNth = labelEvery(hourHeight);
  const halfHours = showsHalfHours(hourHeight);
```

Replace every remaining use of `HOUR_H` in the component with `hourHeight`, and
delete the `const HOUR_H = HOUR_H_DEFAULT;` line. Add the imports:

```tsx
import { useSyncExternalStore } from 'react';
import { getServerZoomSnapshot, getZoomSnapshot, subscribeZoom } from '@/lib/store/day-zoom';
import { labelEvery, resolveHourHeight, showsHalfHours } from './timeline';
```

- [ ] **Step 2: Thin the hour labels and add half-hour rules**

Replace the 24-hour row map with:

```tsx
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              onClick={() => onNew(date, h * 60)}
              className="absolute inset-x-0 cursor-copy border-t border-hair transition-colors hover:bg-panel"
              style={{ top: h * hourHeight, height: hourHeight }}
            >
              {h % everyNth === 0 && (
                <span className="label absolute left-2 top-1">
                  {String(h).padStart(2, '0')}
                </span>
              )}
              {halfHours && (
                <div
                  className="pointer-events-none absolute inset-x-0 border-t border-hair/40"
                  style={{ top: hourHeight / 2 }}
                />
              )}
            </div>
          ))}
```

And update the container height: `style={{ height: 24 * hourHeight }}`.

- [ ] **Step 3: Anchor the scroll**

Replace the existing "open on the working day" effect:

```tsx
  // Open on the working day rather than at midnight.
  useEffect(() => {
    if (gridRef.current) gridRef.current.scrollTop = 7 * HOUR_H;
  }, [date]);
```

with:

```tsx
  /**
   * Where the column opens.
   *
   * Today opens on now; another day opens on its first entry; an empty day falls
   * back to the working morning. A fixed 07:00 was wrong for exactly the days
   * you open the modal to look at.
   */
  useEffect(() => {
    const el = gridRef.current;
    if (!el || hourHeight === 0) return;
    const first = placed.reduce<number | null>(
      (min, p) => (min === null || p.segment.top < min ? p.segment.top : min),
      null,
    );
    const anchor = isToday && nowMinutes !== null ? nowMinutes : (first ?? 7 * 60);
    el.scrollTop = Math.max(0, (anchor / 60) * hourHeight - el.clientHeight / 3);
    // Deliberately not reacting to `nowMinutes`: re-anchoring every 30 seconds
    // would yank the column out from under whatever you were reading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);
```

- [ ] **Step 4: Hold the centre time when the scale changes**

Add below the anchoring effect:

```tsx
  /**
   * Zooming keeps the middle of the column pointing at the same time.
   *
   * Holding the pixel offset instead would land you at a different hour every
   * time you changed the scale, which is the single most disorienting thing a
   * timeline can do.
   */
  const previousHeight = useRef(hourHeight);
  useEffect(() => {
    const el = gridRef.current;
    const was = previousHeight.current;
    previousHeight.current = hourHeight;
    if (!el || was === hourHeight || was === 0) return;
    const centreMinutes = ((el.scrollTop + el.clientHeight / 2) / was) * 60;
    el.scrollTop = (centreMinutes / 60) * hourHeight - el.clientHeight / 2;
  }, [hourHeight]);
```

- [ ] **Step 5: Add Ctrl/⌘-wheel zoom**

On the scroll container (`<div ref={gridRef} …>`), add:

```tsx
            onWheel={(e) => {
              // What a trackpad pinch sends. Without the guard this would
              // hijack ordinary scrolling.
              if (!e.ctrlKey && !e.metaKey) return;
              e.preventDefault();
              setZoom(e.deltaY < 0 ? zoomIn(zoom, paneHeight) : zoomOut(zoom, paneHeight));
            }}
```

Import `setZoom` from `@/lib/store/day-zoom` and `zoomIn`, `zoomOut` from `./timeline`.

- [ ] **Step 6: Add the zoom control to DayModal**

In `src/components/calendar/DayModal.tsx`, inside the toolbar row after the two
`Stepper`s, add:

```tsx
        <div className="ml-2 flex items-center gap-1">
          <Stepper label="Zoom out" onClick={() => setZoom(zoomOut(zoom, 0))}>
            −
          </Stepper>
          <button
            type="button"
            onClick={() => setZoom(zoom === 'fit' ? HOUR_H_DEFAULT : 'fit')}
            aria-pressed={zoom === 'fit'}
            className={[
              'border px-2 py-1 text-[10px] leading-none tracking-[0.12em] transition-colors',
              zoom === 'fit'
                ? 'border-hairlit bg-raised text-bright'
                : 'border-hair text-mute hover:border-hairlit hover:text-ink',
            ].join(' ')}
          >
            FIT
          </button>
          <Stepper label="Zoom in" onClick={() => setZoom(zoomIn(zoom, 0))}>
            +
          </Stepper>
        </div>
```

`zoomIn`/`zoomOut` are passed `0` for the pane height here: from FIT the modal
cannot know the column's measured height, and both functions clamp to the floor,
so the first click out of FIT lands on the minimum and steps up from there.

Add to `DayModal`:

```tsx
  const zoom = useSyncExternalStore(subscribeZoom, getZoomSnapshot, getServerZoomSnapshot);
```

and the imports for `setZoom`, `subscribeZoom`, `getZoomSnapshot`,
`getServerZoomSnapshot`, `zoomIn`, `zoomOut`, `HOUR_H_DEFAULT`.

- [ ] **Step 7: Give the pane its height**

In `DayModal.tsx`, replace both occurrences of `className="h-[52vh] min-h-0"`
with:

```tsx
className="h-[min(72vh,calc(100vh-14rem))] min-h-[360px] min-w-0"
```

- [ ] **Step 8: Bind the keys**

In `src/components/calendar/CalendarShell.tsx`, inside `onKey` — after the
Escape block and **before** the `if (typing || e.metaKey || …) return;` guard:

```tsx
    /**
     * The timeline's scale, while the day is the top layer.
     *
     * Here rather than in `DayView` because the shell is the one place that
     * decides what a key means — a second window listener would race this one.
     */
    if (top?.kind === 'day' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoom(zoomIn(getZoomSnapshot(), 0));
        return;
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setZoom(zoomOut(getZoomSnapshot(), 0));
        return;
      }
      if (e.key === '0') {
        e.preventDefault();
        setZoom('fit');
        return;
      }
    }
```

Import `getZoomSnapshot`, `setZoom` from `@/lib/store/day-zoom` and `zoomIn`,
`zoomOut` from `./timeline`.

> Note: `'0'` is claimed only while the day overlay is open, so the existing
> `1` / `2` / `3` view switches are untouched.

- [ ] **Step 9: Pin the ALL DAY strip and respect reduced motion**

Spec I.5. In `DayView`, track whether the column has been scrolled:

```tsx
  const [scrolled, setScrolled] = useState(false);
```

On the scroll container add `onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}`.

Then on the ALL DAY strip's wrapper, replace `className="shrink-0 space-y-1 border-b border-hair px-3 py-2.5"` with:

```tsx
              className={[
                'relative z-10 shrink-0 space-y-1 border-b border-hair px-3 py-2.5',
                // Reads as pinned rather than as the first thing in the scroll.
                scrolled ? 'shadow-[0_4px_8px_-4px_rgba(0,0,0,0.6)]' : '',
              ].join(' ')}
```

Then, in `src/app/globals.css`, append:

```css
/* A timeline that animates its scale is a timeline that lurches for anyone who
   asked the OS for less of that. */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

> If `globals.css` already carries a `prefers-reduced-motion` block, leave it
> alone and skip this half of the step.

- [ ] **Step 10: Typecheck and test**

Run: `npx tsc --noEmit && npm test`
Expected: `tsc` exits 0; 207 tests passing.

- [ ] **Step 11: Verify in the browser**

In the preview: open a day, press `0` — all 24 hours fit the pane with every
third hour labelled and no half-hour rules. Press `+` several times — hours grow,
labels fill in, half-hour rules appear, and the time under the middle of the
column stays put. Reload — the scale survives. ⌘-scroll over the column zooms;
ordinary scroll does not. Scroll the column — the ALL DAY strip casts a shadow.

- [ ] **Step 12: Commit**

```bash
git add src/components/calendar/DayView.tsx src/components/calendar/DayModal.tsx src/components/calendar/CalendarShell.tsx
git commit -m "Let the day be seen whole, at whatever scale suits it"
```

---

### Task 9: The drag rewrite

**Files:**
- Modify: `src/components/calendar/DayView.tsx`

**Interfaces:**
- Consumes: `applyDrag`, `snapMinutes`, `FINE_MINUTES`, `SNAP_MINUTES` (Task 3).
- Produces: no new exports.

- [ ] **Step 1: Replace the drag state and handler**

Replace the `drag` state declaration with one that carries resolved times rather
than deltas, so the live chip and the block read the same numbers:

```tsx
  const [drag, setDrag] = useState<{ key: string; start: number; end: number } | null>(null);
```

Replace `beginTimeDrag` entirely:

```tsx
  function beginTimeDrag(
    e: React.PointerEvent,
    occ: Occurrence,
    segment: DaySegment,
    mode: 'move' | 'resize',
  ) {
    e.stopPropagation();
    e.preventDefault();
    if (occ.readOnly) return;

    const originY = e.clientY;
    /**
     * A block whose drawn edges are both cuts, or whose stored end reads earlier
     * than its stored start, spans more than this day. `setOccurrenceTime` takes
     * only minutes and cannot say "and also move it a day", so the drag holds it
     * still rather than silently truncating it.
     */
    const lockDates = segment.continuesBefore || segment.continuesAfter;

    const resolve = (ev: PointerEvent | React.PointerEvent) =>
      applyDrag({
        start: segment.top,
        end: segment.bottom,
        deltaMinutes: ((ev.clientY - originY) / hourHeight) * 60,
        mode,
        // Alt is the deliberate escape from the grid.
        step: ev.altKey ? FINE_MINUTES : SNAP_MINUTES,
        lockDates,
      });

    const move = (ev: PointerEvent) => {
      const { start, end } = resolve(ev);
      setDrag({ key: occ.key, start, end });
    };

    const finish = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      setDrag(null);
      const { start, end } = resolve(ev);
      if (start === segment.top && end === segment.bottom) return;
      setOccurrenceTime(occ, start, end, ev.shiftKey ? 'series' : 'occurrence');
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  }
```

- [ ] **Step 2: Read the live times in the block**

In the `placed.map` body, replace the `top`/`bottom` derivation:

```tsx
              const active = drag?.key === key ? drag : null;
              const top = active?.start ?? segment.top;
              const bottom = active?.end ?? segment.bottom;
```

- [ ] **Step 3: Add the density rule and the live chip**

Replace the block's inner content (the title/time/chevron run) with:

```tsx
                  {segment.continuesBefore && height >= 40 && (
                    <div className="label leading-none opacity-70">↑ FROM {shortDate(occ.date)}</div>
                  )}

                  {/* Three densities. A 15-minute entry used to render two
                      stacked lines inside an 18px box and overflow itself. */}
                  {height >= 40 ? (
                    <>
                      <div className="truncate leading-tight">{occ.title}</div>
                      <div className="label mt-0.5">{clockLabel(top)}</div>
                    </>
                  ) : height >= 22 ? (
                    <div className="flex items-baseline gap-1.5 leading-tight">
                      <span className="truncate">{occ.title}</span>
                      <span className="label shrink-0 opacity-70">{clockLabel(top)}</span>
                    </div>
                  ) : (
                    <div className="truncate leading-none">{occ.title}</div>
                  )}

                  {segment.continuesAfter && height >= 40 && (
                    <div className="label absolute inset-x-1.5 bottom-0.5 leading-none opacity-70">
                      ↓ TO {shortDate(occ.endDate)}
                    </div>
                  )}

                  {/* The readout that turns a drag from an estimate into a
                      measurement — and makes the quarter-hour snap legible. */}
                  {active && (
                    <div className="absolute -right-1 -top-6 z-40 whitespace-nowrap border border-hairlit bg-panel px-1.5 py-0.5 text-[10px] text-bright shadow-[0_4px_12px_rgba(0,0,0,0.6)]">
                      {clockLabel(top)} – {clockLabel(bottom)}
                    </div>
                  )}
```

- [ ] **Step 4: Add the cursor affordances**

On the block's `className`, add `cursor-grab` and, while dragging,
`cursor-grabbing` plus a shadow:

```tsx
                    active ? 'cursor-grabbing shadow-[0_6px_18px_rgba(0,0,0,0.6)]' : 'cursor-grab',
```

- [ ] **Step 5: Typecheck and test**

Run: `npx tsc --noEmit && npm test`
Expected: `tsc` exits 0; 207 tests passing.

- [ ] **Step 6: Verify in the browser**

In the preview: drag a block that starts off-grid — it snaps onto the quarter
hour, and the chip shows the times stepping in 15-minute jumps. Hold Alt — it
moves freely. Drag hard past midnight — it stops at the edge instead of springing
back. Drag an overnight block — it does not move. Resize by the bottom grip; the
grip is absent on a block that continues past the day.

- [ ] **Step 7: Commit**

```bash
git add src/components/calendar/DayView.tsx
git commit -m "Land a dragged block where you meant, and say where that is"
```

---

# Section H — Undo

## File structure

| File | Responsibility |
|---|---|
| `src/lib/store/undo.ts` | **Create.** The reconciler: diff two snapshots over a set of touched ids and say what to write. Pure — no Supabase, no store. |
| `src/lib/store/undo.test.ts` | **Create.** Unit tests for the above. |
| `src/lib/store/calendar-store.ts` | **Modify.** Undo stack, `optimistic` gains a label and a touched set, `undo()` action. |
| `src/lib/store/calendar-store.test.ts` | **Modify.** Undo behaviour against the existing mock client. |
| `src/components/calendar/Toast.tsx` | **Modify.** Generic label instead of `TempoEvent[]`. |
| `src/components/calendar/CalendarShell.tsx` | **Modify.** ⌘Z ungated from the toast; announces from the stack. |

---

### Task 10: The reconciler

**Files:**
- Create: `src/lib/store/undo.ts`
- Create: `src/lib/store/undo.test.ts`

**Interfaces:**
- Produces: `interface Touched`, `interface Snapshot`, `interface Plan<T>`, `planRows<T extends { id: string }>(before: T[], live: T[], touched: string[]): Plan<T>`, `EMPTY_TOUCHED: Touched`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/store/undo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { planRows } from './undo';

/**
 * The reconciler is the whole of undo: every action's inverse is the same diff,
 * so this is the one place the correctness of "take that back" lives.
 *
 * The id scoping is not an optimisation. Realtime sync means another device's
 * edit can land between an action and its undo, and a diff over everything
 * would revert it as a side effect of Cmd-Z.
 */

const row = (id: string, v: number) => ({ id, v });

describe('planRows', () => {
  it('plans nothing when nothing changed', () => {
    const rows = [row('a', 1)];
    expect(planRows(rows, rows, ['a'])).toEqual({ insert: [], update: [], remove: [] });
  });

  it('updates a row that changed', () => {
    expect(planRows([row('a', 1)], [row('a', 2)], ['a'])).toEqual({
      insert: [],
      update: [row('a', 1)],
      remove: [],
    });
  });

  it('inserts a row the snapshot has and the live state does not', () => {
    expect(planRows([row('a', 1)], [], ['a'])).toEqual({
      insert: [row('a', 1)],
      update: [],
      remove: [],
    });
  });

  it('removes a row the live state has and the snapshot does not', () => {
    expect(planRows([], [row('a', 1)], ['a'])).toEqual({
      insert: [],
      update: [],
      remove: ['a'],
    });
  });

  /** The bug this exists to prevent: Cmd-Z must not revert another device. */
  it('ignores rows the action never touched', () => {
    expect(planRows([row('a', 1), row('b', 1)], [row('a', 2), row('b', 99)], ['a'])).toEqual({
      insert: [],
      update: [row('a', 1)],
      remove: [],
    });
  });

  it('plans several rows at once', () => {
    const before = [row('a', 1), row('b', 1)];
    const live = [row('a', 2), row('b', 2)];
    expect(planRows(before, live, ['a', 'b']).update).toEqual(before);
  });

  it('compares structurally, not by reference', () => {
    expect(planRows([row('a', 1)], [{ id: 'a', v: 1 }], ['a']).update).toEqual([]);
  });

  it('ignores a touched id absent from both sides', () => {
    expect(planRows([], [], ['ghost'])).toEqual({ insert: [], update: [], remove: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/store/undo.test.ts`
Expected: FAIL — `Failed to resolve import "./undo"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/store/undo.ts`:

```ts
import type { Category, OccurrenceOverride, TempoEvent } from '@/lib/tempo/types';

/**
 * Undo, as a diff rather than as an inverse per action.
 *
 * Writing an inverse for every mutation means writing a new one for every
 * future mutation, and a forgotten one is not a crash — it is a silent
 * divergence between what the screen shows and what the database holds. One
 * diff covers every action that exists and every action that will.
 */

/** Which rows an action changed. Collected by the action, never inferred. */
export interface Touched {
  events: string[];
  overrides: string[];
  categories: string[];
}

export const EMPTY_TOUCHED: Touched = { events: [], overrides: [], categories: [] };

/**
 * The store as it stood before an action.
 *
 * `deleted` is part of it because deletion is soft: a trashed row still exists
 * on the server, so moving between `events` and `deleted` is an *update*, and
 * the two lists have to be reconciled as one set or restoring would look like
 * an insert of a row that was never gone.
 */
export interface Snapshot {
  events: TempoEvent[];
  overrides: OccurrenceOverride[];
  categories: Category[];
  deleted: TempoEvent[];
}

export interface Plan<T> {
  insert: T[];
  update: T[];
  remove: string[];
}

/**
 * What to write to put `live` back to `before`, considering only `touched`.
 *
 * The id scoping is load-bearing rather than an optimisation. Realtime sync
 * streams other devices' changes into the store, so `live` is not necessarily
 * descended from `before` — and a diff over every row would revert a remote
 * edit that had nothing to do with the action being undone.
 */
export function planRows<T extends { id: string }>(
  before: T[],
  live: T[],
  touched: string[],
): Plan<T> {
  const beforeById = new Map(before.map((r) => [r.id, r]));
  const liveById = new Map(live.map((r) => [r.id, r]));

  const plan: Plan<T> = { insert: [], update: [], remove: [] };

  for (const id of new Set(touched)) {
    const was = beforeById.get(id);
    const now = liveById.get(id);

    if (was && !now) plan.insert.push(was);
    else if (!was && now) plan.remove.push(id);
    else if (was && now && !same(was, now)) plan.update.push(was);
  }

  return plan;
}

/**
 * Structural equality over the row's own fields.
 *
 * `JSON.stringify` on sorted keys rather than a deep walk: these are plain data
 * — strings, numbers, booleans, nulls and small arrays of the same — with no
 * cycles, no dates and no class instances, so the cheap version is the correct
 * one here.
 */
function same(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

function stable(v: unknown): string {
  return JSON.stringify(v, (_k, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value as object).sort(([x], [y]) => x.localeCompare(y)))
      : value,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/store/undo.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/store/undo.ts src/lib/store/undo.test.ts
git commit -m "Say what to write to put a snapshot back"
```

---

### Task 11: The undo stack in the store

**Files:**
- Modify: `src/lib/store/calendar-store.ts`
- Modify: `src/lib/store/calendar-store.test.ts`

**Interfaces:**
- Consumes: `planRows`, `Snapshot`, `Touched`, `EMPTY_TOUCHED` (Task 10).
- Produces on `CalendarState`: `undoStack: UndoEntry[]`, `undo: () => Promise<void>`, `exported interface UndoEntry { label: string; at: number; before: Snapshot; touched: Touched }`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/store/calendar-store.test.ts`:

```ts
describe('undo', () => {
  /**
   * The stack is the one mechanism behind every action's inverse, so these test
   * the reconciler through the store rather than the store's own bookkeeping:
   * what matters is that the calendar comes back, whatever moved it.
   */
  it('puts a moved event back', async () => {
    const e = event({ startDate: '2026-08-10', endDate: '2026-08-10' });
    useCalendar.setState({ ownerId: 'owner-1', events: [e], undoStack: [] });

    await useCalendar.getState().moveOccurrence(occurrenceOf(e, '2026-08-10'), 5, 'series');
    expect(useCalendar.getState().events[0].startDate).toBe('2026-08-15');

    await useCalendar.getState().undo();
    expect(useCalendar.getState().events[0].startDate).toBe('2026-08-10');
    expect(useCalendar.getState().undoStack).toHaveLength(0);
  });

  it('puts a resized event back', async () => {
    const e = event({ startDate: '2026-08-10', endDate: '2026-08-12' });
    useCalendar.setState({ ownerId: 'owner-1', events: [e], undoStack: [] });

    await useCalendar
      .getState()
      .resizeOccurrence(occurrenceOf(e, '2026-08-10', '2026-08-12'), 3, 'end', 'series');
    expect(useCalendar.getState().events[0].endDate).toBe('2026-08-15');

    await useCalendar.getState().undo();
    expect(useCalendar.getState().events[0].endDate).toBe('2026-08-12');
  });

  it('unwinds one action at a time, newest first', async () => {
    const e = event({ startDate: '2026-08-10', endDate: '2026-08-10' });
    useCalendar.setState({ ownerId: 'owner-1', events: [e], undoStack: [] });

    await useCalendar.getState().moveOccurrence(occurrenceOf(e, '2026-08-10'), 1, 'series');
    const once = useCalendar.getState().events[0];
    await useCalendar.getState().moveOccurrence(occurrenceOf(once, '2026-08-11'), 1, 'series');
    expect(useCalendar.getState().events[0].startDate).toBe('2026-08-12');

    await useCalendar.getState().undo();
    expect(useCalendar.getState().events[0].startDate).toBe('2026-08-11');
    await useCalendar.getState().undo();
    expect(useCalendar.getState().events[0].startDate).toBe('2026-08-10');
  });

  /** A delete is an update now, so its undo is one too — no special case. */
  it('takes an entry back out of the trash', async () => {
    const e = event({ id: 'e1' });
    useCalendar.setState({ ownerId: 'owner-1', events: [e], deleted: [], undoStack: [] });

    await useCalendar.getState().deleteEvent('e1');
    expect(useCalendar.getState().events).toHaveLength(0);
    expect(useCalendar.getState().deleted).toHaveLength(1);

    await useCalendar.getState().undo();
    expect(useCalendar.getState().events).toHaveLength(1);
    expect(useCalendar.getState().deleted).toHaveLength(0);
  });

  it('removes an entry that undo says was never created', async () => {
    useCalendar.setState({ ownerId: 'owner-1', events: [], undoStack: [] });

    await useCalendar.getState().createEvent({
      title: 'New',
      kind: 'event',
      allDay: true,
      startDate: '2026-08-10',
      endDate: '2026-08-10',
    });
    expect(useCalendar.getState().events).toHaveLength(1);

    await useCalendar.getState().undo();
    expect(useCalendar.getState().events).toHaveLength(0);
  });

  /** A write the server refused has nothing to take back. */
  it('records nothing when the write fails', async () => {
    const e = event({ startDate: '2026-08-10' });
    useCalendar.setState({ ownerId: 'owner-1', events: [e], undoStack: [] });

    shouldFail = true;
    await useCalendar.getState().moveOccurrence(occurrenceOf(e, '2026-08-10'), 5, 'series');
    shouldFail = false;

    expect(useCalendar.getState().undoStack).toHaveLength(0);
    expect(useCalendar.getState().events[0].startDate).toBe('2026-08-10');
  });

  it('keeps the entry when the undo itself fails, so it can be retried', async () => {
    const e = event({ startDate: '2026-08-10' });
    useCalendar.setState({ ownerId: 'owner-1', events: [e], undoStack: [] });
    await useCalendar.getState().moveOccurrence(occurrenceOf(e, '2026-08-10'), 5, 'series');

    shouldFail = true;
    await useCalendar.getState().undo();
    shouldFail = false;

    expect(useCalendar.getState().undoStack).toHaveLength(1);
  });

  it('does nothing on an empty stack', async () => {
    useCalendar.setState({ ownerId: 'owner-1', events: [], undoStack: [] });
    await expect(useCalendar.getState().undo()).resolves.toBeUndefined();
  });

  it('evicts the oldest past the cap', async () => {
    const e = event({ startDate: '2026-08-10' });
    useCalendar.setState({ ownerId: 'owner-1', events: [e], undoStack: [] });

    for (let i = 0; i < 55; i++) {
      const current = useCalendar.getState().events[0];
      await useCalendar
        .getState()
        .moveOccurrence(occurrenceOf(current, current.startDate!), 1, 'series');
    }
    expect(useCalendar.getState().undoStack).toHaveLength(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/store/calendar-store.test.ts -t undo`
Expected: FAIL — `undo is not a function`.

- [ ] **Step 3: Add the state and the action**

In `src/lib/store/calendar-store.ts`:

Add the import:

```ts
import { EMPTY_TOUCHED, planRows, type Snapshot, type Touched } from './undo';
```

Add above `interface CalendarState`:

```ts
/** A safety net, not a log. The fifty-first action pushes the oldest off. */
const UNDO_CAP = 50;

export interface UndoEntry {
  /** What the toast says, and what ⌘Z is taking back. */
  label: string;
  at: number;
  before: Snapshot;
  touched: Touched;
}
```

Add to `interface CalendarState`:

```ts
  /**
   * What this session did, newest first.
   *
   * In memory and nowhere else, and deliberately separate from `event_versions`:
   * a version log is per-entry and ordered by time, and a group move of six
   * entries is one action across six rows. Only a stack can express that as one
   * Cmd-Z. The durable half already exists; this is the reflex.
   */
  undoStack: UndoEntry[];
  /** Take back the last action. */
  undo: () => Promise<void>;
```

- [ ] **Step 4: Give `optimistic` a label and a touched set**

Replace `optimistic` with:

```ts
  /**
   * Apply optimistically, persist, restore the snapshot if the write fails —
   * and remember the snapshot if it succeeds.
   *
   * The snapshot was always taken; it was simply thrown away on success. Undo
   * is that snapshot kept, which is why it costs a field rather than a
   * mechanism.
   */
  async function optimistic(
    apply: () => void,
    persist: () => Promise<{ error: { message: string } | null }>,
    record?: { label: string; touched: Touched },
  ): Promise<boolean> {
    const snapshot: Snapshot = {
      events: get().events,
      overrides: get().overrides,
      categories: get().categories,
      // The trash is local state like any other. A delete the server refused
      // has to take its own undo offer back with it — an entry that never
      // actually left has nothing to restore.
      deleted: get().deleted,
    };
    apply();
    const { error } = await persist();
    if (error) {
      set({ ...snapshot, error: error.message });
      return false;
    }
    // Only on success. An entry for a rejected write would offer to take back
    // something that never happened.
    if (record) {
      set((s) => ({
        undoStack: [
          { label: record.label, at: Date.now(), before: snapshot, touched: record.touched },
          ...s.undoStack,
        ].slice(0, UNDO_CAP),
      }));
    }
    return true;
  }
```

- [ ] **Step 5: Add `undo` to the returned object**

Beside `rollbackTo`:

```ts
    undoStack: [],

    /**
     * Put the calendar back to before the last action.
     *
     * Local state is an assignment; the server needs the difference written to
     * it, which `planRows` works out once for every action there is. The entry
     * is only popped once the write lands, so a failed undo can be retried
     * rather than silently lost.
     */
    undo: async () => {
      const ownerId = get().ownerId;
      const entry = get().undoStack[0];
      if (!ownerId || !entry) return;

      const { before, touched } = entry;
      const live = get();

      /**
       * Live and trashed rows are one set. Deletion is soft, so a row in the
       * trash still exists on the server — treating the two lists separately
       * would plan an insert for a row that was only ever updated.
       */
      const events = planRows(
        [...before.events, ...before.deleted],
        [...live.events, ...live.deleted],
        touched.events,
      );
      const overrides = planRows(before.overrides, live.overrides, touched.overrides);
      const categories = planRows(before.categories, live.categories, touched.categories);

      // An undo is an edit, and an edit that leaves no version behind is a hole
      // in the history surface.
      for (const e of [...events.update, ...events.insert]) captureVersion(e.id, 'edit');

      const ok = await optimistic(
        () =>
          set({
            events: before.events,
            overrides: before.overrides,
            categories: before.categories,
            deleted: before.deleted,
          }),
        async () => {
          for (const e of [...events.insert, ...events.update]) {
            const { error } = await supabase
              .from('events')
              .upsert({ id: e.id, owner_id: ownerId, title: e.title, ...eventToRow(e) });
            if (error) return { error };
          }
          if (events.remove.length > 0) {
            const { error } = await supabase.from('events').delete().in('id', events.remove);
            if (error) return { error };
          }

          for (const o of [...overrides.insert, ...overrides.update]) {
            const { error } = await supabase.from('occurrence_overrides').upsert(
              {
                id: o.id,
                owner_id: ownerId,
                event_id: o.eventId,
                occurrence_date: o.occurrenceDate,
                cancelled: o.cancelled,
                patch: o.patch as never,
              },
              { onConflict: 'event_id,occurrence_date' },
            );
            if (error) return { error };
          }
          if (overrides.remove.length > 0) {
            const { error } = await supabase
              .from('occurrence_overrides')
              .delete()
              .in('id', overrides.remove);
            if (error) return { error };
          }

          for (const c of [...categories.insert, ...categories.update]) {
            const { error } = await supabase.from('categories').upsert({
              id: c.id,
              owner_id: ownerId,
              name: c.name,
              color: c.color,
              sort_order: c.sortOrder,
            });
            if (error) return { error };
          }
          if (categories.remove.length > 0) {
            const { error } = await supabase
              .from('categories')
              .delete()
              .in('id', categories.remove);
            if (error) return { error };
          }

          return { error: null };
        },
      );

      /**
       * Popped only once the write lands.
       *
       * `optimistic` rolled the local state back if it did not, which leaves
       * this entry still describing a real difference — so it stays, and the
       * undo can be pressed again. Read from `optimistic`'s own answer rather
       * than from `state.error`, which may still be holding a message from some
       * earlier, unrelated failure nobody has dismissed.
       */
      if (ok) set((s) => ({ undoStack: s.undoStack.slice(1) }));
    },
```

> The `undo` call passes no `record`, so undo pushes nothing and cannot loop.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/lib/store/calendar-store.test.ts -t undo`
Expected: PASS — 9 tests.

- [ ] **Step 7: Typecheck, full suite, commit**

```bash
npx tsc --noEmit && npm test
git add src/lib/store/calendar-store.ts src/lib/store/calendar-store.test.ts
git commit -m "Keep the snapshot optimistic() already took"
```

Expected: 224 tests passing.

---

### Task 12: Label every mutation

**Files:**
- Modify: `src/lib/store/calendar-store.ts`

**Interfaces:**
- Consumes: `optimistic`'s third parameter (Task 11).
- Produces: no new exports.

Every mutation passes a label and the ids it touched. The label belongs to the
action that started the mutation, not the method that finished it —
`moveOccurrence` delegating to `updateEvent` must still say "Moved".

- [ ] **Step 1: Thread a label through the delegating helpers**

Give `writeEvent` and `patchOccurrence` an optional record, defaulting to the
generic one, and pass it to `optimistic`:

```ts
  /** The write half of `updateEvent`, without the version capture. */
  async function writeEvent(
    id: string,
    patch: Partial<TempoEvent>,
    record?: { label: string; touched: Touched },
  ) {
    await optimistic(
      () =>
        set((s) => ({
          events: s.events.map((e) => (e.id === id ? { ...e, ...patch } : e)),
        })),
      async () => {
        const { error } = await supabase.from('events').update(eventToRow(patch)).eq('id', id);
        return { error };
      },
      record ?? { label: `Edited ${titleOf(id)}`, touched: { ...EMPTY_TOUCHED, events: [id] } },
    );
  }
```

Add the helper beside `deleteStamp`:

```ts
  /** An entry's title, for a label. Falls back rather than throwing. */
  function titleOf(id: string): string {
    const { events, deleted } = get();
    return (events.find((e) => e.id === id) ?? deleted.find((e) => e.id === id))?.title ?? 'entry';
  }
```

- [ ] **Step 2: Label each mutation**

Apply these, passing the record as `optimistic`'s third argument (or
`writeEvent`'s / `patchOccurrence`'s):

| method | label | touched |
|---|---|---|
| `createEvent` | `` `Created ${event.title}` `` | `{ ...EMPTY_TOUCHED, events: [id] }` |
| `updateEvent` | `` `Edited ${titleOf(id)}` `` | `{ ...EMPTY_TOUCHED, events: [id] }` |
| `softDelete` (1 id) | `` `Deleted ${titleOf(ids[0])}` `` | `{ ...EMPTY_TOUCHED, events: ids }` |
| `softDelete` (n ids) | `` `Deleted ${ids.length} entries` `` | `{ ...EMPTY_TOUCHED, events: ids }` |
| `restoreDeleted` | `` `Restored ${titleOf(eventId)}` `` | `{ ...EMPTY_TOUCHED, events: [id] }` |
| `moveOccurrence` | `` `Moved ${occ.title}` `` | events or overrides, per branch |
| `moveOccurrences` / `gatherOccurrences` (via `shiftBy`) | `` `Moved ${n} entries` `` where n = `patches.size + overrides.size`, or `` `Moved ${title}` `` when n is 1 | `{ events: [...patches.keys()], overrides: rewritten.map(o => o.id), categories: [] }` |
| `resizeOccurrence` | `` `Resized ${occ.title}` `` | per branch |
| `setOccurrenceTime` | `` `Rescheduled ${occ.title}` `` | per branch |
| `cancelOccurrence` | `` `Skipped ${occ.title}` `` | per branch |
| `setStatus` | `` `Marked ${occ.title} ${status}` `` | per branch |
| `createCategory` | `` `Added category ${name}` `` | `{ ...EMPTY_TOUCHED, categories: [id] }` |
| `updateCategory` | `` `Renamed category ${name}` `` | `{ ...EMPTY_TOUCHED, categories: [id] }` |
| `deleteCategory` | `` `Deleted category ${name}` `` | `{ events: affectedIds, overrides: [], categories: [id] }` |

**"Per branch" means exactly this rule.** `moveOccurrence`, `resizeOccurrence`,
`setOccurrenceTime`, `cancelOccurrence` and `setStatus` each already fork on
whether the edit rewrites the series or excepts one instance out of it:

```ts
const wholeSeries = scope === 'series' || !occ.event.recurrence;
```

- **Series branch** — the write lands on the event row, so
  `{ ...EMPTY_TOUCHED, events: [occ.eventId] }`, passed to `writeEvent`.
- **Occurrence branch** — the write lands on an override, so
  `{ ...EMPTY_TOUCHED, overrides: [merged.id] }`, passed through
  `patchOccurrence`. `merged` is the `OccurrenceOverride` that function already
  builds; give `patchOccurrence` the same optional `record` parameter
  `writeEvent` gets, and default it to
  `` { label: `Edited ${titleOf(occ.eventId)}`, touched: { ...EMPTY_TOUCHED, overrides: [merged.id] } } ``.

`cancelOccurrence` has a third path: a one-off has no series to except out of,
so it calls `deleteEvent`, which supplies its own "Deleted …" label. Pass no
record from `cancelOccurrence` on that path.

`purgeDeleted` and `rollbackTo` take **no** record. A purge is documented as the
one irreversible action in the app, and a rollback is reached from the HISTORY
surface, which has its own way back.

- [ ] **Step 3: Add a label test**

Append to `calendar-store.test.ts`:

```ts
  it('labels a move by the gesture, not by the method that wrote it', async () => {
    const e = event({ title: 'Standup', startDate: '2026-08-10' });
    useCalendar.setState({ ownerId: 'owner-1', events: [e], undoStack: [] });

    await useCalendar.getState().moveOccurrence(occurrenceOf(e, '2026-08-10'), 1, 'series');
    expect(useCalendar.getState().undoStack[0].label).toBe('Moved Standup');
  });

  it('labels a bulk delete by its size', async () => {
    const a = event({ id: 'a' });
    const b = event({ id: 'b' });
    useCalendar.setState({ ownerId: 'owner-1', events: [a, b], deleted: [], undoStack: [] });

    await useCalendar.getState().deleteEvents(['a', 'b']);
    expect(useCalendar.getState().undoStack[0].label).toBe('Deleted 2 entries');
  });
```

- [ ] **Step 4: Typecheck, test, commit**

```bash
npx tsc --noEmit && npm test
git add src/lib/store/calendar-store.ts src/lib/store/calendar-store.test.ts
git commit -m "Name every action in the words of the gesture that caused it"
```

Expected: 226 tests passing.

---

### Task 13: The toast and the keymap

**Files:**
- Modify: `src/components/calendar/Toast.tsx`
- Modify: `src/components/calendar/CalendarShell.tsx`

**Interfaces:**
- Consumes: `undoStack`, `undo` (Tasks 11–12).
- Produces: `Toast` props become `{ label: string; actionLabel?: string; onUndo?: () => void; onDismiss: () => void }`.

- [ ] **Step 1: Make the toast generic**

In `src/components/calendar/Toast.tsx`, replace the props and the message body:

```tsx
interface Props {
  /** What just happened, in the words of the gesture that caused it. */
  label: string;
  /** Omitted for the confirmation an undo raises — there is nothing to offer. */
  onUndo?: () => void;
  onDismiss: () => void;
}

export function Toast({ label, onUndo, onDismiss }: Props) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, LIFETIME_MS);
    return () => window.clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-full z-40 flex justify-center px-4"
      style={{ paddingBottom: LIFT_PX }}
    >
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex max-w-[420px] items-center gap-3 border border-hairlit bg-panel px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.7)]"
      >
        <span className="min-w-0 truncate text-[11px] text-dim">{label}</span>
        {onUndo && (
          <Button type="button" variant="primary" onClick={onUndo}>
            UNDO
          </Button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 px-1 text-[12px] leading-none text-mute transition-colors hover:text-ink"
        >
          ×
        </button>
      </div>
    </div>
  );
}
```

Delete the now-unused `TempoEvent` import and the `entries.length === 0` guard —
the shell decides whether a toast exists.

- [ ] **Step 2: Announce from the stack in CalendarShell**

Replace the `deleted`-watching effect, the `liveToast` derivation and
`undoDelete` with:

```tsx
  const undoStack = useCalendar((s) => s.undoStack);
  const undo = useCalendar((s) => s.undo);

  const [toast, setToast] = useState<{ at: number; label: string; undoable: boolean } | null>(null);
  /** The action already announced, so a shrinking stack doesn't re-announce. */
  const announced = useRef<number | null>(null);

  /**
   * The toast follows the stack, not the action.
   *
   * Several surfaces mutate the calendar — the grid, the timeline, the form,
   * the tasks pane — and none of them report back up here. The stack is the one
   * place all of them land, so this watches for an action newer than the last
   * announced rather than asking to be told.
   *
   * The first pass only records where the stack stood, which is nothing on a
   * fresh tab and is the right no-op if that ever stops being true.
   */
  useEffect(() => {
    const newest = undoStack[0]?.at ?? null;
    if (announced.current === null) {
      announced.current = newest ?? 0;
      return;
    }
    if (newest === null || newest <= announced.current) return;
    announced.current = newest;
    setToast({ at: newest, label: undoStack[0].label, undoable: true });
  }, [undoStack]);

  const dismissToast = useCallback(() => setToast(null), []);

  /**
   * Undo says what it undid.
   *
   * Cmd-Z is no longer gated on a visible toast, so it can fire with nothing on
   * screen — and a keypress that changes the calendar and says nothing is worse
   * than no keypress at all. The confirmation carries no UNDO of its own:
   * pressing it again is what "again" means.
   */
  const runUndo = useCallback(async () => {
    const before = useCalendar.getState().undoStack;
    const entry = before[0];
    if (!entry) return;

    await undo();

    // The stack shrinking is what "it worked" means. `state.error` may still be
    // holding a message from some earlier failure nobody has dismissed, and a
    // failed undo deliberately leaves its entry in place to be retried.
    const after = useCalendar.getState().undoStack;
    if (after.length >= before.length) return;

    announced.current = after[0]?.at ?? 0;
    setToast({ at: Date.now(), label: `Undid: ${entry.label}`, undoable: false });
  }, [undo]);
```

- [ ] **Step 3: Ungate ⌘Z**

Replace the ⌘Z branch in `onKey`:

```tsx
    /**
     * The one chord the app claims, and now whenever there is anything to take
     * back rather than only while a toast happens to be up. The undo you reach
     * for eight seconds late is the same undo.
     *
     * Not in a text field, where it still means "undo my typing", and not with
     * Shift, which is redo and stays the browser's.
     */
    if (
      (e.metaKey || e.ctrlKey) &&
      !e.altKey &&
      !e.shiftKey &&
      (e.key === 'z' || e.key === 'Z') &&
      undoStack.length > 0 &&
      !typing
    ) {
      e.preventDefault();
      void runUndo();
      return;
    }
```

- [ ] **Step 4: Render it**

Replace the `{liveToast && …}` block:

```tsx
        {toast && (
          <Toast
            key={toast.at}
            label={toast.label}
            onUndo={toast.undoable ? runUndo : undefined}
            onDismiss={dismissToast}
          />
        )}
```

Remove the now-unused `deleted` / `restoreDeleted` selectors **only if** nothing
else in the file uses them — `History.tsx` is reached from here but has its own
selectors.

- [ ] **Step 5: Typecheck and test**

Run: `npx tsc --noEmit && npm test`
Expected: `tsc` exits 0; 226 tests passing.

- [ ] **Step 6: Verify in the browser**

In the preview: drag an entry to another date — a toast says "Moved …". Press
⌘Z — it returns and a toast says "Undid: Moved …". Let a toast expire, then
press ⌘Z — it still works. Retime a block on the timeline, resize a bar, edit an
entry in the form, delete one: each announces, each undoes. Press ⌘Z repeatedly
to walk back several actions. Type in the entry form and press ⌘Z — the browser's
text undo, not the calendar's.

- [ ] **Step 7: Commit**

```bash
git add src/components/calendar/Toast.tsx src/components/calendar/CalendarShell.tsx
git commit -m "Offer the undo, and say what it took back"
```

---

## Verification

After Task 13:

```bash
npx tsc --noEmit && npm run lint && npm test
```

Expected: `tsc` exits 0, lint clean, **226 tests passing**: 167 baseline, plus
40 from `timeline.test.ts` (9 + 6 + 13 + 12), 8 from `undo.test.ts`, and 11
added to `calendar-store.test.ts` (9 behaviour + 2 label).

Manual pass against `/preview`, covering what unit tests cannot reach:

1. An overnight entry draws on the timeline on both days, cut at midnight with
   chevrons, and not in the ALL DAY strip.
2. An entry ending at exactly 00:00 leaves no sliver on the following day.
3. Two overlapping morning entries do not narrow an afternoon one.
4. The red rule sits at the current time on today only, and never eats a drag.
5. `0` fits the day; `+` and `-` step; the centre time holds; the scale survives
   a reload.
6. A drag snaps to the quarter hour, Alt frees it, an overshoot clamps, and the
   chip reads the live times.
7. ⌘Z walks back through moves, resizes, retimes, edits, status flips and
   deletes, and says what it took back each time.
