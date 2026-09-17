/**
 * When to be told about something.
 *
 * The calendar never stores an occurrence, so it cannot store a pending
 * reminder either — there is no row to hang "fires at 08:45" off. Instead the
 * dispatcher asks this module, on a timer, "what came due since I last looked",
 * and the answer is computed from the same expansion the grid renders from.
 *
 * That keeps one source of truth: a reminder cannot survive the event being
 * deleted, cannot fire for an occurrence that was cancelled, and cannot drift
 * out of step with a series whose rule changed, because none of those facts is
 * cached anywhere.
 *
 * Pure. No network, no clock of its own — the window is always passed in, which
 * is what makes the DST and boundary cases testable.
 */

import { addDays, civilInZone, diffDays, instantFromCivil } from './civil';
import { expandEvent } from './recurrence';
import type {
  EventKind,
  Occurrence,
  OccurrenceOverride,
  Reminder,
  ReminderAnchor,
  TempoEvent,
} from './types';

/**
 * When an all-day entry is due if it does not say. Five to midnight rather than
 * midnight, because midnight is the start of the *next* day — and an assignment
 * due "on Friday" is one you can still hand in on Friday evening.
 */
export const DEFAULT_DUE_MINUTES = 23 * 60 + 55;

/** The time of day a new day reminder is sent at. */
export const DAY_REMINDER_AT = 9 * 60;

/**
 * How far before the due point a time-of-day reminder is sent when, as set, it
 * would have landed at or after it.
 */
export const LATE_LEAD_MINUTES = 60;

/**
 * What a new entry starts with.
 *
 * Applied only when creating: an edit must never rewrite reminders the row
 * already holds, for the same reason `notify` is left out of the draft entirely.
 *
 * One set for everything that is not a birthday — this calendar is kept with
 * one kind of entry, categorised, and a deadline's needs do not change with
 * its category. Three for something that happens once: the morning it starts,
 * so there is a nudge to begin; the morning before it is due; and the morning
 * it is due. On a one-day entry the first and last are one moment and send
 * once, so a one-day entry sends two and a stretched one three without anyone
 * editing anything in between.
 *
 * With a time it is the morning before and an hour before — there is no start
 * day apart from the day it happens. A repeat gets one reminder, because it
 * comes round again: half an hour before a lecture, the morning rent is due.
 *
 * Birthdays keep five minutes before midnight, so the message is typed when the
 * day begins, and 09:00 that morning for the nights you were asleep by then.
 */
export function defaultReminders(kind: EventKind, allDay: boolean, repeats: boolean): Reminder[] {
  if (kind === 'birthday') return [{ minutes: 5 }, { minutes: -DAY_REMINDER_AT }];
  if (repeats) return allDay ? [{ from: 'dueDay', minutes: -DAY_REMINDER_AT }] : [{ minutes: 30 }];
  return allDay
    ? [
        { minutes: -DAY_REMINDER_AT },
        { from: 'dueDay', minutes: allDayLeadMinutes(1, DAY_REMINDER_AT) },
        { from: 'dueDay', minutes: -DAY_REMINDER_AT },
      ]
    : [{ from: 'dueDay', minutes: allDayLeadMinutes(1, DAY_REMINDER_AT) }, { minutes: 60 }];
}

export type LeadUnit = 'minutes' | 'hours' | 'days' | 'weeks';

export const UNIT_MINUTES: Record<LeadUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
  weeks: 10080,
};

/** "3 hours before", as a lead in minutes. */
export function leadMinutes(amount: number, unit: LeadUnit): number {
  return Math.round(amount) * UNIT_MINUTES[unit];
}

/**
 * "2 days before, at 08:00", as minutes before a midnight. `daysBefore` 0 is
 * the day itself, which comes out negative.
 */
export function allDayLeadMinutes(daysBefore: number, timeOfDay: number): number {
  return Math.round(daysBefore) * 1440 - timeOfDay;
}

/** Whether the dispatcher will actually send a reminder this far out. */
export function isSendableLead(minutes: number): boolean {
  return minutes >= MIN_LEAD_MINUTES && minutes <= MAX_LEAD_MINUTES;
}

