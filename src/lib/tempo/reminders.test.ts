import { describe, expect, it } from 'vitest';
import { parseReminders } from './mappers';
import {
  allDayLeadMinutes,
  defaultReminders,
  dueReminders,
  isSendableLead,
  leadMinutes,
  occurrenceStart,
  planReminders,
  reminderText,
} from './reminders';
import { expandEvent } from './recurrence';
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

// ------------------------------------------------------------------- anchors

describe('anchors', () => {
  /** An assignment worked on Monday to Friday, 13–17 July. */
  const week = (over: Partial<TempoEvent> = {}) =>
    event({ startDate: '2026-07-13', endDate: '2026-07-17', ...over });

  it('counts a due-day reminder back from the last day, not the first', () => {
    const e = week({ reminders: [{ from: 'dueDay', minutes: 900 }] });
    const w = MONTH(7);

    expect(firedAt([e], w.after, w.upTo)).toEqual([instant(2026, 7, 16, 9 * 60).toISOString()]);
  });

  it('keeps a start reminder on the first day', () => {
    const e = week({ reminders: [{ minutes: -540 }] });
    const w = MONTH(7);

    expect(firedAt([e], w.after, w.upTo)).toEqual([instant(2026, 7, 13, 9 * 60).toISOString()]);
  });

  it('counts a due reminder back from the due time', () => {
    const e = week({ dueMinutes: 18 * 60, reminders: [{ from: 'due', minutes: 60 }] });
    const w = MONTH(7);

    expect(firedAt([e], w.after, w.upTo)).toEqual([instant(2026, 7, 17, 17 * 60).toISOString()]);
  });

  it('is due when the last day ends when no due time is stated', () => {
    const e = week({ reminders: [{ from: 'due', minutes: 60 }] });
    const w = MONTH(7);

    expect(firedAt([e], w.after, w.upTo)).toEqual([instant(2026, 7, 17, 23 * 60).toISOString()]);
  });

  it('leaves a late-night reminder where it is when nothing is due at a time', () => {
    // 23:55 on the day it is due. With a stated due time of 23:55 this would be
    // at the deadline and sent an hour early; with none, there is no moment for
    // it to be after.
    const e = event({
      startDate: '2026-07-15',
      endDate: '2026-07-15',
      reminders: [{ from: 'dueDay', minutes: -(23 * 60 + 55) }],
    });
    const w = MONTH(7);

    expect(firedAt([e], w.after, w.upTo)).toEqual([
      instant(2026, 7, 15, 23 * 60 + 55).toISOString(),
    ]);
  });

  it('holds a time-of-day reminder at its time when the due time moves', () => {
    const e = week({ dueMinutes: 18 * 60, reminders: [{ from: 'dueDay', minutes: 900 }] });
    const w = MONTH(7);

    expect(firedAt([e], w.after, w.upTo)).toEqual([instant(2026, 7, 16, 9 * 60).toISOString()]);
  });

  it('puts a timed entry’s due day on the day it starts', () => {
    const e = timed('2026-07-15', 7 * 60, {
      reminders: [{ from: 'dueDay', minutes: 900 }, { from: 'due', minutes: 60 }],
    });
    const w = MONTH(7);

    expect(firedAt([e], w.after, w.upTo)).toEqual([
      instant(2026, 7, 14, 9 * 60).toISOString(),
      instant(2026, 7, 15, 6 * 60).toISOString(),
    ]);
  });

  it('finds a deadline whose entry started before the window', () => {
    const e = event({
      startDate: '2026-06-20',
      endDate: '2026-07-15',
      reminders: [{ from: 'dueDay', minutes: 900 }],
    });
    const w = MONTH(7);

    expect(firedAt([e], w.after, w.upTo)).toEqual([instant(2026, 7, 14, 9 * 60).toISOString()]);
  });

  it('follows a dragged end, because the reminder is anchored to it', () => {
    const e = week({
      endDate: '2026-07-24',
      reminders: [{ from: 'dueDay', minutes: 900 }],
    });
    const w = MONTH(7);

    expect(firedAt([e], w.after, w.upTo)).toEqual([instant(2026, 7, 23, 9 * 60).toISOString()]);
  });

  it('carries the anchor into the identity, so equal minutes stay two reminders', () => {
    const e = week({ reminders: [{ minutes: -540 }, { from: 'dueDay', minutes: -540 }] });
    const w = MONTH(7);
    const due = dueReminders([e], NO_OVERRIDES, w.after, w.upTo);

    expect(due.map((d) => [d.anchor, d.minutes])).toEqual([
      ['start', -540],
      ['dueDay', -540],
    ]);
  });
});

