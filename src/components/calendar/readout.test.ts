import { describe, expect, it } from 'vitest';
import { monthReadout } from './readout';

describe('the month readout', () => {
  it('names the month filling the screen, not the sliver at the top', () => {
    // The week of Sep 27 is four days of September and three of October, and
    // only a tenth of it is still on screen above three whole October weeks.
    expect(
      monthReadout([
        { weekStart: '2026-09-27', visible: 0.1 },
        { weekStart: '2026-10-04', visible: 1 },
        { weekStart: '2026-10-11', visible: 1 },
        { weekStart: '2026-10-18', visible: 1 },
      ]),
    ).toEqual({ head: { year: 2026, month: 10 }, next: null });
  });

  it('points at the next month when it starts on screen', () => {
    expect(
      monthReadout([
        { weekStart: '2026-09-06', visible: 1 },
        { weekStart: '2026-09-13', visible: 1 },
        { weekStart: '2026-09-20', visible: 1 },
        { weekStart: '2026-09-27', visible: 0.5 },
      ]),
    ).toEqual({ head: { year: 2026, month: 9 }, next: { year: 2026, month: 10 } });
  });

  it('gives a tie to the earlier month, so the label cannot flicker', () => {
    // August: 2 × 0.875 + 7 × 0.375 = 4.375. September: 5 × 0.875 = 4.375.
    expect(
      monthReadout([
        { weekStart: '2026-08-23', visible: 0.375 },
        { weekStart: '2026-08-30', visible: 0.875 },
      ]),
    ).toEqual({ head: { year: 2026, month: 8 }, next: { year: 2026, month: 9 } });
  });

  it('carries the year across December', () => {
    expect(
      monthReadout([
        { weekStart: '2026-12-13', visible: 1 },
        { weekStart: '2026-12-20', visible: 1 },
        { weekStart: '2026-12-27', visible: 0.5 },
      ]),
    ).toEqual({ head: { year: 2026, month: 12 }, next: { year: 2027, month: 1 } });
  });

  it('has nothing to say about nothing', () => {
    expect(monthReadout([])).toBeNull();
    expect(monthReadout([{ weekStart: '2026-09-06', visible: 0 }])).toBeNull();
  });
});
