import { describe, expect, it } from 'vitest';
import { expandEvent } from './recurrence';
import { splitRule } from './split';
import type { Recurrence, TempoEvent } from './types';

function series(id: string, start: string, recurrence: Recurrence | null): TempoEvent {
  return {
    id,
    title: 'Lecture',
    notes: null,
    kind: 'event',
    categoryId: null,
    allDay: true,
    startsAt: null,
    endsAt: null,
    startDate: start,
    endDate: start,
    dueMinutes: null,
    timezone: 'America/Toronto',
    recurrence,
    reminders: [],
    anchorDate: null,
    displayTemplate: null,
    notify: false,
    source: 'tempo',
    googleEventId: null,
    deletedAt: null,
    createdAt: '',
    updatedAt: '',
  };
}

const dates = (e: TempoEvent) => expandEvent(e, [], '2026-08-01', '2027-06-30').map((o) => o.date);

describe('cutting a series at a date', () => {
  const weekly: Recurrence = { freq: 'WEEKLY', interval: 1 };

  it('ends the earlier half the day before the cut', () => {
    expect(splitRule(weekly, '2026-09-15', 3, weekly).earlier.until).toBe('2026-09-14');
  });

  it('gives the later half the rule the edit asked for', () => {
    const { later } = splitRule(weekly, '2026-09-15', 3, { freq: 'WEEKLY', interval: 2 });
    expect(later).toMatchObject({ freq: 'WEEKLY', interval: 2 });
  });

  it('sends each skipped date with the half it falls in', () => {
    const rule: Recurrence = { ...weekly, exdates: ['2026-09-08', '2026-09-22'] };
    const { earlier, later } = splitRule(rule, '2026-09-15', 3, rule);
    expect(earlier.exdates).toEqual(['2026-09-08']);
    expect(later?.exdates).toEqual(['2026-09-22']);
  });

  it('hands the later half what is left of a count', () => {
    const rule: Recurrence = { ...weekly, count: 10 };
    const { earlier, later } = splitRule(rule, '2026-09-22', 4, rule);
    expect(earlier.count).toBeNull();
    expect(later?.count).toBe(7);
  });

  it('keeps the series end on the later half', () => {
    const rule: Recurrence = { ...weekly, until: '2026-12-01' };
    expect(splitRule(rule, '2026-09-15', 3, rule).later?.until).toBe('2026-12-01');
  });

  it('makes the later half a one-off when the edit stops the repeat', () => {
    expect(splitRule(weekly, '2026-09-15', 3, null).later).toBeNull();
  });

  it('covers exactly the dates the uncut series had', () => {
    // Tuesdays from 1 September, ten of them counting a skipped one; cut at the
    // fourth, 22 September. The skipped date counts toward the ten.
    const rule: Recurrence = { ...weekly, count: 10, exdates: ['2026-09-08'] };
    const { earlier, later } = splitRule(rule, '2026-09-22', 4, rule);
    expect([
      ...dates(series('a', '2026-09-01', earlier)),
      ...dates(series('b', '2026-09-22', later)),
    ]).toEqual(dates(series('uncut', '2026-09-01', rule)));
  });
});