describe('one moment, one notification', () => {
  const three: TempoEvent['reminders'] = [
    { minutes: -540 },
    { from: 'dueDay', minutes: 900 },
    { from: 'dueDay', minutes: -540 },
  ];

  it('sends a one-day entry’s start and due reminders once, as the due one', () => {
    const e = event({ startDate: '2026-07-15', endDate: '2026-07-15', reminders: three });
    const w = MONTH(7);
    const due = dueReminders([e], NO_OVERRIDES, w.after, w.upTo);

    expect(due.map((d) => [d.anchor, d.minutes])).toEqual([
      ['dueDay', 900],
      ['dueDay', -540],
    ]);
  });

  it('sends all three once the entry is stretched', () => {
    const e = event({ startDate: '2026-07-13', endDate: '2026-07-17', reminders: three });
    const w = MONTH(7);

    expect(firedAt([e], w.after, w.upTo)).toEqual([
      instant(2026, 7, 13, 9 * 60).toISOString(),
      instant(2026, 7, 16, 9 * 60).toISOString(),
      instant(2026, 7, 17, 9 * 60).toISOString(),
    ]);
  });

  it('prefers the reminder nearer the deadline on a two-day entry', () => {
    // Starts Thursday, due Friday: "starts today" and "due tomorrow" are both
    // Thursday 09:00.
    const e = event({ startDate: '2026-07-16', endDate: '2026-07-17', reminders: three });
    const w = MONTH(7);
    const due = dueReminders([e], NO_OVERRIDES, w.after, w.upTo);

    expect(due.map((d) => [d.anchor, d.minutes])).toEqual([
      ['dueDay', 900],
      ['dueDay', -540],
    ]);
  });

  it('reports what it merged, for the form to say so', () => {
    const e = event({
      startDate: '2026-07-15',
      endDate: '2026-07-15',
      reminders: [{ minutes: -540 }, { from: 'dueDay', minutes: -540 }],
    });
    const [occ] = expandEvent(e, [], '2026-07-15', '2026-07-15');

    expect(planReminders(occ, e).map((p) => [p.anchor, p.merged])).toEqual([
      ['start', true],
      ['dueDay', false],
    ]);
  });
});

describe('after the deadline', () => {
  it('sends a 09:00 reminder for a 07:00 deadline an hour before it instead', () => {
    const e = timed('2026-07-15', 7 * 60, { reminders: [{ from: 'dueDay', minutes: -540 }] });
    const w = MONTH(7);
    const [due] = dueReminders([e], NO_OVERRIDES, w.after, w.upTo);

    expect(due.fireAt.toISOString()).toBe(instant(2026, 7, 15, 6 * 60).toISOString());
    expect(due.late).toBe(true);
  });

  it('does the same on an all-day entry due early in the morning', () => {
    const e = event({
      startDate: '2026-07-15',
      endDate: '2026-07-15',
      dueMinutes: 7 * 60,
      reminders: [{ from: 'dueDay', minutes: -540 }],
    });
    const w = MONTH(7);

    expect(firedAt([e], w.after, w.upTo)).toEqual([instant(2026, 7, 15, 6 * 60).toISOString()]);
  });

  it('merges a moved reminder into a lead that lands on the same minute', () => {
    const e = timed('2026-07-15', 7 * 60, {
      reminders: [{ from: 'dueDay', minutes: -540 }, { minutes: 60 }],
    });
    const w = MONTH(7);
    const due = dueReminders([e], NO_OVERRIDES, w.after, w.upTo);

    expect(due.map((d) => [d.anchor, d.late])).toEqual([['start', false]]);
  });

  it('never moves a lead, which is before the time by definition', () => {
    const e = timed('2026-07-15', 7 * 60, { reminders: [{ minutes: 0 }] });
    const w = MONTH(7);
    const [due] = dueReminders([e], NO_OVERRIDES, w.after, w.upTo);

    expect(due.fireAt.toISOString()).toBe(instant(2026, 7, 15, 7 * 60).toISOString());
    expect(due.late).toBe(false);
  });

  it('leaves a reminder before the deadline where it is', () => {
    const e = event({
      startDate: '2026-07-15',
      endDate: '2026-07-15',
      dueMinutes: 9 * 60 + 30,
      reminders: [{ from: 'dueDay', minutes: -540 }],
    });
    const w = MONTH(7);

    expect(firedAt([e], w.after, w.upTo)).toEqual([instant(2026, 7, 15, 9 * 60).toISOString()]);
  });
});

