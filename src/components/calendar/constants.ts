import { civilInZone, minutesInZone, type CivilDate } from '@/lib/tempo/civil';
import type { EventKind, EventStatus, TempoEvent } from '@/lib/tempo/types';

/**
 * The epoch is a large fixed range rather than true unbounded infinity.
 *
 * Genuinely infinite bidirectional scroll means prepending rows, which yanks
 * the scroll position and needs anchoring compensation to hide. A fixed range
 * of week rows costs nothing to virtualise and removes that entire class of
 * bug.
 *
 * Rows are not all one height, so scroll offset does not map linearly onto
 * dates. Each is `MIN_ROW_H` at least and grows to fit its entries, and the
 * virtualiser measures it once it has been drawn. `TODAY_OFFSET` still lands
 * exactly, because every row above today is an unmeasured estimate on first
 * paint (see `MIN_ROW_H`). Anything that has to be exact about a row that has
 * been drawn reads the virtualiser's measurements instead (see `rowsInBand`).
 * The month labels in the gutter need neither: each row draws its own.
 *
 * It was fifteen years, which was small enough that you could reach the end of
 * it by accident and have to think about where the calendar stops. A century
 * forward is far enough that the question stops coming up, and it is close to
 * free: the virtualiser mounts the eight rows on screen no matter how many
 * exist, and the whole epoch at `MIN_ROW_H` comes to around 10^6 px against a
 * browser ceiling near 3×10^7. Growth does not close that gap, because only the
 * rows you have actually drawn are measured taller. Thirty years back covers
 * anything worth scrolling to; a birth date from 1940 is an anchor, which is a
 * reference rather than a destination, and the date picker reaches further back
 * for exactly that reason.
 */

export const WEEKS_BEFORE = 30 * 52;
export const WEEKS_AFTER = 100 * 52;
export const WEEK_COUNT = WEEKS_BEFORE + WEEKS_AFTER;

/**
 * The least a week row is: 190px, up from 146 when bars first grew.
 *
 * A floor, not a fixed height. Rows grow to fit their entries and the
 * virtualiser measures each one; this is what a quiet week is, what an
 * unmeasured row is assumed to be, and what `TODAY_OFFSET` is counted in —
 * every row above today is unmeasured on first paint, so that arithmetic still
 * lands exactly. Anything that has to be exact about a row that *has* been
 * drawn asks the virtualiser's measurements instead (see `rowsInBand`).
 */
export const MIN_ROW_H = 190;
export const ROW_H = MIN_ROW_H;

/**
 * Space left under the lowest bar of a row that has grown to fit.
 *
 * A row sized exactly to its content put the last entry flush on the rule
 * below it, so a busy day read as running into the next week. A quiet row is at
 * `MIN_ROW_H` already and never reaches this.
 */
export const ROW_PAD_B = 8;

