import { describe, expect, it } from 'vitest';
import {
  formatMark,
  formatPercent,
  need,
  parseMark,
  parseWeight,
  sections,
  summarize,
  type GradeItem,
} from './grades';

let next = 0;
function item(weight: number, mark: [number, number] | null = null, over: Partial<GradeItem> = {}): GradeItem {
  next++;
  return {
    id: `i${next}`,
    courseId: 'c1',
    name: `Item ${next}`,
    section: '',
    weight,
    earned: mark ? mark[0] : null,
    outOf: mark ? mark[1] : null,
    notes: '',
    eventId: null,
    sortOrder: next,
    ...over,
  };
}

describe('parseMark', () => {
  it('reads a bare number as a percentage', () => {
    expect(parseMark('85')).toEqual({ kind: 'mark', earned: 85, outOf: 100 });
    expect(parseMark(' 72.5 % ')).toEqual({ kind: 'mark', earned: 72.5, outOf: 100 });
  });

  it('reads points out of a total', () => {
    expect(parseMark('17/20')).toEqual({ kind: 'mark', earned: 17, outOf: 20 });
    expect(parseMark('17.5 / 20')).toEqual({ kind: 'mark', earned: 17.5, outOf: 20 });
  });

  it('reads nothing as no mark yet', () => {
    expect(parseMark('')).toEqual({ kind: 'empty' });
    expect(parseMark('   ')).toEqual({ kind: 'empty' });
  });

  it('allows a bonus above full marks', () => {
    expect(parseMark('22/20')).toEqual({ kind: 'mark', earned: 22, outOf: 20 });
  });

  it('refuses what cannot be a mark', () => {
    for (const bad of ['abc', '-5', '17/0', '17/', '/20', '1/2/3', '17/-4', '85%%']) {
      expect(parseMark(bad), bad).toEqual({ kind: 'invalid' });
    }
  });
});

describe('formatMark', () => {
  it('says a percentage mark as one, and points as points', () => {
    expect(formatMark(item(10, [85, 100]))).toBe('85%');
    expect(formatMark(item(10, [17, 20]))).toBe('17/20');
    expect(formatMark(item(10))).toBe('');
  });

  it('round-trips through parseMark', () => {
    for (const text of ['85%', '17/20', '72.5%', '17.5/20']) {
      const parsed = parseMark(text);
      if (parsed.kind !== 'mark') throw new Error(text);
      expect(formatMark(item(10, [parsed.earned, parsed.outOf]))).toBe(text);
    }
  });
});

describe('parseWeight', () => {
  it('takes a number with or without a percent sign', () => {
    expect(parseWeight('20')).toBe(20);
    expect(parseWeight('12.5%')).toBe(12.5);
    expect(parseWeight('')).toBe(0);
  });

  it('refuses a weight outside 0–100', () => {
    expect(parseWeight('-1')).toBeNull();
    expect(parseWeight('101')).toBeNull();
    expect(parseWeight('ten')).toBeNull();
  });
});

