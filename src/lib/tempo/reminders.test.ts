import { describe, expect, it } from 'vitest';
import { parseReminders } from './mappers';
import { defaultReminders, dueReminders, occurrenceStart, reminderText } from './reminders';
import type { OccurrenceOverride, TempoEvent } from './types';

// ------------------------------------------------------------------ fixtures

const TZ = 'America/Toronto';

function event(over: Partial<TempoEvent> = {}): TempoEvent {
  return {
    id: 'e1',
    title: 'Thing',
    notes: null,
    kind: 'event',
    categoryId: null,
    allDay: true,
    startsAt: null,
    endsAt: null,
    startDate: '2026-07-30',
    endDate: '2026-07-30',
    timezone: TZ,
    recurrence: null,
    reminders: [],
    anchorDate: null,
    displayTemplate: null,
    status: null,
    notify: false,
    source: 'tempo',
    googleEventId: null,
    deletedAt: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

/** A timed event on one date, in Toronto. */
function timed(date: string, startMinutes: number, over: Partial<TempoEvent> = {}): TempoEvent {
  return event({
    allDay: false,
    startDate: null,
    endDate: null,
    ...over,
    // Last, because `expandEvent` derives a timed event's span from these — an
    // override that set them would be placing the event somewhere the test did
    // not ask for.
    ...spanOf(date, startMinutes),
  });
}

/**
 * The expander derives a timed event's span from `startsAt`/`endsAt`, so the
 * fixture has to build real instants rather than assert a civil date.
 */
function spanOf(date: string, startMinutes: number) {
  const [y, m, d] = date.split('-').map(Number);
  // Toronto is UTC-5 in winter and UTC-4 in summer; building through UTC with
  // an explicit offset would bake in the wrong one, so use the same conversion
  // the app uses.
  const start = instant(y, m, d, startMinutes);
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 3_600_000).toISOString(),
  };
}

function instant(y: number, m: number, d: number, minutes: number): Date {
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const offset = offsetAt(new Date(guess));
  return new Date(guess - offset);
}

/** Toronto's UTC offset in ms at an instant. */
function offsetAt(at: Date): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const g = (t: string) => Number(f.find((p) => p.type === t)!.value);
  const wall = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'));
  return wall - at.getTime();
}

const NO_OVERRIDES = new Map<string, OccurrenceOverride[]>();

/** The instants a set of reminders fired at, as ISO strings. */
function firedAt(
  events: TempoEvent[],
  after: Date,
  upTo: Date,
  overrides = NO_OVERRIDES,
): string[] {
  return dueReminders(events, overrides, after, upTo).map((d) => d.fireAt.toISOString());
}

/** A window wide enough to catch anything in the given month. */
const MONTH = (m: number) => ({
  after: new Date(Date.UTC(2026, m - 1, 1)),
  upTo: new Date(Date.UTC(2026, m, 1)),
});

// -------------------------------------------------------------------- timing

describe('reminder timing', () => {
  it('fires a timed reminder its lead time before the start', () => {
    const e = timed('2026-07-15', 14 * 60, { reminders: [{ minutes: 30 }] });
    const w = MONTH(7);

    expect(firedAt([e], w.after, w.upTo)).toEqual([
      instant(2026, 7, 15, 13 * 60 + 30).toISOString(),
    ]);
  });

  it('anchors an all-day reminder to midnight in the event timezone', () => {
    // 900 minutes before midnight on the 15th is 09:00 on the 14th, local.
    const e = event({ startDate: '2026-07-15', endDate: '2026-07-15', reminders: [{ minutes: 900 }] });
    const w = MONTH(7);

    expect(firedAt([e], w.after, w.upTo)).toEqual([instant(2026, 7, 14, 9 * 60).toISOString()]);
  });

  it('treats a negative lead as after the start, for a same-morning nudge', () => {
    const e = event({ startDate: '2026-07-15', endDate: '2026-07-15', reminders: [{ minutes: -540 }] });
    const w = MONTH(7);

    expect(firedAt([e], w.after, w.upTo)).toEqual([instant(2026, 7, 15, 9 * 60).toISOString()]);
  });

  it('emits one entry per reminder, longest lead first', () => {
    const e = timed('2026-07-15', 14 * 60, { reminders: [{ minutes: 1440 }, { minutes: 120 }] });
    const w = MONTH(7);

    expect(firedAt([e], w.after, w.upTo)).toEqual([
      instant(2026, 7, 14, 14 * 60).toISOString(),
      instant(2026, 7, 15, 12 * 60).toISOString(),
    ]);
  });

  it('gives every occurrence of a series its own reminder', () => {
    const e = timed('2026-07-06', 9 * 60, {
      reminders: [{ minutes: 15 }],
      recurrence: { freq: 'WEEKLY', interval: 1, byWeekday: [1] },
    });
    const w = MONTH(7);

    expect(firedAt([e], w.after, w.upTo)).toEqual([
      instant(2026, 7, 6, 8 * 60 + 45).toISOString(),
      instant(2026, 7, 13, 8 * 60 + 45).toISOString(),
      instant(2026, 7, 20, 8 * 60 + 45).toISOString(),
      instant(2026, 7, 27, 8 * 60 + 45).toISOString(),
    ]);
  });
});

