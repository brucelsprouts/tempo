# ICS Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Download the whole calendar as an RFC 5545 `.ics` file from Settings.

**Architecture:** A pure `toICS` in `src/lib/tempo/ics.ts` turns events, exceptions and categories into the file: plain entries as one VEVENT (with RRULE, EXDATE and RECURRENCE-ID events for a series), entries with a display template written out per occurrence for ten years. `/api/export?format=ics` serves it; Settings links to it.

**Tech Stack:** TypeScript, Next.js 16 route handler (`GET(request: NextRequest)`, dynamic by default — checked in `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`), Vitest. Spec: `docs/superpowers/specs/2026-09-19-ics-export-design.md`.

**Baseline (after autosave):** 20 files, 461 tests pass; `tsc` exit 0; `eslint src` 15 pre-existing problems.

---

### Task 1: `toICS`

**Files:**
- Modify: `src/lib/tempo/recurrence.ts` (export `isSeriesDate`)
- Create: `src/lib/tempo/ics.ts`
- Test: `src/lib/tempo/ics.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/tempo/ics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TEMPLATE_PRESETS } from './derive';
import { toICS } from './ics';
import type { Category, OccurrenceOverride, TempoEvent } from './types';

const TZ = 'America/Toronto';
const NOW = new Date('2026-09-19T16:00:00.000Z');

function entry(over: Partial<TempoEvent>): TempoEvent {
  return {
    id: 'e1',
    title: 'Thing',
    notes: null,
    kind: 'event',
    categoryId: null,
    allDay: true,
    startsAt: null,
    endsAt: null,
    startDate: '2026-09-21',
    endDate: '2026-09-21',
    dueMinutes: null,
    timezone: TZ,
    recurrence: null,
    reminders: [],
    anchorDate: null,
    displayTemplate: null,
    notify: false,
    source: 'tempo',
    googleEventId: null,
    deletedAt: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

const write = (
  events: TempoEvent[],
  overrides: OccurrenceOverride[] = [],
  categories: Category[] = [],
) => toICS({ events, overrides, categories, now: NOW });

/** The file as a reader sees it: folded lines joined back up. */
function lines(ics: string): string[] {
  return ics.replace(/\r\n /g, '').split('\r\n').filter(Boolean);
}

/** Each VEVENT's lines, in order. */
function vevents(ics: string): string[][] {
  const out: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines(ics)) {
    if (line === 'BEGIN:VEVENT') current = [];
    else if (line === 'END:VEVENT') {
      out.push(current!);
      current = null;
    } else if (current) current.push(line);
  }
  return out;
}

describe('the file', () => {
  it('is one calendar, in CRLF lines, stamped with the moment it was made', () => {
    const ics = write([entry({})]);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(vevents(ics)[0]).toContain('DTSTAMP:20260919T160000Z');
  });
});

describe('an all-day entry', () => {
  it('ends on the day after its last, as ICS counts', () => {
    const [e] = vevents(write([entry({ startDate: '2026-09-21', endDate: '2026-09-25' })]));
    expect(e).toContain('UID:e1@tempo');
    expect(e).toContain('DTSTART;VALUE=DATE:20260921');
    expect(e).toContain('DTEND;VALUE=DATE:20260926');
  });

  it('carries its category, its due time and its notes', () => {
    const [e] = vevents(
      write(
        [entry({ categoryId: 'c1', dueMinutes: 23 * 60 + 55, notes: 'Submit on OWL' })],
        [],
        [{ id: 'c1', name: 'Psychol 2020A', color: '#b8705c', sortOrder: 0 }],
      ),
    );
    expect(e).toContain('CATEGORIES:Psychol 2020A');
    expect(e).toContain('DESCRIPTION:Due 23:55\\n\\nSubmit on OWL');
  });
});

describe('an entry with a time', () => {
  const timed = { allDay: false, startDate: null, endDate: null } as const;

  it('is written in UTC when it happens once', () => {
    const [e] = vevents(
      write([
        entry({ ...timed, startsAt: '2026-09-21T11:00:00.000Z', endsAt: '2026-09-21T14:00:00.000Z' }),
      ]),
    );
    expect(e).toContain('DTSTART:20260921T110000Z');
    expect(e).toContain('DTEND:20260921T140000Z');
  });

  it('keeps its zone when it repeats, with its days and its end', () => {
    const [e] = vevents(
      write([
        entry({
          ...timed,
          // 10:00–11:30 in Toronto, on a Tuesday.
          startsAt: '2026-09-22T14:00:00.000Z',
          endsAt: '2026-09-22T15:30:00.000Z',
          recurrence: { freq: 'WEEKLY', interval: 1, byWeekday: [4, 2], until: '2026-12-08' },
        }),
      ]),
    );
    expect(e).toContain('DTSTART;TZID=America/Toronto:20260922T100000');
    expect(e).toContain('DTEND;TZID=America/Toronto:20260922T113000');
    // The end of 8 December in Toronto, which is 04:59 on the 9th in UTC.
    expect(e).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261209T045900Z');
  });

  it('says how often and how many times', () => {
    const [e] = vevents(write([entry({ recurrence: { freq: 'MONTHLY', interval: 2, count: 6 } })]));
    expect(e).toContain('RRULE:FREQ=MONTHLY;INTERVAL=2;COUNT=6');
  });
});

describe('exceptions', () => {
  // Mondays from 21 September.
  const weekly = entry({ recurrence: { freq: 'WEEKLY' } });

  it('writes a skipped date as EXDATE', () => {
    const [e] = vevents(
      write([weekly], [{ id: 'o1', eventId: 'e1', occurrenceDate: '2026-09-28', cancelled: true, patch: {} }]),
    );
    expect(e).toContain('EXDATE;VALUE=DATE:20260928');
  });

  it('writes a moved date as a second event for that date', () => {
    const events = vevents(
      write(
        [weekly],
        [
          {
            id: 'o1',
            eventId: 'e1',
            occurrenceDate: '2026-09-28',
            cancelled: false,
            patch: { startDate: '2026-09-29', endDate: '2026-09-29', title: 'Moved' },
          },
        ],
      ),
    );
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual(
      expect.arrayContaining([
        'UID:e1@tempo',
        'RECURRENCE-ID;VALUE=DATE:20260928',
        'DTSTART;VALUE=DATE:20260929',
        'DTEND;VALUE=DATE:20260930',
        'SUMMARY:Moved',
      ]),
    );
  });

  it('leaves out an exception for a date the series does not have', () => {
    const ics = write(
      [weekly],
      [{ id: 'o1', eventId: 'e1', occurrenceDate: '2026-09-30', cancelled: true, patch: {} }],
    );
    expect(ics).not.toContain('EXDATE');
  });
});

describe('a birthday', () => {
  it('is written out year by year with its age, ten years ahead', () => {
    const mom = entry({
      id: 'mom',
      title: 'Mom',
      kind: 'birthday',
      startDate: '1974-06-14',
      endDate: '1974-06-14',
      anchorDate: '1974-06-14',
      displayTemplate: TEMPLATE_PRESETS.birthday,
      recurrence: { freq: 'YEARLY', interval: 1, onInvalid: 'clamp' },
    });
    const ics = write([mom]);
    const events = vevents(ics);

    // 1974 to 2036.
    expect(events).toHaveLength(63);
    const thisYear = events.find((e) => e.includes('DTSTART;VALUE=DATE:20260614'))!;
    expect(thisYear).toContain('SUMMARY:Mom > 52');
    expect(thisYear).toContain('UID:mom-2026-06-14@tempo');
    expect(lines(ics).some((l) => l.startsWith('RRULE'))).toBe(false);
  });
});

describe('what is left out', () => {
  it('leaves out the trash and entries mirrored from Google', () => {
    const ics = write([
      entry({ id: 'gone', deletedAt: '2026-09-01T00:00:00.000Z' }),
      entry({ id: 'theirs', source: 'google' }),
      entry({ id: 'ours' }),
    ]);
    expect(vevents(ics)).toHaveLength(1);
    expect(ics).toContain('UID:ours@tempo');
  });
});

describe('text', () => {
  it('escapes what ICS reserves, and folds long lines without splitting a character', () => {
    const title =
      'Read chapters 3, 4; then write — a title long enough that it has to be folded onto more than one line';
    const ics = write([entry({ title })]);

    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(ics).toMatch(/\r\n /);
    expect(vevents(ics)[0]).toContain(
      `SUMMARY:${title.replace(/,/g, '\\,').replace(/;/g, '\\;')}`,
    );
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/tempo/ics.test.ts` → Expected: FAIL — `Failed to resolve import "./ics"`.

