'use client';

/**
 * Courses and their marks, in memory, written as you type.
 *
 * A store of its own rather than three more collections in `calendar-store`.
 * That store's snapshot, undo and realtime are all shaped around the calendar,
 * and grades share none of its questions — no occurrences, no series, no
 * versions. What carries over is the rule: every change lands on screen at
 * once, the database follows, and a write the server refuses puts the row back
 * the way the server last had it.
 *
 * Typing into a cell is a write per keystroke with nothing in between, so each
 * row has a `Writer` (the entry popup's) that waits for a pause and sends only
 * the latest. The baseline a failed write restores is the row as it last
 * reached the server, not as it stood one keystroke ago.
 */

import { create } from 'zustand';
import { createClient } from '@/lib/supabase/client';
import {
  gradeCourseFromRow,
  gradeCourseToRow,
  gradeItemFromRow,
  gradeItemToRow,
} from '@/lib/tempo/mappers';
import type { GradeCourse, GradeItem } from '@/lib/tempo/grades';
import { useCalendar } from './calendar-store';
import { createWriter, type Writer } from './writer';

/** The same pause the entry popup waits for. */
const WRITE_DELAY = 400;

/**
 * - `missing` — the tables are not there: `20261029_grades.sql` has not been run.
 *   Said as such, because "error" would send you looking for a bug.
 */
export type GradeStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error';

export type CoursePatch = Partial<Pick<GradeCourse, 'name' | 'notes' | 'drops' | 'categoryId'>>;
export type ItemPatch = Partial<
  Pick<GradeItem, 'name' | 'section' | 'weight' | 'earned' | 'outOf' | 'notes'>
>;

interface GradeState {
  status: GradeStatus;
  courses: GradeCourse[];
  items: GradeItem[];
  error: string | null;

  /** Read everything. Rows with a write still pending keep their local value. */
  load: () => Promise<void>;
  /** The new course's id, or `null` when it could not be made. */
  addCourse: (input: { categoryId: string | null; name: string }) => Promise<string | null>;
  updateCourse: (id: string, patch: CoursePatch) => void;
  deleteCourse: (id: string) => Promise<void>;
  addItem: (courseId: string, seed?: ItemPatch) => Promise<string | null>;
  updateItem: (id: string, patch: ItemPatch) => void;
  deleteItem: (id: string) => Promise<void>;
  /** Send every waiting write now — the page is being hidden. */
  flush: () => Promise<void>;
  dismissError: () => void;
}

/** PostgREST's "no such table", in both the spellings it has used. */
function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST205' || error?.code === '42P01';
}

/**
 * A refused write, said the way the view can act on. A missing table is the
 * migration not having been run — the same thing `load` says, not an error.
 */
function failed(error: { code?: string; message: string }): Partial<GradeState> {
  return isMissingTable(error) ? { status: 'missing', error: null } : { error: error.message };
}

const bySortOrder = <T extends { sortOrder: number }>(a: T, b: T) => a.sortOrder - b.sortOrder;

