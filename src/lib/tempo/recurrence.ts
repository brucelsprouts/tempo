/**
 * Recurrence expansion.
 *
 * Occurrences are derived, never stored. This runs on every scroll window, so
 * it does not walk from the series start to find the visible range — it jumps
 * there arithmetically. A birthday from 1974 costs the same to render in 2026
 * as one from last week.
 *
 * The one case that must walk is `count`, because skipped invalid dates (the
 * 31st of February, Feb 29 in a common year) mean the Nth occurrence is not
 * necessarily the Nth period. `count` is bounded by definition, so walking it
 * is cheap and correct.
 */

import {
  addDays,
  addMonths,
  civil,
  civilInZone,
  compareDates,
  daysInMonth,
  diffDays,
  minutesInZone,
  parts,
  rangesOverlap,
  startOfWeek,
  type CivilDate,
} from './civil';
import { resolveTitle } from './derive';
import type {
  Occurrence,
  OccurrenceOverride,
  Recurrence,
  TempoEvent,
} from './types';

/** Guard against a pathological rule over an absurd window. */
const MAX_OCCURRENCES_PER_EVENT = 5000;

/** The day-span an event occupies, in its own timezone. */
interface Span {
  start: CivilDate;
  end: CivilDate;
  durationDays: number;
  startMinutes: number | null;
  endMinutes: number | null;
}

export function eventSpan(event: TempoEvent): Span | null {
  if (event.allDay) {
    if (!event.startDate || !event.endDate) return null;
    return {
      start: event.startDate,
      end: event.endDate,
      durationDays: diffDays(event.endDate, event.startDate),
      startMinutes: null,
      endMinutes: null,
    };
  }
  if (!event.startsAt || !event.endsAt) return null;
  const tz = event.timezone;
  const startInstant = new Date(event.startsAt);
  const endInstant = new Date(event.endsAt);
  const start = civilInZone(startInstant, tz);
  const end = civilInZone(endInstant, tz);
  return {
    start,
    end,
    durationDays: diffDays(end, start),
    // Wall-clock minutes, not an offset from an instant: a 09:00 standup stays
    // at 09:00 after a DST transition, which is what a person expects.
    startMinutes: minutesInZone(startInstant, tz),
    endMinutes: minutesInZone(endInstant, tz),
  };
}

// ------------------------------------------------------------ date generation

/** Resolve a candidate date for period `k`, or null if the rule lands nowhere. */
function dateForPeriod(rule: Recurrence, dtstart: CivilDate, k: number): CivilDate | null {
  const interval = Math.max(1, rule.interval ?? 1);
  const base = parts(dtstart);

  switch (rule.freq) {
    case 'DAILY':
      return addDays(dtstart, k * interval);

    case 'WEEKLY':
      // byWeekday is handled by the caller, which fans each period out across
      // the listed weekdays; here a period is just its week.
      return addDays(dtstart, k * interval * 7);

    case 'MONTHLY': {
      const day = rule.byMonthDay ?? base.day;
      const anchor = addMonths(civil(base.year, base.month, 1), k * interval);
      const a = parts(anchor);
      return materialiseDay(a.year, a.month, day, rule);
    }

    case 'YEARLY': {
      const month = rule.byMonth ?? base.month;
      const day = rule.byMonthDay ?? base.day;
      return materialiseDay(base.year + k * interval, month, day, rule);
    }
  }
}

/**
 * Handles the dates that don't exist. RFC 5545 skips them, which is right for
 * "the 31st of every month" — there is no January-31st-equivalent in February.
 * It is wrong for a Feb 29 birthday, where the person still ages, so the
 * birthday preset opts into clamping to the last real day of the month.
 */
function materialiseDay(
  year: number,
  month: number,
  day: number,
  rule: Recurrence,
): CivilDate | null {
  const limit = daysInMonth(year, month);
  if (day <= limit) return civil(year, month, day);
  if (rule.onInvalid === 'clamp') return civil(year, month, limit);
  return null;
}

/**
 * First period index whose date could reach `windowStart`, computed rather than
 * searched. Intentionally conservative — it may undershoot by one period, which
 * the caller filters out, but it must never overshoot and drop a real occurrence.
 */
