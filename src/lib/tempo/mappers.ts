/**
 * Row ↔ domain translation, and the validation boundary for the two JSON
 * columns. Malformed `recurrence` or `patch` data degrades to "no rule" rather
 * than throwing: one bad row should cost you one event, not the whole calendar.
 */

import { z } from 'zod';
import type {
  CategoryRow,
  EventRow,
  OccurrenceOverrideRow,
} from '@/lib/db/database.types';
import type {
  Category,
  Occurrence,
  OccurrenceOverride,
  OccurrencePatch,
  Recurrence,
  TempoEvent,
} from './types';

const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const recurrenceSchema = z.object({
  freq: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
  interval: z.number().int().positive().optional(),
  byWeekday: z.array(z.number().int().min(0).max(6)).optional(),
  byMonthDay: z.number().int().min(1).max(31).optional(),
  byMonth: z.number().int().min(1).max(12).optional(),
  until: civilDate.nullable().optional(),
  count: z.number().int().positive().nullable().optional(),
  exdates: z.array(civilDate).optional(),
  onInvalid: z.enum(['skip', 'clamp']).optional(),
});

const patchSchema = z.object({
  title: z.string().optional(),
  startDate: civilDate.optional(),
  endDate: civilDate.optional(),
  startMinutes: z.number().int().min(0).max(1439).optional(),
  endMinutes: z.number().int().min(0).max(1440).optional(),
  status: z.enum(['todo', 'doing', 'done']).optional(),
});

export function parseRecurrence(value: unknown): Recurrence | null {
  if (!value) return null;
  const result = recurrenceSchema.safeParse(value);
  return result.success ? (result.data as Recurrence) : null;
}

export function parsePatch(value: unknown): OccurrencePatch {
  if (!value) return {};
  const result = patchSchema.safeParse(value);
  return result.success ? result.data : {};
}

export function eventFromRow(row: EventRow): TempoEvent {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    kind: row.kind,
    categoryId: row.category_id,
    allDay: row.all_day,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    startDate: row.start_date,
    endDate: row.end_date,
    timezone: row.timezone,
    recurrence: parseRecurrence(row.recurrence),
    anchorDate: row.anchor_date,
    displayTemplate: row.display_template,
    status: row.status,
    notify: row.notify,
    source: row.source,
    googleEventId: row.google_event_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Domain → row. Only the columns a client is allowed to set. */
export function eventToRow(e: Partial<TempoEvent>): Partial<EventRow> {
  const row: Partial<EventRow> = {};
  if (e.title !== undefined) row.title = e.title;
  if (e.notes !== undefined) row.notes = e.notes;
  if (e.kind !== undefined) row.kind = e.kind;
  if (e.categoryId !== undefined) row.category_id = e.categoryId;
  if (e.allDay !== undefined) row.all_day = e.allDay;
  if (e.startsAt !== undefined) row.starts_at = e.startsAt;
  if (e.endsAt !== undefined) row.ends_at = e.endsAt;
  if (e.startDate !== undefined) row.start_date = e.startDate;
  if (e.endDate !== undefined) row.end_date = e.endDate;
  if (e.timezone !== undefined) row.timezone = e.timezone;
  if (e.recurrence !== undefined) row.recurrence = e.recurrence as never;
  if (e.anchorDate !== undefined) row.anchor_date = e.anchorDate;
  if (e.displayTemplate !== undefined) row.display_template = e.displayTemplate;
  if (e.status !== undefined) row.status = e.status;
  if (e.notify !== undefined) row.notify = e.notify;
  return row;
}

export function overrideFromRow(row: OccurrenceOverrideRow): OccurrenceOverride {
  return {
    id: row.id,
    eventId: row.event_id,
    occurrenceDate: row.occurrence_date,
    cancelled: row.cancelled,
    patch: parsePatch(row.patch),
  };
}

export function categoryFromRow(row: CategoryRow): Category {
  return { id: row.id, name: row.name, color: row.color, sortOrder: row.sort_order };
}

// ------------------------------------------------------------------- export
/**
 * The portable shape. Deliberately flat and human-readable so it can be dropped
 * into Obsidian frontmatter without a join or a lookup table.
 */
export interface PortableEvent {
  id: string;
  title: string;
  kind: string;
  all_day: boolean;
  start_date?: string;
  end_date?: string;
  starts_at?: string;
  ends_at?: string;
  timezone?: string;
  recurrence?: Recurrence;
  anchor_date?: string;
  display_template?: string;
  category?: string;
  status?: string;
  notify: boolean;
  notes?: string;
}

export function toPortable(e: TempoEvent, categoryName?: string): PortableEvent {
  const out: PortableEvent = {
    id: e.id,
    title: e.title,
    kind: e.kind,
    all_day: e.allDay,
    notify: e.notify,
  };
  if (e.allDay) {
    out.start_date = e.startDate ?? undefined;
    out.end_date = e.endDate ?? undefined;
  } else {
    out.starts_at = e.startsAt ?? undefined;
    out.ends_at = e.endsAt ?? undefined;
    out.timezone = e.timezone;
  }
  if (e.recurrence) out.recurrence = e.recurrence;
  if (e.anchorDate) out.anchor_date = e.anchorDate;
  if (e.displayTemplate) out.display_template = e.displayTemplate;
  if (categoryName) out.category = categoryName;
  if (e.status) out.status = e.status;
  if (e.notes) out.notes = e.notes;
  return out;
}

/** Occurrence → the identity an override is keyed by. */
export function overrideKey(occ: Occurrence): string {
  return `${occ.eventId}:${occ.seriesDate}`;
}
