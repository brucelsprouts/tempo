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
 * 146, up from 132.
 *
 * Bars are no longer a uniform 21px — see `KIND_HEIGHT` in `layout.ts` — so the
 * row has to hold a taller stack to keep drawing four of them. It stays a
 * compile-time constant, which is the invariant the whole scroll architecture
 * rests on: `TOTAL_H` is known before first paint, jumping to a date is
 * arithmetic rather than a measured scroll, and the entry modal's cut scrim can
 * locate a week row without finding it in the DOM.
 */
export const ROW_H = 146;

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
/** Room for the "+N" chip at the foot of a cell. */
export const OVERFLOW_H = 13;

/**
 * What a row will spend on bars, in pixels rather than in lanes.
 *
 * Four events still fit: lanes at 0, 24, 48, 72, last bottom at 93. Three tasks
 * fit: 0, 35, 70, last bottom at 102. A day with two tasks and two events draws
 * three and a "+1" — the fourth lane would start at 94 and end at 115. That day
 * stays fully readable in the day modal's task pane, and the "+1" chip is the
 * link to it.
 */
export const LANE_BUDGET = ROW_H - DAY_HEADER_H - OVERFLOW_H;

export const GUTTER_W = 58;

/**
 * A gutter on the right edge of the grid, so the Saturday column stops butting
 * the window. Scrollbars are hidden, so without it there is no margin at all on
 * that side and the last bar's resize handle lives in the final six pixels of
 * the screen.
 *
 * Applied as a **margin** on the two boxes that have to stay the same width —
 * the weekday header's column grid and each week row's column box — never as
 * padding. `colWidth` is measured from the header grid's own `contentRect` and
 * bars are positioned in percentages of the row's column box; padding would
 * shrink the inside of one box and not the other, putting every bar 8px out of
 * step with the column it belongs to. A margin shrinks both identically.
 */
export const GRID_PAD_R = 8;

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

