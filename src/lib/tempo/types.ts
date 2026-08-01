import type { CivilDate } from './civil';

export type EventKind = 'event' | 'assignment' | 'milestone' | 'birthday';
export type EventStatus = 'todo' | 'doing' | 'done';
export type EventSource = 'tempo' | 'google';
export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

/**
 * RFC 5545 RRULE semantics in a shape that survives a `git diff` and a chunk of
 * Obsidian frontmatter. Kept deliberately narrower than the full spec — this is
 * the subset a personal calendar actually uses, and every field maps 1:1 onto a
 * real RRULE part so serialising to Google is a rename, not a translation.
 */
export interface Recurrence {
  freq: Frequency;
  /** Every N periods. Default 1. */
  interval?: number;
  /** WEEKLY only. 0 = Sunday … 6 = Saturday. */
  byWeekday?: number[];
  /** MONTHLY and YEARLY. Defaults to the day-of-month of the series start. */
  byMonthDay?: number;
  /** YEARLY only, 1-12. Defaults to the month of the series start. */
  byMonth?: number;
  until?: CivilDate | null;
  count?: number | null;
  /** Occurrence dates to suppress, as they would have fallen without the exception. */
  exdates?: CivilDate[];
  /**
   * What to do when a rule lands on a date that doesn't exist — Feb 30, or
   * Feb 29 in a common year. RFC 5545 says skip, which is right for "the 31st
   * of every month" but wrong for a leap-day birthday, where the person still
   * has one. Defaults to 'skip'; the birthday preset uses 'clamp'.
   */
  onInvalid?: 'skip' | 'clamp';
}

/**
 * How long before an occurrence starts to be told about it.
 *
 * Minutes, and only minutes, for the same reason `Recurrence` is RRULE-shaped:
 * Google's API takes `{ method, minutes }`, so this serialises as a rename
 * rather than a translation. An ISO-8601 VALARM trigger (`-P1DT9H`) would read
 * better in a diff and cost that.
 *
 * Measured back from the occurrence's *start*, where an all-day occurrence
 * starts at 00:00 in the event's own timezone. So "the day before at 09:00" on
 * a birthday is 900 — fifteen hours back from midnight. Nobody types that;
 * `TIMED_PRESETS` and `ALL_DAY_PRESETS` name the ones people actually pick.
 *
 * **Negative means after.** An all-day entry has no time of day, so the only
 * way to say "09:00 on the morning of" is -540. Google has no equivalent — its
 * range is 0…40320 — so a negative reminder is the one field that would clamp
 * rather than rename if the mirror is ever built. Worth the divergence: an
 * exam you are told about at midnight is an exam you are told about in your
 * sleep, and the alternative is having no same-day option at all.
 */
export interface Reminder {
  minutes: number;
}

/**
 * The stored definition of something on the calendar. For a recurring event
 * this is the *whole series* — occurrences are never persisted.
 */
export interface TempoEvent {
  id: string;
  title: string;
  notes: string | null;
  kind: EventKind;
  categoryId: string | null;

  allDay: boolean;
  /** Timed events only: ISO instants. */
  startsAt: string | null;
  endsAt: string | null;
  /** All-day events only: bare dates, end inclusive. */
  startDate: CivilDate | null;
  endDate: CivilDate | null;
  timezone: string;

  recurrence: Recurrence | null;

  /**
   * Applies to every occurrence of the series. Empty means silent.
   *
   * Deliberately not patchable per occurrence: `OccurrencePatch` can move an
   * instance, and its reminders move with it, but "quiet just this once" is a
   * separate feature that would need its own suppression record.
   */
  reminders: Reminder[];

  /** Origin date for derived fields — a birth date, a start-of-employment date. */
  anchorDate: CivilDate | null;
  /** Evaluated per occurrence at render time. See `derive.ts`. */
  displayTemplate: string | null;

  status: EventStatus | null;
  notify: boolean;
  source: EventSource;
  googleEventId: string | null;

  /**
   * Set means deleted. The row stays, so a delete is reversible and a version
   * log written against it still has something to point at.
   *
   * Everything that renders the calendar reads the store's `events`, which
   * holds only live rows — this field is what the store partitions on, not
   * something the views are expected to check.
   */
  deletedAt: string | null;

  createdAt: string;
  updatedAt: string;
}

/** A per-instance edit to one occurrence of a series. */
export interface OccurrenceOverride {
  id: string;
  eventId: string;
  /** The date the occurrence *would* have fallen on. The stable identity key. */
  occurrenceDate: CivilDate;
  cancelled: boolean;
  patch: OccurrencePatch;
}

export interface OccurrencePatch {
  title?: string;
  /** Day-shift applied to this instance only. */
  startDate?: CivilDate;
  endDate?: CivilDate;
  startMinutes?: number;
  endMinutes?: number;
  status?: EventStatus;
}

/**
 * A materialised instance, produced at render time and thrown away. Nothing
 * downstream of expansion needs to know whether this came from a recurring
 * series, a one-off, or Google.
 */
export interface Occurrence {
  /** Stable within a render pass: `${eventId}:${seriesDate}`. */
  key: string;
  eventId: string;
  event: TempoEvent;

  /** Where this instance actually sits, after any override. */
  date: CivilDate;
  /** Inclusive. Equal to `date` for single-day items. */
  endDate: CivilDate;
  /** The undisplaced date, used to key overrides. */
  seriesDate: CivilDate;

  /** 1-based position within the series. 1 for one-off events. */
  index: number;
  /** Title after the display template resolves — "Mom · 52", not "Mom". */
  title: string;

  allDay: boolean;
  /** Minutes past midnight in the event's own timezone. Timed events only. */
  startMinutes: number | null;
  endMinutes: number | null;

  kind: EventKind;
  status: EventStatus | null;
  categoryId: string | null;
  isOverride: boolean;
  /** Google-sourced instances render dimmed and refuse drag. */
  readOnly: boolean;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
}

/** What produced a version. Ordered roughly by how much it changed. */
export type VersionReason = 'edit' | 'move' | 'resize' | 'status' | 'delete';

/**
 * One recorded shape of an entry, from before a change landed.
 *
 * The snapshot carries the event *and its exceptions together*. Versioning the
 * row alone would miss every per-occurrence edit — moving one instance of a
 * series writes an override and leaves the event untouched — and those are
 * exactly the edits most worth being able to take back.
 */
export interface EventVersion {
  id: string;
  eventId: string;
  snapshot: { event: TempoEvent; overrides: OccurrenceOverride[] };
  reason: VersionReason;
  createdAt: string;
}