/** A reminder's anchor, with the omitted one spelled out. */
export function anchorOf(r: Reminder): ReminderAnchor {
  return r.from ?? 'start';
}

/** A reminder's identity: two reminders with the same key are the same reminder. */
export function reminderKey(r: Reminder): string {
  return `${anchorOf(r)}:${r.minutes}`;
}

/**
 * Which anchor wins when two reminders land on one moment: the one nearer the
 * deadline, since that is what the notification should be about.
 */
export const ANCHOR_RANK: Record<ReminderAnchor, number> = { start: 0, dueDay: 1, due: 2 };

/**
 * A reminder list in its one stored shape: no explicit `'start'`, no
 * duplicates, sorted by anchor and then longest lead first.
 *
 * One shape so that a list can be compared as data. The store tells an edit
 * from a form that was only opened by comparing, and a list in the order it was
 * chosen in would read as changed against the same list read back sorted.
 */
export function canonicalReminders(
  list: readonly { minutes: number; from?: ReminderAnchor }[],
): Reminder[] {
  const unique = new Map<string, Reminder>();
  for (const { minutes, from } of list) {
    const r: Reminder = !from || from === 'start' ? { minutes } : { from, minutes };
    if (!unique.has(reminderKey(r))) unique.set(reminderKey(r), r);
  }
  return [...unique.values()].sort(
    (a, b) => ANCHOR_RANK[anchorOf(a)] - ANCHOR_RANK[anchorOf(b)] || b.minutes - a.minutes,
  );
}

/** One reminder that has come due, ready to be sent. */
export interface DueReminder {
  event: TempoEvent;
  occurrence: Occurrence;
  /**
   * Identity, and it is the *series* date rather than the displaced one — the
   * same key overrides use. A reminder recorded as sent must stay recorded
   * after the occurrence is dragged, or moving an event re-notifies you for it.
   */
  seriesDate: string;
  /** Which reminder of the event's list this is: these two are its identity. */
  anchor: ReminderAnchor;
  minutes: number;
  /** The instant it was supposed to fire. */
  fireAt: Date;
  /** Moved to an hour before the due point. See `planReminders`. */
  late: boolean;
}

/**
 * The bounds a reminder has to fall inside to be acted on, matching the parse
 * ceiling in `mappers.ts`. Re-checked here rather than trusted, because this
 * module is also reachable from the dispatcher with rows that were written by
 * an older client — and an unbounded lead would make every tick expand years
 * of the calendar looking for occurrences to warn about.
 */
export const MAX_LEAD_MINUTES = 40320; // four weeks, Google's own ceiling
export const MIN_LEAD_MINUTES = -1440; // one day *after* the start

/**
 * What placing a reminder needs to know about an occurrence — narrowed, so the
 * form can ask about the entry it is still drawing, which has no occurrence yet.
 */
export type OccurrenceTiming = Pick<Occurrence, 'allDay' | 'date' | 'endDate' | 'startMinutes'>;

/**
 * When an occurrence starts, as a real instant.
 *
 * An all-day occurrence starts at midnight in the event's own zone — not the
 * viewer's, and not UTC. A birthday reminder set for "the day before at 09:00"
 * has to mean 09:00 where the event lives, or it lands at 04:00 for half the
 * year and 05:00 for the other half.
 */
export function occurrenceStart(occ: OccurrenceTiming, event: Pick<TempoEvent, 'timezone'>): Date {
  const minutes = occ.allDay ? 0 : (occ.startMinutes ?? 0);
  return instantFromCivil(occ.date, minutes, event.timezone);
}

/**
 * When an occurrence is due, as a real instant.
 *
 * An all-day one is due on its last day at the event's due time. One with a
 * time is due when it starts: a final is something you have to be at, and a
 * block of work with an hour on it is one you meant to begin then.
 */
export function occurrenceDue(
  occ: OccurrenceTiming,
  event: Pick<TempoEvent, 'timezone' | 'dueMinutes'>,
): Date {
  if (!occ.allDay) return occurrenceStart(occ, event);
  return instantFromCivil(occ.endDate, event.dueMinutes ?? DEFAULT_DUE_MINUTES, event.timezone);
}

