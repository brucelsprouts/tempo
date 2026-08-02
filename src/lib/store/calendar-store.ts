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
import type {
  CategoryRow,
  EventRow,
  OccurrenceOverrideRow,
} from '@/lib/db/database.types';
import {
  categoryFromRow,
  eventFromRow,
  eventToRow,
  overrideFromRow,
  overrideKey,
  versionFromRow,
} from '@/lib/tempo/mappers';
import {
  addDays,
  diffDays,
  instantFromCivil,
  LAST_MINUTE_OF_DAY,
  type CivilDate,
} from '@/lib/tempo/civil';
import { copyableFields, copyTitle } from '@/lib/tempo/duplicate';
import { eventSpan } from '@/lib/tempo/recurrence';
import type {
  Category,
  EventKind,
  EventStatus,
  EventVersion,
  Occurrence,
  OccurrenceOverride,
  OccurrencePatch,
  Recurrence,
  Reminder,
  TempoEvent,
  VersionReason,
} from '@/lib/tempo/types';

import { EMPTY_TOUCHED, movedNothing, planRows, same, type Snapshot, type Touched } from './undo';

/** Whether an edit applies to one instance or rewrites the whole series. */
export type EditScope = 'occurrence' | 'series';

/** A safety net, not a log. The fifty-first action pushes the oldest off. */
const UNDO_CAP = 50;

export interface UndoEntry {
  /** What the toast says, and what ⌘Z is taking back. */
  label: string;
  at: number;
  before: Snapshot;
  touched: Touched;
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
  reminders?: Reminder[];
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
   * The trash: rows whose `deleted_at` is set, newest first.
   *
   * A separate list rather than a flag every view has to remember to check.
   * `events` still means "live", so the grid, the year view and the list all
   * kept working untouched when deletion stopped being permanent.
   */
  deleted: TempoEvent[];

  /**
   * The versions of one entry, and which entry they belong to.
   *
   * Loaded on demand rather than with the calendar: history is a surface you
   * open, and fetching every version of every entry at startup would be paying
   * for it on every load instead.
   */
  versions: EventVersion[];
  versionsFor: string | null;

  load: () => Promise<void>;
  createEvent: (draft: EventDraft) => Promise<void>;
  updateEvent: (id: string, patch: Partial<TempoEvent>) => Promise<void>;
  /** Editing counterpart to `createEvent`. See `draftTiming`. */
  updateEventFromDraft: (id: string, draft: EventDraft) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  deleteEvents: (ids: string[]) => Promise<void>;
  /** Put one back, or the whole trash when called with nothing. */
  restoreDeleted: (eventId?: string) => Promise<void>;
  /**
   * The one hard delete in the app. One entry, or the whole trash.
   *
   * Irreversible, and it takes the entry's exceptions with it by cascade — so
   * every caller asks first.
   */
  purgeDeleted: (eventId?: string) => Promise<void>;
  /**
   * Start and stop listening for changes made elsewhere.
   *
   * Separate from `load()` because they answer different questions — one is
   * "what is there", the other is "what changed since" — and because the
   * subscription needs an owner, which only exists once the load has resolved.
   */
  connect: () => void;
  disconnect: () => void;
  /** Fill `versions` with one entry's history. */
  loadVersions: (eventId: string) => Promise<void>;
  /** Put a recorded shape back. Itself an edit, and itself recorded. */
  rollbackTo: (versionId: string) => Promise<void>;
  moveOccurrence: (occ: Occurrence, deltaDays: number, scope: EditScope) => Promise<void>;
  /** A selection shifted by one shared delta, keeping the spacing between entries. */
  moveOccurrences: (occs: Occurrence[], deltaDays: number, scope: EditScope) => Promise<void>;
  /** A selection collapsed onto one date, each entry keeping its own length. */
  gatherOccurrences: (occs: Occurrence[], toDate: CivilDate, scope: EditScope) => Promise<void>;
  /**
   * A selection copied, as new entries.
   *
   * `toDate` places the earliest copy and shifts the rest by the same delta, so
   * the shape of a selection survives being pasted somewhere else; `null` means
   * in place, which is what a duplicate is. Returns the rows it created, so the
   * caller can light them up — the copies are what you want selected after
   * making them, the way they are in every editor that has this.
   */
  duplicateOccurrences: (
    occs: Occurrence[],
    toDate: CivilDate | null,
  ) => Promise<TempoEvent[]>;
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

  /**
   * What this session did, newest first.
   *
   * In memory and nowhere else, and deliberately separate from `event_versions`:
   * a version log is per-entry and ordered by time, and a group move of six
   * entries is one action across six rows. Only a stack can express that as one
   * Cmd-Z. The durable half already exists; this is the reflex.
   */
  undoStack: UndoEntry[];
  /** Take back the last action. */
  undo: () => Promise<void>;
}

/** Seeded once, so a fresh calendar has colours to assign immediately. */
const DEFAULT_CATEGORIES = [
  { name: 'personal', color: '#7d9a6d', sort_order: 0 },
  { name: 'work', color: '#6d8bb0', sort_order: 1 },
  { name: 'school', color: '#b8705c', sort_order: 2 },
  { name: 'admin', color: '#8a9096', sort_order: 3 },
];

