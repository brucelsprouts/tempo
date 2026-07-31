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
import type { Occurrence } from './types';

export const DAYS_PER_WEEK = 7;

export interface WeekSegment {
  occurrence: Occurrence;
  /** 0-6, inclusive, within this week row. */
  startCol: number;
  endCol: number;
  lane: number;
  /** The bar is clipped: it began in an earlier week / ends in a later one. */
  continuesBefore: boolean;
  continuesAfter: boolean;
  /** Beyond `maxLanes`; rolled into the day's "+N" counter instead of drawn. */
  hidden: boolean;
}

export interface WeekLayout {
  weekStart: CivilDate;
  weekEnd: CivilDate;
  days: CivilDate[];
  segments: WeekSegment[];
  /** Lanes actually drawn, after the overflow cutoff. Drives row height. */
  laneCount: number;
  /** Per column, how many occurrences were suppressed. */
  overflow: number[];
}

export function weekDays(weekStart: CivilDate): CivilDate[] {
  return Array.from({ length: DAYS_PER_WEEK }, (_, i) => addDays(weekStart, i));
}

/**
 * Assigns lanes for one week row.
 *
 * `maxLanes` caps the drawn stack so a single busy week can't blow the row
 * height out and wreck the scroll rhythm; the remainder becomes a "+N" chip.
 */
export function layoutWeek(
  weekStart: CivilDate,
  occurrences: Occurrence[],
  maxLanes = 4,
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
  const segments: WeekSegment[] = [];
  const overflow = new Array<number>(DAYS_PER_WEEK).fill(0);

  for (const c of clipped) {
    let lane = laneEnds.findIndex((end) => end < c.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(c.endCol);
    } else {
      laneEnds[lane] = c.endCol;
    }

    const hidden = lane >= maxLanes;
    if (hidden) {
      for (let col = c.startCol; col <= c.endCol; col++) overflow[col] += 1;
    }
    segments.push({ ...c, lane, hidden });
  }

  const laneCount = Math.min(
    maxLanes,
    segments.reduce((n, s) => Math.max(n, s.lane + 1), 0),
  );

  return { weekStart, weekEnd, days, segments, laneCount, overflow };
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
