import { describe, expect, it } from 'vitest';
import type { Recurrence } from '@/lib/tempo/types';
import { clampInterval, periodWord, repeatRule } from './repeat';

describe('the rule REPEATS and EVERY describe', () => {
  const weekdays: Recurrence = {
    freq: 'WEEKLY',
    interval: 1,
    byWeekday: [1, 2, 3, 4, 5],
    until: '2026-12-18',
  };

  it('hands back the stored rule itself when nothing changed', () => {
    expect(repeatRule(weekdays, 'WEEKLY', 1)).toBe(weekdays);
    // Stored without an interval, which reads as 1.
    const bare: Recurrence = { freq: 'MONTHLY' };
    expect(repeatRule(bare, 'MONTHLY', 1)).toBe(bare);
  });

  it('changes only the interval on the same frequency', () => {
    expect(repeatRule(weekdays, 'WEEKLY', 2)).toEqual({ ...weekdays, interval: 2 });
  });

  it('keeps the end, the count and the skipped dates across a frequency change', () => {
    const rule: Recurrence = { ...weekdays, count: 20, exdates: ['2026-10-12'] };
    expect(repeatRule(rule, 'DAILY', 3)).toEqual({
      freq: 'DAILY',
      interval: 3,
      until: '2026-12-18',
      count: 20,
      exdates: ['2026-10-12'],
    });
  });

  it('drops the weekday set a new frequency cannot use', () => {
    expect(repeatRule(weekdays, 'MONTHLY', 1)).not.toHaveProperty('byWeekday');
  });

  it('builds a fresh rule for an entry that did not repeat', () => {
    expect(repeatRule(null, 'WEEKLY', 2)).toEqual({ freq: 'WEEKLY', interval: 2 });
  });

  it('says nothing for ONCE', () => {
    expect(repeatRule(weekdays, 'NONE', 1)).toBeNull();
  });

  it('keeps EVERY between 1 and 99', () => {
    expect(clampInterval(0)).toBe(1);
    expect(clampInterval(250)).toBe(99);
    expect(clampInterval(2.6)).toBe(3);
    expect(clampInterval(Number.NaN)).toBe(1);
  });

  it('pluralises the period', () => {
    expect(periodWord('WEEKLY', 1)).toBe('WEEK');
    expect(periodWord('DAILY', 3)).toBe('DAYS');
  });
});
