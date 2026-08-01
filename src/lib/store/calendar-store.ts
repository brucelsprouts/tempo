'use client';

/**
 * The whole calendar lives in memory.
 *
 * A single person's events number in the hundreds, not the millions, so the app
 * loads all of them once and expands occurrences locally. That is what makes
 * the continuous scroll feel instant — a round-trip per scroll window would be
 * visible, and the killer feature is the one thing that must never feel slow.
 *
 * Every mutation applies optimistically and rolls back the snapshot on failure.
 */

import { create } from 'zustand';
import { createClient } from '@/lib/supabase/client';
import {
  categoryFromRow,
  eventFromRow,
  eventToRow,
  overrideFromRow,
  overrideKey,
} from '@/lib/tempo/mappers';
import { addDays, diffDays, instantFromCivil, type CivilDate } from '@/lib/tempo/civil';
import { eventSpan } from '@/lib/tempo/recurrence';
import type {
  Category,
  EventKind,
  EventStatus,
  Occurrence,
  OccurrenceOverride,
  OccurrencePatch,
  Recurrence,
  TempoEvent,
} from '@/lib/tempo/types';

/** Whether an edit applies to one instance or rewrites the whole series. */
export type EditScope = 'occurrence' | 'series';

/**
 * An entry the recovery pool is holding, with everything the delete took.
 *
 * The overrides matter as much as the row. Deleting an event drops its
 * exceptions here and cascades them on the server, so an entry restored without
 * them comes back having forgotten which instances were moved or cancelled —
 * silently, and only visibly wrong to whoever moved them.
 */
export interface DeletedEntry {
  event: TempoEvent;
  overrides: OccurrenceOverride[];
  /** When it went, and the key for the whole batch one delete removed. */
  at: number;
}

export interface EventDraft {
  title: string;
  kind: EventKind;
  allDay: boolean;
  startDate: CivilDate;
  endDate: CivilDate;
  startMinutes?: number;
  endMinutes?: number;
  categoryId?: string | null;
  recurrence?: Recurrence | null;
  anchorDate?: CivilDate | null;
  displayTemplate?: string | null;
  notify?: boolean;
  notes?: string | null;
  status?: EventStatus | null;
}

