import type { Category, OccurrenceOverride, TempoEvent } from '@/lib/tempo/types';

/**
 * Undo, as a diff rather than as an inverse per action.
 *
 * Writing an inverse for every mutation means writing a new one for every
 * future mutation, and a forgotten one is not a crash — it is a silent
 * divergence between what the screen shows and what the database holds. One
 * diff covers every action that exists and every action that will.
 */

/** Which rows an action changed. Collected by the action, never inferred. */
export interface Touched {
  events: string[];
  overrides: string[];
  categories: string[];
}

export const EMPTY_TOUCHED: Touched = { events: [], overrides: [], categories: [] };

/**
 * The store as it stood before an action.
 *
 * `deleted` is part of it because deletion is soft: a trashed row still exists
 * on the server, so moving between `events` and `deleted` is an *update*, and
 * the two lists have to be reconciled as one set or restoring would look like
 * an insert of a row that was never gone.
 */
export interface Snapshot {
  events: TempoEvent[];
  overrides: OccurrenceOverride[];
  categories: Category[];
  deleted: TempoEvent[];
}

export interface Plan<T> {
  insert: T[];
  update: T[];
  remove: string[];
}

/**
 * What to write to put `live` back to `before`, considering only `touched`.
 *
 * The id scoping is load-bearing rather than an optimisation. Realtime sync
 * streams other devices' changes into the store, so `live` is not necessarily
 * descended from `before` — and a diff over every row would revert a remote
 * edit that had nothing to do with the action being undone.
 */
export function planRows<T extends { id: string }>(
  before: T[],
  live: T[],
  touched: string[],
): Plan<T> {
  const beforeById = new Map(before.map((r) => [r.id, r]));
  const liveById = new Map(live.map((r) => [r.id, r]));

  const plan: Plan<T> = { insert: [], update: [], remove: [] };

  for (const id of new Set(touched)) {
    const was = beforeById.get(id);
    const now = liveById.get(id);

    if (was && !now) plan.insert.push(was);
    else if (!was && now) plan.remove.push(id);
    else if (was && now && !same(was, now)) plan.update.push(was);
  }

  return plan;
}

/**
 * Structural equality over the row's own fields.
 *
 * `JSON.stringify` on sorted keys rather than a deep walk: these are plain data
 * — strings, numbers, booleans, nulls and small arrays of the same — with no
 * cycles, no dates and no class instances, so the cheap version is the correct
 * one here.
 */
function same(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

function stable(v: unknown): string {
  return JSON.stringify(v, (_k, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value as object).sort(([x], [y]) => x.localeCompare(y)))
      : value,
  );
}
