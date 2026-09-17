import type { CivilDate } from '@/lib/tempo/civil';
import {
  allDayLeadMinutes,
  anchorOf,
  canonicalReminders,
  DAY_REMINDER_AT,
  isSendableLead,
  leadMinutes,
  planReminders,
  reminderKey,
  UNIT_MINUTES,
  type LeadUnit,
} from '@/lib/tempo/reminders';
import type { EventKind, Reminder } from '@/lib/tempo/types';

/**
 * The entry form's reminders, as rows a person edits.
 *
 * A stored reminder is minutes before an anchor — `{ from: 'dueDay', minutes:
 * 900 }` — which is exact and unreadable. A row says the same thing the way it
 * gets chosen: DAYS BEFORE DUE, 1, AT 09:00. This module is the translation
 * both ways, plus what a row should say under itself, kept apart from the form
 * for the same reason `when.ts` is: it is all cases, and none of it is React.
 */

/** What a row counts from, in the form's words. */
export type RowWhen = 'startDay' | 'daysBeforeStart' | 'dueDay' | 'daysBeforeDue' | 'beforeDue';

export interface ReminderRow {
  /** A key for React, stable while the row is edited. */
  id: number;
  when: RowWhen;
  /** The two `daysBefore` shapes. */
  days: number;
  /** A time of day: every shape but `beforeDue`. */
  at: number;
  /** `beforeDue` only. */
  amount: number;
  unit: LeadUnit;
}

/**
 * Which rows make sense on this entry.
 *
 * - `allDay` has two days that can differ, a start and a due, and a due time.
 * - `anyTime` is the same entry with the due time left empty. It is due some
 *   time on its last day, so there is no moment to count back from and no
 *   BEFORE DUE TIME row: every reminder it can hold is a day and a time.
 * - `timed` has one day, and is due when it starts — so its start day and due
 *   day are the same row, and a lead is "before it starts".
 * - `birthday` has one day and nothing due: a day and a time, and that is all.
 */
export type RowContext = 'allDay' | 'anyTime' | 'timed' | 'birthday';

export function rowContext(kind: EventKind, allDay: boolean, dueMinutes: number | null): RowContext {
  if (kind === 'birthday') return 'birthday';
  if (!allDay) return 'timed';
  return dueMinutes === null ? 'anyTime' : 'allDay';
}

const ALL_DAY_OPTIONS: readonly { value: RowWhen; label: string }[] = [
  { value: 'startDay', label: 'ON START DAY' },
  { value: 'daysBeforeStart', label: 'DAYS BEFORE START' },
  { value: 'dueDay', label: 'ON DUE DAY' },
  { value: 'daysBeforeDue', label: 'DAYS BEFORE DUE' },
  { value: 'beforeDue', label: 'BEFORE DUE TIME' },
];

export const ROW_OPTIONS: Record<RowContext, readonly { value: RowWhen; label: string }[]> = {
  allDay: ALL_DAY_OPTIONS,
  anyTime: ALL_DAY_OPTIONS.filter((o) => o.value !== 'beforeDue'),
  timed: [
    { value: 'dueDay', label: 'ON THE DAY' },
    { value: 'daysBeforeDue', label: 'DAYS BEFORE' },
    { value: 'beforeDue', label: 'BEFORE IT STARTS' },
  ],
  birthday: [
    { value: 'startDay', label: 'ON THE DAY' },
    { value: 'daysBeforeStart', label: 'DAYS BEFORE' },
  ],
};

/** The most days back a row can reach: four weeks, the dispatcher's ceiling. */
export const MAX_DAYS = 28;

/**
 * A row as the entry it is on can hold it.
 *
 * Rows outlive a flip of the all-day switch, the type or the due time, and are
 * not rewritten when one happens — flipping back should find them as they were.
 * So they are fitted when read instead. A timed entry has one day, so a
 * start-day row is a due-day row there; a birthday has no due, so a due-day row
 * is its one day, and a lead before its midnight is the day and time that lead
 * lands on.
 *
 * With the due time emptied, a lead has nothing to count from, so it becomes
 * the day and time it was already landing on — an hour before the end of the
 * last day is 23:00 on it. Typing the due time back in restores the lead,
 * because the row it was written on is still there.
 */
export function fitRow(row: ReminderRow, ctx: RowContext): ReminderRow {
  if (ctx === 'anyTime' && row.when === 'beforeDue') {
    // The due point is the midnight *after* the last day, one day past the
    // midnight a due-day row counts from.
    const { days, at } = dayAndTime(leadMinutes(row.amount, row.unit) - 1440);
    return { ...row, when: days === 0 ? 'dueDay' : 'daysBeforeDue', days, at };
  }
  if (ctx === 'timed') {
    if (row.when === 'startDay') return { ...row, when: 'dueDay' };
    if (row.when === 'daysBeforeStart') return { ...row, when: 'daysBeforeDue' };
    return row;
  }
  if (ctx === 'birthday') {
    if (row.when === 'dueDay') return { ...row, when: 'startDay' };
    if (row.when === 'daysBeforeDue') return { ...row, when: 'daysBeforeStart' };
    if (row.when === 'beforeDue') {
      const { days, at } = dayAndTime(leadMinutes(row.amount, row.unit));
      return { ...row, when: days === 0 ? 'startDay' : 'daysBeforeStart', days, at };
    }
  }
  return row;
}