/** One reminder of one occurrence, with where it lands. */
export interface PlannedReminder {
  reminder: Reminder;
  anchor: ReminderAnchor;
  fireAt: Date;
  /**
   * Moved to an hour before the due point, because as set it landed at or
   * after it — a 09:00 "today" on a 07:00 exam.
   */
  late: boolean;
  /** Lands on the same moment as another reminder that is sent in its place. */
  merged: boolean;
}

/**
 * Where each of an occurrence's reminders lands, and which of them are sent.
 *
 * Two shapes of reminder, and the difference matters here. A **time of day** —
 * "the day before, 09:00" — counts back from a midnight, so it stays 09:00
 * whatever the due time does. A **lead** — "1 hour before" — counts back from
 * the moment itself. On an all-day entry every `start` reminder is a time of
 * day, because its start *is* a midnight.
 *
 * A time of day that lands at or after the due point is moved to an hour before
 * it. Left alone it would arrive after the thing it was about, and silence
 * would hide that the exam was earlier than the reminder assumed. A lead is
 * never moved: it is before the moment by construction.
 *
 * Two reminders on one moment send once. A one-day entry's start day and due
 * day are the same day, so "09:00 the day it starts" and "09:00 the day it is
 * due" would otherwise be two identical notifications. The one sent is the one
 * that was not moved, then the one nearer the deadline, then the first listed —
 * deterministic, which matters: overlapping dispatcher ticks must pick the same
 * winner or the loser would be claimed by one and sent by the other.
 *
 * The form reads this too, to say under a row that it will be merged or moved.
 */
export function planReminders(
  occ: OccurrenceTiming,
  event: Pick<TempoEvent, 'timezone' | 'dueMinutes' | 'reminders'>,
): PlannedReminder[] {
  const start = occurrenceStart(occ, event);
  const due = occurrenceDue(occ, event);
  const dueDay = instantFromCivil(occ.allDay ? occ.endDate : occ.date, 0, event.timezone);

  const planned = event.reminders
    .filter((r) => isSendableLead(r.minutes))
    .map((reminder): PlannedReminder => {
      const anchor = anchorOf(reminder);
      const base = anchor === 'start' ? start : anchor === 'dueDay' ? dueDay : due;
      const timeOfDay = anchor === 'dueDay' || (anchor === 'start' && occ.allDay);

      let fireAt = new Date(base.getTime() - reminder.minutes * 60_000);
      const late = timeOfDay && fireAt >= due;
      if (late) fireAt = new Date(due.getTime() - LATE_LEAD_MINUTES * 60_000);

      return { reminder, anchor, fireAt, late, merged: false };
    });

  const winners = new Map<number, PlannedReminder>();
  for (const p of planned) {
    const at = p.fireAt.getTime();
    const held = winners.get(at);
    if (!held || beats(p, held)) winners.set(at, p);
  }
  return planned.map((p) => ({ ...p, merged: winners.get(p.fireAt.getTime()) !== p }));
}

/** Whether `a` is sent instead of `b` when the two land on one moment. */
function beats(a: PlannedReminder, b: PlannedReminder): boolean {
  if (a.late !== b.late) return !a.late;
  return ANCHOR_RANK[a.anchor] > ANCHOR_RANK[b.anchor];
}

/**
 * Every reminder whose moment fell in `(after, upTo]`.
 *
 * Half-open at the start so consecutive ticks sharing a boundary don't both
 * claim the same reminder — the delivery table would catch it anyway, but a
 * correct window means the table is a safety net rather than the mechanism.
 */
