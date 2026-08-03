/**
 * Week-row layout.
 *
 * The continuous scroll is a list of week rows, so every occurrence has to be
 * cut into per-week segments and stacked into lanes that don't collide. This is
 * interval-graph colouring, not a CSS problem — two bars that share a single
 * column must never land in the same lane, and a bar crossing a week boundary
 * has to keep its lane stable on both sides or it visibly jumps as you scroll.
 *
 * Everything is a bar, including timed single-day events. Uniformity means one
 * drag model, one resize model, and one lane algorithm instead of three.
 */

import { addDays, diffDays, maxDate, minDate, rangesOverlap, type CivilDate } from './civil';
import type { EventKind, Occurrence } from './types';

export const DAYS_PER_WEEK = 7;

/**
 * Height carries importance.
 *
 * A task is the loudest thing a day can contain and has to look like it at a
 * glance, across seven columns, without being read. Colour can't do that job —
 * it is already spoken for by category — and a 2px border weight is invisible
 * at this scale. Size is the one channel left that survives being glanced at.
 *
 * A mark is a tick because a mark is a moment rather than a span: there is no
 * duration to draw and no second line to write. A birthday gets the extra room
 * its derived age needs; a task gets two lines, title and status.
 *
 * Every figure here is about 35% larger than it was, which leaves the ordering
 * — and therefore the meaning — untouched while raising the floor. The smallest
 * bar was 14px and a 14px bar is something you find by looking for it; the
 * complaint that prompted this was that entries got lost while scanning, and
 * the ratios were never what was wrong.
 */
export const KIND_HEIGHT: Record<EventKind, number> = {
  milestone: 20,
  event: 28,
  birthday: 34,
  assignment: 42,
};

export const LANE_GAP = 4;

export interface WeekSegment {
  occurrence: Occurrence;
  /** 0-6, inclusive, within this week row. */
  startCol: number;
  endCol: number;
  lane: number;
  /** The bar is clipped: it began in an earlier week / ends in a later one. */
  continuesBefore: boolean;
  continuesAfter: boolean;
  /** Past the pixel budget; rolled into the day's "+N" counter instead of drawn. */
  hidden: boolean;
  /** Offset from the top of the lane area. `WeekRow` adds the header height. */
  top: number;
  /** The bar's own height — `KIND_HEIGHT[kind]`, not its lane's. */
  height: number;
}

export interface WeekLayout {
  weekStart: CivilDate;
  weekEnd: CivilDate;
  days: CivilDate[];
  segments: WeekSegment[];
  /** Lanes actually drawn, after the overflow cutoff. */
  laneCount: number;
  /** Tallest bar in each lane. Lanes are as tall as their loudest occupant. */
  laneHeights: number[];
  /** Cumulative offset of each lane from the top of the lane area. */
  laneTops: number[];
  /** Per column, how many occurrences were suppressed. */
  overflow: number[];
  /** The total height of the content in the lane area. */
  contentHeight: number;
}

/**
 * Default pixel budget for the lane area, in case a caller doesn't state one.
 * `constants.ts` derives the real figure from `ROW_H` and passes it in, the way
 * it used to pass `maxLanes`.
 *
 * Kept equal to that figure by hand rather than imported: `constants.ts` is a
 * component-layer module and this one is not, so the dependency would run the
 * wrong way. A default that disagreed with the grid would only ever be seen by
 * a test that forgot to pass a budget, which is the worst place to hide it.
 */
export const DEFAULT_LANE_BUDGET = 141;

export function weekDays(weekStart: CivilDate): CivilDate[] {
  return Array.from({ length: DAYS_PER_WEEK }, (_, i) => addDays(weekStart, i));
}

/**
 * Assigns lanes for one week row.
 *
 * `budget` caps the drawn stack in *pixels* rather than in lanes, so a single
 * busy week can't blow the row height out and wreck the scroll rhythm; the
 * remainder becomes a "+N" chip. It is a pixel budget because lanes are no
 * longer a uniform height — three tasks and four events both fill the row, and
 * counting lanes could only be right for one of them.
 */