/** The reminder a row stands for, fitted to its entry. */
export function reminderFromRow(row: ReminderRow, ctx: RowContext): Reminder {
  const r = fitRow(row, ctx);
  switch (r.when) {
    case 'startDay':
      return { minutes: allDayLeadMinutes(0, r.at) };
    case 'daysBeforeStart':
      return { minutes: allDayLeadMinutes(r.days, r.at) };
    case 'dueDay':
      return { from: 'dueDay', minutes: allDayLeadMinutes(0, r.at) };
    case 'daysBeforeDue':
      return { from: 'dueDay', minutes: allDayLeadMinutes(r.days, r.at) };
    case 'beforeDue': {
      // On a timed entry the start *is* the due point, and a lead written
      // without an anchor is how every timed reminder has always been stored —
      // so an old "30 minutes before" and a new one are the same reminder, with
      // the same delivery identity.
      const minutes = leadMinutes(r.amount, r.unit);
      return ctx === 'timed' ? { minutes } : { from: 'due', minutes };
    }
  }
}

/**
 * What the form saves: every row that can be sent, once, in the stored order —
 * the same order a list reads back in, so opening an entry and closing it
 * again compares as no change.
 */
export function remindersFromRows(rows: readonly ReminderRow[], ctx: RowContext): Reminder[] {
  return canonicalReminders(
    rows
      .filter((row) => !rangeProblem(row, ctx))
      .map((row) => reminderFromRow(row, ctx)),
  );
}

/** Rows for a stored list, numbered from `firstId`. */
export function rowsFromReminders(
  reminders: readonly Reminder[],
  ctx: RowContext,
  firstId = 0,
): ReminderRow[] {
  return reminders.map((r, i) => rowFromReminder(r, ctx, firstId + i));
}

function rowFromReminder(r: Reminder, ctx: RowContext, id: number): ReminderRow {
  const base: ReminderRow = { id, when: 'dueDay', days: 1, at: DAY_REMINDER_AT, amount: 1, unit: 'hours' };
  const anchor = anchorOf(r);

  // A lead: anything counted from the due moment, and anything counted from a
  // timed entry's start, which is that same moment.
  if (anchor === 'due' || (anchor === 'start' && ctx === 'timed')) {
    return fitRow({ ...base, when: 'beforeDue', ...amountAndUnit(r.minutes) }, ctx);
  }

  const { days, at } = dayAndTime(r.minutes);
  const when: RowWhen =
    anchor === 'start'
      ? days === 0 ? 'startDay' : 'daysBeforeStart'
      : days === 0 ? 'dueDay' : 'daysBeforeDue';
  return fitRow({ ...base, when, days, at }, ctx);
}

/**
 * Minutes before a midnight, as a number of days back and a time on that day.
 * Never a day *after*: the rows cannot say one, so the one stored reminder that
 * could — a day after an all-day start — reads as that midnight.
 */
function dayAndTime(minutes: number): { days: number; at: number } {
  const days = Math.max(0, Math.ceil(minutes / 1440));
  return { days, at: Math.min(1439, Math.max(0, days * 1440 - minutes)) };
}

/** A lead in its largest whole unit, so 120 reads as 2 hours and not 120 minutes. */
function amountAndUnit(minutes: number): { amount: number; unit: LeadUnit } {
  const m = Math.max(0, minutes);
  if (m === 0) return { amount: 0, unit: 'minutes' };
  const unit = (['weeks', 'days', 'hours'] as const).find((u) => m % UNIT_MINUTES[u] === 0) ?? 'minutes';
  return { amount: m / UNIT_MINUTES[unit], unit };
}

/**
 * The rows `+ ADD REMINDER` tries, in order: the first one not already on the
 * entry is the one added. An hour before first, because the reminder people
 * reach for once the defaults are in is a last call.
 */