export function dueReminders(
  events: TempoEvent[],
  overridesByEvent: Map<string, OccurrenceOverride[]>,
  after: Date,
  upTo: Date,
): DueReminder[] {
  const out: DueReminder[] = [];

  for (const event of events) {
    const leads = event.reminders.map((r) => r.minutes).filter(isSendableLead);
    if (leads.length === 0) continue;

    // A reminder normally fires *before* its anchor, so the occurrences that
    // matter now are the ones still ahead of us, up to the longest lead away. A
    // negative lead reaches the other way, so the search has to open backwards
    // by that much too — clamped at zero on each side so one sign never shrinks
    // the window the other sign needs.
    //
    // The anchor can be an occurrence's last day rather than its first, which
    // needs nothing extra: expansion returns every occurrence *overlapping* the
    // range, so a deadline inside it is found however long ago its entry began.
    const ahead = Math.max(0, ...leads);
    const behind = Math.max(0, ...leads.map((m) => -m));

    // Widened another day at each end because this window is a range of
    // instants and the expander speaks in civil dates, whose boundaries move
    // with the zone — and because a due time, or a reminder moved an hour
    // before one, sits up to a day from the midnight the leads count from.
    const from = addDays(
      civilInZone(new Date(after.getTime() - behind * 60_000), event.timezone),
      -1,
    );
    const to = addDays(
      civilInZone(new Date(upTo.getTime() + ahead * 60_000), event.timezone),
      1,
    );

    const occurrences = expandEvent(event, overridesByEvent.get(event.id) ?? [], from, to);

    for (const occ of occurrences) {
      for (const p of planReminders(occ, event)) {
        if (p.merged || p.fireAt <= after || p.fireAt > upTo) continue;
        out.push({
          event,
          occurrence: occ,
          seriesDate: occ.seriesDate,
          anchor: p.anchor,
          minutes: p.reminder.minutes,
          fireAt: p.fireAt,
          late: p.late,
        });
      }
    }
  }

  return out.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
}

/**
 * What the notification says.
 *
 * The title is the occurrence's, not the event's, so a derived one arrives as
 * "Mom · 52" rather than "Mom" — the whole point of deriving it per occurrence
 * is lost if the notification re-reads the raw column.
 *
 * Every body that is about a deadline says the time, because a reminder that
 * says "today" about a 07:00 exam reads just as well for a 19:00 one.
 */
export function reminderText(due: DueReminder): { title: string; body: string } {
  return { title: due.occurrence.title, body: body(due) };
}

function body(due: DueReminder): string {
  const { occurrence: occ, event, anchor, minutes, fireAt } = due;
  const tz = event.timezone;

  if (event.kind === 'birthday') {
    // Within the hour before midnight "tomorrow" undersells it; say the minutes.
    return minutes > 0 && minutes < 60
      ? `${lead(minutes)} · midnight`
      : relativeDay(occ.date, fireAt, tz);
  }

  /** What is left until the due point, for a lead or a reminder moved to one. */
  const left = Math.round((occurrenceDue(occ, event).getTime() - fireAt.getTime()) / 60_000);

  if (!occ.allDay) {
    const at = clockLabel(occ.startMinutes ?? 0);
    return anchor === 'dueDay' && !due.late
      ? `${relativeDay(occ.date, fireAt, tz)} · ${at}`
      : `${lead(left)} · ${at}`;
  }

  const at = clockLabel(event.dueMinutes ?? DEFAULT_DUE_MINUTES);
  if (anchor === 'due' || due.late) return `due ${lead(left)} · ${at}`;
  // A start reminder on a one-day entry is a reminder about the day it is due.
  if (anchor === 'start' && occ.endDate !== occ.date) {
    return `starts ${relativeDay(occ.date, fireAt, tz)} · due ${relativeDay(occ.endDate, fireAt, tz)}`;
  }
  return `due ${relativeDay(occ.endDate, fireAt, tz)} · ${at}`;
}

function clockLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h < 12 ? 'am' : 'pm';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
}

/** "in 15 minutes", "tomorrow", "in 2 days" — the lead time, said out loud. */
function lead(minutes: number): string {
  if (minutes < 0) return 'started';
  if (minutes === 0) return 'now';
  if (minutes < 60) return `in ${minutes} min`;
  if (minutes < 1440) {
    const h = Math.round(minutes / 60);
    return `in ${h} hour${h === 1 ? '' : 's'}`;
  }
  const d = Math.round(minutes / 1440);
  return d === 1 ? 'tomorrow' : `in ${d} days`;
}

/**
 * All-day items get a day-relative phrase instead of a lead time, because
 * "in 900 minutes" is not how anyone thinks about a birthday.
 */
function relativeDay(date: string, from: Date, timeZone: string): string {
  const days = diffDays(date, civilInZone(from, timeZone));
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}
