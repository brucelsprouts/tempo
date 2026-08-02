import { describe, expect, it } from 'vitest';
import { planRows } from './undo';

/**
 * The reconciler is the whole of undo: every action's inverse is the same diff,
 * so this is the one place the correctness of "take that back" lives.
 *
 * The id scoping is not an optimisation. Realtime sync means another device's
 * edit can land between an action and its undo, and a diff over everything
 * would revert it as a side effect of Cmd-Z.
 */

const row = (id: string, v: number) => ({ id, v });

describe('planRows', () => {
  it('plans nothing when nothing changed', () => {
    const rows = [row('a', 1)];
    expect(planRows(rows, rows, ['a'])).toEqual({ insert: [], update: [], remove: [] });
  });

  it('updates a row that changed', () => {
    expect(planRows([row('a', 1)], [row('a', 2)], ['a'])).toEqual({
      insert: [],
      update: [row('a', 1)],
      remove: [],
    });
  });

  it('inserts a row the snapshot has and the live state does not', () => {
    expect(planRows([row('a', 1)], [], ['a'])).toEqual({
      insert: [row('a', 1)],
      update: [],
      remove: [],
    });
  });

  it('removes a row the live state has and the snapshot does not', () => {
    expect(planRows([], [row('a', 1)], ['a'])).toEqual({
      insert: [],
      update: [],
      remove: ['a'],
    });
  });

  /** The bug this exists to prevent: Cmd-Z must not revert another device. */
  it('ignores rows the action never touched', () => {
    expect(planRows([row('a', 1), row('b', 1)], [row('a', 2), row('b', 99)], ['a'])).toEqual({
      insert: [],
      update: [row('a', 1)],
      remove: [],
    });
  });

  it('plans several rows at once', () => {
    const before = [row('a', 1), row('b', 1)];
    const live = [row('a', 2), row('b', 2)];
    expect(planRows(before, live, ['a', 'b']).update).toEqual(before);
  });

  it('compares structurally, not by reference', () => {
    expect(planRows([row('a', 1)], [{ id: 'a', v: 1 }], ['a']).update).toEqual([]);
  });

  it('ignores a touched id absent from both sides', () => {
    expect(planRows([], [], ['ghost'])).toEqual({ insert: [], update: [], remove: [] });
  });
});
