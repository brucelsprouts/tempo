/**
 * Course grades: what you have, what you can still get, and what you need.
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
  /** The final grade being aimed for, in percent. */
  target: number | null;
  sortOrder: number;
}

/** One weighted thing in a course: an assignment, a quiz, the final. */
export interface GradeItem {
  id: string;
  courseId: string;
  name: string;
  /** A free label — "Assignments", "Exams" — for grouping. Weight stays per item. */
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

/** A percentage as a target, the same rules as a weight but blank means none. */
export function parseTarget(input: string): number | null | 'invalid' {
  if (input.trim() === '') return null;
  return parseWeight(input) ?? 'invalid';
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

export interface CourseSummary {
  /** Sum of every item's weight. */
  weightTotal: number;
  /** Whether the weights total 100. The range and the target need them to. */
  balanced: boolean;
  /** Weight of the items with a mark in. */
  gradedWeight: number;
  /** Weight of the items still waiting on one. */
  remainingWeight: number;
  /** Percentage points of the final grade already earned. */
  banked: number;
  /** The grade on what has been marked so far — `banked` over `gradedWeight`. */
  current: number | null;
  /** Full marks on everything left. Only when balanced. */
  best: number | null;
  /** Zero on everything left. Only when balanced. */
  worst: number | null;
  /** Every weighted item has a mark. */
  complete: boolean;
  /** The grade, once it is settled: complete and balanced. */
  final: number | null;
}

export function summarize(items: readonly GradeItem[]): CourseSummary {
  let weightTotal = 0;
  let gradedWeight = 0;
  let banked = 0;
  let weighted = 0;

  for (const it of items) {
    weightTotal += it.weight;
    // A weightless item is a note to self — practice quiz, ungraded lab. Its
    // mark is shown but moves nothing, and it is never "remaining".
    if (it.weight <= 0) continue;
    weighted++;
    const pct = markPercent(it);
    if (pct === null) continue;
    gradedWeight += it.weight;
    banked += (it.weight * pct) / 100;
  }

  const remainingWeight = weightTotal - gradedWeight;
  const balanced = Math.abs(weightTotal - 100) < EPSILON;
  const complete = weighted > 0 && remainingWeight < EPSILON;
  const current = gradedWeight > EPSILON ? (banked / gradedWeight) * 100 : null;

  return {
    weightTotal,
    balanced,
    gradedWeight,
    remainingWeight: Math.max(0, remainingWeight),
    banked,
    current,
    best: balanced ? banked + Math.max(0, remainingWeight) : null,
    worst: balanced ? banked : null,
    complete,
    final: balanced && complete ? banked : null,
  };
}

export type Need =
  /** The weights have to total 100 before "what's left" means anything. */
  | { kind: 'unbalanced'; weightTotal: number }
  /** Nothing left to mark: the target was met or it wasn't. */
  | { kind: 'complete'; final: number; met: boolean }
  /** Zero on everything left still reaches it. */
  | { kind: 'secured' }
  /** Full marks on everything left still falls short. */
  | { kind: 'impossible'; best: number }
  /** The average needed across what's left. */
  | { kind: 'need'; average: number; remainingWeight: number };

/** What it takes to finish the course at `target` percent. */
export function need(summary: CourseSummary, target: number): Need {
  if (!summary.balanced) return { kind: 'unbalanced', weightTotal: summary.weightTotal };
  if (summary.complete) {
    return { kind: 'complete', final: summary.banked, met: summary.banked >= target - EPSILON };
  }
  const missing = target - summary.banked;
  if (missing <= EPSILON) return { kind: 'secured' };
  const average = (missing / summary.remainingWeight) * 100;
  // Full marks is the ceiling for planning, though a bonus can beat it: a plan
  // that relies on one is not a plan.
  if (average > 100 + EPSILON) return { kind: 'impossible', best: summary.best ?? summary.banked };
  return { kind: 'need', average: round(average), remainingWeight: summary.remainingWeight };
}

/** Floating point's last-digit noise, off a number about to be compared or shown. */
function round(n: number): number {
  return Math.round(n * 1e9) / 1e9;
}

export interface SectionSummary {
  /** As first typed. Blank is the items with no section. */
  name: string;
  weight: number;
  /** The grade on what is marked in this section. */
  current: number | null;
  count: number;
}

/**
 * Items grouped by section, in the order each section first appears.
 *
 * Matched ignoring case and surrounding space, so "Assignments" and
 * "assignments " are one group — they were always meant to be.
 */
export function sections(items: readonly GradeItem[]): SectionSummary[] {
  const groups = new Map<string, { name: string; members: GradeItem[] }>();
  for (const it of items) {
    const name = it.section.trim();
    const key = name.toLowerCase();
    const group = groups.get(key) ?? { name, members: [] };
    group.members.push(it);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ name, members }) => {
    const s = summarize(members);
    return { name, weight: s.weightTotal, current: s.current, count: members.length };
  });
}
