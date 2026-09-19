/**
 * The calendar as RFC 5545, for importing into any other calendar.
 *
 * The JSON export is the database, legible; this is the calendar, portable.
 * They disagree in exactly one place, which is why this is not a rename of the
 * other: ICS gives a repeating event one SUMMARY for every occurrence, so a
 * title that changes by occurrence — "Mom > 52" this year, "Mom > 53" the next
 * — cannot be a rule. An entry with a display template is written out one
 * occurrence at a time; everything else stays one rule, as the database holds
 * it.
 */

import {
  addDays,
  addYears,
  civilInZone,
  instantFromCivil,
  LAST_MINUTE_OF_DAY,
  maxDate,
  minDate,
  type CivilDate,
} from './civil';
import { eventSpan, expandEvent, isSeriesDate, type Span } from './recurrence';
import type { Category, Occurrence, OccurrenceOverride, Recurrence, TempoEvent } from './types';

export interface IcsInput {
  events: TempoEvent[];
  overrides: OccurrenceOverride[];
  categories: Category[];
  /**
   * When the export is made: every event's DTSTAMP, and where a derived
   * series' ten years are counted from.
   */
  now: Date;
}

/**
 * How far ahead a derived series is written out. A backup keeps the history,
 * as the plain series do; a century of one person's birthdays is not worth the
 * thousands of events, and exporting again moves the horizon.
 */
const DERIVED_YEARS = 10;

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export function toICS({ events, overrides, categories, now }: IcsInput): string {
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const byEvent = new Map<string, OccurrenceOverride[]>();
  for (const o of overrides) {
    const list = byEvent.get(o.eventId);
    if (list) list.push(o);
    else byEvent.set(o.eventId, [o]);
  }
  const stamp = `DTSTAMP:${utc(now)}`;

  const out = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tempo//Tempo export//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Tempo',
  ];

  for (const event of events) {
    // The trash is not the calendar, and an entry mirrored from Google is
    // Google's to export.
    if (event.deletedAt !== null || event.source === 'google') continue;
    const shared = [
      stamp,
      ...details(event, event.categoryId ? categoryName.get(event.categoryId) : undefined),
    ];
    const own = byEvent.get(event.id) ?? [];
    out.push(...(event.displayTemplate ? writtenOut(event, own, shared, now) : asRule(event, own, shared)));
  }

  out.push('END:VCALENDAR');
  return `${out.map(fold).join('\r\n')}\r\n`;
}

/**
 * What every event written for an entry carries besides its own dates: its
 * category, and a description of the due time and the notes — an all-day event
 * in ICS has no time of day to hold a deadline.
 */
function details(event: TempoEvent, category: string | undefined): string[] {
  const out: string[] = [];
  if (category) out.push(`CATEGORIES:${text(category)}`);
  const due = event.allDay && event.dueMinutes !== null ? `Due ${clock(event.dueMinutes)}` : null;
  const description = [due, event.notes].filter(Boolean).join('\n\n');
  if (description) out.push(`DESCRIPTION:${text(description)}`);
  return out;
}

/** A derived series: one event per occurrence, each under its own title. */
function writtenOut(
  event: TempoEvent,
  overrides: OccurrenceOverride[],
  shared: string[],
  now: Date,
): string[] {
  const span = eventSpan(event);
  if (!span) return [];
  const horizon = addYears(civilInZone(now, event.timezone), DERIVED_YEARS);
  return expandEvent(event, overrides, span.start, horizon).flatMap((occ) => [
    'BEGIN:VEVENT',
    `UID:${event.id}-${occ.seriesDate}@tempo`,
    ...occurrenceTimes(occ, event.timezone),
    `SUMMARY:${text(occ.title)}`,
    ...shared,
    'END:VEVENT',
  ]);
}

/**
 * A plain entry: one event — and for a series its rule, the dates it skips,
 * and one more event, under the same UID, for each date moved or renamed.
 */
function asRule(event: TempoEvent, overrides: OccurrenceOverride[], shared: string[]): string[] {
  const span = eventSpan(event);
  if (!span) return [];
  const rule = event.recurrence;
  const uid = `UID:${event.id}@tempo`;

  const out = ['BEGIN:VEVENT', uid, ...seriesTimes(event, span), `SUMMARY:${text(event.title)}`];
  if (!rule) return [...out, ...shared, 'END:VEVENT'];

  out.push(rrule(rule, event));
  // Only the exceptions that still name a real date of the series — the rule
  // the grid draws by.
  const live = overrides.filter((o) => isSeriesDate(rule, span.start, o.occurrenceDate));
  const skipped = new Set([
    ...(rule.exdates ?? []),
    ...live.filter((o) => o.cancelled).map((o) => o.occurrenceDate),
  ]);
  for (const date of [...skipped].sort()) out.push(`EXDATE${seriesDate(event, span, date)}`);
  out.push(...shared, 'END:VEVENT');

  for (const o of live.filter((x) => !x.cancelled)) {
    // Expansion keeps what overlaps the window it is asked about, and a moved
    // date is found where it went — so the window spans where it was and
    // where it is.
    const moved = o.patch.startDate ?? o.occurrenceDate;
    const occ = expandEvent(
      event,
      [o],
      minDate(o.occurrenceDate, moved),
      maxDate(o.occurrenceDate, o.patch.endDate ?? moved),
    ).find((x) => x.seriesDate === o.occurrenceDate);
    if (!occ) continue;
    out.push(
      'BEGIN:VEVENT',
      uid,
      `RECURRENCE-ID${seriesDate(event, span, o.occurrenceDate)}`,
      ...occurrenceTimes(occ, event.timezone),
      `SUMMARY:${text(occ.title)}`,
      ...shared,
      'END:VEVENT',
    );
  }
  return out;
}

