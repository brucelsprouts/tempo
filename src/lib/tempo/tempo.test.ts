import { describe, expect, it } from 'vitest';
import {
  addMonths,
  civilInZone,
  daysInMonth,
  instantFromCivil,
  isCivilDate,
  minutesInZone,
  startOfWeek,
  yearsBetween,
} from './civil';
import { needsAnchor, ordinal, renderTemplate, resolveTitle, TEMPLATE_PRESETS } from './derive';
import { expandEvent } from './recurrence';
import type { OccurrenceOverride, TempoEvent } from './types';

// ------------------------------------------------------------------ fixtures

function allDayEvent(over: Partial<TempoEvent> = {}): TempoEvent {
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
    timezone: 'America/Toronto',
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

function birthday(name: string, birth: string): TempoEvent {
  return allDayEvent({
    title: name,
    kind: 'birthday',
    startDate: birth,
    endDate: birth,
    anchorDate: birth,
    displayTemplate: TEMPLATE_PRESETS.birthday,
    recurrence: { freq: 'YEARLY', interval: 1, onInvalid: 'clamp' },
  });
}

const dates = (occ: { date: string }[]) => occ.map((o) => o.date);

// --------------------------------------------------------------------- civil

describe('civil dates', () => {
  it('clamps month arithmetic to real days', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
  });

  it('knows leap years', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
  });

  it('rejects dates that do not exist', () => {
    expect(isCivilDate('2026-02-31')).toBe(false);
    expect(isCivilDate('2026-13-01')).toBe(false);
    expect(isCivilDate('2026-02-28')).toBe(true);
    expect(isCivilDate('not a date')).toBe(false);
  });

  it('counts whole years, not calendar-year differences', () => {
    // the day before the birthday, you are still the younger age
    expect(yearsBetween('1974-06-14', '2026-06-13')).toBe(51);
    expect(yearsBetween('1974-06-14', '2026-06-14')).toBe(52);
    expect(yearsBetween('1974-06-14', '2026-06-15')).toBe(52);
  });

  it('snaps to the start of the week', () => {
    // 2026-07-30 is a Thursday
    expect(startOfWeek('2026-07-30')).toBe('2026-07-26');
    expect(startOfWeek('2026-07-30', 1)).toBe('2026-07-27');
  });

  it('reads wall-clock time in a zone across DST', () => {
    // 09:00 in Toronto is 13:00Z in summer and 14:00Z in winter
    expect(minutesInZone(new Date('2026-07-30T13:00:00Z'), 'America/Toronto')).toBe(540);
    expect(minutesInZone(new Date('2026-01-15T14:00:00Z'), 'America/Toronto')).toBe(540);
  });

  it('round-trips wall-clock time back to an instant', () => {
    const tz = 'America/Toronto';
    for (const date of ['2026-07-30', '2026-01-15', '2026-03-08', '2026-11-01']) {
      const back = instantFromCivil(date, 540, tz);
      expect(civilInZone(back, tz)).toBe(date);
      expect(minutesInZone(back, tz)).toBe(540);
    }
  });

  it('keeps wall-clock time when shifting a timed event across a DST boundary', () => {
    const tz = 'America/Toronto';
    // 09:00 the day before the autumn transition, and 09:00 the day after
    const before = instantFromCivil('2026-10-31', 540, tz);
    const after = instantFromCivil('2026-11-02', 540, tz);
    expect(minutesInZone(before, tz)).toBe(540);
    expect(minutesInZone(after, tz)).toBe(540);
    // 49 real hours elapse across the fall-back, not 48
    expect(after.getTime() - before.getTime()).toBe(49 * 3600 * 1000);
  });

  it('places an instant on the right calendar square per zone', () => {
    const lateNight = new Date('2026-07-31T02:00:00Z'); // 22:00 previous day in Toronto
    expect(civilInZone(lateNight, 'America/Toronto')).toBe('2026-07-30');
    expect(civilInZone(lateNight, 'UTC')).toBe('2026-07-31');
  });
});

// -------------------------------------------------------------------- derive

