/**
 * Civil dates — calendar dates with no timezone, no instant, and no DST.
 *
 * A birthday is not a moment in time; it is a square on a grid. Representing
 * all-day data as `Date`/`timestamptz` is the single most common calendar bug:
 * the value silently shifts a day when the viewer moves timezone, or when a DST
 * boundary lands on midnight. So all-day data never becomes a local `Date` here.
 *
 * Everything is a `YYYY-MM-DD` string. Arithmetic goes through epoch-day
 * integers via UTC-anchored `Date` objects, which are used purely as a calendar
 * calculator and never rendered.
 */

export type CivilDate = string; // 'YYYY-MM-DD'

const MS_PER_DAY = 86_400_000;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

export function civil(year: number, month: number, day: number): CivilDate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function parts(d: CivilDate): { year: number; month: number; day: number } {
  return {
    year: Number(d.slice(0, 4)),
    month: Number(d.slice(5, 7)),
    day: Number(d.slice(8, 10)),
  };
}

const CIVIL_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isCivilDate(v: unknown): v is CivilDate {
  if (typeof v !== 'string' || !CIVIL_RE.test(v)) return false;
  // reject 2026-02-31 and friends: round-tripping normalises, so a mismatch means invalid
  return fromEpochDay(toEpochDay(v)) === v;
}

/**
 * UTC-anchored Date. For arithmetic only — never render this in local time.
 * Built via setUTCFullYear rather than Date.UTC so years < 100 aren't
 * remapped into the 1900s.
 */
export function toUTCDate(d: CivilDate): Date {
  const { year, month, day } = parts(d);
  const dt = new Date(0);
  dt.setUTCFullYear(year, month - 1, day);
  dt.setUTCHours(0, 0, 0, 0);
  return dt;
}