- [ ] **Step 3: Export `isSeriesDate` and `Span`**

In `src/lib/tempo/recurrence.ts`, replace `function isSeriesDate(` with `export function isSeriesDate(`, and add as the last paragraph of its doc comment:

```
 *
 * Exported for the ICS export, which writes an exception only where the grid
 * would draw one.
```

Replace `interface Span {` with `export interface Span {` — the ICS export writes a series' DTSTART from it.

- [ ] **Step 4: Write the module**

Create `src/lib/tempo/ics.ts`:

```ts
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
```

- [ ] **Step 5: Run it to see it pass**

Run: `npx vitest run src/lib/tempo/ics.test.ts` → Expected: PASS, 12 tests.
Run: `npx tsc --noEmit -p .` → exit 0.
Run: `npx eslint src/lib/tempo/ics.ts src/lib/tempo/ics.test.ts src/lib/tempo/recurrence.ts` → no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tempo/ics.ts src/lib/tempo/ics.test.ts src/lib/tempo/recurrence.ts
git commit -m "Write the calendar as an ICS file" -m "Plain series as RRULEs with their skipped and moved dates, derived titles written out per occurrence ten years ahead, repeating timed entries in their own zone. Asked for beside the JSON export on 2026-07-31.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Serve it, and link to it

**Files:**
- Modify: `src/app/api/export/route.ts`
- Modify: `src/components/calendar/Settings.tsx` (DATA section)