function seekPeriod(rule: Recurrence, dtstart: CivilDate, windowStart: CivilDate): number {
  if (windowStart <= dtstart) return 0;
  const interval = Math.max(1, rule.interval ?? 1);

  switch (rule.freq) {
    case 'DAILY':
      return Math.max(0, Math.floor(diffDays(windowStart, dtstart) / (interval)) - 1);
    case 'WEEKLY': {
      const weeks = Math.floor(
        diffDays(startOfWeek(windowStart), startOfWeek(dtstart)) / 7,
      );
      return Math.max(0, Math.floor(weeks / interval) - 1);
    }
    case 'MONTHLY': {
      const a = parts(dtstart);
      const b = parts(windowStart);
      const months = (b.year - a.year) * 12 + (b.month - a.month);
      return Math.max(0, Math.floor(months / interval) - 1);
    }
    case 'YEARLY': {
      const years = parts(windowStart).year - parts(dtstart).year;
      return Math.max(0, Math.floor(years / interval) - 1);
    }
  }
}

/**
 * Series start dates overlapping [windowStart, windowEnd], each paired with its
 * 1-based position in the series.
 */
function occurrenceDates(
  rule: Recurrence,
  dtstart: CivilDate,
  windowStart: CivilDate,
  windowEnd: CivilDate,
): Array<{ date: CivilDate; index: number }> {
  const out: Array<{ date: CivilDate; index: number }> = [];
  const exdates = new Set(rule.exdates ?? []);
  const until = rule.until ?? null;
  const weekdays =
    rule.freq === 'WEEKLY' && rule.byWeekday?.length
      ? [...rule.byWeekday].sort((a, b) => a - b)
      : null;

  // `count` must be counted in emitted occurrences, not elapsed periods, so it
  // walks from the start. Bounded by definition, so the walk is cheap.
  const bounded = typeof rule.count === 'number' && rule.count > 0;
  let emitted = 0;

  let k = bounded ? 0 : seekPeriod(rule, dtstart, windowStart);
  let guard = 0;

  while (guard++ < MAX_OCCURRENCES_PER_EVENT) {
    const periodDate = dateForPeriod(rule, dtstart, k);
    if (periodDate === null && !weekdays) {
      // rule landed on a nonexistent date; this period yields nothing
      k += 1;
      if (!bounded && exceededWindow(rule, dtstart, k, windowEnd)) break;
      continue;
    }

    const candidates: CivilDate[] = weekdays
      ? weekdays
          .map((wd) => addDays(startOfWeek(periodDate ?? dtstart), wd))
          .filter((d) => d >= dtstart)
      : [periodDate!];

    let pastEnd = false;
    for (const date of candidates) {
      if (until && date > until) {
        pastEnd = true;
        break;
      }
      if (date > windowEnd) {
        pastEnd = true;
        break;
      }
      emitted += 1;
      if (bounded && emitted > rule.count!) {
        pastEnd = true;
        break;
      }
      if (date >= windowStart && !exdates.has(date)) {
        out.push({ date, index: bounded ? emitted : k + 1 });
      }
    }
    if (pastEnd) break;

    k += 1;
    if (bounded && emitted >= rule.count!) break;
  }

  return out;
}

/** Cheap early-out so a skipping rule can't spin forever past the window. */
function exceededWindow(
  rule: Recurrence,
  dtstart: CivilDate,
  k: number,
  windowEnd: CivilDate,
): boolean {
  const interval = Math.max(1, rule.interval ?? 1);
  const base = parts(dtstart);
  switch (rule.freq) {
    case 'MONTHLY': {
      const anchor = addMonths(civil(base.year, base.month, 1), k * interval);
      return anchor > windowEnd;
    }
    case 'YEARLY':
      return base.year + k * interval > parts(windowEnd).year;
    default:
      return true;
  }
}

// ----------------------------------------------------------------- expansion

/**
 * Materialise one event's occurrences overlapping [from, to], both inclusive.
 */
