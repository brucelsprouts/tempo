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
 */
export const KIND_HEIGHT: Record<EventKind, number> = {
  milestone: 14,
  event: 21,
  birthday: 27,
  assignment: 32,
};

export const LANE_GAP = 3;

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
}

/**
 * Default pixel budget for the lane area, in case a caller doesn't state one.
 * `constants.ts` derives the real figure from `ROW_H` and passes it in, the way
 * it used to pass `maxLanes`.
 */
export const DEFAULT_LANE_BUDGET = 103;

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
  const laneEnds: number[] = [];
  const assigned: Array<(typeof clipped)[number] & { lane: number }> = [];

  for (const c of clipped) {
    let lane = laneEnds.findIndex((end) => end < c.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(c.endCol);
    } else {
      laneEnds[lane] = c.endCol;
    }
    assigned.push({ ...c, lane });
  }

  /**
   * Lane geometry, resolved after assignment rather than during it.
   *
   * A lane is as tall as the tallest thing in it, and each lane starts below
   * the one above — so the offsets can only be known once every bar has a lane.
   * Measured from the top of the *lane area*, not of the row: `WeekRow` adds
   * `DAY_HEADER_H` once when it positions the overlay, so the header appears in
   * exactly one place and cannot be double-counted against the budget.
   */
  const laneHeights: number[] = [];
  for (const a of assigned) {
    const h = KIND_HEIGHT[a.occurrence.kind];
    laneHeights[a.lane] = Math.max(laneHeights[a.lane] ?? 0, h);
  }

  const laneTops: number[] = [];
  let cursor = 0;
  for (let i = 0; i < laneHeights.length; i++) {
    laneTops[i] = cursor;
    cursor += laneHeights[i] + LANE_GAP;
  }

  const segments: WeekSegment[] = [];
  const overflow = new Array<number>(DAYS_PER_WEEK).fill(0);
  let laneCount = 0;

  for (const a of assigned) {
    // Cut on the lane's full extent, not the bar's. A 21px event sharing a lane
    // with a 32px task would otherwise be drawn in a row that has already run
    // out of budget, overlapping the "+N" chip below it.
    const hidden = laneTops[a.lane] + laneHeights[a.lane] > budget;
    if (hidden) {
      for (let col = a.startCol; col <= a.endCol; col++) overflow[col] += 1;
    } else {
      laneCount = Math.max(laneCount, a.lane + 1);
    }

    segments.push({
      ...a,
      hidden,
      top: laneTops[a.lane],
      // Its own height, not its lane's: an event beside a task stays 21px and
      // top-aligns, rather than being stretched to look like something it isn't.
      height: KIND_HEIGHT[a.occurrence.kind],
    });
  }

  return { weekStart, weekEnd, days, segments, laneCount, laneHeights, laneTops, overflow };
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