// ----------------------------------------------------------------------- DST

describe('daylight saving', () => {
  it('holds a 09:00 birthday nudge at 09:00 across the spring transition', () => {
    // Toronto springs forward at 02:00 on 2026-03-08. Nothing between 09:00 on
    // the 8th and midnight on the 9th crosses it, so the offset is unaffected.
    const e = event({
      startDate: '2026-03-09',
      endDate: '2026-03-09',
      reminders: [{ minutes: 900 }],
    });
    const w = MONTH(3);

    expect(firedAt([e], w.after, w.upTo)).toEqual([instant(2026, 3, 8, 9 * 60).toISOString()]);
  });

  it('lands an hour early when the lead itself spans the transition', () => {
    // A documented wart, not a bug to route around. The offset is a *duration*,
    // exactly as RFC 5545's VALARM TRIGGER is, so a 39-hour lead that steps
    // over a spring-forward arrives an hour before the wall clock says it
    // should. Fixing it would mean storing reminders as wall-clock rules and
    // giving up the 1:1 mapping onto Google's `minutes`.
    const e = event({
      startDate: '2026-03-09',
      endDate: '2026-03-09',
      reminders: [{ minutes: 2340 }], // "two days before, 09:00"
    });
    const w = MONTH(3);

    expect(firedAt([e], w.after, w.upTo)).toEqual([instant(2026, 3, 7, 8 * 60).toISOString()]);
  });
});

// ------------------------------------------------------------------- windows

describe('the due window', () => {
  const e = () => timed('2026-07-15', 14 * 60, { reminders: [{ minutes: 30 }] });
  const fire = instant(2026, 7, 15, 13 * 60 + 30);

  it('is half-open, so consecutive ticks never both claim a reminder', () => {
    const before = new Date(fire.getTime() - 60_000);
    const after = new Date(fire.getTime() + 60_000);

    // The tick that ends exactly on the fire instant claims it.
    expect(firedAt([e()], before, fire)).toHaveLength(1);
    // The next tick, starting there, does not.
    expect(firedAt([e()], fire, after)).toHaveLength(0);
  });

  it('ignores reminders outside the window entirely', () => {
    const w = MONTH(8);
    expect(firedAt([e()], w.after, w.upTo)).toHaveLength(0);
  });

  it('skips events with no reminders without expanding them', () => {
    const w = MONTH(7);
    expect(firedAt([timed('2026-07-15', 14 * 60)], w.after, w.upTo)).toHaveLength(0);
  });

  it('drops a lead time beyond the supported range rather than firing it late', () => {
    const e = timed('2026-07-15', 14 * 60, { reminders: [{ minutes: 999_999 }] });
    const w = MONTH(7);
    expect(firedAt([e], w.after, w.upTo)).toHaveLength(0);
  });
});

// ----------------------------------------------------------------- overrides