// ---------------------------------------------------------------------- text

describe('reminderText', () => {
  /** The body of the one reminder `e` sends in July. */
  function body(e: TempoEvent): string {
    const w = MONTH(7);
    const [due] = dueReminders([e], NO_OVERRIDES, w.after, w.upTo);
    return reminderText(due).body;
  }

  const birthday = (reminders: TempoEvent['reminders']) =>
    event({
      title: 'Mom',
      kind: 'birthday',
      startDate: '1974-06-14',
      endDate: '1974-06-14',
      anchorDate: '1974-06-14',
      displayTemplate: '{title} > {yearsSince}',
      recurrence: { freq: 'YEARLY', interval: 1, onInvalid: 'clamp' },
      reminders,
    });

  it('uses the derived title, so a birthday arrives with the age on it', () => {
    const [due] = dueReminders(
      [birthday([{ minutes: 900 }])],
      NO_OVERRIDES,
      new Date(Date.UTC(2026, 5, 1)),
      new Date(Date.UTC(2026, 6, 1)),
    );

    expect(reminderText(due).title).toBe('Mom > 52');
    expect(reminderText(due).body).toBe('tomorrow');
  });

  it('counts the minutes to midnight rather than saying tomorrow', () => {
    const [due] = dueReminders(
      [birthday([{ minutes: 5 }])],
      NO_OVERRIDES,
      new Date(Date.UTC(2026, 5, 1)),
      new Date(Date.UTC(2026, 6, 1)),
    );

    expect(reminderText(due).body).toBe('in 5 min · midnight');
  });

  it('says the clock time for a timed event', () => {
    const e = timed('2026-07-15', 14 * 60, { title: 'Dentist', reminders: [{ minutes: 30 }] });
    const w = MONTH(7);
    const [due] = dueReminders([e], NO_OVERRIDES, w.after, w.upTo);

    expect(reminderText(due)).toEqual({ title: 'Dentist', body: 'in 30 min · 2pm' });
  });

  it('names the day and the time for a timed entry’s day reminders', () => {
    const e = timed('2026-07-15', 7 * 60, { reminders: [{ from: 'dueDay', minutes: 900 }] });
    expect(body(e)).toBe('tomorrow · 7am');
  });

  it('says how long is left when a reminder was moved before the deadline', () => {
    const exam = timed('2026-07-15', 7 * 60, { reminders: [{ from: 'dueDay', minutes: -540 }] });
    expect(body(exam)).toBe('in 1 hour · 7am');

    const early = event({
      startDate: '2026-07-15',
      endDate: '2026-07-15',
      dueMinutes: 7 * 60,
      reminders: [{ from: 'dueDay', minutes: -540 }],
    });
    expect(body(early)).toBe('due in 1 hour · 7am');
  });

  it('says when a deadline is due, with the due time', () => {
    const e = (reminders: TempoEvent['reminders']) =>
      event({
        startDate: '2026-07-13',
        endDate: '2026-07-17',
        dueMinutes: 23 * 60 + 55,
        reminders,
      });

    expect(body(e([{ from: 'dueDay', minutes: 900 }]))).toBe('due tomorrow · 11:55pm');
    expect(body(e([{ from: 'dueDay', minutes: -540 }]))).toBe('due today · 11:55pm');
    expect(body(e([{ from: 'dueDay', minutes: 2340 }]))).toBe('due in 2 days · 11:55pm');
  });

  it('says only the day when nothing states a time', () => {
    const e = event({
      startDate: '2026-07-13',
      endDate: '2026-07-17',
      reminders: [{ from: 'dueDay', minutes: 900 }],
    });

    expect(body(e)).toBe('due tomorrow');
  });

  it('says when a stretched entry starts, and how long until it is due', () => {
    const e = event({
      startDate: '2026-07-13',
      endDate: '2026-07-17',
      reminders: [{ minutes: -540 }],
    });
    expect(body(e)).toBe('starts today · due in 4 days');
  });

  it('calls a one-day entry’s start reminder what it is: due', () => {
    const e = event({
      startDate: '2026-07-15',
      endDate: '2026-07-15',
      dueMinutes: 23 * 60 + 55,
      reminders: [{ minutes: 900 }],
    });
    expect(body(e)).toBe('due tomorrow · 11:55pm');
  });

  it('counts a due-time lead down to the due time', () => {
    const e = event({
      startDate: '2026-07-15',
      endDate: '2026-07-15',
      dueMinutes: 18 * 60,
      reminders: [{ from: 'due', minutes: 60 }],
    });
    expect(body(e)).toBe('due in 1 hour · 6pm');
  });
});

