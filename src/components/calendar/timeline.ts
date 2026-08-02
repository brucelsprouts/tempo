import type { CivilDate } from '@/lib/tempo/civil';
import type { Occurrence } from '@/lib/tempo/types';
import {
  HALF_HOUR_FLOOR,
  HOUR_H_MAX,
  HOUR_H_MIN,
  HOUR_LABEL_FLOOR,
  ZOOM_STEP,
} from './constants';

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
