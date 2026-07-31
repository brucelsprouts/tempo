/**
 * The epoch is a large fixed range rather than true unbounded infinity.
 *
 * Genuinely infinite bidirectional scroll means prepending rows, which yanks
 * the scroll position and needs anchoring compensation to hide. Fifteen years
 * of week rows costs nothing to virtualise and removes that entire class of
 * bug, and every row is the same height — so scroll offset maps linearly onto
 * dates, which is what makes the ruler on the left exact rather than
 * approximate.
 */

export const WEEKS_BEFORE = 5 * 52;
export const WEEKS_AFTER = 10 * 52;
export const WEEK_COUNT = WEEKS_BEFORE + WEEKS_AFTER;

export const ROW_H = 132;

/**
 * Known statically, because every row is the same height. The scroll container
 * is sized from this rather than from the virtualiser's measured total: on the
 * very first paint the measurement is still 0, and assigning a scrollTop to a
 * zero-height element silently clamps to 0 — which lands the app on the wrong
 * date instead of today.
 */
export const TOTAL_H = WEEK_COUNT * ROW_H;
export const TODAY_OFFSET = WEEKS_BEFORE * ROW_H;
/**
 * 30 rather than 26. At 26 the day number sat hard against the cell's top
 * hairline, which reads as a clipping artefact rather than as a header — the
 * one number every cell always shows was the worst-set text on screen.
 *
 * The extra 4px is taken from the row's unused slack: nothing has ever been
 * drawn below the last lane. All four lanes still fit, 4px lower.
 */
export const DAY_HEADER_H = 30;
export const LANE_H = 21;
export const LANE_GAP = 3;
export const MAX_LANES = 4;

export const GUTTER_W = 58;

/**
 * The epoch expressed in years, and the one place that answers "which years
 * exist".
 *
 * Derived from the week counts above rather than restated, because it was
 * restated: the year view and the date picker each grew their own copy of the
 * same 5-and-10, and a third would have arrived with the next surface that
 * needed a year list. Widening `WEEKS_BEFORE` now widens all of them at once
 * instead of leaving two of the three quietly disagreeing.
 */
export const EPOCH_YEARS_BEFORE = Math.round(WEEKS_BEFORE / 52);
export const EPOCH_YEARS_AFTER = Math.round(WEEKS_AFTER / 52);

/**
 * Every reachable year. `include` is folded in when it falls outside — a stored
 * date can predate the epoch, and a select that cannot show its own value shows
 * the wrong one instead.
 */
export function epochYears(thisYear: number, include?: number): number[] {
  const years = Array.from(
    { length: EPOCH_YEARS_BEFORE + EPOCH_YEARS_AFTER + 1 },
    (_, i) => thisYear - EPOCH_YEARS_BEFORE + i,
  );
  if (include == null || years.includes(include)) return years;
  return [...years, include].sort((a, b) => a - b);
}

export const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

export const MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
] as const;

export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/**
 * Category colours are the only hue in the interface, so they are muted enough
 * to sit on near-black without vibrating, and distinct enough to tell apart at
 * 2px wide.
 */
export const CATEGORY_PALETTE = [
  '#b8705c', // rust
  '#7d9a6d', // sage
  '#6d8bb0', // steel
  '#a8936d', // sand
  '#8f6da8', // plum
  '#5aa39a', // teal
  '#b06d8b', // rose
  '#8a9096', // graphite
] as const;

export const DEFAULT_CATEGORY_COLOR = '#8a9096';

export function laneTop(lane: number): number {
  return DAY_HEADER_H + lane * (LANE_H + LANE_GAP);
}