const DEFAULT_TZ = process.env.NEXT_PUBLIC_TEMPO_TIMEZONE || 'America/Toronto';

/**
 * How long the trash holds an entry.
 *
 * Stated in the empty state of the history panel, so it has to be true. Without
 * it the trash is a second copy of the calendar that grows forever and nobody
 * ever reads.
 */
const TRASH_DAYS = 30;

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

  /**
   * The realtime channel, held outside the store's state.
   *
   * It is a socket, not data: nothing renders from it, and putting it in state
   * would make every subscribe and unsubscribe a re-render of the whole
   * calendar for a value no component reads.
   */
  let channel: ReturnType<typeof supabase.channel> | null = null;

  /**
   * Apply optimistically, persist, restore the snapshot if the write fails —
   * and remember the snapshot if it succeeds.
   *
   * The snapshot was always taken; it was simply thrown away on success. Undo
   * is that snapshot kept, which is why it costs a field rather than a
   * mechanism.
   */
  async function optimistic(
    apply: () => void,
    persist: () => Promise<{ error: { message: string } | null }>,
    record?: { label: string; touched: Touched },
  ): Promise<boolean> {
    const snapshot: Snapshot = {
      events: get().events,
      overrides: get().overrides,
      categories: get().categories,
      // The trash is local state like any other. A delete the server refused
      // has to take its own undo offer back with it — an entry that never
      // actually left has nothing to restore.
      deleted: get().deleted,
    };
    apply();

    /**
     * Measured here rather than after the write, and against the same diff undo
     * would use. Realtime streams other devices' edits into the store while a
     * request is in flight, so asking afterwards would credit this action with
     * a change that came from somewhere else.
     */
    const moot = record ? movedNothing(snapshot, get(), record.touched) : false;

    const { error } = await persist();
    if (error) {
      set({ ...snapshot, error: error.message });
      return false;
    }
    // Only on success, and only if something moved. An entry for a rejected
    // write would offer to take back something that never happened; an entry
    // for a no-op would offer to take back nothing at all.
    if (record && !moot) {
      set((s) => ({
        undoStack: [
          { label: record.label, at: Date.now(), before: snapshot, touched: record.touched },
          ...s.undoStack,
        ].slice(0, UNDO_CAP),
      }));
    }
    return true;
  }

  /**
   * Write down the shape an entry has right now, before something changes it.
   *
   * Deliberately not awaited and deliberately outside `optimistic()`. A version
   * is bookkeeping, not the thing the user asked for, and two failures make
   * that non-negotiable: the migration may not have been run, in which case
   * awaiting this would make every edit in the app appear to fail; and a
   * history table that is full or unreachable must degrade to "no history"
   * rather than to "the calendar is broken". Awaiting it would also put a
   * round-trip in front of every optimistic update, which is the one thing the
   * whole store is arranged to avoid.
   *
   * It reads state rather than taking a snapshot argument, so "before" is a
   * fact about when it is called — every call site is the first line of its
   * mutation, ahead of the `set`.
   */
  function captureVersion(eventId: string, reason: VersionReason) {
    const { ownerId, events, deleted, overrides } = get();
    if (!ownerId) return;

    // The trash as well as the live list: a version can be captured for an
    // entry that is already deleted, which is what makes rolling one back to
    // an older shape possible without restoring it first.
    const event = events.find((e) => e.id === eventId) ?? deleted.find((e) => e.id === eventId);
    if (!event) return;

    void supabase
      .from('event_versions')
      .insert({
        owner_id: ownerId,
        event_id: eventId,
        reason,
        snapshot: {
          event,
          overrides: overrides.filter((o) => o.eventId === eventId),
        } as never,
      })
      .then(({ error }) => {
        if (error) warnOnce(error.message);
      });
  }

  /**
   * The stamp a delete writes, and the key for everything it took.
   *
   * Chosen here rather than left to the server's `now()` so the row the
   * calendar is holding and the row on the server agree — an optimistic update
   * that guesses a different timestamp would show one thing until the next
   * load and another after it. Forced strictly past the newest entry already in
   * the trash, which makes it a batch key as well as a time: "what did the last
   * delete take" has an exact answer, which is what a single UNDO has to cover.
   */
  function deleteStamp(): string {
    const now = new Date().toISOString();
    const newest = get().deleted[0]?.deletedAt;
    return newest && newest >= now ? new Date(Date.parse(newest) + 1).toISOString() : now;
  }

  /** An entry's title, for a label. Falls back rather than throwing. */
  function titleOf(id: string): string {
    const { events, deleted } = get();
    return (events.find((e) => e.id === id) ?? deleted.find((e) => e.id === id))?.title ?? 'entry';
  }

  /** The rows an action touched, for the common single-table cases. */
  const touchedEvents = (ids: string[]): Touched => ({ ...EMPTY_TOUCHED, events: ids });
  const touchedOverrides = (ids: string[]): Touched => ({ ...EMPTY_TOUCHED, overrides: ids });

  /**
   * An entry changed somewhere else.
   *
   * Merged by id in every case, never appended: an UPDATE can be the first this
   * device has heard of a row — it may have been created while this tab was
   * closed, or the INSERT may simply have been missed — so "update what I have"
   * and "add what I don't" are the same operation.
   *
   * A soft delete crosses the wire as an UPDATE, which is the case a handler
   * written before Section G would have got wrong: it would have applied the
   * new `deleted_at` as an ordinary field change and left a deleted entry
   * sitting on the grid.
   */
  function applyRemoteEvent(payload: RemotePayload<EventRow>) {
    if (payload.eventType === 'DELETE') {
      const id = payload.old?.id;
      if (!id) return;
      set((s) => ({
        events: s.events.filter((e) => e.id !== id),
        deleted: s.deleted.filter((e) => e.id !== id),
        // The server cascaded these; keeping them would leave exceptions
        // pointing at a row that is gone.
        overrides: s.overrides.filter((o) => o.eventId !== id),
      }));
      return;
    }

    if (!payload.new) return;
    const incoming = eventFromRow(payload.new);
    set((s) => ({
      events:
        incoming.deletedAt === null
          ? replaceById(s.events, incoming)
          : s.events.filter((e) => e.id !== incoming.id),
      deleted:
        incoming.deletedAt === null
          ? s.deleted.filter((e) => e.id !== incoming.id)
          : replaceById(s.deleted, incoming),
    }));
  }

  function applyRemoteOverride(payload: RemotePayload<OccurrenceOverrideRow>) {
    if (payload.eventType === 'DELETE') {
      const id = payload.old?.id;
      if (!id) return;
      set((s) => ({ overrides: s.overrides.filter((o) => o.id !== id) }));
      return;
    }
    if (!payload.new) return;
    const incoming = overrideFromRow(payload.new);
    set((s) => ({ overrides: replaceById(s.overrides, incoming) }));
  }

  function applyRemoteCategory(payload: RemotePayload<CategoryRow>) {
    if (payload.eventType === 'DELETE') {
      const id = payload.old?.id;
      if (!id) return;
      set((s) => ({
        categories: s.categories.filter((c) => c.id !== id),
        // Mirrors what `deleteCategory` does locally, and what the column's
        // own `ON DELETE` will have done on the server.
        events: s.events.map((e) => (e.categoryId === id ? { ...e, categoryId: null } : e)),
      }));
      return;
    }
    if (!payload.new) return;
    const incoming = categoryFromRow(payload.new);
    set((s) => ({
      categories: [...s.categories.filter((c) => c.id !== incoming.id), incoming].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      ),
    }));
  }

  /**
   * The write half of `updateEvent`, without the version capture.
   *
   * The record is optional because the label belongs to the *gesture*, not to
   * the method that finished it: `moveOccurrence` delegating here must still
   * say "Moved", so it passes its own.
   */
  async function writeEvent(
    id: string,
    patch: Partial<TempoEvent>,
    record?: { label: string; touched: Touched },
  ) {
    await optimistic(
      () =>
        set((s) => ({
          events: s.events.map((e) => (e.id === id ? { ...e, ...patch } : e)),
        })),
      async () => {
        const { error } = await supabase.from('events').update(eventToRow(patch)).eq('id', id);
        return { error };
      },
      record ?? { label: `Edited ${titleOf(id)}`, touched: touchedEvents([id]) },
    );
  }

  /** Move rows into the trash under one shared stamp. */
  async function softDelete(ids: string[], match: (id: string) => boolean) {
    if (ids.length === 0) return;
    // Ahead of the write, so the version records the entry as it stood. A
    // delete the server then refuses leaves one unused version behind, which
    // the retention trigger reclaims.
    for (const id of ids) captureVersion(id, 'delete');

    const at = deleteStamp();
    // Read before the rows move, so a one-entry delete says what it took.
    const label = ids.length === 1 ? `Deleted ${titleOf(ids[0])}` : `Deleted ${ids.length} entries`;
    await optimistic(
      () =>
        set((s) => ({
          events: s.events.filter((e) => !match(e.id)),
          // Read off `s` rather than captured beforehand, so the rows the trash
          // receives and the rows the filter drops are the same rows.
          deleted: [
            ...s.events.filter((e) => match(e.id)).map((e) => ({ ...e, deletedAt: at })),
            ...s.deleted,
          ],
        })),
      async () => {
        const q = supabase.from('events').update({ deleted_at: at });
        const { error } = ids.length === 1 ? await q.eq('id', ids[0]) : await q.in('id', ids);
        return { error };
      },
      { label, touched: touchedEvents(ids) },
    );
  }

  function findOverride(eventId: string, date: CivilDate) {
    return get().overrides.find(
      (o) => o.eventId === eventId && o.occurrenceDate === date,
    );
  }

  /** Merge a patch into this occurrence's override, creating one if needed. */
  async function patchOccurrence(
    occ: Occurrence,
    patch: OccurrencePatch,
    cancelled = false,
    record?: (override: OccurrenceOverride) => { label: string; touched: Touched },
  ) {
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
      record?.(merged) ?? {
        label: `Edited ${titleOf(occ.eventId)}`,
        touched: touchedOverrides([merged.id]),
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

    const moved = patches.size + overrides.size;
    const movedIds = [...patches.keys(), ...rewritten.map((o) => o.eventId)];

    // One version per entry actually being touched, and only once the group has
    // resolved — an occurrence that turned out to be a no-op is not an edit.
    for (const id of new Set([...patches.keys(), ...rewritten.map((o) => o.eventId)])) {
      captureVersion(id, 'move');
    }

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
      {
        // One gesture, however many rows it reached.
        label: moved === 1 ? `Moved ${titleOf(movedIds[0])}` : `Moved ${moved} entries`,
        touched: {
          events: [...patches.keys()],
          overrides: rewritten.map((o) => o.id),
          categories: [],
        },
      },
    );
  }

  return {
    timezone: DEFAULT_TZ,
    ownerId: null,
    events: [],
    overrides: [],
    categories: [],
    deleted: [],
    versions: [],
    versionsFor: null,
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

      /**
       * One query, partitioned here.
       *
       * Two queries — one for live rows, one for the trash — would be two
       * round-trips for a split this side of the wire can do for nothing, and
       * they could disagree if a delete landed between them.
       */
      const all = (events.data ?? []).map(eventFromRow);
      const cutoff = new Date(Date.now() - TRASH_DAYS * 86_400_000).toISOString();
      const expired = all.filter((e) => e.deletedAt !== null && e.deletedAt < cutoff);

      set({
        ownerId: user.id,
        events: all.filter((e) => e.deletedAt === null),
        deleted: all
          .filter((e) => e.deletedAt !== null && e.deletedAt >= cutoff)
          .sort((a, b) => (a.deletedAt! < b.deletedAt! ? 1 : -1)),
        overrides: (overrides.data ?? []).map(overrideFromRow),
        categories: categoryRows.map(categoryFromRow),
        status: 'ready',
      });

      /**
       * Retention, run on the way past.
       *
       * Not awaited: nothing on screen is waiting for it, and a calendar that
       * refused to finish loading because a cleanup failed would be trading a
       * working app for a tidy table. `lt` on the stamp cannot touch a live
       * row — its `deleted_at` is null, and null compares to nothing.
       */
      if (expired.length > 0) {
        void supabase
          .from('events')
          .delete()
          .lt('deleted_at', cutoff)
          .then(({ error }) => {
            if (error) warnOnce(error.message);
          });
      }
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
        deletedAt: null,
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
        { label: `Created ${event.title}`, touched: touchedEvents([id]) },
      );
    },

    updateEventFromDraft: async (id, draft) => {
      await get().updateEvent(id, draftFields(draft, get().timezone));
    },

    /**
     * An edit that changes nothing is not an edit.
     *
     * `optimistic` already refuses to put a no-op on the undo stack, but this
     * one has to be caught a step earlier: the form commits on every close,
     * including the close where you only came to look, and by the time the
     * write is under way a version has been captured saying you edited it. A
     * history full of edits nobody made is the same untruth as the toast, told
     * somewhere it does not expire after eight seconds.
     */
    updateEvent: async (id, patch) => {
      const current = get().events.find((e) => e.id === id);
      if (current && same(current, { ...current, ...patch })) return;
      captureVersion(id, 'edit');
      await writeEvent(id, patch);
    },

    deleteEvent: async (id) => {
      await softDelete([id], (candidate) => candidate === id);
    },

    deleteEvents: async (ids) => {
      const doomed = new Set(ids);
      await softDelete([...doomed], (candidate) => doomed.has(candidate));
    },

    /**
     * Put one back by clearing the stamp.
     *
     * The row never left, so this is an ordinary update — and the exceptions
     * were never deleted either, which is the whole reason the trash moved into
     * the database. A restore used to have to remember and re-insert them, and
     * a series that came back having forgotten which instances were cancelled
     * was wrong in a way only the person who cancelled them would ever notice.
     */
    restoreDeleted: async (eventId) => {
      const trash = get().deleted;
      // One entry, or the whole trash — the same shape `purgeDeleted` takes,
      // because the two sit next to each other and answering to different
      // calling conventions would be a trap for whoever wires up the next
      // button.
      const coming = eventId ? trash.filter((e) => e.id === eventId) : trash;
      if (coming.length === 0) return;
      const ids = coming.map((e) => e.id);
      const back = new Set(ids);

      await optimistic(
        () =>
          set((s) => ({
            events: [...s.events, ...coming.map((e) => ({ ...e, deletedAt: null }))],
            deleted: s.deleted.filter((e) => !back.has(e.id)),
          })),
        async () => {
          // One statement, not one per entry: a loop that failed partway would
          // leave half the trash restored, which a single snapshot rollback has
          // no way to express.
          const q = supabase.from('events').update({ deleted_at: null });
          const { error } = ids.length === 1 ? await q.eq('id', ids[0]) : await q.in('id', ids);
          return { error };
        },
        {
          label:
            ids.length === 1
              ? `Restored ${titleOf(ids[0])}`
              : `Restored ${ids.length} entries`,
          touched: touchedEvents(ids),
        },
      );
    },

    purgeDeleted: async (eventId) => {
      const ids = eventId ? [eventId] : get().deleted.map((e) => e.id);
      if (ids.length === 0) return;
      const doomed = new Set(ids);

      await optimistic(
        () =>
          set((s) => ({
            deleted: s.deleted.filter((e) => !doomed.has(e.id)),
            // The exceptions go with it, as the cascade will do on the server.
            // A rollback can only restore a snapshot, not reconstruct one.
            overrides: s.overrides.filter((o) => !doomed.has(o.eventId)),
          })),
        async () => {
          const { error } = await supabase.from('events').delete().in('id', ids);
          return { error };
        },
      );
    },

    /**
     * Listen for what the other tabs and devices are doing.
     *
     * Filtered to this owner server-side rather than sorted out here: RLS
     * already limits what may be sent, and a filter keeps the socket quiet
     * instead of waking every client on every write.
     *
     * The merge is deliberately blunt — an incoming row wins for the fields it
     * carries. The one race it does not close is an edit in flight from *this*
     * device when a slightly older row arrives from the server: the remote row
     * lands, and this device's own write echoes back a moment later and
     * restores it. That flickers, briefly, and settles correct. Closing it
     * properly needs per-row versioning the schema does not have, which is a
     * larger change than the flicker justifies.
     */
    connect: () => {
      const ownerId = get().ownerId;
      if (!ownerId || channel) return;

      const filter = `owner_id=eq.${ownerId}`;
      const on = { event: '*', schema: 'public' } as const;

      channel = supabase
        .channel('tempo-sync')
        /**
         * Through `unknown`, deliberately. The client types a payload's `new`
         * as `{}` on a delete and as a loose index signature otherwise, so
         * there is no assignability either way — the row shape is a fact about
         * our schema that the generic channel type cannot know. The handlers
         * treat every field as possibly absent, which is what makes this safe
         * rather than merely quiet.
         */
        .on('postgres_changes', { ...on, table: 'events', filter }, (payload) =>
          applyRemoteEvent(payload as unknown as RemotePayload<EventRow>),
        )
        .on('postgres_changes', { ...on, table: 'occurrence_overrides', filter }, (payload) =>
          applyRemoteOverride(payload as unknown as RemotePayload<OccurrenceOverrideRow>),
        )
        .on('postgres_changes', { ...on, table: 'categories', filter }, (payload) =>
          applyRemoteCategory(payload as unknown as RemotePayload<CategoryRow>),
        )
        .subscribe();
    },

    disconnect: () => {
      if (!channel) return;
      supabase.removeChannel(channel);
      channel = null;
    },

    loadVersions: async (eventId) => {
      const { data, error } = await supabase
        .from('event_versions')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });

      // No history is a state this surface has to render anyway — the table may
      // not exist yet — so a failed read is an empty list, not an error banner
      // over a calendar that is working fine.
      if (error) {
        warnOnce(error.message);
        set({ versions: [], versionsFor: eventId });
        return;
      }

      set({
        versions: (data ?? [])
          .map(versionFromRow)
          .filter((v): v is EventVersion => v !== null),
        versionsFor: eventId,
      });
    },

    /**
     * Write a recorded shape back over the current one.
     *
     * The exceptions are replaced rather than merged: an override created
     * *after* the version has to go, or the series returns to its old shape
     * still carrying an instance it never had. And a version of a shape that
     * was alive restores the entry, because applying an edit to something in
     * the trash would be an edit nobody can see.
     */
    rollbackTo: async (versionId) => {
      const ownerId = get().ownerId;
      if (!ownerId) return;

      const version = get().versions.find((v) => v.id === versionId);
      if (!version) return;
      const { event, overrides } = version.snapshot;

      // Rolling back is an edit like any other, so it is recorded like one.
      // Undoing an undo is therefore possible.
      captureVersion(event.id, 'edit');

      const restored: TempoEvent = { ...event, deletedAt: null };

      await optimistic(
        () =>
          set((s) => ({
            events: [...s.events.filter((e) => e.id !== event.id), restored],
            deleted: s.deleted.filter((e) => e.id !== event.id),
            overrides: [...s.overrides.filter((o) => o.eventId !== event.id), ...overrides],
          })),
        async () => {
          const written = await supabase
            .from('events')
            .update({ ...eventToRow(restored), deleted_at: null })
            .eq('id', event.id);
          if (written.error) return { error: written.error };

          const cleared = await supabase
            .from('occurrence_overrides')
            .delete()
            .eq('event_id', event.id);
          if (cleared.error) return { error: cleared.error };

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

    undoStack: [],

    /**
     * Put the calendar back to before the last action.
     *
     * Local state is an assignment; the server needs the difference written to
     * it, which `planRows` works out once for every action there is. The entry
     * is only popped once the write lands, so a failed undo can be retried
     * rather than silently lost.
     */
    undo: async () => {
      const ownerId = get().ownerId;
      const entry = get().undoStack[0];
      if (!ownerId || !entry) return;

      const { before, touched } = entry;
      const live = get();

      /**
       * Live and trashed rows are one set. Deletion is soft, so a row in the
       * trash still exists on the server — treating the two lists separately
       * would plan an insert for a row that was only ever updated.
       */
      const events = planRows(
        [...before.events, ...before.deleted],
        [...live.events, ...live.deleted],
        touched.events,
      );
      const overrides = planRows(before.overrides, live.overrides, touched.overrides);
      const categories = planRows(before.categories, live.categories, touched.categories);

      // An undo is an edit, and an edit that leaves no version behind is a hole
      // in the history surface.
      for (const e of [...events.update, ...events.insert]) captureVersion(e.id, 'edit');

      const ok = await optimistic(
        () =>
          set({
            events: before.events,
            overrides: before.overrides,
            categories: before.categories,
            deleted: before.deleted,
          }),
        async () => {
          for (const e of [...events.insert, ...events.update]) {
            const { error } = await supabase
              .from('events')
              .upsert({ id: e.id, owner_id: ownerId, title: e.title, ...eventToRow(e) });
            if (error) return { error };
          }
          if (events.remove.length > 0) {
            const { error } = await supabase.from('events').delete().in('id', events.remove);
            if (error) return { error };
          }

          for (const o of [...overrides.insert, ...overrides.update]) {
            const { error } = await supabase.from('occurrence_overrides').upsert(
              {
                id: o.id,
                owner_id: ownerId,
                event_id: o.eventId,
                occurrence_date: o.occurrenceDate,
                cancelled: o.cancelled,
                patch: o.patch as never,
              },
              { onConflict: 'event_id,occurrence_date' },
            );
            if (error) return { error };
          }
          if (overrides.remove.length > 0) {
            const { error } = await supabase
              .from('occurrence_overrides')
              .delete()
              .in('id', overrides.remove);
            if (error) return { error };
          }

          for (const c of [...categories.insert, ...categories.update]) {
            const { error } = await supabase.from('categories').upsert({
              id: c.id,
              owner_id: ownerId,
              name: c.name,
              color: c.color,
              sort_order: c.sortOrder,
            });
            if (error) return { error };
          }
          if (categories.remove.length > 0) {
            const { error } = await supabase
              .from('categories')
              .delete()
              .in('id', categories.remove);
            if (error) return { error };
          }

          return { error: null };
        },
      );

      /**
       * Popped only once the write lands.
       *
       * `optimistic` rolled the local state back if it did not, which leaves
       * this entry still describing a real difference — so it stays, and the
       * undo can be pressed again. Read from `optimistic`'s own answer rather
       * than from `state.error`, which may still be holding a message from some
       * earlier, unrelated failure nobody has dismissed.
       */
      if (ok) set((s) => ({ undoStack: s.undoStack.slice(1) }));
    },

    moveOccurrence: async (occ, deltaDays, scope) => {
      if (occ.readOnly || deltaDays === 0) return;
      captureVersion(occ.eventId, 'move');

      // A one-off event has no series to distinguish from, so it always moves whole.
      const wholeSeries = scope === 'series' || !occ.event.recurrence;

      const label = `Moved ${occ.title}`;
      if (!wholeSeries) {
        await patchOccurrence(
          occ,
          {
            startDate: addDays(occ.date, deltaDays),
            endDate: addDays(occ.endDate, deltaDays),
          },
          false,
          (merged) => ({ label, touched: touchedOverrides([merged.id]) }),
        );
        return;
      }

      const ev = occ.event;
      await writeEvent(ev.id, shiftEvent(ev, deltaDays, deltaDays, get().timezone), {
        label,
        touched: touchedEvents([occ.eventId]),
      });
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

    /**
     * Copy a selection, as whole entries.
     *
     * Entries and not instances: a selection is made of occurrences, but an
     * occurrence is a render artefact — there is no row to copy — so what a
     * duplicate produces is a new event carrying the same recurrence rule.
     * Selecting two instances of one series therefore yields *one* copy, not
     * two identical ones, which is why the loop claims event ids as it goes.
     *
     * The shift is a single shared delta rather than one per entry. Copying
     * Monday and Friday and pasting on the 15th means the 15th and the 19th —
     * the gap between them is most of what made the pair worth copying, and
     * collapsing both onto the 15th would throw it away. That is the one place
     * this deliberately parts company with `gatherOccurrences`, which is a
     * *move* and answers a different question.
     */
    duplicateOccurrences: async (occs, toDate) => {
      const ownerId = get().ownerId;
      if (!ownerId) return [];

      const tz = get().timezone;
      const byId = new Map(get().events.map((e) => [e.id, e]));

      // Earliest first: it is the anchor the shared delta is measured from, and
      // it is the instance that decides where a series lands when several of
      // its instances are selected at once.
      const sorted = [...occs]
        .filter((o) => !o.readOnly)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (sorted.length === 0) return [];

      const delta = toDate ? diffDays(toDate, sorted[0].date) : 0;

      /**
       * Every title in play, so no copy is handed a name that is already on the
       * calendar — including one handed out a moment ago in this same batch.
       * Trashed entries are left out: their names are not visible anywhere the
       * ambiguity would bite, and reserving them would leak the trash into the
       * numbering.
       */
      const taken = new Set(get().events.map((e) => e.title));

      const copies: TempoEvent[] = [];
      const claimed = new Set<string>();
      const now = new Date().toISOString();

      for (const occ of sorted) {
        if (claimed.has(occ.eventId)) continue;
        claimed.add(occ.eventId);

        /**
         * The live row, or the one the occurrence is carrying.
         *
         * The fallback is what makes a paste survive its original: the
         * clipboard holds occurrences captured at copy time, so deleting the
         * entry you copied would otherwise turn ⌘V into a no-op. Live wins when
         * it exists, so editing an entry between copy and paste gives you the
         * version you can see rather than the one you had.
         */
        const ev = byId.get(occ.eventId) ?? occ.event;
        if (!ev) continue;
        const title = copyTitle(ev.title, taken);
        taken.add(title);

        copies.push({
          id: crypto.randomUUID(),
          title,
          ...copyableFields(ev),
          // Both date pairs come from the source and then move together, so a
          // timed copy keeps its instants and an all-day one keeps its bare
          // dates — exactly one pair is ever populated, and `shiftEvent`
          // rewrites whichever it is.
          startsAt: ev.startsAt,
          endsAt: ev.endsAt,
          startDate: ev.startDate,
          endDate: ev.endDate,
          ...shiftEvent(ev, delta, delta, tz),
          source: 'tempo',
          googleEventId: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        });
      }

      if (copies.length === 0) return [];

      const ok = await optimistic(
        () => set((s) => ({ events: [...s.events, ...copies] })),
        async () => {
          const { error } = await supabase.from('events').insert(
            copies.map((e) => ({ id: e.id, owner_id: ownerId, title: e.title, ...eventToRow(e) })),
          );
          return { error };
        },
        {
          label:
            copies.length === 1
              ? `Duplicated ${copies[0].title}`
              : `Duplicated ${copies.length} entries`,
          // Rows that did not exist in the snapshot, so undoing plans a delete
          // — the same path that takes back a `createEvent`.
          touched: touchedEvents(copies.map((e) => e.id)),
        },
      );

      // Nothing to select if the write was refused; `optimistic` has already
      // rolled the rows back out of the store.
      return ok ? copies : [];
    },

    resizeOccurrence: async (occ, deltaDays, edge, scope) => {
      if (occ.readOnly || deltaDays === 0) return;

      const wholeSeries = scope === 'series' || !occ.event.recurrence;
      const nextStart = edge === 'start' ? addDays(occ.date, deltaDays) : occ.date;
      const nextEnd = edge === 'end' ? addDays(occ.endDate, deltaDays) : occ.endDate;

      if (nextEnd < nextStart) return; // refuse to invert the bar

      // The clock the write will carry, which is what any check here has to be
      // about: a series rewrite keeps the series' hours, an exception keeps
      // this instance's.
      const span = eventSpan(occ.event);
      const startMinutes = (wholeSeries ? span?.startMinutes : occ.startMinutes) ?? 0;
      const endMinutes = (wholeSeries ? span?.endMinutes : occ.endMinutes) ?? 0;

      // Collapsed onto a single date, a timed entry still carries a time of
      // day, and an 18:00-to-midnight evening would read 18:00 to 00:00 —
      // backwards, and refused outright by the database. Shortening the bar is
      // what the drag asked for, so the dragged edge gives up its own hour and
      // takes the day's: the trailing edge ends at 23:59, the leading edge
      // starts at 00:00. Only on equal dates — a drag that still leaves two
      // dates already runs forwards, and its hours are none of this business.
      const clamp: OccurrencePatch =
        !occ.allDay && nextEnd === nextStart && endMinutes < startMinutes
          ? edge === 'end'
            ? { endMinutes: LAST_MINUTE_OF_DAY }
            : { startMinutes: 0 }
          : {};

      // What is left has to still have some length to it. An entry ending at
      // exactly midnight occupies none of the date it ends on, so starting it
      // there is a drop with nothing in it, and no clamping rescues that.
      if (
        !occ.allDay &&
        nextEnd === nextStart &&
        (clamp.endMinutes ?? endMinutes) <= (clamp.startMinutes ?? startMinutes)
      ) {
        return;
      }

      captureVersion(occ.eventId, 'resize');

      const label = `Resized ${occ.title}`;
      if (!wholeSeries) {
        await patchOccurrence(
          occ,
          { startDate: nextStart, endDate: nextEnd, ...clamp },
          false,
          (merged) => ({ label, touched: touchedOverrides([merged.id]) }),
        );
        return;
      }

      const ev = occ.event;
      const startDelta = edge === 'start' ? deltaDays : 0;
      const endDelta = edge === 'end' ? deltaDays : 0;
      await writeEvent(ev.id, shiftEvent(ev, startDelta, endDelta, get().timezone, clamp), {
        label,
        touched: touchedEvents([occ.eventId]),
      });
    },

    setOccurrenceTime: async (occ, startMinutes, endMinutes, scope) => {
      if (occ.readOnly || occ.allDay) return;
      if (endMinutes <= startMinutes) return;
      captureVersion(occ.eventId, 'edit');

      const wholeSeries = scope === 'series' || !occ.event.recurrence;
      const label = `Rescheduled ${occ.title}`;
      if (!wholeSeries) {
        await patchOccurrence(occ, { startMinutes, endMinutes }, false, (merged) => ({
          label,
          touched: touchedOverrides([merged.id]),
        }));
        return;
      }

      const ev = occ.event;
      const span = eventSpan(ev);
      if (!span) return;
      await writeEvent(
        ev.id,
        {
          startsAt: instantFromCivil(span.start, startMinutes, ev.timezone).toISOString(),
          endsAt: instantFromCivil(span.end, endMinutes, ev.timezone).toISOString(),
        },
        { label, touched: touchedEvents([occ.eventId]) },
      );
    },

    cancelOccurrence: async (occ) => {
      if (occ.readOnly) return;
      // A one-off has nothing to except out of; delete the row instead — which
      // takes its own snapshot, under the same reason this one would use.
      if (!occ.event.recurrence) {
        await get().deleteEvent(occ.eventId);
        return;
      }
      captureVersion(occ.eventId, 'delete');
      await patchOccurrence(occ, {}, true, (merged) => ({
        label: `Skipped ${occ.title}`,
        touched: touchedOverrides([merged.id]),
      }));
    },

    setStatus: async (occ, status) => {
      if (occ.readOnly) return;
      captureVersion(occ.eventId, 'status');
      const label = `Marked ${occ.title} ${status}`;
      if (occ.event.recurrence) {
        await patchOccurrence(occ, { status }, false, (merged) => ({
          label,
          touched: touchedOverrides([merged.id]),
        }));
        return;
      }
      await writeEvent(occ.eventId, { status }, { label, touched: touchedEvents([occ.eventId]) });
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
        {
          label: `Added category ${category.name}`,
          touched: { ...EMPTY_TOUCHED, categories: [id] },
        },
      );
    },

    updateCategory: async (id, patch) => {
      // Read before the write, so a colour-only change still names the category.
      const name = patch.name ?? get().categories.find((c) => c.id === id)?.name ?? 'category';
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
        { label: `Renamed category ${name}`, touched: { ...EMPTY_TOUCHED, categories: [id] } },
      );
    },

    deleteCategory: async (id) => {
      // Both halves of what a delete changes, read before it changes them.
      const name = get().categories.find((c) => c.id === id)?.name ?? 'category';
      const affectedIds = get()
        .events.filter((e) => e.categoryId === id)
        .map((e) => e.id);

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
        {
          label: `Deleted category ${name}`,
          touched: { events: affectedIds, overrides: [], categories: [id] },
        },
      );
    },
  };
});

