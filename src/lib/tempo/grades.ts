/**
 * Course grades: what you have so far, and what it came to.
 *
 * Pure arithmetic over a course's weighted items. No React, no network — the
 * GRADES view and the store both read these, so a number on screen is the
 * number the tests measure.
 *
 * Weights are percentage points of the final grade and a mark is a fraction of
 * its own total, so an item's contribution is `weight × earned / outOf`. A mark
 * entered as a percentage is stored as points out of 100: one shape for the
 * arithmetic, and the input box still says it back the way it was typed.
 */

/** A course: one tab in GRADES. Usually a category, but not necessarily one. */
export interface GradeCourse {
  id: string;
  /**
   * The category this course is, when it is one. Its name is the course's name
   * while the link holds; deleting the category leaves the course and its marks
   * standing under `name`.
   */
  categoryId: string | null;
  /** The name it was created with, shown once there is no category to ask. */
  name: string;
  notes: string;
  /** Retired from the view. The column stays so nobody's old value is lost to a tidy-up. */
  target: number | null;
  /** How many of each type's lowest marks do not count, by `sectionKey`. */
  drops: Drops;
  sortOrder: number;
}

/** "Drop the lowest quiz" is `{ quiz: 1 }`. A type that drops nothing has no key. */
export type Drops = Record<string, number>;

/** One weighted thing in a course: an assignment, a quiz, the final. */
export interface GradeItem {
  id: string;
  courseId: string;
  name: string;
  /** The item's type, "Quiz" or "Exam", which groups it. Weight stays per item. */
  section: string;
  /** Percentage points of the final grade, 0–100. */
  weight: number;
  /** Both or neither: no mark yet is `null` / `null`. */
  earned: number | null;
  outOf: number | null;
  notes: string;
  /** Reserved for linking an item to the entry it is due on. Not yet read. */
  eventId: string | null;
  sortOrder: number;
}

/**
 * How close a weight total has to be to 100 to count as 100.
 *
 * Three items at 33.3, 33.3 and 33.4 sum to 99.99999999999999 in floating
 * point, and a course that says WEIGHTS DON'T ADD UP over that is wrong.
 */
const EPSILON = 1e-6;

// ------------------------------------------------------------------- input

export type ParsedMark =
  | { kind: 'empty' }
  | { kind: 'mark'; earned: number; outOf: number }
  | { kind: 'invalid' };

const NUMBER = /^\d+(?:\.\d+)?$|^\.\d+$/;

/**
 * A mark as typed: `85`, `85%`, `17/20`. Blank is "no mark yet".
 *
 * A bonus above full marks is allowed (22/20) — it happens, and refusing it
 * would mean typing a wrong number to get a right grade.
 */
export function parseMark(input: string): ParsedMark {
  const text = input.trim();
  if (text === '') return { kind: 'empty' };

  const slash = text.split('/');
  if (slash.length === 2) {
    const [a, b] = slash.map((s) => s.trim());
    if (!NUMBER.test(a) || !NUMBER.test(b)) return { kind: 'invalid' };
    const earned = Number(a);
    const outOf = Number(b);
    if (outOf <= 0) return { kind: 'invalid' };
    return { kind: 'mark', earned, outOf };
  }
  if (slash.length > 2) return { kind: 'invalid' };

  const bare = text.endsWith('%') ? text.slice(0, -1).trim() : text;
  if (!NUMBER.test(bare)) return { kind: 'invalid' };
  return { kind: 'mark', earned: Number(bare), outOf: 100 };
}

/** The mark back as text: out of 100 reads as a percentage, anything else as points. */
export function formatMark(item: Pick<GradeItem, 'earned' | 'outOf'>): string {
  if (item.earned === null || item.outOf === null) return '';
  if (item.outOf === 100) return `${trim(item.earned)}%`;
  return `${trim(item.earned)}/${trim(item.outOf)}`;
}

/** A weight as typed, `20` or `20%`. Blank is 0; anything outside 0–100 is `null`. */
export function parseWeight(input: string): number | null {
  const text = input.trim();
  if (text === '') return 0;
  const bare = text.endsWith('%') ? text.slice(0, -1).trim() : text;
  if (!NUMBER.test(bare)) return null;
  const weight = Number(bare);
  return weight > 100 ? null : weight;
}

