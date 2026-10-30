import { describe, expect, it } from 'vitest';
import {
  formatMark,
  formatPercent,
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
    expect(s.final).toBeNull();
  });

  it('bases the current grade only on what has been marked', () => {
    // 85% on a 20% item and 70% on a 30% item: (17 + 21) / 50 = 76%.
    const s = summarize([item(20, [17, 20]), item(30, [70, 100]), item(50)]);
    expect(s.current).toBeCloseTo(76);
    expect(s.banked).toBeCloseTo(38);
    expect(s.gradedWeight).toBe(50);
  });

  it('gives a final grade once everything is in', () => {
    const s = summarize([item(40, [80, 100]), item(60, [90, 100])]);
    expect(s.complete).toBe(true);
    expect(s.final).toBeCloseTo(86);
  });

  it('withholds the final grade when weights do not total 100', () => {
    const s = summarize([item(20, [80, 100]), item(30)]);
    expect(s.weightTotal).toBe(50);
    expect(s.balanced).toBe(false);
    // Still a fact about the marks that are in.
    expect(s.current).toBeCloseTo(80);
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

describe('dropping the lowest', () => {
  const quiz = (mark: number | null) =>
    item(3, mark === null ? null : [mark, 100], { section: 'Quiz' });

  it('leaves the group worth what it was worth', () => {
    // Quizzes 90, 80, 70, 60, 50 at 3% each, the 50 gone: four at 3.75% bank
    // 3.375 + 3 + 2.625 + 2.25 = 11.25. With 85% on the 85% rest: 72.25 + 11.25.
    const quizzes = [quiz(90), quiz(80), quiz(70), quiz(60), quiz(50)];
    const s = summarize([...quizzes, item(85, [85, 100])], { quiz: 1 });
    expect(s.dropped).toEqual(new Set([quizzes[4].id]));
    expect(s.gradedWeight).toBeCloseTo(100);
    expect(s.final).toBeCloseTo(83.5);
  });

  it('does not strike a mark while the lowest could still be one to come', () => {
    const s = summarize([quiz(90), quiz(50), quiz(null)], { quiz: 1 });
    expect(s.dropped.size).toBe(0);
    expect(s.current).toBeCloseTo(70);
  });

  it('strikes as soon as the drops outnumber what is left', () => {
    const quizzes = [quiz(90), quiz(50), quiz(70), quiz(null)];
    const s = summarize(quizzes, { quiz: 2 });
    expect(s.dropped).toEqual(new Set([quizzes[1].id]));
    expect(s.current).toBeCloseTo(80);
  });

  it('weighs the group as though its pending drop had happened', () => {
    // Three 10% quizzes with one to drop are two at 15%, against an exam at
    // 70%: (15 * 100 + 70 * 50) / 85.
    const s = summarize(
      [
        item(10, [100, 100], { section: 'Quiz' }),
        item(10, null, { section: 'Quiz' }),
        item(10, null, { section: 'Quiz' }),
        item(70, [50, 100]),
      ],
      { quiz: 1 },
    );
    expect(s.current).toBeCloseTo(5000 / 85);
  });

  it('only touches the group it names, in any spelling', () => {
    const s = summarize(
      [
        item(50, [40, 100], { section: ' QUIZ ' }),
        item(25, [80, 100], { section: 'quiz' }),
        item(25, [10, 100], { section: 'Exam' }),
      ],
      { quiz: 1 },
    );
    expect(s.dropped.size).toBe(1);
    // The 25% quiz now carries the group's 75%; the exam is untouched.
    expect(s.final).toBeCloseTo(75 * 0.8 + 25 * 0.1);
  });

  it('always leaves one mark standing', () => {
    const s = summarize([item(100, [40, 100], { section: 'Quiz' })], { quiz: 3 });
    expect(s.dropped.size).toBe(0);
    expect(s.final).toBeCloseTo(40);
  });

  it('ignores a weightless item when choosing what to drop', () => {
    const practice = item(0, [0, 100], { section: 'Quiz' });
    const s = summarize([practice, quiz(90), quiz(80)], { quiz: 1 });
    expect(s.dropped.has(practice.id)).toBe(false);
    expect(s.current).toBeCloseTo(90);
  });

  it('reaches the per-type average too', () => {
    const rows = sections([quiz(90), quiz(50)], { quiz: 1 });
    expect(rows[0].current).toBeCloseTo(90);
    expect(rows[0].weight).toBe(6);
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
