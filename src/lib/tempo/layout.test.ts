import { describe, expect, it } from 'vitest';
import { layoutWeek } from './layout';
import type { Occurrence } from './types';

// week of Sunday 2026-07-26 … Saturday 2026-08-01
const WEEK_START = '2026-07-26';

function occ(key: string, date: string, endDate = date): Occurrence {
  return {
    key,
    eventId: key,
    event: null as never,
    date,
    endDate,
    seriesDate: date,
    index: 1,
    title: key,
    allDay: true,
    startMinutes: null,
    endMinutes: null,
    kind: 'event',
    status: null,
    categoryId: null,
    isOverride: false,
    readOnly: false,
  };
}

const laneOf = (segs: { occurrence: Occurrence; lane: number }[], key: string) =>
  segs.find((s) => s.occurrence.key === key)!.lane;

describe('week layout', () => {
  it('puts non-overlapping bars in the same lane', () => {
    const { segments, laneCount } = layoutWeek(WEEK_START, [
      occ('a', '2026-07-26', '2026-07-27'),
      occ('b', '2026-07-30', '2026-07-31'),
    ]);
    expect(laneOf(segments, 'a')).toBe(0);
    expect(laneOf(segments, 'b')).toBe(0);
    expect(laneCount).toBe(1);
  });

  it('stacks bars that share a column', () => {
    const { segments, laneCount } = layoutWeek(WEEK_START, [
      occ('a', '2026-07-26', '2026-07-29'),
      occ('b', '2026-07-28', '2026-07-30'),
      occ('c', '2026-07-29', '2026-07-29'),
    ]);
    expect(laneOf(segments, 'a')).toBe(0);
    expect(laneOf(segments, 'b')).toBe(1);
    expect(laneOf(segments, 'c')).toBe(2);
    expect(laneCount).toBe(3);
  });

  it('clips a bar to the week and flags both continuations', () => {
    const [seg] = layoutWeek(WEEK_START, [occ('a', '2026-07-20', '2026-08-10')]).segments;
    expect(seg.startCol).toBe(0);
    expect(seg.endCol).toBe(6);
    expect(seg.continuesBefore).toBe(true);
    expect(seg.continuesAfter).toBe(true);
  });

  it('maps dates onto the right columns', () => {
    const [seg] = layoutWeek(WEEK_START, [occ('a', '2026-07-28', '2026-07-30')]).segments;
    expect(seg.startCol).toBe(2); // Tuesday
    expect(seg.endCol).toBe(4); // Thursday
    expect(seg.continuesBefore).toBe(false);
    expect(seg.continuesAfter).toBe(false);
  });

  it('drops occurrences that miss the week entirely', () => {
    expect(layoutWeek(WEEK_START, [occ('a', '2026-09-01')]).segments).toHaveLength(0);
  });

  it('rolls anything past the lane cap into a per-day overflow count', () => {
    const many = Array.from({ length: 6 }, (_, i) => occ(`e${i}`, '2026-07-29'));
    const { segments, overflow, laneCount } = layoutWeek(WEEK_START, many, 4);

    expect(laneCount).toBe(4);
    expect(segments.filter((s) => s.hidden)).toHaveLength(2);
    expect(overflow[3]).toBe(2); // Wednesday column
    expect(overflow[0]).toBe(0);
  });

  it('gives long bars the top lanes so rows stay stable across boundaries', () => {
    const { segments } = layoutWeek(WEEK_START, [
      occ('short', '2026-07-26'),
      occ('long', '2026-07-26', '2026-08-01'),
    ]);
    expect(laneOf(segments, 'long')).toBe(0);
    expect(laneOf(segments, 'short')).toBe(1);
  });
});