describe('summarize', () => {
  it('has no current grade before any mark is in', () => {
    const s = summarize([item(20), item(30), item(50)]);
    expect(s.current).toBeNull();
    expect(s.banked).toBe(0);
    expect(s.remainingWeight).toBe(100);
    expect(s.best).toBe(100);
    expect(s.worst).toBe(0);
    expect(s.final).toBeNull();
  });

  it('bases the current grade only on what has been marked', () => {
    // 85% on a 20% item and 70% on a 30% item: (17 + 21) / 50 = 76%.
    const s = summarize([item(20, [17, 20]), item(30, [70, 100]), item(50)]);
    expect(s.current).toBeCloseTo(76);
    expect(s.banked).toBeCloseTo(38);
    expect(s.gradedWeight).toBe(50);
    expect(s.remainingWeight).toBe(50);
    expect(s.worst).toBeCloseTo(38);
    expect(s.best).toBeCloseTo(88);
  });

  it('gives a final grade once everything is in', () => {
    const s = summarize([item(40, [80, 100]), item(60, [90, 100])]);
    expect(s.complete).toBe(true);
    expect(s.final).toBeCloseTo(86);
    expect(s.best).toBeCloseTo(86);
    expect(s.worst).toBeCloseTo(86);
  });

  it('withholds the range when weights do not total 100', () => {
    const s = summarize([item(20, [80, 100]), item(30)]);
    expect(s.weightTotal).toBe(50);
    expect(s.balanced).toBe(false);
    // Still a fact about the marks that are in.
    expect(s.current).toBeCloseTo(80);
    expect(s.best).toBeNull();
    expect(s.worst).toBeNull();
    expect(s.final).toBeNull();
  });

  it('counts weights that only total 100 to within rounding as balanced', () => {
    const s = summarize([item(33.3), item(33.3), item(33.4)]);
    expect(s.balanced).toBe(true);
    const tenths = summarize(Array.from({ length: 10 }, () => item(0.1 + 9.9)));
    expect(tenths.balanced).toBe(true);
  });

  it('ignores a weightless item, marked or not', () => {
    const s = summarize([item(100, [50, 100]), item(0, [100, 100]), item(0)]);
    expect(s.current).toBeCloseTo(50);
    expect(s.complete).toBe(true);
  });

  it('has nothing to say about an empty course', () => {
    const s = summarize([]);
    expect(s.current).toBeNull();
    expect(s.weightTotal).toBe(0);
    expect(s.balanced).toBe(false);
    expect(s.complete).toBe(false);
  });
});

describe('need', () => {
  const half = [item(50, [80, 100]), item(50)];

  it('says what average the rest needs', () => {
    // 40 banked; 80 needs 40 more from 50% of the course = 80%.
    expect(need(summarize(half), 80)).toEqual({ kind: 'need', average: 80, remainingWeight: 50 });
  });

  it('says plainly when the target is out of reach', () => {
    const result = need(summarize(half), 95);
    expect(result.kind).toBe('impossible');
    if (result.kind === 'impossible') expect(result.best).toBeCloseTo(90);
  });

  it('says when the target is already secured', () => {
    expect(need(summarize(half), 40).kind).toBe('secured');
    expect(need(summarize(half), 30).kind).toBe('secured');
  });

  it('treats a target exactly at the best case as reachable', () => {
    const result = need(summarize(half), 90);
    expect(result).toEqual({ kind: 'need', average: 100, remainingWeight: 50 });
  });

  it('reports met or missed once everything is in', () => {
    const done = summarize([item(100, [78, 100])]);
    expect(need(done, 75)).toEqual({ kind: 'complete', final: 78, met: true });
    expect(need(done, 80)).toEqual({ kind: 'complete', final: 78, met: false });
  });

  it('cannot answer until the weights total 100', () => {
    expect(need(summarize([item(20, [80, 100]), item(30)]), 80)).toEqual({
      kind: 'unbalanced',
      weightTotal: 50,
    });
  });

  it('works before any mark is in', () => {
    expect(need(summarize([item(30), item(70)]), 65)).toEqual({
      kind: 'need',
      average: 65,
      remainingWeight: 100,
    });
  });

  it('counts a bonus mark towards the target', () => {
    // 110% on half the course banks 55; 80 needs 25 from the other 50 = 50%.
    const bonus = summarize([item(50, [22, 20]), item(50)]);
    expect(need(bonus, 80)).toEqual({ kind: 'need', average: 50, remainingWeight: 50 });
  });
});

describe('sections', () => {
  it('groups by section in the order sections first appear', () => {
    const rows = sections([
      item(10, [90, 100], { section: 'Assignments' }),
      item(30, null, { section: 'Exams' }),
      item(10, [70, 100], { section: ' assignments ' }),
      item(5, [100, 100]),
    ]);
    expect(rows.map((r) => r.name)).toEqual(['Assignments', 'Exams', '']);
    expect(rows[0].weight).toBe(20);
    expect(rows[0].current).toBeCloseTo(80);
    expect(rows[1].current).toBeNull();
    expect(rows[2].current).toBeCloseTo(100);
  });
});

describe('formatPercent', () => {
  it('says one decimal, or a dash for nothing', () => {
    expect(formatPercent(78.444)).toBe('78.4%');
    expect(formatPercent(80)).toBe('80.0%');
    expect(formatPercent(null)).toBe('—');
  });
});
