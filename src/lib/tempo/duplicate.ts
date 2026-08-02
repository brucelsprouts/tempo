import type { TempoEvent } from './types';

/**
 * What a copy is called.
 *
 * A duplicate that kept the original's title would be indistinguishable from it
 * everywhere the calendar shows a name and nowhere else — the grid draws a bar,
 * the list draws a row, and two rows reading `Standup` are two rows you have to
 * open to tell apart. So the copy says it is one, in the notation every file
 * manager and every note app already uses.
 *
 * Kept here, pure and away from the store, because "what is this called" is a
 * question about a set of strings rather than about the database — which is what
 * makes the awkward cases (a copy of a copy, a title that already ends in
 * parentheses, six copies made in one keystroke) cheap to pin down in tests.
 */

/**
 * ` (12)` at the very end, and nothing else.
 *
 * The base and its separating space are one optional group, so a title that is
 * *only* a counter still parses — which is what keeps this and `joinCopy` exact
 * inverses. Without it, naming a copy of an untitled entry `(1)` and then
 * duplicating that would produce `(1) (1)`, and the counter would have stopped
 * counting on the one input this module itself generated.
 */
const SUFFIX = /^(?:(.*) )?\((\d+)\)$/;

/** The separator exists only when there is something to separate. */
function joinCopy(base: string, n: number): string {
  return base === '' ? `(${n})` : `${base} (${n})`;
}

/**
 * A title split into the part that names the thing and the part that counts it.
 *
 * `n` is 0 for a title that is not a copy, which reads as "the original" and
 * makes the caller's arithmetic uniform. Only a positive integer counts: `(0)`
 * and `(-1)` are numbers this never writes, so a title carrying one is a title
 * someone typed, and taking it apart would quietly rename their entry.
 */
export function splitCopySuffix(title: string): { base: string; n: number } {
  const m = SUFFIX.exec(title);
  if (!m) return { base: title, n: 0 };
  const n = Number(m[2]);
  // `\d+` cannot produce a negative or a fraction, so this is really a guard
  // against `(0)` — and against a run of digits long enough to lose precision.
  if (!Number.isSafeInteger(n) || n < 1) return { base: title, n: 0 };
  // Absent when the title is bare `(1)`, which has a counter and no base.
  return { base: m[1] ?? '', n };
}

/**
 * The name for a copy of `title`, given everything already named.
 *
 * Counts from the *base*, so duplicating `Standup (1)` gives `Standup (2)`
 * rather than `Standup (1) (1)` — the suffix is a counter, and a counter that
 * nests has stopped counting. Fills the lowest free number rather than counting
 * past the highest, so deleting `(1)` and duplicating again reuses it instead of
 * leaving a permanent gap.
 *
 * `taken` is whatever set the caller considers a collision — live titles, plus
 * the names it has already handed out in this batch. That second part is why
 * this takes a set rather than reading the store: six copies made by one
 * keystroke must not all be told they can be `(1)`.
 */
export function copyTitle(title: string, taken: ReadonlySet<string>): string {
  const { base } = splitCopySuffix(title);
  // Bounded by construction: at most one existing title can occupy each number,
  // so the first free one is never further out than `taken.size + 1`.
  for (let n = 1; ; n++) {
    const candidate = joinCopy(base, n);
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * The fields a copy inherits, and the ones it must not.
 *
 * Identity, provenance and timestamps are the row's own; everything else —
 * including the recurrence rule, the reminders and the derived-field template —
 * describes the entry, and a copy that dropped them would be a different entry
 * wearing the same name. Dates are deliberately absent: the caller shifts them,
 * because only it knows where the copy is going.
 *
 * `source` and `googleEventId` reset because a copy is ours even when its
 * original came from Google — it is a new row in our table that nothing
 * upstream knows about, and leaving it marked `google` would make it read-only
 * the moment it was created.
 */
export function copyableFields(
  ev: TempoEvent,
): Omit<
  TempoEvent,
  | 'id'
  | 'title'
  | 'startsAt'
  | 'endsAt'
  | 'startDate'
  | 'endDate'
  | 'source'
  | 'googleEventId'
  | 'deletedAt'
  | 'createdAt'
  | 'updatedAt'
> {
  return {
    notes: ev.notes,
    kind: ev.kind,
    categoryId: ev.categoryId,
    allDay: ev.allDay,
    timezone: ev.timezone,
    recurrence: ev.recurrence,
    reminders: ev.reminders,
    anchorDate: ev.anchorDate,
    displayTemplate: ev.displayTemplate,
    status: ev.status,
    notify: ev.notify,
  };
}