interface CalendarState {
  timezone: string;
  ownerId: string | null;
  events: TempoEvent[];
  overrides: OccurrenceOverride[];
  categories: Category[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;

  /**
   * What was deleted this session, newest first.
   *
   * In memory and nowhere else: `events` has no `deleted_at` and adding one is a
   * migration. The failure this catches — "I deleted that by accident" — is
   * noticed in seconds, so a pool that lives as long as the tab covers it. Every
   * surface that shows the pool has to say that plainly rather than implying an
   * archive.
   */
  recentlyDeleted: DeletedEntry[];

  load: () => Promise<void>;
  createEvent: (draft: EventDraft) => Promise<void>;
  updateEvent: (id: string, patch: Partial<TempoEvent>) => Promise<void>;
  /** Editing counterpart to `createEvent`. See `draftTiming`. */
  updateEventFromDraft: (id: string, draft: EventDraft) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  deleteEvents: (ids: string[]) => Promise<void>;
  restoreDeleted: (eventId: string) => Promise<void>;
  /** Drop one entry, or the whole pool when called with nothing. */
  purgeDeleted: (eventId?: string) => void;
  moveOccurrence: (occ: Occurrence, deltaDays: number, scope: EditScope) => Promise<void>;
  /** A selection shifted by one shared delta, keeping the spacing between entries. */
  moveOccurrences: (occs: Occurrence[], deltaDays: number, scope: EditScope) => Promise<void>;
  /** A selection collapsed onto one date, each entry keeping its own length. */
  gatherOccurrences: (occs: Occurrence[], toDate: CivilDate, scope: EditScope) => Promise<void>;
  resizeOccurrence: (
    occ: Occurrence,
    deltaDays: number,
    edge: 'start' | 'end',
    scope: EditScope,
  ) => Promise<void>;
  setOccurrenceTime: (
    occ: Occurrence,
    startMinutes: number,
    endMinutes: number,
    scope: EditScope,
  ) => Promise<void>;
  cancelOccurrence: (occ: Occurrence) => Promise<void>;
  setStatus: (occ: Occurrence, status: EventStatus) => Promise<void>;
  createCategory: (name: string, color: string) => Promise<void>;
  updateCategory: (id: string, patch: { name?: string; color?: string }) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  setTimezone: (tz: string) => void;
  dismissError: () => void;
}

/** Seeded once, so a fresh calendar has colours to assign immediately. */
const DEFAULT_CATEGORIES = [
  { name: 'personal', color: '#7d9a6d', sort_order: 0 },
  { name: 'work', color: '#6d8bb0', sort_order: 1 },
  { name: 'school', color: '#b8705c', sort_order: 2 },
  { name: 'admin', color: '#8a9096', sort_order: 3 },
];

const DEFAULT_TZ = process.env.NEXT_PUBLIC_TEMPO_TIMEZONE || 'America/Toronto';

/** A safety net, not a log. The twenty-first delete pushes the oldest off. */
const DELETE_POOL_CAP = 20;

/**
 * The zone lives in localStorage, not in a table.
 *
 * It describes the device you are reading the calendar on, not the calendar
 * itself — every event already carries its own `timezone` — so syncing it to
 * the server would be wrong, and reading it during store construction would
 * desync the server render. `load()` applies it instead, on the client.
 */
const TZ_KEY = 'tempo.timezone';

function storedTimezone(): string | null {
  try {
    return window.localStorage.getItem(TZ_KEY);
  } catch {
    return null;
  }
}

export const useCalendar = create<CalendarState>((set, get) => {
  const supabase = createClient();

  /** Apply optimistically, persist, restore the snapshot if the write fails. */
  async function optimistic(
    apply: () => void,
    persist: () => Promise<{ error: { message: string } | null }>,
  ) {
    const snapshot = {
      events: get().events,
      overrides: get().overrides,
      categories: get().categories,
      // The pool is local state like any other. A delete the server refused has
      // to take its own undo offer back with it — an entry that never actually
      // left has nothing to restore, and inserting it would collide with itself.
      recentlyDeleted: get().recentlyDeleted,
    };
    apply();
    const { error } = await persist();
    if (error) {
      set({ ...snapshot, error: error.message });
    }
  }

  function findOverride(eventId: string, date: CivilDate) {
    return get().overrides.find(
      (o) => o.eventId === eventId && o.occurrenceDate === date,
    );
  }

  /** Merge a patch into this occurrence's override, creating one if needed. */
  async function patchOccurrence(occ: Occurrence, patch: OccurrencePatch, cancelled = false) {
    const ownerId = get().ownerId;
    if (!ownerId) return;

    const existing = findOverride(occ.eventId, occ.seriesDate);
    const merged: OccurrenceOverride = {
      id: existing?.id ?? crypto.randomUUID(),
      eventId: occ.eventId,
      occurrenceDate: occ.seriesDate,
      cancelled,
      patch: { ...(existing?.patch ?? {}), ...patch },
    };

    await optimistic(
      () =>
        set((s) => ({
          overrides: existing
            ? s.overrides.map((o) => (o.id === existing.id ? merged : o))
            : [...s.overrides, merged],
        })),
      async () => {
        const { error } = await supabase.from('occurrence_overrides').upsert(
          {
            id: merged.id,
            owner_id: ownerId,
            event_id: merged.eventId,
            occurrence_date: merged.occurrenceDate,
            cancelled: merged.cancelled,
            patch: merged.patch as never,
          },
          { onConflict: 'event_id,occurrence_date' },
        );
        return { error };
      },
    );
  }

  /**
   * A whole selection moved as one unit, each entry by its own delta.
   *
   * Not a loop over `moveOccurrence`. Each call is its own snapshot, so a
   * failure partway through a loop of six leaves four entries moved, one rolled
   * back and one never attempted — a state the single-snapshot rollback has no
   * way to describe, let alone undo. So the group is resolved first, applied in
   * one `set`, and written as at most one statement per table.
   *
   * The delta is a function of the occurrence rather than a number, which is the
   * one difference between the two gestures built on this: the arrow keys pass a
   * constant and preserve the spacing between entries, a drop onto a day passes
   * `toDate - occ.date` and destroys it. Everything downstream is identical, so
   * the two cannot drift apart in how they treat series, exceptions or failure.
   *
   * The remaining seam is honest and narrow: with both a series rewrite and an
   * override in the same selection, the events write can land and the overrides
   * write fail, leaving the server ahead of the rolled-back client until the
   * next load. Closing that needs a transaction, which means an RPC, which is a
   * server-side surface this app does not otherwise have.
   */
  async function shiftBy(
    occs: Occurrence[],
    deltaFor: (occ: Occurrence) => number,
    scope: EditScope,
  ) {
    const ownerId = get().ownerId;
    if (!ownerId) return;

    const tz = get().timezone;
    const byId = new Map(get().events.map((e) => [e.id, e]));

    const patches = new Map<string, Partial<TempoEvent>>();
    const overrides = new Map<string, OccurrenceOverride>();
    /**
     * Event ids a whole-series shift has already spoken for.
     *
     * Separate from `patches` because a claim and a patch are different facts: a
     * selection holding two instances of one series describes one row with two
     * destinations, and the earliest instance settles it — including when the
     * earliest one is not moving at all. Keyed off `patches` instead, an earliest
     * instance with a zero delta would write no patch, leave the id unclaimed,
     * and hand the row to whichever later instance came next.
     */
    const claimed = new Set<string>();

    // Earliest first, so "the first occurrence of a series wins" is a rule about
    // the calendar rather than about the order a selection happened to arrive in.
    // Irrelevant to a shared delta, where every instance of a row agrees anyway.
    for (const occ of [...occs].sort((a, b) => a.date.localeCompare(b.date))) {
      if (occ.readOnly) continue;
      const ev = byId.get(occ.eventId);
      if (!ev) continue;
      const deltaDays = deltaFor(occ);

      // A one-off has no series to distinguish itself from, so it moves whole
      // whatever the scope says — the same rule `moveOccurrence` applies.
      if (scope === 'series' || !ev.recurrence) {
        if (claimed.has(ev.id)) continue;
        claimed.add(ev.id);
        if (deltaDays !== 0) patches.set(ev.id, shiftEvent(ev, deltaDays, deltaDays, tz));
        continue;
      }

      if (deltaDays === 0) continue;
      const key = overrideKey(occ);
      if (overrides.has(key)) continue;
      const existing = findOverride(occ.eventId, occ.seriesDate);
      overrides.set(key, {
        id: existing?.id ?? crypto.randomUUID(),
        eventId: occ.eventId,
        occurrenceDate: occ.seriesDate,
        cancelled: false,
        patch: {
          ...(existing?.patch ?? {}),
          startDate: addDays(occ.date, deltaDays),
          endDate: addDays(occ.endDate, deltaDays),
        },
      });
    }

    if (patches.size === 0 && overrides.size === 0) return;
    const rewritten = [...overrides.values()];

    await optimistic(
      () =>
        set((s) => ({
          events: s.events.map((e) => {
            const patch = patches.get(e.id);
            return patch ? { ...e, ...patch } : e;
          }),
          overrides: mergeOverrides(s.overrides, rewritten),
        })),
      async () => {
        if (patches.size > 0) {
          // Read back out of the store rather than rebuilt here: `apply` has
          // already run, so these are the rows the calendar is showing, and
          // the write and the optimistic state cannot drift apart.
          const rows = get()
            .events.filter((e) => patches.has(e.id))
            .map((e) => ({ id: e.id, owner_id: ownerId, title: e.title, ...eventToRow(e) }));
          const { error } = await supabase.from('events').upsert(rows);
          if (error) return { error };
        }

        if (rewritten.length > 0) {
          const { error } = await supabase.from('occurrence_overrides').upsert(
            rewritten.map((o) => ({
              id: o.id,
              owner_id: ownerId,
              event_id: o.eventId,
              occurrence_date: o.occurrenceDate,
              cancelled: o.cancelled,
              patch: o.patch as never,
            })),
            { onConflict: 'event_id,occurrence_date' },
          );
          if (error) return { error };
        }

        return { error: null };
      },
    );
  }

  return {
    timezone: DEFAULT_TZ,
    ownerId: null,
    events: [],
    overrides: [],
    categories: [],
    recentlyDeleted: [],
    status: 'idle',
    error: null,

    dismissError: () => set({ error: null }),

    setTimezone: (tz) => {
      try {
        window.localStorage.setItem(TZ_KEY, tz);
      } catch {
        // private mode / storage disabled: the choice just doesn't survive a reload
      }
      set({ timezone: tz });
    },

    load: async () => {
      set({ status: 'loading', error: null });

      const saved = storedTimezone();
      if (saved) set({ timezone: saved });
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        set({ status: 'error', error: 'Not signed in' });
        return;
      }

      const [events, overrides, categories] = await Promise.all([
        supabase.from('events').select('*'),
        supabase.from('occurrence_overrides').select('*'),
        supabase.from('categories').select('*').order('sort_order'),
      ]);

      const failure = events.error ?? overrides.error ?? categories.error;
      if (failure) {
        set({ status: 'error', error: failure.message });
        return;
      }

      let categoryRows = categories.data ?? [];
      if (categoryRows.length === 0) {
        const seeded = await supabase
          .from('categories')
          .insert(DEFAULT_CATEGORIES.map((c) => ({ ...c, owner_id: user.id })))
          .select();
        if (seeded.data) categoryRows = seeded.data;
      }

      set({
        ownerId: user.id,
        events: (events.data ?? []).map(eventFromRow),
        overrides: (overrides.data ?? []).map(overrideFromRow),
        categories: categoryRows.map(categoryFromRow),
        status: 'ready',
      });
    },

    createEvent: async (draft) => {
      const ownerId = get().ownerId;
      if (!ownerId) return;
      const tz = get().timezone;

      const id = crypto.randomUUID();

      const event: TempoEvent = {
        id,
        ...draftFields(draft, tz),
        timezone: tz,
        notify: draft.notify ?? false,
        source: 'tempo',
        googleEventId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await optimistic(
        () => set((s) => ({ events: [...s.events, event] })),
        async () => {
          const { error } = await supabase
            .from('events')
            .insert({ id, owner_id: ownerId, title: event.title, ...eventToRow(event) });
          return { error };
        },
      );
    },

    updateEventFromDraft: async (id, draft) => {
      await get().updateEvent(id, draftFields(draft, get().timezone));
    },

    updateEvent: async (id, patch) => {
      await optimistic(
        () =>
          set((s) => ({
            events: s.events.map((e) => (e.id === id ? { ...e, ...patch } : e)),
          })),
        async () => {
          const { error } = await supabase.from('events').update(eventToRow(patch)).eq('id', id);
          return { error };
        },
      );
    },

    deleteEvent: async (id) => {
      await optimistic(
        () =>
          set((s) => ({
            events: s.events.filter((e) => e.id !== id),
            overrides: s.overrides.filter((o) => o.eventId !== id),
            // Read off `s` rather than captured beforehand, so the rows the pool
            // keeps and the rows the two filters above drop are the same rows.
            recentlyDeleted: remember(
              s.recentlyDeleted,
              s.events.filter((e) => e.id === id),
              s.overrides,
            ),
          })),
        async () => {
          const { error } = await supabase.from('events').delete().eq('id', id);
          return { error };
        },
      );
    },

    deleteEvents: async (ids) => {
      const doomed = new Set(ids);
      if (doomed.size === 0) return;

      await optimistic(
        () =>
          set((s) => ({
            events: s.events.filter((e) => !doomed.has(e.id)),
            overrides: s.overrides.filter((o) => !doomed.has(o.eventId)),
            recentlyDeleted: remember(
              s.recentlyDeleted,
              s.events.filter((e) => doomed.has(e.id)),
              s.overrides,
            ),
          })),
        async () => {
          const { error } = await supabase.from('events').delete().in('id', [...doomed]);
          return { error };
        },
      );
    },

    /**
     * Put one back, as an insert.
     *
     * Not `updateEvent`: the row is gone from the server, so an update would
     * match nothing, change nothing and report success — the calendar would show
     * the entry again and lose it on the next load. The exceptions go back the
     * same way and in the same call, because a series that returns without them
     * has quietly forgotten which instances were moved or cancelled.
     */
    restoreDeleted: async (eventId) => {
      const ownerId = get().ownerId;
      if (!ownerId) return;

      const entry = get().recentlyDeleted.find((d) => d.event.id === eventId);
      if (!entry) return;
      const { event, overrides } = entry;

      await optimistic(
        () =>
          set((s) => ({
            events: [...s.events, event],
            overrides: [...s.overrides, ...overrides],
            recentlyDeleted: s.recentlyDeleted.filter((d) => d.event.id !== eventId),
          })),
        async () => {
          const restored = await supabase
            .from('events')
            .insert({ id: event.id, owner_id: ownerId, title: event.title, ...eventToRow(event) });
          if (restored.error) return { error: restored.error };

          if (overrides.length === 0) return { error: null };
          const { error } = await supabase.from('occurrence_overrides').insert(
            overrides.map((o) => ({
              id: o.id,
              owner_id: ownerId,
              event_id: o.eventId,
              occurrence_date: o.occurrenceDate,
              cancelled: o.cancelled,
              patch: o.patch as never,
            })),
          );
          return { error };
        },
      );
    },

    purgeDeleted: (eventId) =>
      set((s) => ({
        recentlyDeleted: eventId
          ? s.recentlyDeleted.filter((d) => d.event.id !== eventId)
          : [],
      })),

    moveOccurrence: async (occ, deltaDays, scope) => {
      if (occ.readOnly || deltaDays === 0) return;

      // A one-off event has no series to distinguish from, so it always moves whole.
      const wholeSeries = scope === 'series' || !occ.event.recurrence;

      if (!wholeSeries) {
        await patchOccurrence(occ, {
          startDate: addDays(occ.date, deltaDays),
          endDate: addDays(occ.endDate, deltaDays),
        });
        return;
      }

      const ev = occ.event;
      await get().updateEvent(ev.id, shiftEvent(ev, deltaDays, deltaDays, get().timezone));
    },

    /** Every entry by the same number of days, so the spacing survives. */
    moveOccurrences: async (occs, deltaDays, scope) => {
      if (deltaDays === 0) return;
      await shiftBy(occs, () => deltaDays, scope);
    },

    /**
     * Every entry onto one date, each keeping its own length.
     *
     * What dropping a lasso'd selection on a day means. Deliberately not a
     * shared delta: "put these here" is a different request from "push these
     * forward three days", and the grabbed bar's own offset — which is all a
     * shared delta can be computed from — is not part of either one. That also
     * makes a drop onto a date one of the entries already occupies meaningful
     * rather than a no-op: the others still have to come to it.
     */
    gatherOccurrences: async (occs, toDate, scope) => {
      await shiftBy(occs, (occ) => diffDays(toDate, occ.date), scope);
    },

    resizeOccurrence: async (occ, deltaDays, edge, scope) => {
      if (occ.readOnly || deltaDays === 0) return;

      const nextStart = edge === 'start' ? addDays(occ.date, deltaDays) : occ.date;
      const nextEnd = edge === 'end' ? addDays(occ.endDate, deltaDays) : occ.endDate;
      if (nextEnd < nextStart) return; // refuse to invert the bar

      const wholeSeries = scope === 'series' || !occ.event.recurrence;
      if (!wholeSeries) {
        await patchOccurrence(occ, { startDate: nextStart, endDate: nextEnd });
        return;
      }

      const ev = occ.event;
      const startDelta = edge === 'start' ? deltaDays : 0;
      const endDelta = edge === 'end' ? deltaDays : 0;
      await get().updateEvent(ev.id, shiftEvent(ev, startDelta, endDelta, get().timezone));
    },

    setOccurrenceTime: async (occ, startMinutes, endMinutes, scope) => {
      if (occ.readOnly || occ.allDay) return;
      if (endMinutes <= startMinutes) return;

      const wholeSeries = scope === 'series' || !occ.event.recurrence;
      if (!wholeSeries) {
        await patchOccurrence(occ, { startMinutes, endMinutes });
        return;
      }

      const ev = occ.event;
      const span = eventSpan(ev);
      if (!span) return;
      await get().updateEvent(ev.id, {
        startsAt: instantFromCivil(span.start, startMinutes, ev.timezone).toISOString(),
        endsAt: instantFromCivil(span.end, endMinutes, ev.timezone).toISOString(),
      });
    },

    cancelOccurrence: async (occ) => {
      if (occ.readOnly) return;
      // A one-off has nothing to except out of; delete the row instead.
      if (!occ.event.recurrence) {
        await get().deleteEvent(occ.eventId);
        return;
      }
      await patchOccurrence(occ, {}, true);
    },

    setStatus: async (occ, status) => {
      if (occ.readOnly) return;
      if (occ.event.recurrence) {
        await patchOccurrence(occ, { status });
        return;
      }
      await get().updateEvent(occ.eventId, { status });
    },

    createCategory: async (name, color) => {
      const ownerId = get().ownerId;
      if (!ownerId) return;
      const title = name.trim();
      if (!title) return;

      // Appended, never inserted: `sort_order` is the display order and the
      // seeded four already occupy 0..3, so a new one takes the next number
      // rather than renumbering rows nobody asked to move.
      const id = crypto.randomUUID();
      const sortOrder = get().categories.reduce((n, c) => Math.max(n, c.sortOrder + 1), 0);
      const category: Category = { id, name: title, color, sortOrder };

      await optimistic(
        () => set((s) => ({ categories: [...s.categories, category] })),
        async () => {
          const { error } = await supabase.from('categories').insert({
            id,
            owner_id: ownerId,
            name: category.name,
            color: category.color,
            sort_order: category.sortOrder,
          });
          return { error };
        },
      );
    },

    updateCategory: async (id, patch) => {
      await optimistic(
        () =>
          set((s) => ({
            categories: s.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)),
          })),
        async () => {
          // `name` and `color` are spelled identically in both shapes, so this
          // needs no mapper. `sortOrder` is the one field that isn't, and it is
          // deliberately not patchable here.
          const { error } = await supabase.from('categories').update(patch).eq('id', id);
          return { error };
        },
      );
    },

    deleteCategory: async (id) => {
      await optimistic(
        () =>
          set((s) => ({
            categories: s.categories.filter((c) => c.id !== id),
            events: s.events.map((e) =>
              e.categoryId === id ? { ...e, categoryId: null } : e,
            ),
          })),
        async () => {
          /**
           * Null the references first, then drop the row.
           *
           * The generated types confirm `events_category_id_fkey` exists but
           * say nothing about its `ON DELETE`, and the three possibilities
           * disagree loudly: RESTRICT rejects the delete outright, CASCADE
           * takes the events with it, SET NULL does this anyway. Clearing
           * explicitly is correct under all three, and it is the only version
           * that matches what local state was just told happened — a rollback
           * can only restore a snapshot, not reconstruct a cascade.
           */
          const cleared = await supabase
            .from('events')
            .update({ category_id: null })
            .eq('category_id', id);
          if (cleared.error) return { error: cleared.error };

          const { error } = await supabase.from('categories').delete().eq('id', id);
          return { error };
        },
      );
    },
  };
});