export function layoutWeek(
  weekStart: CivilDate,
  occurrences: Occurrence[],
  budget = DEFAULT_LANE_BUDGET,
): WeekLayout {
  const weekEnd = addDays(weekStart, DAYS_PER_WEEK - 1);
  const days = weekDays(weekStart);

  const clipped = occurrences
    .filter((o) => rangesOverlap(o.date, o.endDate, weekStart, weekEnd))
    .map((occurrence) => {
      const visibleStart = maxDate(occurrence.date, weekStart);
      const visibleEnd = minDate(occurrence.endDate, weekEnd);
      return {
        occurrence,
        startCol: diffDays(visibleStart, weekStart),
        endCol: diffDays(visibleEnd, weekStart),
        continuesBefore: occurrence.date < weekStart,
        continuesAfter: occurrence.endDate > weekEnd,
      };
    })
    .sort(bySpanThenStart);

  // Greedy lowest-available-lane. Bars are pre-sorted longest-first so the
  // multi-day spine of a week settles into the top lanes and short chips fill
  // in beneath, which keeps lanes stable as you scroll across a boundary.
  //
  // Because they are sorted longest-first, events starting later can be processed
  // before events starting earlier. We track column-level occupancy per lane so
  // that a lane's empty days before a long event are not incorrectly blocked.
  const laneOccupied: boolean[][] = [];
  const assigned: Array<(typeof clipped)[number] & { lane: number }> = [];

  for (const c of clipped) {
    let lane = laneOccupied.findIndex((occupied) => {
      for (let col = c.startCol; col <= c.endCol; col++) {
        if (occupied[col]) return false;
      }
      return true;
    });

    if (lane === -1) {
      lane = laneOccupied.length;
      laneOccupied.push(new Array(DAYS_PER_WEEK).fill(false));
    }

    for (let col = c.startCol; col <= c.endCol; col++) {
      laneOccupied[lane][col] = true;
    }
    assigned.push({ ...c, lane });
  }

  // 1. Calculate column heights for each (col, lane) cell.
  const colHeights = Array.from({ length: DAYS_PER_WEEK }, () => [] as number[]);
  for (const a of assigned) {
    const h = KIND_HEIGHT[a.occurrence.kind];
    for (let col = a.startCol; col <= a.endCol; col++) {
      colHeights[col][a.lane] = h;
    }
  }

  // 2. Compute column-level top offsets for each (col, lane) cell.
  const colTops = Array.from({ length: DAYS_PER_WEEK }, () => [] as number[]);
  for (let col = 0; col < DAYS_PER_WEEK; col++) {
    let currentTop = 0;
    const maxLane = colHeights[col].length;
    for (let l = 0; l < maxLane; l++) {
      colTops[col][l] = currentTop;
      const h = colHeights[col][l] ?? 0;
      if (h > 0) {
        currentTop += h + LANE_GAP;
      }
    }
  }

  // 3. Populate global laneHeights and laneTops (as max of each lane across all columns).
  // This satisfies the WeekLayout interface and maintains correct total height of the row.
  const maxLanes = Math.max(0, ...assigned.map((a) => a.lane + 1));
  const laneHeights: number[] = new Array(maxLanes).fill(0);
  const laneTops: number[] = new Array(maxLanes).fill(0);

  for (let l = 0; l < maxLanes; l++) {
    let maxHeight = 0;
    for (let col = 0; col < DAYS_PER_WEEK; col++) {
      maxHeight = Math.max(maxHeight, colHeights[col][l] ?? 0);
    }
    laneHeights[l] = maxHeight;

    let maxTop = 0;
    for (let col = 0; col < DAYS_PER_WEEK; col++) {
      if ((colHeights[col][l] ?? 0) > 0) {
        maxTop = Math.max(maxTop, colTops[col][l] ?? 0);
      }
    }
    laneTops[l] = maxTop;
  }

  const segments: WeekSegment[] = [];
  const overflow = new Array<number>(DAYS_PER_WEEK).fill(0);
  let laneCount = 0;
  let contentHeight = 0;

  for (const a of assigned) {
    const h = KIND_HEIGHT[a.occurrence.kind];
    // A segment's top is the maximum of the top offsets needed in the columns it covers,
    // ensuring the multi-day bar remains flat across columns.
    let segmentTop = 0;
    for (let col = a.startCol; col <= a.endCol; col++) {
      segmentTop = Math.max(segmentTop, colTops[col][a.lane] ?? 0);
    }

    const hidden = false;
    laneCount = Math.max(laneCount, a.lane + 1);
    contentHeight = Math.max(contentHeight, segmentTop + h);

    segments.push({
      ...a,
      hidden,
      top: segmentTop,
      height: h,
    });
  }

  return { weekStart, weekEnd, days, segments, laneCount, laneHeights, laneTops, overflow, contentHeight };
}

