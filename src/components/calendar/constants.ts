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
export const DAY_HEADER_H = 26;
export const LANE_H = 21;
export const LANE_GAP = 3;
export const MAX_LANES = 4;

export const GUTTER_W = 58;

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