/**
 * Push everything one delete removed onto the front of the pool.
 *
 * The stamp is shared by the whole batch and forced strictly past the newest
 * entry already there, which makes it a batch key as well as a time: "what did
 * the last delete take" has an exact answer, which is what a single UNDO has to
 * cover. Two deletes inside one millisecond would otherwise be one
 * indistinguishable batch — a millisecond of drift on a stamp nobody reads below
 * the minute is the cheaper of the two errors.
 */
function remember(
  pool: DeletedEntry[],
  events: TempoEvent[],
  overrides: OccurrenceOverride[],
): DeletedEntry[] {
  if (events.length === 0) return pool;
  const at = Math.max(Date.now(), (pool[0]?.at ?? 0) + 1);
  const taken = events.map((event) => ({
    event,
    overrides: overrides.filter((o) => o.eventId === event.id),
    at,
  }));
  return [...taken, ...pool].slice(0, DELETE_POOL_CAP);
}

/**
 * What a draft says about an event, as event fields.
 *
 * The one translation between the form's vocabulary and a row's, so create and
 * update cannot disagree about it — and they did. `updateEvent` takes a
 * `Partial<TempoEvent>`, `startMinutes` is not a field of one, and a spread
 * widens rather than rejects; so an edit handed its draft straight over, the
 * patch reached `eventToRow` carrying no time at all, the write succeeded, and
 * the entry kept whatever hour it already had.
 *
 * `notify`, `source` and the identity fields are deliberately absent: they are
 * not the form's to state, and an edit must not reset them.
 */