describe('derived display fields', () => {
  it('renders an age from an anchor', () => {
    expect(
      renderTemplate(TEMPLATE_PRESETS.birthday, {
        title: 'Mom',
        date: '2026-06-14',
        anchorDate: '1974-06-14',
        index: 53,
      }),
    ).toBe('Mom · 52');
  });

  it('renders ordinals', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(13)).toBe('13th');
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(112)).toBe('112th');
  });

  it('renders an anniversary through a function token', () => {
    expect(
      renderTemplate(TEMPLATE_PRESETS.anniversary, {
        title: 'Wedding',
        date: '2026-09-01',
        anchorDate: '2014-09-01',
        index: 13,
      }),
    ).toBe('Wedding — 12th anniversary');
  });

  it('degrades cleanly when there is no anchor to resolve', () => {
    expect(
      renderTemplate(TEMPLATE_PRESETS.birthday, {
        title: 'Mom',
        date: '2026-06-14',
        anchorDate: null,
        index: 1,
      }),
    ).toBe('Mom');
  });

  it('leaves unknown tokens visible rather than silently dropping them', () => {
    expect(
      renderTemplate('{title} {yearSince}', {
        title: 'Mom',
        date: '2026-06-14',
        anchorDate: '1974-06-14',
        index: 1,
      }),
    ).toBe('Mom {yearSince}');
  });

  it('falls back to the raw title when there is no template', () => {
    expect(
      resolveTitle(null, { title: 'Mom', date: '2026-06-14', anchorDate: null, index: 1 }),
    ).toBe('Mom');
  });

  /**
   * Asserted over the whole preset table, and against the renderer rather than
   * against a second copy of the predicate's own regex.
   *
   * A preset needs an anchor exactly when rendering it with one differs from
   * rendering it without — that is the user-visible definition, and it is the
   * one the old `template.includes('{yearsSince}')` gate got wrong: the
   * anniversary preset wraps the token as `{ordinal(yearsSince)}`, so the form
   * never offered an anchor field and every anniversary silently lost its
   * number. Testing the table rather than one string is what stops a future
   * preset from reopening the same hole.
   */
  it('flags every preset whose output depends on an anchor', () => {
    const ctx = { title: 'Thing', date: '2026-09-01', index: 13 };
    const presets = Object.entries(TEMPLATE_PRESETS);

    const dependent = presets
      .filter(
        ([, template]) =>
          renderTemplate(template, { ...ctx, anchorDate: '2014-09-01' }) !==
          renderTemplate(template, { ...ctx, anchorDate: null }),
      )
      .map(([name]) => name);

    // Guards the guard. If this ever comes back empty the loop below passes
    // vacuously, and the regression it exists to catch walks straight back in.
    expect(dependent).toEqual(['birthday', 'anniversary']);

    for (const [name, template] of presets) {
      expect(needsAnchor(template), name).toBe(dependent.includes(name));
    }
  });

  it('treats an absent template as needing nothing', () => {
    expect(needsAnchor(null)).toBe(false);
    expect(needsAnchor(undefined)).toBe(false);
    expect(needsAnchor('')).toBe(false);
  });
});

// ---------------------------------------------------------------- recurrence