const CANDIDATES: Record<RowContext, readonly Omit<ReminderRow, 'id'>[]> = {
  allDay: [
    { when: 'beforeDue', days: 1, at: DAY_REMINDER_AT, amount: 1, unit: 'hours' },
    { when: 'daysBeforeDue', days: 2, at: DAY_REMINDER_AT, amount: 1, unit: 'hours' },
    { when: 'daysBeforeDue', days: 7, at: DAY_REMINDER_AT, amount: 1, unit: 'hours' },
  ],
  // No last call to offer, since nothing states a moment to be early for. The
  // morning of instead: the entry starts with the morning before, and the
  // reminder you reach for next is one on the day itself.
  anyTime: [
    { when: 'dueDay', days: 1, at: DAY_REMINDER_AT, amount: 1, unit: 'hours' },
    { when: 'daysBeforeDue', days: 2, at: DAY_REMINDER_AT, amount: 1, unit: 'hours' },
    { when: 'daysBeforeDue', days: 7, at: DAY_REMINDER_AT, amount: 1, unit: 'hours' },
  ],
  timed: [
    { when: 'beforeDue', days: 1, at: DAY_REMINDER_AT, amount: 1, unit: 'hours' },
    { when: 'beforeDue', days: 1, at: DAY_REMINDER_AT, amount: 15, unit: 'minutes' },
    { when: 'daysBeforeDue', days: 1, at: DAY_REMINDER_AT, amount: 1, unit: 'hours' },
  ],
  birthday: [
    { when: 'daysBeforeStart', days: 1, at: DAY_REMINDER_AT, amount: 1, unit: 'hours' },
    { when: 'daysBeforeStart', days: 7, at: DAY_REMINDER_AT, amount: 1, unit: 'hours' },
  ],
};

/** `rows` with one more, not a copy of any already there where that can be helped. */
export function addRow(rows: readonly ReminderRow[], ctx: RowContext): ReminderRow[] {
  const id = rows.reduce((max, r) => Math.max(max, r.id), -1) + 1;
  const taken = new Set(rows.map((r) => reminderKey(reminderFromRow(r, ctx))));
  const pick =
    CANDIDATES[ctx].find((c) => !taken.has(reminderKey(reminderFromRow({ ...c, id }, ctx)))) ??
    CANDIDATES[ctx][0];
  return [...rows, { ...pick, id }];
}

/** Why a row cannot be sent at all, or `null`. */
function rangeProblem(row: ReminderRow, ctx: RowContext): string | null {
  const r = fitRow(row, ctx);
  if ((r.when === 'daysBeforeStart' || r.when === 'daysBeforeDue') && r.days > MAX_DAYS) {
    return 'UP TO 28 DAYS BEFORE.';
  }
  return isSendableLead(reminderFromRow(r, ctx).minutes) ? null : 'UP TO 4 WEEKS BEFORE.';
}

/** The entry as the form currently holds it — the parts that place a reminder. */
export interface RowTiming {
  allDay: boolean;
  startDate: CivilDate;
  endDate: CivilDate;
  startMinutes: number;
}

/**
 * A line under a row. `warn` is a row that will not do what it says — out of
 * range, a copy, moved — and is drawn lit; one that is only explaining itself
 * is not, because a one-day entry's start and due reminders merging is the
 * everyday case, and lighting it would make every new entry look broken.
 */
export interface RowNote {
  text: string;
  warn: boolean;
}

/**
 * What each row should say under itself, by row id. Rows with nothing to say
 * are absent.
 *
 * Measured against the dates in the form, through the same `planReminders` the
 * dispatcher sends from — so "sent once" here is a statement about what will
 * actually arrive, not a second opinion about it. On a repeating entry that is
 * the date the form is open on, which is the one being looked at.
 */
export function rowNotes(
  rows: readonly ReminderRow[],
  ctx: RowContext,
  timing: RowTiming,
  dueMinutes: number | null,
  timezone: string,
): Map<number, RowNote> {
  const notes = new Map<number, RowNote>();
  const seen = new Set<string>();

  for (const row of rows) {
    const problem = rangeProblem(row, ctx);
    if (problem) {
      notes.set(row.id, { text: problem, warn: true });
      continue;
    }
    const key = reminderKey(reminderFromRow(row, ctx));
    if (seen.has(key)) notes.set(row.id, { text: 'SAME AS ANOTHER REMINDER.', warn: true });
    seen.add(key);
  }

  const plan = planReminders(
    {
      allDay: timing.allDay,
      date: timing.startDate,
      endDate: timing.allDay ? timing.endDate : timing.startDate,
      startMinutes: timing.allDay ? null : timing.startMinutes,
    },
    { timezone, dueMinutes, reminders: remindersFromRows(rows, ctx) },
  );
  const byKey = new Map(plan.map((p) => [reminderKey(p.reminder), p]));

  for (const row of rows) {
    if (notes.has(row.id)) continue;
    const p = byKey.get(reminderKey(reminderFromRow(row, ctx)));
    if (p?.merged) notes.set(row.id, { text: 'SAME MOMENT AS ANOTHER — SENT ONCE.', warn: false });
    else if (p?.late) {
      notes.set(row.id, {
        text:
          ctx === 'timed'
            ? 'AFTER IT STARTS — SENT AN HOUR BEFORE.'
            : 'AFTER IT’S DUE — SENT AN HOUR BEFORE.',
        warn: true,
      });
    }
  }

  return notes;
}
