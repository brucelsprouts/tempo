/**
 * Row ↔ domain translation, and the validation boundary for the three JSON
 * columns. Malformed `recurrence`, `reminders` or `patch` data degrades to
 * "no rule" rather than throwing: one bad row should cost you one event, not
 * the whole calendar.
 */

import { z } from 'zod';
import type {
  CategoryRow,
  EventRow,
  EventVersionRow,
  OccurrenceOverrideRow,
} from '@/lib/db/database.types';
import type {
  Category,
  EventVersion,
  Occurrence,
  OccurrenceOverride,
  OccurrencePatch,
  Recurrence,
  Reminder,
  TempoEvent,
  VersionReason,
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

/**
 * Bounded to Google's own reminder range at the top (40320 — four weeks) so the
 * field stays a rename rather than a translation, and to one day at the bottom,
 * which is as far after an all-day midnight as "on the morning of" can reach.
 */
const reminderSchema = z.object({
  minutes: z.number().int().min(-1440).max(40320),
});

const remindersSchema = z.array(reminderSchema).max(5);

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

/**
 * Malformed reminders degrade to silence rather than throwing, matching
 * `parseRecurrence`. Duplicates are collapsed and the list is sorted longest
 * lead first, so "1 day, then 2 hours" is the stored order regardless of the
 * order it was clicked in — which makes the column diffable.
 */
export function parseReminders(value: unknown): Reminder[] {
  if (!value) return [];
  const result = remindersSchema.safeParse(value);
  if (!result.success) return [];
  const unique = new Map(result.data.map((r) => [r.minutes, r]));
  return [...unique.values()].sort((a, b) => b.minutes - a.minutes);
}

export function parsePatch(value: unknown): OccurrencePatch {
  if (!value) return {};
  const result = patchSchema.safeParse(value);
  return result.success ? result.data : {};
}

/**
 * A whole event, as a schema.
 *
 * Needed only for snapshots. Every other event in the app arrives as an
 * `EventRow` the database has already typed, but a snapshot is a jsonb blob
 * this client wrote and a later version of this client has to read — the one
 * place an event can come back malformed, and the one place a malformed one
 * would be written *into* the calendar rather than merely displayed.
 */
const eventSchema = z.object({
  id: z.string(),
  title: z.string(),
  notes: z.string().nullable(),
  kind: z.enum(['event', 'assignment', 'milestone', 'birthday']),
  categoryId: z.string().nullable(),
  allDay: z.boolean(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  startDate: civilDate.nullable(),
  endDate: civilDate.nullable(),
  timezone: z.string(),
  recurrence: recurrenceSchema.nullable(),
  // Defaulted, not required: snapshots written before reminders existed have no
  // such key, and `versionFromRow` drops a snapshot that fails to parse. Making
  // this required would quietly empty the history panel of everything older
  // than this migration.
  reminders: remindersSchema.default([]),
  anchorDate: civilDate.nullable(),
  displayTemplate: z.string().nullable(),
  status: z.enum(['todo', 'doing', 'done']).nullable(),
  notify: z.boolean(),
  source: z.enum(['tempo', 'google']),
  googleEventId: z.string().nullable(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const overrideSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  occurrenceDate: civilDate,
  cancelled: z.boolean(),
  patch: patchSchema,
});

const snapshotSchema = z.object({
  event: eventSchema,
  overrides: z.array(overrideSchema),
});

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
    reminders: parseReminders(row.reminders),
    anchorDate: row.anchor_date,
    displayTemplate: row.display_template,
    status: row.status,
    notify: row.notify,
    source: row.source,
    googleEventId: row.google_event_id,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * A version row, or nothing.
 *
 * Nothing rather than a partial: a version whose snapshot did not parse cannot
 * be rolled back to, so offering it in the list would be offering a button that
 * does not work. Dropping it silently costs one entry in a history list; the
 * alternative costs the row it would have been written over.
 */
export function versionFromRow(row: EventVersionRow): EventVersion | null {
  const snapshot = snapshotSchema.safeParse(row.snapshot);
  if (!snapshot.success) return null;
  if (!VERSION_REASONS.includes(row.reason as VersionReason)) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    snapshot: snapshot.data as EventVersion['snapshot'],
    reason: row.reason as VersionReason,
    createdAt: row.created_at,
  };
}

const VERSION_REASONS: VersionReason[] = ['edit', 'move', 'resize', 'status', 'delete'];

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
  if (e.reminders !== undefined) row.reminders = e.reminders as never;
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
  /** Minutes before the start, longest lead first. Omitted when silent. */
  reminders?: number[];
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
  // Flattened to bare numbers rather than `[{minutes: 30}]`: the export exists
  // to be read inside a frontmatter block, and a list of objects is not.
  if (e.reminders.length) out.reminders = e.reminders.map((r) => r.minutes);
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