describe('recurrence expansion', () => {
  it('finds a 1974 birthday in a 2026 window and computes that year’s age', () => {
    const mom = birthday('Mom', '1974-06-14');
    const occ = expandEvent(mom, [], '2026-06-01', '2026-06-30');

    expect(occ).toHaveLength(1);
    expect(occ[0].date).toBe('2026-06-14');
    expect(occ[0].title).toBe('Mom · 52');
    // 1974 is the 1st occurrence, so 2026 is the 53rd
    expect(occ[0].index).toBe(53);
  });

  it('advances the age with the year, from one stored row', () => {
    const mom = birthday('Mom', '1974-06-14');
    const titleIn = (year: number) =>
      expandEvent(mom, [], `${year}-06-01`, `${year}-06-30`)[0].title;

    expect(titleIn(2026)).toBe('Mom · 52');
    expect(titleIn(2027)).toBe('Mom · 53');
    expect(titleIn(2044)).toBe('Mom · 70');
  });

  it('skips nonexistent dates by default', () => {
    const e = allDayEvent({
      startDate: '2026-01-31',
      endDate: '2026-01-31',
      recurrence: { freq: 'MONTHLY' },
    });
    // February has no 31st, April has no 31st
    expect(dates(expandEvent(e, [], '2026-01-01', '2026-06-30'))).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
    ]);
  });

  it('clamps instead of skipping when the rule asks it to', () => {
    const leapling = birthday('Leapling', '2024-02-29');
    expect(dates(expandEvent(leapling, [], '2025-01-01', '2027-12-31'))).toEqual([
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
    ]);
  });

  it('counts emitted occurrences, not elapsed periods', () => {
    const e = allDayEvent({
      startDate: '2026-01-31',
      endDate: '2026-01-31',
      recurrence: { freq: 'MONTHLY', count: 3 },
    });
    // naive period-counting would stop at March and yield only two
    expect(dates(expandEvent(e, [], '2026-01-01', '2027-12-31'))).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
    ]);
  });

  it('honours until', () => {
    const e = allDayEvent({
      startDate: '2026-07-06',
      endDate: '2026-07-06',
      recurrence: { freq: 'WEEKLY', until: '2026-07-20' },
    });
    expect(dates(expandEvent(e, [], '2026-07-01', '2026-08-31'))).toEqual([
      '2026-07-06',
      '2026-07-13',
      '2026-07-20',
    ]);
  });

  it('honours exdates', () => {
    const e = allDayEvent({
      startDate: '2026-07-06',
      endDate: '2026-07-06',
      recurrence: { freq: 'WEEKLY', exdates: ['2026-07-13'] },
    });
    expect(dates(expandEvent(e, [], '2026-07-01', '2026-07-31'))).toEqual([
      '2026-07-06',
      '2026-07-20',
      '2026-07-27',
    ]);
  });

  it('fans a weekly rule across selected weekdays', () => {
    // 2026-07-06 is a Monday; rule fires Mon + Wed
    const e = allDayEvent({
      startDate: '2026-07-06',
      endDate: '2026-07-06',
      recurrence: { freq: 'WEEKLY', byWeekday: [1, 3] },
    });
    expect(dates(expandEvent(e, [], '2026-07-06', '2026-07-19'))).toEqual([
      '2026-07-06',
      '2026-07-08',
      '2026-07-13',
      '2026-07-15',
    ]);
  });

  it('seeks a long-running interval rule without drifting off phase', () => {
    const e = allDayEvent({
      startDate: '2020-01-01',
      endDate: '2020-01-01',
      recurrence: { freq: 'DAILY', interval: 3 },
    });
    expect(dates(expandEvent(e, [], '2026-07-01', '2026-07-10'))).toEqual([
      '2026-07-01',
      '2026-07-04',
      '2026-07-07',
      '2026-07-10',
    ]);
  });

  it('includes a multi-day event that starts before the window', () => {
    const e = allDayEvent({ startDate: '2026-07-28', endDate: '2026-08-03' });
    const occ = expandEvent(e, [], '2026-08-01', '2026-08-07');
    expect(occ).toHaveLength(1);
    expect(occ[0].date).toBe('2026-07-28');
    expect(occ[0].endDate).toBe('2026-08-03');
  });

  it('excludes an event that misses the window entirely', () => {
    const e = allDayEvent({ startDate: '2026-07-01', endDate: '2026-07-02' });
    expect(expandEvent(e, [], '2026-08-01', '2026-08-07')).toHaveLength(0);
  });

  it('derives the day span of a timed event from its own timezone', () => {
    const e = allDayEvent({
      allDay: false,
      startDate: null,
      endDate: null,
      startsAt: '2026-07-30T13:00:00Z',
      endsAt: '2026-07-30T14:30:00Z',
    });
    const [occ] = expandEvent(e, [], '2026-07-01', '2026-07-31');
    expect(occ.date).toBe('2026-07-30');
    expect(occ.startMinutes).toBe(540); // 09:00 local
    expect(occ.endMinutes).toBe(630); // 10:30 local
  });

  it('keeps a recurring meeting at the same wall-clock time across DST', () => {
    const e = allDayEvent({
      allDay: false,
      startDate: null,
      endDate: null,
      startsAt: '2026-07-30T13:00:00Z', // 09:00 EDT
      endsAt: '2026-07-30T14:00:00Z',
      recurrence: { freq: 'WEEKLY' },
    });
    const winter = expandEvent(e, [], '2026-12-01', '2026-12-31');
    expect(winter.length).toBeGreaterThan(0);
    for (const occ of winter) expect(occ.startMinutes).toBe(540);
  });
});

// ----------------------------------------------------------------- overrides

describe('occurrence overrides', () => {
  const mom = birthday('Mom', '1974-06-14');

  const override = (o: Partial<OccurrenceOverride>): OccurrenceOverride => ({
    id: 'o1',
    eventId: mom.id,
    occurrenceDate: '2026-06-14',
    cancelled: false,
    patch: {},
    ...o,
  });

  it('cancels a single instance without touching the series', () => {
    const occ = expandEvent(mom, [override({ cancelled: true })], '2026-01-01', '2027-12-31');
    expect(dates(occ)).toEqual(['2027-06-14']);
  });

  it('moves a single instance and keeps the derived value of its series date', () => {
    const occ = expandEvent(
      mom,
      [override({ patch: { startDate: '2026-06-20', endDate: '2026-06-20' } })],
      '2026-06-01',
      '2026-06-30',
    );
    expect(occ[0].date).toBe('2026-06-20');
    expect(occ[0].seriesDate).toBe('2026-06-14');
    // dragging the celebration to the weekend does not change how old she is
    expect(occ[0].title).toBe('Mom · 52');
    expect(occ[0].isOverride).toBe(true);
  });

  it('pulls an instance into view when an override moved it there', () => {
    // the series date sits outside the window; the patched date sits inside it
    const occ = expandEvent(
      mom,
      [override({ patch: { startDate: '2026-07-02', endDate: '2026-07-02' } })],
      '2026-07-01',
      '2026-07-31',
    );
    expect(occ).toHaveLength(1);
    expect(occ[0].date).toBe('2026-07-02');
    expect(occ[0].title).toBe('Mom · 52');
  });

  it('lets an override retitle one instance, overriding the template', () => {
    const occ = expandEvent(
      mom,
      [override({ patch: { title: 'Mom (surprise party)' } })],
      '2026-06-01',
      '2026-06-30',
    );
    expect(occ[0].title).toBe('Mom (surprise party)');
  });
});
