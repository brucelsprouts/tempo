import { describe, expect, it } from 'vitest';
import { addDays } from './civil';
import { KIND_HEIGHT, LANE_GAP, layoutWeek, occurrencesInMarquee } from './layout';
import type { EventKind, Occurrence } from './types';

// week of Sunday 2026-07-26 … Saturday 2026-08-01
const WEEK_START = '2026-07-26';

/** ROW_H 190 − DAY_HEADER_H 34 − OVERFLOW_H 15. Mirrors `constants.ts`. */
const BUDGET = 141;
/** The other two figures the grid is drawn from. Also `constants.ts`. */
const ROW_H = 190;
const DAY_HEADER_H = 34;

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

    // 28px events at a 4px gap: lanes start at 0, 32, 64, 96, 128. The fifth
    // would end at 156, past 141, so four are drawn and two roll up.
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

  it('measures `top` from the lane area, not from the row', () => {
    // The header offset is added once, by `WeekRow`, when it positions the bar
    // overlay — and the lasso's hit test adds it again for the same reason. If
    // it is ever "fixed" here as well it would be counted twice against the
    // budget and every bar would be selectable a header's height below where it
    // is drawn.
    const [seg] = layoutWeek(WEEK_START, [occ('a', '2026-07-28')], BUDGET).segments;
    expect(seg.lane).toBe(0);
    expect(seg.top).toBe(0);
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

  it('fits four events — 0, 32, 64, 96, last bottom at 124', () => {
    const { segments, laneTops } = layoutWeek(
      WEEK_START,
      Array.from({ length: 4 }, (_, i) => kinded(`e${i}`, 'event')),
      BUDGET,
    );
    expect(laneTops.slice(0, 4)).toEqual([0, 32, 64, 96]);
    expect(96 + KIND_HEIGHT.event).toBe(124);
    expect(drawn(segments)).toBe(4);
  });

  it('fits three tasks — 0, 46, 92, last bottom at 134', () => {
    const { segments, laneTops } = layoutWeek(
      WEEK_START,
      Array.from({ length: 3 }, (_, i) => kinded(`t${i}`, 'assignment')),
      BUDGET,
    );
    expect(laneTops.slice(0, 3)).toEqual([0, 46, 92]);
    expect(92 + KIND_HEIGHT.assignment).toBe(134);
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
    // Four bars on one day is 28 + 28 + 42 + 42 of bar and three 4px gaps, so
    // the last lane ends at 152 whichever order they were assigned in — past
    // 141, and the third ends at 106, so three draw and one counts. This is
    // the density cost of ranking kinds by height, and it is unchanged: at the
    // old figures the same four ended at 115 against a 103px budget.
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
    // taller one's height — a 20px bar must not shrink the lane under a 28px
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

/**
 * The lasso, without a DOM.
 *
 * These are the cases the arithmetic exists for. A marquee dragged past the
 * viewport covers rows the virtualiser never mounted, so a hit test that read
 * element rects would quietly select only the visible part of the sweep — which
 * is exactly what cannot be caught by driving the app, because on screen it
 * looks like the selection simply stopped where you expected it to.
 */
describe('lasso hit-testing', () => {
  const COL_W = 100;
  const METRICS = { colWidth: COL_W, rowH: ROW_H, headerH: DAY_HEADER_H };

  /** Week 10 is `WEEK_START`; the epoch is three rows long, 10 through 12. */
  const weekStartOf = (index: number) => addDays(WEEK_START, (index - 10) * 7);

  /** A row lookup over one fixture set. `layoutWeek` clips to the week itself. */
  const grid = (occurrences: Occurrence[]) => (index: number) =>
    index >= 10 && index <= 12 ? layoutWeek(weekStartOf(index), occurrences, BUDGET) : null;

  /** Content-space y, `offset` px into the given row. */
  const at = (week: number, offset: number) => week * ROW_H + offset;

  // Lanes of 28px events sit at 0 and 32, so in row coordinates the first two
  // bars occupy [34, 62] and [66, 94].
  const LANE_0 = DAY_HEADER_H + 5;
  const LANE_1 = DAY_HEADER_H + KIND_HEIGHT.event + LANE_GAP + 5;

  const FIXTURE = [
    occ('mon', '2026-07-27'), //           week 10, column 1
    occ('thu', '2026-07-30'), //           week 10, column 4
    occ('across', '2026-07-31', '2026-08-04'), // weeks 10 and 11
    occ('next', '2026-08-11'), //          week 12, column 2
  ];

  it('takes the bars inside the rect and leaves the ones beside it', () => {
    const hits = occurrencesInMarquee(
      { x0: 0, y0: at(10, 0), x1: 2.5 * COL_W, y1: at(10, ROW_H) },
      grid(FIXTURE),
      METRICS,
    );
    expect([...hits]).toEqual(['mon']);
  });

  it('picks the lane the band actually crosses', () => {
    // Two bars on one day, so which lane each lands in is settled by the sort's
    // final tiebreak on the key rather than by anything under test here.
    const stacked = [occ('upper', '2026-07-29'), occ('zlower', '2026-07-29')];
    const sweep = (offset: number) =>
      occurrencesInMarquee(
        { x0: 0, y0: at(10, offset), x1: 7 * COL_W, y1: at(10, offset + 10) },
        grid(stacked),
        METRICS,
      );

    expect([...sweep(LANE_0)]).toEqual(['upper']);
    expect([...sweep(LANE_1)]).toEqual(['zlower']);
  });

  it('reaches rows that were never rendered', () => {
    const hits = occurrencesInMarquee(
      { x0: 0, y0: at(10, LANE_0), x1: 7 * COL_W, y1: at(12, LANE_0 + 10) },
      grid(FIXTURE),
      METRICS,
    );
    // `across` is drawn as two segments in two rows and is one entry in both.
    expect(hits).toEqual(new Set(['mon', 'thu', 'across', 'next']));
  });

  it('reads the same dragged backwards as forwards', () => {
    const forwards = { x0: 0, y0: at(10, LANE_0), x1: 7 * COL_W, y1: at(11, LANE_0 + 10) };
    const backwards = { x0: forwards.x1, y0: forwards.y1, x1: forwards.x0, y1: forwards.y0 };
    expect(occurrencesInMarquee(backwards, grid(FIXTURE), METRICS)).toEqual(
      occurrencesInMarquee(forwards, grid(FIXTURE), METRICS),
    );
  });

  it('takes nothing from a sweep that stays inside the day headers', () => {
    const hits = occurrencesInMarquee(
      { x0: 0, y0: at(10, 2), x1: 7 * COL_W, y1: at(10, DAY_HEADER_H - 2) },
      grid(FIXTURE),
      METRICS,
    );
    expect(hits.size).toBe(0);
  });

  it('ignores rows outside the epoch rather than inventing them', () => {
    const hits = occurrencesInMarquee(
      { x0: 0, y0: at(-40, 0), x1: 7 * COL_W, y1: at(9, ROW_H) },
      grid(FIXTURE),
      METRICS,
    );
    expect(hits.size).toBe(0);
  });

  it('skips bars that rolled into a "+N" chip instead of being drawn', () => {
    // Six on one day: four are drawn and two are counted, and a chip has no
    // outline to light.
    const many = Array.from({ length: 6 }, (_, i) => occ(`e${i}`, '2026-07-29'));
    const hits = occurrencesInMarquee(
      { x0: 0, y0: at(10, 0), x1: 7 * COL_W, y1: at(10, ROW_H) },
      grid(many),
      METRICS,
    );
    expect(hits.size).toBe(4);
  });

  it('skips read-only instances, which refuse everything a selection can do', () => {
    const hits = occurrencesInMarquee(
      { x0: 0, y0: at(10, 0), x1: 7 * COL_W, y1: at(10, ROW_H) },
      grid([{ ...occ('google', '2026-07-27'), readOnly: true }, occ('mine', '2026-07-29')]),
      METRICS,
    );
    expect([...hits]).toEqual(['mine']);
  });

  it('selects nothing before the columns have been measured', () => {
    const hits = occurrencesInMarquee(
      { x0: 0, y0: at(10, 0), x1: 700, y1: at(12, ROW_H) },
      grid(FIXTURE),
      { ...METRICS, colWidth: 0 },
    );
    expect(hits.size).toBe(0);
  });
});
