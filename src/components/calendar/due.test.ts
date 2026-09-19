import { describe, expect, it } from 'vitest';
import { barDue, dayDue, dueIn, dueMoment, dueSortKey } from './due';

/** Just the fields the rules read. 2026-09-19 is a Saturday. */
function allDay(start: string, end: string, dueMinutes: number | null) {
  return { allDay: true, date: start, endDate: end, startMinutes: null, event: { dueMinutes } };
}

function timed(date: string, startMinutes: number) {
  return { allDay: false, date, endDate: date, startMinutes, event: { dueMinutes: null } };
}

describe('barDue', () => {
  it('states an all-day entry’s due time', () => {
    expect(barDue(allDay('2026-09-21', '2026-09-25', 23 * 60 + 55))).toBe('23:55');
    expect(barDue(allDay('2026-09-21', '2026-09-21', 18 * 60))).toBe('18:00');
  });

  it('says nothing for an entry that states no due time', () => {
    expect(barDue(allDay('2026-09-01', '2026-09-01', null))).toBeNull();
  });

  it('says nothing for an entry with a start time, whose title already leads with it', () => {
    expect(barDue(timed('2026-09-21', 7 * 60))).toBeNull();
  });
});

describe('dayDue', () => {
  // Monday 21 to Friday 25 September, due at 23:55.
  const week = allDay('2026-09-21', '2026-09-25', 23 * 60 + 55);

  it('gives the bare time on the day it is due', () => {
    expect(dayDue(week, '2026-09-25')).toBe('DUE 23:55');
  });

  it('names the weekday from one to six days before', () => {
    expect(dayDue(week, '2026-09-24')).toBe('DUE FRI 23:55');
    expect(dayDue(allDay('2026-09-19', '2026-09-25', 23 * 60 + 55), '2026-09-19')).toBe(
      'DUE FRI 23:55',
    );
  });

  it('dates it from seven days before', () => {
    expect(dayDue(allDay('2026-09-14', '2026-10-03', 18 * 60), '2026-09-26')).toBe(
      'DUE 03 OCT 18:00',
    );
  });

  it('says nothing without a due time, or for an entry with a start time', () => {
    expect(dayDue(allDay('2026-09-01', '2026-09-01', null), '2026-09-01')).toBeNull();
    expect(dayDue(timed('2026-09-21', 7 * 60), '2026-09-21')).toBeNull();
  });
});

describe('dueMoment', () => {
  it('is the last day and the due time for an all-day entry', () => {
    expect(dueMoment(allDay('2026-09-21', '2026-09-25', 1435))).toEqual({
      date: '2026-09-25',
      minutes: 1435,
    });
    expect(dueMoment(allDay('2026-09-01', '2026-09-01', null))).toEqual({
      date: '2026-09-01',
      minutes: null,
    });
  });

  it('is the start for an entry with a time', () => {
    expect(dueMoment(timed('2026-09-21', 420))).toEqual({ date: '2026-09-21', minutes: 420 });
  });
});

describe('dueSortKey', () => {
  it('orders by day, then minute, with a day that states no time at its end', () => {
    const noTimeFri = dueSortKey({ date: '2026-09-25', minutes: null });
    const lateFri = dueSortKey({ date: '2026-09-25', minutes: 1435 });
    const earlyFri = dueSortKey({ date: '2026-09-25', minutes: 420 });
    const thu = dueSortKey({ date: '2026-09-24', minutes: null });
    expect([noTimeFri, lateFri, earlyFri, thu].sort()).toEqual([thu, earlyFri, lateFri, noTimeFri]);
  });

  it('puts nothing ahead after everything', () => {
    expect(dueSortKey(null) > dueSortKey({ date: '2126-12-31', minutes: null })).toBe(true);
  });
});

describe('dueIn', () => {
  it('says today, tomorrow, or how many days', () => {
    expect(dueIn('2026-09-19', '2026-09-19')).toBe('TODAY');
    expect(dueIn('2026-09-20', '2026-09-19')).toBe('TOMORROW');
    expect(dueIn('2026-09-25', '2026-09-19')).toBe('IN 6D');
  });
});
