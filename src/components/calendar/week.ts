import { addDays, diffDays, startOfWeek, type CivilDate } from '@/lib/tempo/civil';

/**
 * The seven dates of the week containing `date`, Sunday first.
 *
 * Sunday-first to match the continuous grid, which is the calendar this view
 * sits beside — a week view that started on Monday would put the same seven
 * days in different columns from the rows above it.
 *
 * Separated from `WeekView` for the reason `timeline.ts` is separated from
 * `DayView`: none of it is about React and all of it is about dates, and a
 * month or year boundary is exactly the kind of thing worth a test rather than
 * a glance.
 */
export function weekDays(date: CivilDate): CivilDate[] {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/**
 * The same weekday `weeks` weeks away, normalised to the start of that week.
 *
 * Normalised so stepping is idempotent: paging forward and back from a Tuesday
 * returns the Sunday its week opens on, not the Tuesday, and every subsequent
 * step lands on a week boundary rather than drifting.
 */
export function shiftWeek(date: CivilDate, weeks: number): CivilDate {
  return addDays(startOfWeek(date), weeks * 7);
}

/**
 * The minimum an entry has to be for the all-day strip to place it: a stable
 * identity and the inclusive dates it covers. Structural rather than
 * `Occurrence` so the tests can state a band as the three facts that decide it.
 */
export interface Spanning {
  key: string;
  date: CivilDate;
  endDate: CivilDate;
}

/** One all-day entry's footprint in the strip, clipped to the week on screen. */
export interface AllDayBand<T extends Spanning> {
  occ: T;
  /** 0-6 within the week, inclusive. */
  startCol: number;
  endCol: number;
  /** Which row of the strip. Rows never collide within a column. */
  lane: number;
  /** The entry began before this week / runs past it, so the bar is cut. */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/**
 * Places all-day entries as bands spanning the days they cover.
 *
 * The strip used to be seven independent lists, each day drawing whatever
 * covered it — so a conference running Monday to Wednesday appeared as three
 * separate chips, in whatever row each day's list happened to put it, reading
 * as three unrelated entries rather than one three-day thing. A band is one
 * element per entry, in one lane across the whole week, which is what the
 * continuous grid's rows have always done and the reason they read correctly.
 *
 * Lane assignment is the same greedy lowest-available as `layoutWeek`, sorted
 * longest-first so the multi-day spine settles at the top and single days fill
 * in beneath it. Occupancy is tracked per column, not per lane as a whole, so a
 * lane's free Thursday is still available to an entry that starts there.
 */
export function allDayBands<T extends Spanning>(
  occurrences: readonly T[],
  days: readonly CivilDate[],
): AllDayBand<T>[] {
  const weekStart = days[0];
  const weekEnd = days[days.length - 1];

  const clipped = occurrences
    .filter((occ) => occ.date <= weekEnd && occ.endDate >= weekStart)
    .map((occ) => ({
      occ,
      startCol: Math.max(0, diffDays(occ.date, weekStart)),
      endCol: Math.min(days.length - 1, diffDays(occ.endDate, weekStart)),
      continuesBefore: occ.date < weekStart,
      continuesAfter: occ.endDate > weekEnd,
    }))
    .sort((a, b) => {
      const span = b.endCol - b.startCol - (a.endCol - a.startCol);
      if (span !== 0) return span; // longest bands claim lanes first
      if (a.startCol !== b.startCol) return a.startCol - b.startCol;
      // A stable tiebreak, so lanes don't shuffle between renders.
      return a.occ.key < b.occ.key ? -1 : a.occ.key > b.occ.key ? 1 : 0;
    });

  const lanes: boolean[][] = [];
  return clipped.map((band) => {
    let lane = lanes.findIndex((cols) => {
      for (let col = band.startCol; col <= band.endCol; col++) if (cols[col]) return false;
      return true;
    });
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(new Array<boolean>(days.length).fill(false));
    }
    for (let col = band.startCol; col <= band.endCol; col++) lanes[lane][col] = true;
    return { ...band, lane };
  });
}
