import { describe, expect, it } from 'vitest';
import { addDays } from './civil';
import { KIND_HEIGHT, LANE_GAP, layoutWeek, occurrencesInMarquee, rowsInBand } from './layout';
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

  it('does not hide segments past the pixel budget and calculates contentHeight', () => {
    const many = Array.from({ length: 6 }, (_, i) => occ(`e${i}`, '2026-07-29'));
    const { segments, overflow, laneCount, contentHeight } = layoutWeek(WEEK_START, many, BUDGET);

    // 56px events at a 4px gap: lanes start at 0, 60, 120, 180, 240, 300.
    // Bottom of the last segment is 300 + 56 = 356.
    expect(laneCount).toBe(6);
    expect(segments.filter((s) => s.hidden)).toHaveLength(0);
    expect(overflow[3]).toBe(0);
    expect(contentHeight).toBe(356);
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
  });

  const drawn = (segs: { hidden: boolean }[]) => segs.filter((s) => !s.hidden).length;

  it('stacks four events — 0, 60, 120, 180, last bottom at 236', () => {
    const { segments, laneTops } = layoutWeek(
      WEEK_START,
      Array.from({ length: 4 }, (_, i) => kinded(`e${i}`, 'event')),
      BUDGET,
    );
    expect(laneTops.slice(0, 4)).toEqual([0, 60, 120, 180]);
    expect(180 + KIND_HEIGHT.event).toBe(236);
    expect(drawn(segments)).toBe(4);
  });

  it('stacks three birthdays — 0, 38, 76, last bottom at 110', () => {
    const { segments, laneTops } = layoutWeek(
      WEEK_START,
      Array.from({ length: 3 }, (_, i) => kinded(`b${i}`, 'birthday')),
      BUDGET,
    );
    expect(laneTops.slice(0, 3)).toEqual([0, 38, 76]);
    expect(76 + KIND_HEIGHT.birthday).toBe(110);
    expect(drawn(segments)).toBe(3);
  });

  it('draws two birthdays and two events and sets contentHeight to 192', () => {
    const { segments, overflow, contentHeight } = layoutWeek(
      WEEK_START,
      [
        kinded('b0', 'birthday'),
        kinded('b1', 'birthday'),
        kinded('e0', 'event'),
        kinded('e1', 'event'),
      ],
      BUDGET,
    );
    // Four bars on one day is 34 + 34 + 56 + 56 of bar and three 4px gaps, so
    // the last lane ends at 192.
    expect(drawn(segments)).toBe(4);
    expect(segments.filter((s) => s.hidden)).toHaveLength(0);
    expect(overflow[3]).toBe(0);
    expect(contentHeight).toBe(192);
  });

  it('keeps a bar at its own height, not its lane’s', () => {
    // A short bar sharing a lane with an entry must not be stretched to match.
    const { segments } = layoutWeek(
      WEEK_START,
      [kinded('entry', 'event', '2026-07-26'), kinded('mark', 'milestone', '2026-07-30')],
      BUDGET,
    );
    const mark = segments.find((s) => s.occurrence.key === 'mark')!;
    const entry = segments.find((s) => s.occurrence.key === 'entry')!;
    expect(mark.lane).toBe(entry.lane); // same lane — they don't overlap
    expect(mark.height).toBe(KIND_HEIGHT.milestone);
    expect(entry.height).toBe(KIND_HEIGHT.event);
    expect(mark.top).toBe(entry.top);
  });

  it('sizes a lane by its tallest occupant', () => {
    const { segments, laneHeights, laneTops } = layoutWeek(
      WEEK_START,
      [
        kinded('birthday', 'birthday', '2026-07-26'),
        // Shares the birthday's column, so it is forced into a different lane
        // rather than packing in beside it.
        kinded('other', 'event', '2026-07-26'),
        // Clear of both, so it joins whichever lane has room. It is the short
        // bar that must not shrink its lane below the birthday's height.
        kinded('mark', 'milestone', '2026-07-30'),
      ],
      BUDGET,
    );

    const birthday = segments.find((s) => s.occurrence.key === 'birthday')!;
    const other = segments.find((s) => s.occurrence.key === 'other')!;
    const mark = segments.find((s) => s.occurrence.key === 'mark')!;

    expect(laneHeights[other.lane]).toBe(KIND_HEIGHT.event);

    // The mark packs in beside the birthday, and their shared lane keeps the
    // taller one's height — a 20px bar must not shrink the lane under a 34px
    // one, or the bar below would overlap it.
    expect(mark.lane).toBe(birthday.lane);
    expect(laneHeights[birthday.lane]).toBe(KIND_HEIGHT.birthday);

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

  // Lanes of 56px events sit at 0 and 60, so in row coordinates the first two
  // bars occupy [34, 90] and [94, 150].
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

  it('includes all bars since none are rolled into a chip anymore', () => {
    const many = Array.from({ length: 6 }, (_, i) => occ(`e${i}`, '2026-07-29'));
    const hits = occurrencesInMarquee(
      { x0: 0, y0: at(10, 0), x1: 7 * COL_W, y1: at(10, 400) },
      grid(many),
      METRICS,
      (y0, y1) => [{ index: 10, start: 10 * ROW_H, end: 10 * ROW_H + 400 }],
    );
    expect(hits.size).toBe(6);
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

describe('rows a band crosses', () => {
  // Forty measured rows of 400px — a busy stretch, and far more extra height
  // than the old `floor(y0 / ROW_H) - 10` starting guess could absorb.
  const rows = Array.from({ length: 40 }, (_, i) => ({ index: i, start: i * 400, end: (i + 1) * 400 }));
  const indexes = (y0: number, y1: number) => rowsInBand(rows, y0, y1).map((r) => r.index);

  it('finds a row the old starting guess would have skipped', () => {
    // The guess would start at floor(12_010 / 190) - 10 = 53, past the last row.
    expect(indexes(12_010, 12_390)).toEqual([30]);
  });

  it('returns every row a band spans', () => {
    expect(indexes(399, 1_201)).toEqual([0, 1, 2, 3]);
  });

  it('reads a band given bottom-up the same as top-down', () => {
    expect(indexes(1_201, 399)).toEqual(indexes(399, 1_201));
  });

  it('returns nothing for a band below the last row', () => {
    expect(indexes(20_000, 20_100)).toEqual([]);
  });
});
