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
} from '@/lib/tempo/mappers';
import { addDays, instantFromCivil, type CivilDate } from '@/lib/tempo/civil';
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

  load: () => Promise<void>;
  createEvent: (draft: EventDraft) => Promise<void>;
  updateEvent: (id: string, patch: Partial<TempoEvent>) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  moveOccurrence: (occ: Occurrence, deltaDays: number, scope: EditScope) => Promise<void>;
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

  return {
    timezone: DEFAULT_TZ,
    ownerId: null,
    events: [],
    overrides: [],
    categories: [],
    status: 'idle',
    error: null,

    dismissError: () => set({ error: null }),

    load: async () => {
      set({ status: 'loading', error: null });
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
      const timed = !draft.allDay;
      const startMinutes = draft.startMinutes ?? 9 * 60;
      const endMinutes = draft.endMinutes ?? startMinutes + 60;

      const event: TempoEvent = {
        id,
        title: draft.title,
        notes: draft.notes ?? null,
        kind: draft.kind,
        categoryId: draft.categoryId ?? null,
        allDay: draft.allDay,
        startsAt: timed
          ? instantFromCivil(draft.startDate, startMinutes, tz).toISOString()
          : null,
        endsAt: timed ? instantFromCivil(draft.endDate, endMinutes, tz).toISOString() : null,
        startDate: draft.allDay ? draft.startDate : null,
        endDate: draft.allDay ? draft.endDate : null,
        timezone: tz,
        recurrence: draft.recurrence ?? null,
        anchorDate: draft.anchorDate ?? null,
        displayTemplate: draft.displayTemplate ?? null,
        status: draft.status ?? (draft.kind === 'assignment' ? 'todo' : null),
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
          })),
        async () => {
          const { error } = await supabase.from('events').delete().eq('id', id);
          return { error };
        },
      );
    },

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
  };
});

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