- [ ] **Step 1: The route**

Replace the whole of `src/app/api/export/route.ts` with:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toICS } from '@/lib/tempo/ics';
import {
  categoryFromRow,
  eventFromRow,
  overrideFromRow,
  toPortable,
} from '@/lib/tempo/mappers';

/**
 * Everything, in one of two shapes.
 *
 * JSON by default: the database, legible without the app that produced it —
 * each event one object whose keys map 1:1 onto Obsidian frontmatter, category
 * resolved to its name, recurring events as their rule rather than thousands of
 * expanded occurrences.
 *
 * `?format=ics`: the calendar, for importing into another one. See `ics.ts` for
 * the one place the two disagree — derived titles.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [eventRows, categoryRows, overrideRows] = await Promise.all([
    supabase.from('events').select('*'),
    supabase.from('categories').select('*'),
    supabase.from('occurrence_overrides').select('*'),
  ]);

  const failure = eventRows.error ?? categoryRows.error ?? overrideRows.error;
  if (failure) return NextResponse.json({ error: failure.message }, { status: 500 });

  const cats = new Map((categoryRows.data ?? []).map((c) => [c.id, categoryFromRow(c)]));
  const events = (eventRows.data ?? []).map(eventFromRow);
  const overrides = (overrideRows.data ?? []).map(overrideFromRow);
  const day = new Date().toISOString().slice(0, 10);

  if (request.nextUrl.searchParams.get('format') === 'ics') {
    return new NextResponse(
      toICS({ events, overrides, categories: [...cats.values()], now: new Date() }),
      {
        headers: {
          'content-type': 'text/calendar; charset=utf-8',
          'content-disposition': `attachment; filename="tempo-${day}.ics"`,
        },
      },
    );
  }

  const payload = {
    format: 'tempo.export.v1',
    exportedAt: new Date().toISOString(),
    categories: [...cats.values()],
    events: events.map((e) =>
      toPortable(e, e.categoryId ? cats.get(e.categoryId)?.name : undefined),
    ),
    overrides,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="tempo-${day}.json"`,
    },
  });
}
```

- [ ] **Step 2: The link**

In `Settings.tsx`, replace

```tsx
        <a
          href="/api/export"
          className="tap inline-flex items-center border border-hair px-3 py-2 text-[10px] tracking-[0.14em] text-dim transition-colors hover:border-hairlit hover:text-ink"
        >
          EXPORT ALL AS JSON
        </a>
```

with

```tsx
        {/* Two files, because they answer different needs: JSON is the
            database, for Obsidian or a script; ICS is the calendar, for
            importing into another calendar app. */}
        <div className="flex flex-wrap gap-2">
          <a
            href="/api/export"
            className="tap inline-flex items-center border border-hair px-3 py-2 text-[10px] tracking-[0.14em] text-dim transition-colors hover:border-hairlit hover:text-ink"
          >
            EXPORT ALL AS JSON
          </a>
          <a
            href="/api/export?format=ics"
            className="tap inline-flex items-center border border-hair px-3 py-2 text-[10px] tracking-[0.14em] text-dim transition-colors hover:border-hairlit hover:text-ink"
          >
            EXPORT ALL AS ICS
          </a>
        </div>
