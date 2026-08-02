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
