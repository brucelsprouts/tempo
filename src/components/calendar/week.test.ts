import { describe, expect, it } from 'vitest';
import { shiftWeek, weekDays } from './week';

describe('the seven days of a week', () => {
  it('runs Sunday to Saturday around a midweek date', () => {
    // 2026-09-22 is a Tuesday.
    expect(weekDays('2026-09-22')).toEqual([
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
    ]);
  });

  it('starts on the date itself when that date is a Sunday', () => {
    expect(weekDays('2026-09-20')[0]).toBe('2026-09-20');
  });

  it('puts a Saturday last in its own week', () => {
    const days = weekDays('2026-09-26');
    expect(days[0]).toBe('2026-09-20');
    expect(days[6]).toBe('2026-09-26');
  });

  it('crosses a month boundary', () => {
    // 2026-10-01 is a Thursday, so its week opens in September.
    expect(weekDays('2026-10-01')).toEqual([
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
  });

  it('crosses a year boundary', () => {
    // 2027-01-01 is a Friday.
    const days = weekDays('2027-01-01');
    expect(days[0]).toBe('2026-12-27');
    expect(days[6]).toBe('2027-01-02');
  });

  it('always returns seven days', () => {
    for (const d of ['2026-02-28', '2028-02-29', '2026-12-31', '2027-03-14']) {
      expect(weekDays(d)).toHaveLength(7);
    }
  });
});

describe('stepping between weeks', () => {
  it('lands on the next week and back again', () => {
    expect(shiftWeek('2026-09-22', 1)).toBe('2026-09-27');
    expect(shiftWeek('2026-09-22', -1)).toBe('2026-09-13');
    expect(shiftWeek(shiftWeek('2026-09-22', 1), -1)).toBe('2026-09-20');
  });
});