```

- [ ] **Step 3: Check**

Run: `npx tsc --noEmit -p .` → exit 0. `npx eslint src/app/api/export/route.ts src/components/calendar/Settings.tsx` → no output. `npx vitest run` → 21 files, 473 tests pass.
In `/preview`, press `S`: DATA shows both links; the ICS one's `href` is `/api/export?format=ics`. (The route itself needs a signed-in session, so the preview cannot download it; `curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/export?format=ics"` → `307` or `401`, the auth gate.)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/export/route.ts src/components/calendar/Settings.tsx
git commit -m "Offer the ICS export beside the JSON one" -m "One route, two formats: ?format=ics serves the calendar for importing elsewhere, the default stays the Obsidian-shaped JSON.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Record it, and verify the whole branch

- [ ] **Step 1: DESIGN.md.** Add §19 after §18, before the `---` that precedes `## Not built`:

```markdown
## 19. The calendar exports as ICS too

JSON is the database, legible; ICS is the calendar, portable — asked for on the
first day so everything could be re-imported elsewhere. They disagree in one
place. ICS gives a repeating event one title, so an entry whose title changes by
occurrence ("Mom > 52") is written out one occurrence at a time, from its start
to ten years ahead; everything else is one rule with its skipped and moved dates.
A repeating entry with a time keeps its zone rather than UTC, or a 09:00 lecture
would import at 10:00 for half the year. Reminders stay behind: they count from
anchors ICS has no words for, and whatever imports the file sets its own.
```

- [ ] **Step 2: README.** Replace ``- **`/api/export`** returns every event as flat JSON whose keys map 1:1 onto`` / `` Obsidian frontmatter. Recurring events export as their rule, not as expanded`` / `` occurrences — the export is the same size as the database.`` with:

```markdown
- **`/api/export`** returns every event as flat JSON whose keys map 1:1 onto
  Obsidian frontmatter. Recurring events export as their rule, not as expanded
  occurrences — the export is the same size as the database. `?format=ics`
  returns the same calendar as an `.ics` file for any other calendar app.
```

- [ ] **Step 3: Commit** `docs/DESIGN.md README.md` — "Record the ICS export".

- [ ] **Step 4: Verify.** `npx vitest run` → 21 files, 473 pass. `npx tsc --noEmit -p .` → 0. `npx eslint src` → the 15 pre-existing problems. `npx next build` → completes.
