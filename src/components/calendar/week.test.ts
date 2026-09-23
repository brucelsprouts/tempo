import { describe, expect, it } from 'vitest';
import { allDayBands, shiftWeek, weekDays } from './week';

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

describe('banding all-day entries across the week', () => {
  const week = weekDays('2026-09-22'); // 2026-09-20 … 2026-09-26
  const entry = (key: string, date: string, endDate = date) => ({ key, date, endDate });

  it('draws a multi-day entry as one band, not one chip per day', () => {
    const bands = allDayBands([entry('conf', '2026-09-21', '2026-09-23')], week);
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({ startCol: 1, endCol: 3, lane: 0 });
  });

  it('clips a band that runs in from an earlier week and out into a later one', () => {
    const [band] = allDayBands([entry('term', '2026-09-14', '2026-10-02')], week);
    expect(band).toMatchObject({
      startCol: 0,
      endCol: 6,
      continuesBefore: true,
      continuesAfter: true,
    });
  });

  it('marks a band that ends inside the week as uncut', () => {
    const [band] = allDayBands([entry('trip', '2026-09-22', '2026-09-24')], week);
    expect(band.continuesBefore).toBe(false);
    expect(band.continuesAfter).toBe(false);
  });

  it('stacks overlapping bands into separate lanes', () => {
    const bands = allDayBands(
      [entry('a', '2026-09-21', '2026-09-23'), entry('b', '2026-09-22', '2026-09-24')],
      week,
    );
    expect(bands.map((b) => b.lane).sort()).toEqual([0, 1]);
  });

  it('reuses a lane for entries that never share a day', () => {
    const bands = allDayBands(
      [entry('a', '2026-09-21', '2026-09-22'), entry('b', '2026-09-24', '2026-09-25')],
      week,
    );
    expect(bands.every((b) => b.lane === 0)).toBe(true);
  });

  it('puts the longest band in the top lane', () => {
    const bands = allDayBands(
      [entry('short', '2026-09-22'), entry('long', '2026-09-20', '2026-09-26')],
      week,
    );
    expect(bands.find((b) => b.occ.key === 'long')!.lane).toBe(0);
    expect(bands.find((b) => b.occ.key === 'short')!.lane).toBe(1);
  });

  it('drops entries that miss the week entirely', () => {
    expect(allDayBands([entry('past', '2026-09-01', '2026-09-19')], week)).toEqual([]);
    expect(allDayBands([entry('future', '2026-09-27', '2026-09-28')], week)).toEqual([]);
  });

  it('orders lanes the same way whichever order the entries arrive in', () => {
    const a = entry('a', '2026-09-21', '2026-09-22');
    const b = entry('b', '2026-09-21', '2026-09-22');
    const lanes = (list: typeof week extends never ? never : Array<ReturnType<typeof entry>>) =>
      allDayBands(list, week).map((x) => [x.occ.key, x.lane] as const);
    expect(lanes([a, b])).toEqual(lanes([b, a]));
  });
});