/** Up to two decimals, and no trailing zeros: 17.5, not 17.50. */
function trim(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** `78.4%`, or a dash when there is nothing to say. */
export function formatPercent(n: number | null): string {
  return n === null ? '—' : `${n.toFixed(1)}%`;
}

/** A weight for a total line: `100%`, `12.5%`. */
export function formatWeight(n: number): string {
  return `${trim(n)}%`;
}

// ------------------------------------------------------------- arithmetic

/** A mark as a percentage of its own total, or `null` with no mark yet. */
export function markPercent(item: Pick<GradeItem, 'earned' | 'outOf'>): number | null {
  if (item.earned === null || item.outOf === null || item.outOf <= 0) return null;
  return (item.earned / item.outOf) * 100;
}

/** Two spellings of one type are one group: "Quiz" and "quiz " were always meant to be. */
export function sectionKey(section: string): string {
  return section.trim().toLowerCase();
}

/**
 * What dropping does to a course: which marks stopped counting, and what each
 * of the others is now worth.
 *
 * A group's weight survives its drops. Five quizzes at 3% with the lowest gone
 * are four quizzes at 3.75%, still 15% of the course, so the weights go on
 * adding up to what the syllabus says.
 *
 * A mark is only struck once it cannot count: with a quiz still to come, that
 * quiz might be the lowest instead. Until then the drop is held for the items
 * not yet marked, and the group is reweighted as though it had already happened.
 */
export function applyDrops(
  items: readonly GradeItem[],
  drops: Drops,
): { dropped: Set<string>; scale: Map<string, number> } {
  const dropped = new Set<string>();
  const scale = new Map<string, number>();

  const groups = new Map<string, GradeItem[]>();
  for (const it of items) {
    if (it.weight <= 0) continue;
    const key = sectionKey(it.section);
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }

  for (const [key, members] of groups) {
    // At least one item always counts: dropping all of them is not a grade.
    const count = Math.min(drops[key] ?? 0, members.length - 1);
    if (count <= 0) continue;

    const marked = members.filter((m) => markPercent(m) !== null);
    const waiting = members.filter((m) => markPercent(m) === null);
    const struck = Math.max(0, count - waiting.length);
    const lowest = [...marked]
      .sort((a, b) => markPercent(a)! - markPercent(b)!)
      .slice(0, struck);
    for (const it of lowest) dropped.add(it.id);

    const total = members.reduce((sum, m) => sum + m.weight, 0);
    const waitingAverage = waiting.reduce((sum, m) => sum + m.weight, 0) / (waiting.length || 1);
    const goneWeight =
      lowest.reduce((sum, m) => sum + m.weight, 0) + (count - struck) * waitingAverage;
    for (const it of members) scale.set(it.id, total / (total - goneWeight));
  }

  return { dropped, scale };
}

export interface CourseSummary {
  /** Sum of every item's weight, as entered. */
  weightTotal: number;
  /** Whether the weights total 100. FINAL needs them to. */
  balanced: boolean;
  /** What the marks that count are worth, after drops. */
  gradedWeight: number;
  /** Percentage points of the final grade already earned. */
  banked: number;
  /** The grade on what has been marked so far: `banked` over `gradedWeight`. */
  current: number | null;
  /** Every weighted item has a mark. */
  complete: boolean;
  /** The grade, once it is settled: complete and balanced. */
  final: number | null;
  /** The marks that do not count. */
  dropped: Set<string>;
}

export function summarize(items: readonly GradeItem[], drops: Drops = {}): CourseSummary {
  const { dropped, scale } = applyDrops(items, drops);
  let weightTotal = 0;
  let gradedWeight = 0;
  let banked = 0;
  let weighted = 0;
  let waiting = 0;

  for (const it of items) {
    weightTotal += it.weight;
    // A weightless item is a note to self: practice quiz, ungraded lab. Its
    // mark is shown but moves nothing, and it is never waited on.
    if (it.weight <= 0) continue;
    weighted++;
    const pct = markPercent(it);
    if (pct === null) {
      waiting++;
      continue;
    }
    if (dropped.has(it.id)) continue;
    const weight = it.weight * (scale.get(it.id) ?? 1);
    gradedWeight += weight;
    banked += (weight * pct) / 100;
  }

  const balanced = Math.abs(weightTotal - 100) < EPSILON;
  const complete = weighted > 0 && waiting === 0;
  const current = gradedWeight > EPSILON ? (banked / gradedWeight) * 100 : null;

  return {
    weightTotal,
    balanced,
    gradedWeight,
    banked,
    current,
    complete,
    final: balanced && complete ? banked : null,
    dropped,
  };
}

export interface SectionSummary {
  /** As first typed. Blank is the items with no type. */
  name: string;
  weight: number;
  /** The grade on what is marked in this group, after its drops. */
  current: number | null;
  count: number;
}

/**
 * Items grouped by type, in the order each type first appears.
 *
 * Matched by `sectionKey`, ignoring case and surrounding space.
 */
export function sections(items: readonly GradeItem[], drops: Drops = {}): SectionSummary[] {
  const groups = new Map<string, { name: string; members: GradeItem[] }>();
  for (const it of items) {
    const key = sectionKey(it.section);
    const group = groups.get(key) ?? { name: it.section.trim(), members: [] };
    group.members.push(it);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ name, members }) => {
    const s = summarize(members, drops);
    return { name, weight: s.weightTotal, current: s.current, count: members.length };
  });
}