export const TODAY_OFFSET = WEEKS_BEFORE * MIN_ROW_H;
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
 * What a quiet week has for bars: `MIN_ROW_H` less the day header.
 *
 * Once a pixel budget — the stack a row would draw before a "+N" took over —
 * and the arithmetic it was chosen against (four 28px events, three 42px tasks)
 * went when bars doubled. Rows grow to fit their entries, so this is a floor
 * rather than a cap: the least room a row's bars have, and the room a move
 * preview is kept inside while rows cannot grow under the pointer (see
 * `WeekRow`'s drafts).
 */
export const LANE_BUDGET = MIN_ROW_H - DAY_HEADER_H;

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

/**
 * What an entry saved without a title is called.
 *
 * Shared rather than written twice, because it is shown before it is stored:
 * the draft bar on the grid says it in `text-mute` while the title field is
 * still empty, and the form commits it verbatim if you click away without
 * filling one in. Two spellings would mean the placeholder renamed itself the
 * moment it became real.
 */
export const UNTITLED = 'UNTITLED';

/**
 * Whether the thing pointing at the app is a finger.
 *
 * Asked at the moment of the gesture rather than subscribed to, which is what
 * keeps it free: the grid draws dozens of day cells per screen, and a
 * `matchMedia` listener per cell would be dozens of subscriptions to answer a
 * question only a tap ever asks. Reading it live also means an iPad that has
 * just had a trackpad attached gets the right answer on the next tap instead of
 * on the next mount.
 *
 * Everything that can be settled in CSS is — `.tap`, `.hover-only` and the
 * selection lock are all media queries. This exists for the cases where the
 * *behaviour* differs rather than the styling, and a media query cannot rebind a
 * handler.
 */
export function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
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
 * to sit on near-black without vibrating. They are read as a 50% fill and as a
 * solid chip (see `tint.ts`), and `tint.test.ts` holds each to 4.5:1 in both.
 *
 * Ochre and petrol were added by search rather than by eye: within the first
 * eight's band of lightness and chroma, the two hues farthest from all of them
 * as fills — each farther from its nearest neighbour than steel is from
 * graphite, the palette's closest pair. The first eight are unchanged: every
 * category stores its colour as hex, so retuning one would rewrite user rows.
 * Graphite stays last, the neutral, and is what an uncategorised edge uses.
 */
export const CATEGORY_PALETTE = [
  '#b8705c', // rust
  '#7d9a6d', // sage
  '#6d8bb0', // steel
  '#a8936d', // sand
  '#8f6da8', // plum
  '#5aa39a', // teal
  '#b06d8b', // rose
  '#947a30', // ochre
  '#128e99', // petrol
  '#8a9096', // graphite
] as const;

export const DEFAULT_CATEGORY_COLOR = '#8a9096';

/**
 * The mark a bar wears, outside the grid.
 *
 * Shared rather than local to one panel: the history surface and the deleted
 * list draw entries that are not on the calendar, and an entry that looked like
 * one thing on the grid and another in a list would be two entries as far as
 * anyone reading is concerned. A task is drawn by its status everywhere, so a
 * done one must not come back as an empty box without anyone unticking it.
 */
export function glyphFor(e: Pick<TempoEvent, 'kind' | 'status'>): string {
  if (e.kind === 'assignment') return e.status ? STATUS_GLYPH[e.status] : '[ ]';
  return KIND_GLYPH[e.kind];
}

export const STATUS_GLYPH: Record<EventStatus, string> = {
  todo: '[ ]',
  doing: '[~]',
  done: '[x]',
};

export const KIND_GLYPH: Record<EventKind, string> = {
  event: '·',
  assignment: '[ ]',
  birthday: '✳',
  milestone: '◆',
};

/**
 * The 24-hour column's scale, and the thresholds that depend on it.
 *
 * Here rather than in `DayView` because three separate decisions read the same
 * number and have to agree about it: how tall an hour row is, whether a
 * half-hour rule is distinguishable, and whether there is room to label every
 * hour. Two of those living inline is how they drift.
 */
export const HOUR_H_DEFAULT = 44;
/** Below this an hour row is thinner than the text in it. */
export const HOUR_H_MIN = 8;
/** Above this a single event needs scrolling to read, which defeats the column. */
export const HOUR_H_MAX = 120;
/** One click of + or -. */
export const ZOOM_STEP = 6;
/** Half-hour rules appear at or above this; below it they are noise. */
export const HALF_HOUR_FLOOR = 34;
/** Every hour is labelled at or above this; below it, every third. */
export const HOUR_LABEL_FLOOR = 26;

/**
 * When something happened, as a clock reading rather than an age.
 *
 * "4M AGO" would be the friendlier phrasing and is the wrong one here: it is
 * only true at the instant it renders, so it needs either a ticking timer or a
 * clock read during render, and both are a lot of machinery for a line nobody
 * reads twice. A time is still true five minutes later. 24-hour and zero-padded,
 * the same as every other time in the app, in the zone the calendar is set to.
 */
export function clock(at: string | number, timezone: string): string {
  const minutes = minutesInZone(new Date(at), timezone);
  const h = Math.floor(minutes / 60);
  return `${String(h).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * The same instant, with the date said out loud.
 *
 * The trash spans thirty days, so a bare clock reading in it is ambiguous by
 * design — 09:14 on which of them? Anything older than today gets its date.
 */
export function stamp(at: string, timezone: string, today: CivilDate): string {
  const day = civilInZone(new Date(at), timezone);
  return day === today ? clock(at, timezone) : `${day} ${clock(at, timezone)}`;
}