export function expandEvent(
  event: TempoEvent,
  overrides: OccurrenceOverride[],
  from: CivilDate,
  to: CivilDate,
): Occurrence[] {
  const span = eventSpan(event);
  if (!span) return [];

  const overrideByDate = new Map(overrides.map((o) => [o.occurrenceDate, o]));

  // An occurrence starting before the window can still reach into it, so widen
  // the search by the event's own duration.
  const searchStart = addDays(from, -span.durationDays);

  let seeds: Array<{ date: CivilDate; index: number }>;
  if (event.recurrence) {
    seeds = occurrenceDates(event.recurrence, span.start, searchStart, to);
  } else {
    seeds = rangesOverlap(span.start, span.end, from, to)
      ? [{ date: span.start, index: 1 }]
      : [];
  }

  const emitted = new Set(seeds.map((s) => s.date));

  // An override can *move* an occurrence into view whose original date sits
  // outside the search window, so those are picked up separately.
  const displaced = overrides
    .filter((o) => !o.cancelled && o.patch.startDate && !emitted.has(o.occurrenceDate))
    .filter((o) => {
      const s = o.patch.startDate!;
      const e = o.patch.endDate ?? addDays(s, span.durationDays);
      return rangesOverlap(s, e, from, to);
    })
    .map((o) => ({
      date: o.occurrenceDate,
      index: seriesIndexOf(event, span.start, o.occurrenceDate),
    }));

  return [...seeds, ...displaced]
    .map((seed) => buildOccurrence(event, span, seed, overrideByDate.get(seed.date)))
    .filter((occ): occ is Occurrence => occ !== null)
    .filter((occ) => rangesOverlap(occ.date, occ.endDate, from, to))
    .sort(byStart);
}

function buildOccurrence(
  event: TempoEvent,
  span: Span,
  seed: { date: CivilDate; index: number },
  override: OccurrenceOverride | undefined,
): Occurrence | null {
  if (override?.cancelled) return null;

  const patch = override?.patch ?? {};
  const date = patch.startDate ?? seed.date;
  const endDate = patch.endDate ?? addDays(date, span.durationDays);

  return {
    key: `${event.id}:${seed.date}`,
    eventId: event.id,
    event,
    date,
    endDate,
    seriesDate: seed.date,
    index: seed.index,
    // Derived fields resolve against the *series* date, not the dragged one:
    // moving a birthday celebration to the weekend doesn't change the age.
    title: resolveTitle(patch.title ? null : event.displayTemplate, {
      title: patch.title ?? event.title,
      date: seed.date,
      anchorDate: event.anchorDate,
      index: seed.index,
    }),
    allDay: event.allDay,
    startMinutes: patch.startMinutes ?? span.startMinutes,
    endMinutes: patch.endMinutes ?? span.endMinutes,
    kind: event.kind,
    status: patch.status ?? event.status,
    categoryId: event.categoryId,
    isOverride: override !== undefined,
    readOnly: event.source === 'google' || event.kind === 'birthday',
  };
}

/** Position of a known occurrence date within its series. */
function seriesIndexOf(event: TempoEvent, dtstart: CivilDate, date: CivilDate): number {
  const rule = event.recurrence;
  if (!rule) return 1;
  const interval = Math.max(1, rule.interval ?? 1);
  const a = parts(dtstart);
  const b = parts(date);
  switch (rule.freq) {
    case 'DAILY':
      return Math.floor(diffDays(date, dtstart) / interval) + 1;
    case 'WEEKLY':
      return Math.floor(diffDays(startOfWeek(date), startOfWeek(dtstart)) / (7 * interval)) + 1;
    case 'MONTHLY':
      return Math.floor(((b.year - a.year) * 12 + (b.month - a.month)) / interval) + 1;
    case 'YEARLY':
      return Math.floor((b.year - a.year) / interval) + 1;
  }
}

function byStart(a: Occurrence, b: Occurrence): number {
  const d = compareDates(a.date, b.date);
  if (d !== 0) return d;
  // all-day and multi-day items first: they form the stable bars a week row is
  // built around, and chips flow underneath them
  const aSpan = diffDays(a.endDate, a.date);
  const bSpan = diffDays(b.endDate, b.date);
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  if (aSpan !== bSpan) return bSpan - aSpan;
  const am = a.startMinutes ?? 0;
  const bm = b.startMinutes ?? 0;
  if (am !== bm) return am - bm;
  return a.title.localeCompare(b.title);
}

/** Expand a whole calendar across a window. */
export function expandAll(
  events: TempoEvent[],
  overridesByEvent: Map<string, OccurrenceOverride[]>,
  from: CivilDate,
  to: CivilDate,
): Occurrence[] {
  const out: Occurrence[] = [];
  for (const event of events) {
    out.push(...expandEvent(event, overridesByEvent.get(event.id) ?? [], from, to));
  }
  return out.sort(byStart);
}