describe('per-occurrence exceptions', () => {
  const series = () =>
    timed('2026-07-06', 9 * 60, {
      reminders: [{ minutes: 15 }],
      recurrence: { freq: 'WEEKLY', interval: 1, byWeekday: [1] },
    });

  function overrides(...list: Partial<OccurrenceOverride>[]) {
    return new Map([
      [
        'e1',
        list.map((o, i) => ({
          id: `o${i}`,
          eventId: 'e1',
          occurrenceDate: '2026-07-13',
          cancelled: false,
          patch: {},
          ...o,
        })) as OccurrenceOverride[],
      ],
    ]);
  }

  it('does not remind about a cancelled occurrence', () => {
    const w = MONTH(7);
    const fired = firedAt([series()], w.after, w.upTo, overrides({ cancelled: true }));

    expect(fired).not.toContain(instant(2026, 7, 13, 8 * 60 + 45).toISOString());
    expect(fired).toHaveLength(3);
  });

  it('reminds off the moved time when an occurrence is dragged', () => {
    const w = MONTH(7);
    const fired = firedAt(
      [series()],
      w.after,
      w.upTo,
      overrides({ patch: { startDate: '2026-07-15', startMinutes: 16 * 60 } }),
    );

    expect(fired).toContain(instant(2026, 7, 15, 15 * 60 + 45).toISOString());
    expect(fired).not.toContain(instant(2026, 7, 13, 8 * 60 + 45).toISOString());
  });

  it('keeps the series date as the identity, so a move is not a new reminder', () => {
    const w = MONTH(7);
    const due = dueReminders(
      [series()],
      overrides({ patch: { startDate: '2026-07-15' } }),
      w.after,
      w.upTo,
    );
    const moved = due.find((d) => d.occurrence.date === '2026-07-15');

    expect(moved?.seriesDate).toBe('2026-07-13');
  });
});

// -------------------------------------------------------------------- wiring

describe('occurrenceStart', () => {
  it('puts an all-day occurrence at local midnight, not UTC midnight', () => {
    const e = event({
      startDate: '2026-07-15',
      endDate: '2026-07-15',
      reminders: [{ minutes: 0 }],
    });
    const w = MONTH(7);
    const [due] = dueReminders([e], NO_OVERRIDES, w.after, w.upTo);

    expect(occurrenceStart(due.occurrence, e).toISOString()).toBe(
      instant(2026, 7, 15, 0).toISOString(),
    );
  });
});

describe('reminderText', () => {
  it('uses the derived title, so a birthday arrives with the age on it', () => {
    const e = event({
      title: 'Mom',
      startDate: '1974-06-14',
      endDate: '1974-06-14',
      anchorDate: '1974-06-14',
      displayTemplate: '{title} · {yearsSince}',
      recurrence: { freq: 'YEARLY', interval: 1, onInvalid: 'clamp' },
      reminders: [{ minutes: 900 }],
    });
    const [due] = dueReminders(
      [e],
      NO_OVERRIDES,
      new Date(Date.UTC(2026, 5, 1)),
      new Date(Date.UTC(2026, 6, 1)),
    );

    expect(reminderText(due).title).toBe('Mom · 52');
    expect(reminderText(due).body).toBe('tomorrow');
  });

  it('says the clock time for a timed event', () => {
    const e = timed('2026-07-15', 14 * 60, { title: 'Dentist', reminders: [{ minutes: 30 }] });
    const w = MONTH(7);
    const [due] = dueReminders([e], NO_OVERRIDES, w.after, w.upTo);

    expect(reminderText(due)).toEqual({ title: 'Dentist', body: 'in 30 min · 2pm' });
  });
});

// ------------------------------------------------------------------ defaults

describe('defaults and parsing', () => {
  it('pairs a long and a short lead for deadlines', () => {
    expect(defaultReminders('assignment', false)).toEqual([{ minutes: 1440 }, { minutes: 120 }]);
  });

  it('gives a birthday one morning-before nudge', () => {
    expect(defaultReminders('birthday', true)).toEqual([{ minutes: 900 }]);
  });

  it('collapses duplicates and sorts longest lead first', () => {
    expect(parseReminders([{ minutes: 30 }, { minutes: 1440 }, { minutes: 30 }])).toEqual([
      { minutes: 1440 },
      { minutes: 30 },
    ]);
  });

  it('degrades a malformed column to silence rather than throwing', () => {
    expect(parseReminders('every so often')).toEqual([]);
    expect(parseReminders([{ minutes: 'soon' }])).toEqual([]);
  });
});