/**
 * DTSTART and DTEND for a plain entry. A repeating one with a time keeps its
 * zone: written in UTC, its 09:00 would be 10:00 for half the year.
 */
function seriesTimes(event: TempoEvent, span: Span): string[] {
  if (event.allDay) {
    return [
      `DTSTART;VALUE=DATE:${compact(span.start)}`,
      `DTEND;VALUE=DATE:${compact(addDays(span.end, 1))}`,
    ];
  }
  if (!event.recurrence) {
    return [
      `DTSTART:${utc(new Date(event.startsAt!))}`,
      `DTEND:${utc(new Date(event.endsAt!))}`,
    ];
  }
  return [
    `DTSTART;TZID=${event.timezone}:${local(span.start, span.startMinutes ?? 0)}`,
    `DTEND;TZID=${event.timezone}:${local(span.end, span.endMinutes ?? 0)}`,
  ];
}

/** DTSTART and DTEND for one materialised occurrence: dates, or instants in UTC. */
function occurrenceTimes(occ: Occurrence, tz: string): string[] {
  if (occ.allDay) {
    return [
      `DTSTART;VALUE=DATE:${compact(occ.date)}`,
      `DTEND;VALUE=DATE:${compact(addDays(occ.endDate, 1))}`,
    ];
  }
  const start = occ.startMinutes ?? 0;
  return [
    `DTSTART:${utc(instantFromCivil(occ.date, start, tz))}`,
    `DTEND:${utc(instantFromCivil(occ.endDate, occ.endMinutes ?? start, tz))}`,
  ];
}

/** A date of a series, written the way its DTSTART is — for EXDATE and RECURRENCE-ID. */
function seriesDate(event: TempoEvent, span: Span, date: CivilDate): string {
  return event.allDay
    ? `;VALUE=DATE:${compact(date)}`
    : `;TZID=${event.timezone}:${local(date, span.startMinutes ?? 0)}`;
}

function rrule(r: Recurrence, event: TempoEvent): string {
  const parts = [`FREQ=${r.freq}`];
  if ((r.interval ?? 1) > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.byWeekday?.length) {
    parts.push(`BYDAY=${[...r.byWeekday].sort((a, b) => a - b).map((d) => DAYS[d]).join(',')}`);
  }
  if (r.byMonthDay) parts.push(`BYMONTHDAY=${r.byMonthDay}`);
  if (r.byMonth) parts.push(`BYMONTH=${r.byMonth}`);
  // UNTIL takes DTSTART's type: a date for an all-day series, and for one with
  // a time an instant in UTC — the end of that day, where the entry lives.
  if (r.until) {
    parts.push(
      `UNTIL=${event.allDay ? compact(r.until) : utc(instantFromCivil(r.until, LAST_MINUTE_OF_DAY, event.timezone))}`,
    );
  } else if (r.count) {
    parts.push(`COUNT=${r.count}`);
  }
  return `RRULE:${parts.join(';')}`;
}

// -------------------------------------------------------------- formatting

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-09-21` → `20260921`. */
const compact = (d: CivilDate) => d.replace(/-/g, '');

/** An instant in UTC: `20260919T160000Z`. */
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** A wall-clock time on a date, for a TZID: `20260921T090000`. */
const local = (d: CivilDate, minutes: number) =>
  `${compact(d)}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`;

const clock = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** Text as a property value: backslashes, semicolons, commas and newlines escaped. */
function text(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * One line folded at 75 octets, as RFC 5545 asks. Counted in UTF-8 bytes and
 * broken only between characters, so an em dash is never cut in half — a
 * continuation line begins with a space, which counts towards its 75.
 */
function fold(line: string): string {
  const pieces: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = utf8Length(ch);
    const limit = pieces.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      pieces.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  pieces.push(current);
  return pieces.join('\r\n ');
}

function utf8Length(ch: string): number {
  const c = ch.codePointAt(0)!;
  return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
}