export function fromUTCDate(dt: Date): CivilDate {
  return civil(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function toEpochDay(d: CivilDate): number {
  return Math.round(toUTCDate(d).getTime() / MS_PER_DAY);
}

export function fromEpochDay(n: number): CivilDate {
  return fromUTCDate(new Date(n * MS_PER_DAY));
}

export function addDays(d: CivilDate, n: number): CivilDate {
  return fromEpochDay(toEpochDay(d) + n);
}

/** Signed day count, `a - b`. */
export function diffDays(a: CivilDate, b: CivilDate): number {
  return toEpochDay(a) - toEpochDay(b);
}

/** ISO date strings sort lexicographically, so this is also a valid comparator. */
export function compareDates(a: CivilDate, b: CivilDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const minDate = (a: CivilDate, b: CivilDate) => (a <= b ? a : b);
export const maxDate = (a: CivilDate, b: CivilDate) => (a >= b ? a : b);

/** True when `d` falls inside [start, end], both inclusive. */
export function withinInclusive(d: CivilDate, start: CivilDate, end: CivilDate): boolean {
  return d >= start && d <= end;
}

/** True when [aStart, aEnd] and [bStart, bEnd] share at least one day. */
export function rangesOverlap(
  aStart: CivilDate,
  aEnd: CivilDate,
  bStart: CivilDate,
  bEnd: CivilDate,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** `month` is 1-indexed. */
export function daysInMonth(year: number, month: number): number {
  const dt = new Date(0);
  // day 0 of the following month === last day of this one
  dt.setUTCFullYear(year, month, 0);
  return dt.getUTCDate();
}

/**
 * Clamps to the end of the target month: 2026-01-31 + 1 month → 2026-02-28.
 * Recurrence rules that need RFC 5545's *skip* semantics instead must check
 * the resulting day-of-month themselves; see `recurrence.ts`.
 */
export function addMonths(d: CivilDate, n: number): CivilDate {
  const { year, month, day } = parts(d);
  const total = year * 12 + (month - 1) + n;
  const y = Math.floor(total / 12);
  const m = (((total % 12) + 12) % 12) + 1;
  return civil(y, m, Math.min(day, daysInMonth(y, m)));
}

export function addYears(d: CivilDate, n: number): CivilDate {
  return addMonths(d, n * 12);
}

/**
 * The same day of the same year, in a month you named. Stays within the year: this
 * answers a month picker, and a picker that reads `MAR` while showing you next March
 * is lying about one of the two.
 *
 * Expressed as a step rather than as `civil(year, month, day)` so that it inherits
 * `addMonths`'s clamp — a cursor on the 31st asked for February has to land on the
 * 28th, the same as it does when the month steppers walk it there.
 */
export function setMonth(d: CivilDate, month: number): CivilDate {
  return addMonths(d, month - parts(d).month);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(d: CivilDate): number {
  return toUTCDate(d).getUTCDay();
}

export function startOfWeek(d: CivilDate, weekStartsOn = 0): CivilDate {
  const delta = (dayOfWeek(d) - weekStartsOn + 7) % 7;
  return addDays(d, -delta);
}

export function startOfMonth(d: CivilDate): CivilDate {
  const { year, month } = parts(d);
  return civil(year, month, 1);
}

export function isFirstOfMonth(d: CivilDate): boolean {
  return parts(d).day === 1;
}

/** ISO-8601 week number: weeks start Monday, week 1 contains the first Thursday. */
export function isoWeek(d: CivilDate): number {
  const date = toUTCDate(d);
  const dayFromMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayFromMonday + 3); // the Thursday of this week
  const thursday = date.getTime();
  const jan4 = toUTCDate(civil(date.getUTCFullYear(), 1, 4));
  const jan4FromMonday = (jan4.getUTCDay() + 6) % 7;
  jan4.setUTCDate(jan4.getUTCDate() - jan4FromMonday + 3);
  return 1 + Math.round((thursday - jan4.getTime()) / (7 * 86_400_000));
}

/** Whole years elapsed from `from` to `to`; negative if `to` precedes `from`. */
export function yearsBetween(from: CivilDate, to: CivilDate): number {
  const a = parts(from);
  const b = parts(to);
  let years = b.year - a.year;
  if (b.month < a.month || (b.month === a.month && b.day < a.day)) years -= 1;
  return years;
}

// ---------------------------------------------------------------- timezones
// The only two places an instant and a civil date are allowed to meet.

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = zoneFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    zoneFormatters.set(timeZone, fmt);
  }
  return fmt;
}

/** Which calendar square an instant lands on, as seen from `timeZone`. */
export function civilInZone(instant: Date, timeZone: string): CivilDate {
  const f = zoneFormatter(timeZone).formatToParts(instant);
  const get = (t: string) => f.find((p) => p.type === t)!.value;
  return civil(Number(get('year')), Number(get('month')), Number(get('day')));
}

/** Minutes past midnight for an instant, as seen from `timeZone`. */
export function minutesInZone(instant: Date, timeZone: string): number {
  const f = zoneFormatter(timeZone).formatToParts(instant);
  const get = (t: string) => f.find((p) => p.type === t)!.value;
  // Intl renders midnight as hour 24 in some locales under hour12: false
  const hour = Number(get('hour')) % 24;
  return hour * 60 + Number(get('minute'));
}

export function todayIn(timeZone: string): CivilDate {
  return civilInZone(new Date(), timeZone);
}

function utcMs(year: number, month: number, day: number, hour = 0, minute = 0): number {
  const dt = new Date(0);
  dt.setUTCFullYear(year, month - 1, day);
  dt.setUTCHours(hour, minute, 0, 0);
  return dt.getTime();
}

/** How far `timeZone` sits from UTC at a given instant, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const f = zoneFormatter(timeZone).formatToParts(instant);
  const get = (t: string) => Number(f.find((p) => p.type === t)!.value);
  const wall = utcMs(get('year'), get('month'), get('day'), get('hour') % 24, get('minute'));
  return wall - instant.getTime();
}

/**
 * The inverse of `civilInZone` — the instant at which a given wall-clock time
 * occurs in a zone. Needed whenever a timed event is created or dragged: adding
 * 86400000ms to move something "one day later" silently shifts it an hour
 * across a DST boundary, whereas a 09:00 standup must stay at 09:00.
 *
 * Solved by iteration rather than a table: guess, measure the zone's actual
 * offset at that guess, correct. Twice, because the first correction can itself
 * land on the far side of a transition.
 */
export function instantFromCivil(
  date: CivilDate,
  minutes: number,
  timeZone: string,
): Date {
  const { year, month, day } = parts(date);
  const wall = utcMs(year, month, day, Math.floor(minutes / 60), minutes % 60);
  let ts = wall;
  for (let i = 0; i < 2; i++) {
    ts = wall - zoneOffsetMs(new Date(ts), timeZone);
  }
  return new Date(ts);
}