/**
 * Say once that history is unavailable, then stop.
 *
 * The two ways this fires are "the migration has not been run" and "the table
 * is unreachable", and both of them fire on *every* edit. One line in the
 * console is a diagnosis; one per keystroke is noise that buries it.
 */
/**
 * What a `postgres_changes` callback hands over. Narrowed to the two fields
 * this store reads — `old` carries only the primary key on a delete.
 */
interface RemotePayload<Row> {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new?: Row;
  old?: { id?: string };
}

/**
 * Replace by id, or append when it is new.
 *
 * Order is preserved for rows that were already there, which matters more than
 * it looks: the list view and the trash both read these arrays in order, and an
 * entry that jumped to the bottom every time another device touched it would
 * make a shared calendar visibly restless.
 */
function replaceById<T extends { id: string }>(list: T[], incoming: T): T[] {
  const at = list.findIndex((item) => item.id === incoming.id);
  if (at === -1) return [...list, incoming];
  const next = [...list];
  next[at] = incoming;
  return next;
}

let historyWarned = false;

function warnOnce(message: string) {
  if (historyWarned) return;
  historyWarned = true;
  console.warn(`[tempo] history unavailable — edits are fine, versions are not being kept: ${message}`);
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
 *
 * `reminders` is here, unlike `notify`, precisely because it *is* the form's to
 * state — the control is in the entry form, so an omitted value means the user
 * cleared it rather than that the caller didn't know. Every caller must send
 * the current list, the same contract `title` has.
 */
function draftFields(draft: EventDraft, tz: string) {
  return {
    title: draft.title,
    notes: draft.notes ?? null,
    kind: draft.kind,
    categoryId: draft.categoryId ?? null,
    recurrence: draft.recurrence ?? null,
    reminders: draft.reminders ?? [],
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
 *
 * `clock` replaces a wall-clock time outright instead of carrying it across,
 * which is how a resize that collapses an entry onto one date lands its dragged
 * edge on that date's own boundary rather than on an hour that reads backwards.
 * All-day entries have no clock to replace, so it does not reach them.
 */
function shiftEvent(
  ev: TempoEvent,
  startDelta: number,
  endDelta: number,
  tz: string,
  clock: { startMinutes?: number; endMinutes?: number } = {},
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
      clock.startMinutes ?? span.startMinutes ?? 0,
      zone,
    ).toISOString(),
    endsAt: instantFromCivil(
      addDays(span.end, endDelta),
      clock.endMinutes ?? span.endMinutes ?? 60,
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