function draftFields(draft: EventDraft, tz: string) {
  return {
    title: draft.title,
    notes: draft.notes ?? null,
    kind: draft.kind,
    categoryId: draft.categoryId ?? null,
    recurrence: draft.recurrence ?? null,
    anchorDate: draft.anchorDate ?? null,
    displayTemplate: draft.displayTemplate ?? null,
    status: draft.status ?? (draft.kind === 'assignment' ? 'todo' : null),
    ...draftTiming(draft, tz),
  };
}

/**
 * The date and time fields a draft implies.
 *
 * The form speaks minutes from midnight; a row speaks instants, and only the
 * store knows the zone that converts between them.
 */
function draftTiming(draft: EventDraft, tz: string) {
  const timed = !draft.allDay;
  const startMinutes = draft.startMinutes ?? 9 * 60;
  const endMinutes = draft.endMinutes ?? startMinutes + 60;
  return {
    allDay: draft.allDay,
    startsAt: timed ? instantFromCivil(draft.startDate, startMinutes, tz).toISOString() : null,
    endsAt: timed ? instantFromCivil(draft.endDate, endMinutes, tz).toISOString() : null,
    // A timed entry's span lives in the instants; an all-day one has no instant
    // to hold it. Exactly one pair is ever populated.
    startDate: draft.allDay ? draft.startDate : null,
    endDate: draft.allDay ? draft.endDate : null,
  };
}

