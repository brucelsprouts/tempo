import { civil, isCivilDate, parts, type CivilDate } from '@/lib/tempo/civil';
import { formatMinutes } from './TimePicker';

/**
 * When an entry happens, as one value.
 *
 * `EventForm` used to hold these five as five `useState`s, with the rule that an end
 * never precedes its start spread across four `onChange` handlers and a fifth copy in
 * `save`. Every one of them was correct in isolation and none of them could be tested
 * without rendering a form. They are one object and one function now, so `WhenField`
 * can hand back any combination its controls can produce — including the impossible
 * ones — and get something storable back.
 *
 * Nothing here is a `Date`. Dates are civil strings and times are minutes from
 * midnight, which is what the store, the expander and the bars already speak — see
 * DESIGN.md §3 for why an all-day value that becomes a `Date` is a bug waiting for a
 * timezone change.
 */

export interface WhenValue {
  startDate: CivilDate;
  endDate: CivilDate;
  allDay: boolean;
  /** Minutes from midnight. Retained while `allDay`, so toggling it back is free. */
  startMinutes: number;
  endMinutes: number;
}

/** The last minute a day holds, and the ceiling on a nudged end time. */
export const LAST_MINUTE = 23 * 60 + 59;

/**
 * The one invariant: an end never precedes its start.
 *
 * It is always the *end* that moves, never the start. Pulling the start backwards to
 * accommodate an end would silently rewrite the field you were not editing, and the
 * end is the one whose meaning survives being clamped — "at least as long as zero" is
 * a sentence, "starts earlier than you said" is not.
 *
 * The time only has to obey this when the two dates agree. An entry running Friday
 * 22:00 → Saturday 02:00 is ordinary, which is why the floor cannot simply be "always
 * the start time".
 */
export function normalizeWhen(v: WhenValue): WhenValue {
  const endDate = v.endDate < v.startDate ? v.startDate : v.endDate;
  const sameDay = endDate === v.startDate;

  return {
    ...v,
    endDate,
    endMinutes: sameDay && v.endMinutes < v.startMinutes ? v.startMinutes : v.endMinutes,
  };
}

/**
 * What the closed field reads as.
 *
 * Four shapes, and the arrow is doing the work: `→` crosses a date boundary and `–`
 * does not, so "two days" and "two hours on one day" are distinguishable at a glance
 * without the second date being printed twice.
 *
 * `hasEnd` mirrors the END DATE toggle in the form. When it is off and the event is
 * timed, only the start time is shown — an event without an explicit end is a point
 * in time, not a span.
 */
export function formatWhen(v: WhenValue, hasEnd = true): string {
  const spans = v.endDate !== v.startDate;

  if (v.allDay) return spans ? `${v.startDate} → ${v.endDate}` : v.startDate;

  const from = formatMinutes(v.startMinutes);
  if (!hasEnd && !spans) return `${v.startDate} ${from}`;

  const to = formatMinutes(v.endMinutes);
  return spans ? `${v.startDate} ${from} → ${v.endDate} ${to}` : `${v.startDate} ${from} – ${to}`;
}

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** Three letters is enough to name a month unambiguously, and is how they are typed. */
function monthFrom(word: string): number | null {
  if (word.length < 3) return null;
  const i = MONTH_NAMES.findIndex((n) => n.startsWith(word));
  return i === -1 ? null : i + 1;
}

/**
 * Rejects 2026-02-31 and friends. `civil` will happily format any three numbers, and
 * the round-trip through the epoch normalises — so a value that comes back different
 * from what went in was never a date.
 */
function build(y: number, m: number, d: number): CivilDate | null {
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const c = civil(y, m, d);
  return isCivilDate(c) ? c : null;
}

/**
 * What the date fields will accept from a keyboard.
 *
 * `YYYY-MM-DD` is the canonical form and the one every other surface in the app
 * prints, so it is first and it is exact. The rest exist because a field you have to
 * type eleven characters into is a field people go back to clicking: `8/4`, `aug 4`
 * and a bare `12` all resolve against `ref` — the value the field already holds — so
 * the month and year you are looking at are the ones you get.
 *
 * `null` means "this is not a date", and the caller holds its previous value rather
 * than displaying something invalid.
 */
export function parseDateInput(raw: string, ref: CivilDate): CivilDate | null {
  const s = raw.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (s === '') return null;

  const { year, month } = parts(ref);

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return build(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // Month first, the way this app's weekday header is ordered: `8/4` is August 4th.
  // A two-digit year is this century — a calendar whose epoch starts in the 2000s has
  // no other reading of `26` available to it.
  const numeric = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(s);
  if (numeric) {
    const y =
      numeric[3] === undefined
        ? year
        : numeric[3].length === 2
          ? 2000 + Number(numeric[3])
          : Number(numeric[3]);
    return build(y, Number(numeric[1]), Number(numeric[2]));
  }

  // A bare number is a day of the month on screen, which is what "the 12th" means to
  // someone already looking at August.
  if (/^\d{1,2}$/.test(s)) return build(year, month, Number(s));

  const monthFirst = /^([a-z]+) (\d{1,2})(?: (\d{4}))?$/.exec(s);
  if (monthFirst) {
    const m = monthFrom(monthFirst[1]);
    return m === null
      ? null
      : build(monthFirst[3] ? Number(monthFirst[3]) : year, m, Number(monthFirst[2]));
  }

  const dayFirst = /^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/.exec(s);
  if (dayFirst) {
    const m = monthFrom(dayFirst[2]);
    return m === null
      ? null
      : build(dayFirst[3] ? Number(dayFirst[3]) : year, m, Number(dayFirst[1]));
  }

  return null;
}