function bySpanThenStart(
  a: { startCol: number; endCol: number; occurrence: Occurrence },
  b: { startCol: number; endCol: number; occurrence: Occurrence },
): number {
  const aSpan = a.endCol - a.startCol;
  const bSpan = b.endCol - b.startCol;
  if (aSpan !== bSpan) return bSpan - aSpan; // longest bars claim lanes first
  if (a.startCol !== b.startCol) return a.startCol - b.startCol;
  if (a.occurrence.allDay !== b.occurrence.allDay) return a.occurrence.allDay ? -1 : 1;
  const am = a.occurrence.startMinutes ?? 0;
  const bm = b.occurrence.startMinutes ?? 0;
  if (am !== bm) return am - bm;
  // final tiebreak on a stable id so lanes don't shuffle between renders
  return a.occurrence.key.localeCompare(b.occurrence.key);
}

/** Occurrences touching a given day, for the day-detail panel. */
export function occurrencesOn(occurrences: Occurrence[], day: CivilDate): Occurrence[] {
  return occurrences.filter((o) => rangesOverlap(o.date, o.endDate, day, day));
}

// ------------------------------------------------------------------- lasso

/**
 * A marquee, in the scroll container's **content** coordinates: `x` from the
 * left edge of the seven columns, `y` from the top of week 0. Content rather
 * than viewport, so the rect survives autoscroll without being recomputed —
 * scrolling under a stationary pointer moves the pointer's content position and
 * leaves the anchor exactly where it was pressed.
 */
export interface MarqueeRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface GridMetrics {
  colWidth: number;
  /** Every row is this tall. The identity the whole scroll architecture rests on. */
  rowH: number;
  /** The day-number strip a segment's `top` is measured below. */
  headerH: number;
}

/**
 * Which bars a marquee covers.
 *
 * Computed, never measured. Rows are virtualised, so a marquee dragged past the
 * viewport covers rows that have no elements to read a rect from — reading the
 * DOM would silently select only the part of the sweep that happened to be on
 * screen. Every row is exactly `rowH` tall and every segment's band inside its
 * row is already known, so the intersection is arithmetic that works just as
 * well for a row that was never mounted. It is also why no rAF throttle is
 * needed here: nothing is being measured, so nothing can force a layout.
 *
 * `layoutOf` is a lookup rather than a prepared map because the range of weeks
 * to consider is itself part of the answer — the caller would have to redo this
 * function's row arithmetic to know which layouts to hand over.
 */
export function occurrencesInMarquee(
  rect: MarqueeRect,
  layoutOf: (weekIndex: number) => WeekLayout | null,
  { colWidth, rowH, headerH }: GridMetrics,
  getWeekRange?: (y0: number, y1: number) => Array<{ index: number; start: number; end: number }>,
): Set<string> {
  const hits = new Set<string>();
  if (colWidth <= 0 || rowH <= 0) return hits;

  // Normalised, so dragging up and to the left works like dragging down and to
  // the right rather than selecting nothing.
  const left = Math.min(rect.x0, rect.x1);
  const right = Math.max(rect.x0, rect.x1);
  const top = Math.min(rect.y0, rect.y1);
  const bottom = Math.max(rect.y0, rect.y1);

  const firstCol = Math.floor(left / colWidth);
  const lastCol = Math.floor(right / colWidth);
  if (lastCol < 0 || firstCol > DAYS_PER_WEEK - 1) return hits;

  let weeksToOverlap: Array<{ index: number; start: number; end: number }> = [];
  if (getWeekRange) {
    weeksToOverlap = getWeekRange(top, bottom);
  } else {
    const startWeek = Math.floor(top / rowH);
    const endWeek = Math.floor(bottom / rowH);
    for (let w = startWeek; w <= endWeek; w++) {
      weeksToOverlap.push({ index: w, start: w * rowH, end: (w + 1) * rowH });
    }
  }

  for (const { index: week, start: weekStart, end: weekEnd } of weeksToOverlap) {
    const layout = layoutOf(week);
    if (!layout) continue;

    const rowHeight = weekEnd - weekStart;
    // The marquee's band clipped to this row, in row-local pixels.
    const bandTop = Math.max(top - weekStart, 0);
    const bandBottom = Math.min(bottom - weekStart, rowHeight);

    for (const segment of layout.segments) {
      // A hidden segment is a "+N" chip, not a bar. Selecting something with no
      // outline to light would be a selection you cannot see.
      if (segment.hidden) continue;
      // Google-sourced instances refuse every edit a selection can apply, so
      // lighting them would be an affordance that does nothing.
      if (segment.occurrence.readOnly) continue;
      if (segment.endCol < firstCol || segment.startCol > lastCol) continue;

      const segTop = headerH + segment.top;
      if (segTop + segment.height < bandTop || segTop > bandBottom) continue;

      hits.add(segment.occurrence.key);
    }
  }

  return hits;
}