export const useGrades = create<GradeState>((set, get) => {
  const supabase = createClient();

  const writers = new Map<string, Writer>();
  /** The row as the server last confirmed it, for every row with an edit not yet confirmed. */
  const baselines = new Map<string, GradeCourse | GradeItem>();
  /**
   * Inserts not yet acknowledged. An edit typed into a row in the moment after
   * it was added would otherwise reach the server first, update nothing, and be
   * lost without an error to say so.
   */
  const inserting = new Map<string, Promise<boolean>>();

  function writerFor(id: string): Writer {
    let w = writers.get(id);
    if (!w) {
      w = createWriter(WRITE_DELAY);
      writers.set(id, w);
    }
    return w;
  }

  function ownerId(): string | null {
    return useCalendar.getState().ownerId;
  }

  const nextSort = (rows: { sortOrder: number }[]) =>
    rows.reduce((n, r) => Math.max(n, r.sortOrder + 1), 0);

  /**
   * Edit now, write after a pause, restore the server's row if it refuses.
   *
   * Generic over the two tables because the two are written identically; the
   * only difference is which list the row lives in.
   */
  function editRow<K extends 'courses' | 'items'>(
    key: K,
    table: 'grade_courses' | 'grade_items',
    id: string,
    patch: Partial<GradeState[K][number]>,
    toRow: (row: GradeState[K][number]) => Record<string, unknown>,
  ) {
    const list = get()[key] as GradeState[K][number][];
    const current = list.find((r) => r.id === id);
    if (!current) return;
    if (!baselines.has(id)) baselines.set(id, current);

    set({ [key]: list.map((r) => (r.id === id ? { ...r, ...patch } : r)) } as Partial<GradeState>);

    const writer = writerFor(id);
    writer.schedule(async () => {
      if (inserting.has(id) && !(await inserting.get(id))) return;
      const latest = (get()[key] as GradeState[K][number][]).find((r) => r.id === id);
      if (!latest) return;
      // Cast because `table` is a union and the client types each table's
      // update separately; `toRow` is the mapper for whichever one this is.
      const { error } = await supabase
        .from(table)
        .update(toRow(latest) as never)
        .eq('id', id);
      if (error) {
        const baseline = baselines.get(id) as GradeState[K][number] | undefined;
        baselines.delete(id);
        set((s) => ({
          [key]: baseline
            ? (s[key] as GradeState[K][number][]).map((r) => (r.id === id ? baseline : r))
            : s[key],
          ...failed(error),
        }) as Partial<GradeState>);
        return;
      }
      // A newer edit is already waiting: what was just sent is now the row the
      // server has, and the one to go back to if *that* write fails.
      if (writer.queued) baselines.set(id, latest);
      else baselines.delete(id);
    });
  }

  /** Apply, persist, put the lists back if the server refuses. */
  async function optimistic(
    apply: () => void,
    persist: () => PromiseLike<{ error: { code?: string; message: string } | null }>,
  ): Promise<boolean> {
    const snapshot = { courses: get().courses, items: get().items };
    apply();
    const { error } = await persist();
    if (error) {
      set({ ...snapshot, ...failed(error) });
      return false;
    }
    return true;
  }

  return {
    status: 'idle',
    courses: [],
    items: [],
    error: null,

    load: async () => {
      if (get().status === 'idle') set({ status: 'loading' });
      let courseRes, itemRes;
      try {
        [courseRes, itemRes] = await Promise.all([
          supabase.from('grade_courses').select('*').order('sort_order'),
          supabase.from('grade_items').select('*').order('sort_order'),
        ]);
      } catch {
        // Already showing something: keep showing it. A failed look-again is
        // not a reason to empty the screen.
        if (get().status !== 'ready') set({ status: 'error', error: 'Could not reach the database' });
        return;
      }

      if (isMissingTable(courseRes.error) || isMissingTable(itemRes.error)) {
        set({ status: 'missing', error: null });
        return;
      }
      const failure = courseRes.error ?? itemRes.error;
      if (failure) {
        if (get().status !== 'ready') set({ status: 'error', error: failure.message });
        return;
      }

      // A row being typed into keeps what is on screen; the server's copy of
      // it is at most one pause behind and about to be overwritten anyway.
      const pending = (id: string) => baselines.has(id) || inserting.has(id);
      const local = get();
      const courses = (courseRes.data ?? []).map(gradeCourseFromRow);
      const items = (itemRes.data ?? []).map(gradeItemFromRow);
      const merge = <T extends { id: string; sortOrder: number }>(fresh: T[], mine: T[]) => {
        const kept = mine.filter((r) => pending(r.id));
        const keptIds = new Set(kept.map((r) => r.id));
        return [...fresh.filter((r) => !keptIds.has(r.id)), ...kept].sort(bySortOrder);
      };

      set({
        status: 'ready',
        courses: merge(courses, local.courses),
        items: merge(items, local.items),
      });
    },

    addCourse: async ({ categoryId, name }) => {
      const owner = ownerId();
      if (!owner) return null;
      const id = crypto.randomUUID();
      const course: GradeCourse = {
        id,
        categoryId,
        name: name.trim(),
        notes: '',
        target: null,
        drops: {},
        sortOrder: nextSort(get().courses),
      };
      const insert = optimistic(
        () => set((s) => ({ courses: [...s.courses, course] })),
        () =>
          supabase.from('grade_courses').insert({ id, owner_id: owner, ...gradeCourseToRow(course) }),
      );
      inserting.set(id, insert);
      const ok = await insert;
      inserting.delete(id);
      return ok ? id : null;
    },

    updateCourse: (id, patch) =>
      editRow('courses', 'grade_courses', id, patch, (c) =>
        gradeCourseToRow({ name: c.name, notes: c.notes, drops: c.drops, categoryId: c.categoryId }),
      ),

    deleteCourse: async (id) => {
      await writers.get(id)?.flush();
      const doomed = new Set(get().items.filter((i) => i.courseId === id).map((i) => i.id));
      await Promise.all([...doomed].map((i) => writers.get(i)?.flush()));
      await optimistic(
        () =>
          set((s) => ({
            courses: s.courses.filter((c) => c.id !== id),
            items: s.items.filter((i) => !doomed.has(i.id)),
          })),
        // The items go with it, by the foreign key's cascade.
        () => supabase.from('grade_courses').delete().eq('id', id),
      );
    },

    addItem: async (courseId, seed = {}) => {
      const owner = ownerId();
      if (!owner) return null;
      const id = crypto.randomUUID();
      const siblings = get().items.filter((i) => i.courseId === courseId);
      const item: GradeItem = {
        id,
        courseId,
        name: '',
        section: '',
        weight: 0,
        earned: null,
        outOf: null,
        notes: '',
        eventId: null,
        sortOrder: nextSort(siblings),
        ...seed,
      };
      const insert = optimistic(
        () => set((s) => ({ items: [...s.items, item] })),
        () =>
          supabase
            .from('grade_items')
            .insert({ ...gradeItemToRow(item), id, owner_id: owner, course_id: courseId }),
      );
      inserting.set(id, insert);
      const ok = await insert;
      inserting.delete(id);
      return ok ? id : null;
    },

    updateItem: (id, patch) =>
      editRow('items', 'grade_items', id, patch, (i) =>
        gradeItemToRow({
          name: i.name,
          section: i.section,
          weight: i.weight,
          earned: i.earned,
          outOf: i.outOf,
          notes: i.notes,
        }),
      ),

    deleteItem: async (id) => {
      await writers.get(id)?.flush();
      await inserting.get(id);
      await optimistic(
        () => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
        () => supabase.from('grade_items').delete().eq('id', id),
      );
    },

    flush: async () => {
      await Promise.all([...writers.values()].map((w) => w.flush()));
    },

    dismissError: () => set({ error: null }),
  };
});
