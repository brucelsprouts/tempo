/**
 * The epoch is a large fixed range rather than true unbounded infinity.
 *
 * Genuinely infinite bidirectional scroll means prepending rows, which yanks
 * the scroll position and needs anchoring compensation to hide. A fixed range
 * of week rows costs nothing to virtualise and removes that entire class of
 * bug, and every row is the same height — so scroll offset maps linearly onto
 * dates, which is what makes the ruler on the left exact rather than
 * approximate.
 *
 * It was fifteen years, which was small enough that you could reach the end of
 * it by accident and have to think about where the calendar stops. A century
 * forward is far enough that the question stops coming up, and it is close to
 * free: the virtualiser mounts the eight rows on screen no matter how many
 * exist, and `TOTAL_H` lands around 10^6 px against a browser ceiling near
 * 3×10^7. Thirty years back covers anything worth scrolling to; a birth date
 * from 1940 is an anchor, which is a reference rather than a destination, and
 * the date picker reaches further back for exactly that reason.
 */

export const WEEKS_BEFORE = 30 * 52;
export const WEEKS_AFTER = 100 * 52;
export const WEEK_COUNT = WEEKS_BEFORE + WEEKS_AFTER;

/**
 * 190, up from 146.
 *
 * A 21px bar carrying an 11px title was readable when you looked straight at it
 * and invisible when you were scanning, which is the whole of "things get lost
 * and I feel a little blind". Every bar in `KIND_HEIGHT` grew about 35% and the
 * row grew 30% to hold the same stack, so the density is *held* rather than
 * improved — four events still fit, three tasks still fit — and what changed is
 * that the bars you can see are legible at a glance. It costs about one row per
 * screen: roughly five in a 720px window where six used to fit.
 *
 * It stays a compile-time constant, which is the invariant the whole scroll
 * architecture rests on: `TOTAL_H` is known before first paint, jumping to a
 * date is arithmetic rather than a measured scroll, the lasso's hit test
 * divides by it, and the entry modal's cut scrim can locate a week row without
 * finding it in the DOM.
 */
export const ROW_H = 190;

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
 * 34 rather than 30. The day number went to 12px and the strip was still sized
 * for the 11px it used to be, so the one number every cell always shows was
 * again sitting closer to its hairline than anything else on screen.
 *
 * It also has to keep pace with the bars below it. A header that stayed at 30
 * under a 28px event would read as the smaller of the two things in the cell,
 * and the number is what you navigate by.
 */
export const DAY_HEADER_H = 34;
/**
 * Room for the "+N" chip at the foot of a cell: 10px of text sitting 4px off
 * the bottom edge, with a pixel of slack. At 13 the chip's own box was flush
 * with the last lane's budget line.
 */
export const OVERFLOW_H = 15;

/**
 * What a row will spend on bars, in pixels rather than in lanes.
 *
 * Four events still fit: lanes at 0, 32, 64, 96, last bottom at 124. Three
 * tasks fit: 0, 46, 92, last bottom at 134. A day with two tasks and two events
 * still draws three and a "+1" — the fourth lane would end at 152. Those are
 * the same three cases the old 103px budget was chosen against and they resolve
 * the same way: the row and everything in it grew together, so the week that
 * overflowed before overflows now. Trading lanes away for size would have been
 * a different decision. That day stays fully readable in the day modal's task
 * pane, and the "+1" chip is the link to it.
 */
export const LANE_BUDGET = ROW_H - DAY_HEADER_H - OVERFLOW_H;

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
  return yearsFrom(thisYear - EPOCH_YEARS_BEFORE, thisYear + EPOCH_YEARS_AFTER, include);
}

/**
 * The earliest year a date field will offer.
 *
 * The date picker reaches further back than the grid does because it is asked
 * different questions. An anchor date is a birth date or a wedding date — a
 * fact about the past, not a row you intend to scroll to — so bounding it by
 * how far the grid can scroll would make the calendar unable to state how old
 * anyone is.
 */
export const PICKER_YEAR_FLOOR = 1900;

export function pickerYears(thisYear: number, include?: number): number[] {
  return yearsFrom(PICKER_YEAR_FLOOR, thisYear + EPOCH_YEARS_AFTER, include);
}

function yearsFrom(first: number, last: number, include?: number): number[] {
  const years = Array.from({ length: last - first + 1 }, (_, i) => first + i);
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