/**
 * Shift an event definition by whole days.
 *
 * Timed events are rebuilt from wall-clock time rather than having milliseconds
 * added, so a 09:00 meeting dragged across a DST boundary is still at 09:00.
 */
function shiftEvent(
  ev: TempoEvent,
  startDelta: number,
  endDelta: number,
  tz: string,
): Partial<TempoEvent> {
  if (ev.allDay) {
    return {
      startDate: addDays(ev.startDate!, startDelta),
      endDate: addDays(ev.endDate!, endDelta),
    };
  }
  const span = eventSpan(ev);
  if (!span) return {};
  const zone = ev.timezone || tz;
  return {
    startsAt: instantFromCivil(
      addDays(span.start, startDelta),
      span.startMinutes ?? 0,
      zone,
    ).toISOString(),
    endsAt: instantFromCivil(
      addDays(span.end, endDelta),
      span.endMinutes ?? 60,
      zone,
    ).toISOString(),
  };
}

/**
 * Replace-or-append, keyed by `(event, occurrence date)`.
 *
 * That pair is the table's own unique constraint, so rewriting an exception
 * that already exists has to update the row rather than add a second one for
 * the same day — which the upsert would then reject.
 */
function mergeOverrides(
  existing: OccurrenceOverride[],
  incoming: OccurrenceOverride[],
): OccurrenceOverride[] {
  const identity = (o: OccurrenceOverride) => `${o.eventId}:${o.occurrenceDate}`;
  const replaced = new Set(incoming.map(identity));
  return [...existing.filter((o) => !replaced.has(identity(o))), ...incoming];
}

/** Overrides grouped for the expander. */
export function groupOverrides(overrides: OccurrenceOverride[]): Map<string, OccurrenceOverride[]> {
  const map = new Map<string, OccurrenceOverride[]>();
  for (const o of overrides) {
    const list = map.get(o.eventId);
    if (list) list.push(o);
    else map.set(o.eventId, [o]);
  }
  return map;
}