// ------------------------------------------------------------------ defaults

describe('defaults and parsing', () => {
  const DUE_AT_NIGHT = 23 * 60 + 55;

  it('gives a deadline a start, a day before, and the day it is due', () => {
    expect(
      defaultReminders('event', { allDay: true, repeats: false, dueMinutes: DUE_AT_NIGHT }),
    ).toEqual([
      { minutes: -540 },
      { from: 'dueDay', minutes: 900 },
      { from: 'dueDay', minutes: -540 },
    ]);
  });

  it('gives an all-day entry with no due time one reminder, the morning before', () => {
    // Rent is due on the first, not at 23:55 on the first. One reminder, early
    // enough that there is still a day to do something about it.
    expect(
      defaultReminders('event', { allDay: true, repeats: false, dueMinutes: null }),
    ).toEqual([{ from: 'dueDay', minutes: 900 }]);
  });

  it('gives a repeat with no due time that same single reminder', () => {
    expect(defaultReminders('event', { allDay: true, repeats: true, dueMinutes: null })).toEqual(
      defaultReminders('event', { allDay: true, repeats: false, dueMinutes: null }),
    );
  });

  it('gives a one-off with a time the day before and an hour before', () => {
    expect(
      defaultReminders('event', { allDay: false, repeats: false, dueMinutes: null }),
    ).toEqual([{ from: 'dueDay', minutes: 900 }, { minutes: 60 }]);
  });

  it('gives a repeat one reminder, since it comes round again anyway', () => {
    expect(defaultReminders('event', { allDay: false, repeats: true, dueMinutes: null })).toEqual([
      { minutes: 30 },
    ]);
    expect(
      defaultReminders('event', { allDay: true, repeats: true, dueMinutes: DUE_AT_NIGHT }),
    ).toEqual([{ from: 'dueDay', minutes: -540 }]);
  });

  it('treats marks as entries', () => {
    const entry = { allDay: true, repeats: false, dueMinutes: DUE_AT_NIGHT };
    expect(defaultReminders('milestone', entry)).toEqual(defaultReminders('event', entry));
  });

  it('nudges a birthday five minutes before midnight, and again that morning', () => {
    expect(
      defaultReminders('birthday', { allDay: true, repeats: true, dueMinutes: null }),
    ).toEqual([{ minutes: 5 }, { minutes: -540 }]);
  });

  it('collapses duplicates and sorts longest lead first', () => {
    expect(parseReminders([{ minutes: 30 }, { minutes: 1440 }, { minutes: 30 }])).toEqual([
      { minutes: 1440 },
      { minutes: 30 },
    ]);
  });

  it('keeps anchors, sorted by anchor then lead, and treats an explicit start as none', () => {
    expect(
      parseReminders([
        { from: 'dueDay', minutes: -540 },
        { from: 'start', minutes: -540 },
        { from: 'due', minutes: 60 },
        { from: 'dueDay', minutes: 900 },
        { minutes: -540 },
      ]),
    ).toEqual([
      { minutes: -540 },
      { from: 'dueDay', minutes: 900 },
      { from: 'dueDay', minutes: -540 },
      { from: 'due', minutes: 60 },
    ]);
  });

  it('degrades a malformed column to silence rather than throwing', () => {
    expect(parseReminders('every so often')).toEqual([]);
    expect(parseReminders([{ minutes: 'soon' }])).toEqual([]);
    expect(parseReminders([{ minutes: 30, from: 'lunch' }])).toEqual([]);
  });
});

describe('lead arithmetic', () => {
  it('builds leads from an amount and a unit, or a day and a time', () => {
    expect(leadMinutes(1, 'hours')).toBe(60);
    expect(leadMinutes(2, 'weeks')).toBe(20160);
    expect(allDayLeadMinutes(0, 9 * 60)).toBe(-540);
    expect(allDayLeadMinutes(1, 9 * 60)).toBe(900);
  });

  it('only offers what the dispatcher will send', () => {
    expect(isSendableLead(40320)).toBe(true);
    expect(isSendableLead(40321)).toBe(false);
    expect(isSendableLead(-1440)).toBe(true);
    expect(isSendableLead(-1441)).toBe(false);
  });
});
