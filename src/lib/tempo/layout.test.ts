import { describe, expect, it } from 'vitest';
import { KIND_HEIGHT, LANE_GAP, layoutWeek } from './layout';
import type { EventKind, Occurrence } from './types';

// week of Sunday 2026-07-26 … Saturday 2026-08-01
const WEEK_START = '2026-07-26';

/** ROW_H 146 − DAY_HEADER_H 30 − OVERFLOW_H 13. Mirrors `constants.ts`. */
const BUDGET = 103;

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

  it('rolls anything past the pixel budget into a per-day overflow count', () => {
    const many = Array.from({ length: 6 }, (_, i) => occ(`e${i}`, '2026-07-29'));
    const { segments, overflow, laneCount } = layoutWeek(WEEK_START, many, BUDGET);

    // 21px events at a 3px gap: lanes start at 0, 24, 48, 72, 96. The fifth
    // would end at 117, past 103, so four are drawn and two roll up.
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

/**
 * The density trade, asserted rather than described.
 *
 * These are the three cases the row budget was chosen against, so they are the
 * three that would notice if `ROW_H`, `KIND_HEIGHT` or `LANE_GAP` moved. Each
 * states the arithmetic it depends on, so a failure says which number changed
 * instead of only that something did.
 */
describe('variable bar heights', () => {
  const kinded = (key: string, kind: EventKind, date = '2026-07-29'): Occurrence => ({
    ...occ(key, date),
    kind,
    status: kind === 'assignment' ? 'todo' : null,
  });

  const drawn = (segs: { hidden: boolean }[]) => segs.filter((s) => !s.hidden).length;

  it('fits four events — 0, 24, 48, 72, last bottom at 93', () => {
    const { segments, laneTops } = layoutWeek(
      WEEK_START,
      Array.from({ length: 4 }, (_, i) => kinded(`e${i}`, 'event')),
      BUDGET,
    );
    expect(laneTops.slice(0, 4)).toEqual([0, 24, 48, 72]);
    expect(72 + KIND_HEIGHT.event).toBe(93);
    expect(drawn(segments)).toBe(4);
  });

  it('fits three tasks — 0, 35, 70, last bottom at 102', () => {
    const { segments, laneTops } = layoutWeek(
      WEEK_START,
      Array.from({ length: 3 }, (_, i) => kinded(`t${i}`, 'assignment')),
      BUDGET,
    );
    expect(laneTops.slice(0, 3)).toEqual([0, 35, 70]);
    expect(70 + KIND_HEIGHT.assignment).toBe(102);
    expect(drawn(segments)).toBe(3);
  });

  it('draws three and one "+1" for two tasks plus two events', () => {
    const { segments, overflow } = layoutWeek(
      WEEK_START,
      [
        kinded('t0', 'assignment'),
        kinded('t1', 'assignment'),
        kinded('e0', 'event'),
        kinded('e1', 'event'),
      ],
      BUDGET,
    );
    // 32, 32, 21 → lanes at 0, 35, 70; the fourth starts at 94 and would end
    // at 115. This is the density cost of ranking kinds by height.
    expect(drawn(segments)).toBe(3);
    expect(segments.filter((s) => s.hidden)).toHaveLength(1);
    expect(overflow[3]).toBe(1);
  });

  it('keeps a bar at its own height, not its lane’s', () => {
    // A short bar sharing a lane row with a task must not be stretched to match.
    const { segments } = layoutWeek(
      WEEK_START,
      [kinded('task', 'assignment', '2026-07-26'), kinded('mark', 'milestone', '2026-07-30')],
      BUDGET,
    );
    const mark = segments.find((s) => s.occurrence.key === 'mark')!;
    const task = segments.find((s) => s.occurrence.key === 'task')!;
    expect(mark.lane).toBe(task.lane); // same lane — they don't overlap
    expect(mark.height).toBe(KIND_HEIGHT.milestone);
    expect(task.height).toBe(KIND_HEIGHT.assignment);
    expect(mark.top).toBe(task.top);
  });

  it('sizes a lane by its tallest occupant', () => {
    const { segments, laneHeights, laneTops } = layoutWeek(
      WEEK_START,
      [
        kinded('task', 'assignment', '2026-07-26'),
        // Shares the task's column, so it is forced into a different lane
        // rather than packing in beside it — which is the case being measured.
        kinded('other', 'event', '2026-07-26'),
        // Clear of both, so it joins whichever lane has room. It is the short
        // bar that must not shrink its lane below the task's height.
        kinded('mark', 'milestone', '2026-07-30'),
      ],
      BUDGET,
    );

    // Which lane the task landed in is a tiebreak detail, not the behaviour
    // under test — asserting lane 0 would make this fail if the sort ever
    // changed its mind about two same-day bars.
    const task = segments.find((s) => s.occurrence.key === 'task')!;
    const other = segments.find((s) => s.occurrence.key === 'other')!;
    const mark = segments.find((s) => s.occurrence.key === 'mark')!;

    expect(laneHeights[task.lane]).toBe(KIND_HEIGHT.assignment);

    // The mark packs in beside the event, and their shared lane keeps the
    // taller one's height — a 14px bar must not shrink the lane under a 21px
    // one, or the bar above would overlap it.
    expect(mark.lane).toBe(other.lane);
    expect(laneHeights[other.lane]).toBe(KIND_HEIGHT.event);

    // Tops are cumulative: every lane begins one gap below the previous lane's
    // full height, whatever mix of kinds produced it.
    for (let i = 1; i < laneTops.length; i++) {
      expect(laneTops[i]).toBe(laneTops[i - 1] + laneHeights[i - 1] + LANE_GAP);
    }
  });
});
