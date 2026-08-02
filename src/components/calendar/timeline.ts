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
