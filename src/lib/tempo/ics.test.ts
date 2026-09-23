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
    timetable: false,
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
