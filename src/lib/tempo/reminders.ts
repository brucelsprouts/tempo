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
import type { Occurrence, OccurrenceOverride, Reminder, TempoEvent } from './types';

/**
 * The lead times worth offering, named.
 *
 * Two lists because the offset means something different either side of the
 * all-day line. On a timed event the useful question is "how long before it
 * starts"; on an all-day one the start is midnight, so every honest answer is
 * a time of day on some earlier date — 900 is "the day before at 09:00", and
 * showing that as "15 hours before" would be technically true and useless.
 */
export const TIMED_PRESETS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 0, label: 'At the time' },
  { minutes: 5, label: '5 minutes before' },
  { minutes: 15, label: '15 minutes before' },
  { minutes: 30, label: '30 minutes before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 120, label: '2 hours before' },
  { minutes: 1440, label: '1 day before' },
  { minutes: 2880, label: '2 days before' },
  { minutes: 10080, label: '1 week before' },
];

export const ALL_DAY_PRESETS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 5, label: '5 minutes before midnight' },
  { minutes: 0, label: 'Midnight, that day' },
  { minutes: -540, label: '09:00 that morning' },
  { minutes: 900, label: 'The day before, 09:00' },
  { minutes: 2340, label: 'Two days before, 09:00' },
  { minutes: 9540, label: 'A week before, 09:00' },
];

/**
 * What a new entry starts with, by kind.
 *
 * A long lead so you can act and a short one so you turn up — the pairing every
 * calendar converges on. Applied only when creating: an edit must never rewrite
 * reminders the row already holds, for the same reason `notify` is left out of
 * the draft entirely.
 *
 * Assignments and milestones get the day-before pair because the useful moment
 * for a deadline is the evening you could still start it. Birthdays get five
 * minutes before midnight, so the message is typed when the day begins, and
 * 09:00 that morning for the nights you were asleep by then.
 */
export function defaultReminders(kind: TempoEvent['kind'], allDay: boolean): Reminder[] {
  if (kind === 'birthday') return [{ minutes: 5 }, { minutes: -540 }];
  if (kind === 'assignment' || kind === 'milestone') {
    return allDay ? [{ minutes: 2340 }, { minutes: 900 }] : [{ minutes: 1440 }, { minutes: 120 }];
  }
  return allDay ? [{ minutes: 900 }] : [{ minutes: 30 }];
}

export type LeadUnit = 'minutes' | 'hours' | 'days' | 'weeks';

const UNIT_MINUTES: Record<LeadUnit, number> = {
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
 * "2 days before, at 08:00", as minutes before the midnight an all-day entry
 * starts at. `daysBefore` 0 is the day itself, which comes out negative.
 */
export function allDayLeadMinutes(daysBefore: number, timeOfDay: number): number {
  return Math.round(daysBefore) * 1440 - timeOfDay;
}

/** Whether the dispatcher will actually send a reminder this far out. */
export function isSendableLead(minutes: number): boolean {
  return minutes >= MIN_LEAD_MINUTES && minutes <= MAX_LEAD_MINUTES;
}

/**
 * What a reminder's chip says.
 *
 * A preset keeps its own words. Anything else is described the way its side
 * of the all-day line thinks — a lead time on a timed entry, a day and a time
 * of day on an all-day one — so a custom reminder, or one carried across a
 * switch between the two, shows up as a chip instead of vanishing from the form
 * while still being sent.
 */
export function reminderLabel(minutes: number, allDay: boolean): string {
  const preset = (allDay ? ALL_DAY_PRESETS : TIMED_PRESETS).find((p) => p.minutes === minutes);
  if (preset) return preset.label;
  return allDay ? allDayLabel(minutes) : timedLabel(minutes);
}

function timedLabel(minutes: number): string {
  if (minutes === 0) return 'At the time';
  const size = Math.abs(minutes);
  const unit = (['weeks', 'days', 'hours', 'minutes'] as const).find(
    (u) => size % UNIT_MINUTES[u] === 0,
  )!;
  const n = size / UNIT_MINUTES[unit];
  const word = n === 1 ? unit.slice(0, -1) : unit;
  return `${n} ${word} ${minutes > 0 ? 'before' : 'after'}`;
}

function allDayLabel(minutes: number): string {
  // Which day, counting back from the entry's own; then the time on it.
  const days = Math.ceil(minutes / 1440);
  const time = days * 1440 - minutes;
  const clock = `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}`;
  if (days === 0) return `That day, ${clock}`;
  const n = Math.abs(days);
  return `${n} day${n === 1 ? '' : 's'} ${days > 0 ? 'before' : 'after'}, ${clock}`;
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
  /** Which reminder of the event's list this is. Part of the identity. */
  minutes: number;
  /** The instant it was supposed to fire. */
  fireAt: Date;
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
 * When an occurrence starts, as a real instant.
 *
 * An all-day occurrence starts at midnight in the event's own zone — not the
 * viewer's, and not UTC. A birthday reminder set for "the day before at 09:00"
 * has to mean 09:00 where the event lives, or it lands at 04:00 for half the
 * year and 05:00 for the other half.
 */
export function occurrenceStart(occ: Occurrence, event: TempoEvent): Date {
  const minutes = occ.allDay ? 0 : (occ.startMinutes ?? 0);
  return instantFromCivil(occ.date, minutes, event.timezone);
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
    const leads = event.reminders
      .map((r) => r.minutes)
      .filter((m) => m >= MIN_LEAD_MINUTES && m <= MAX_LEAD_MINUTES);
    if (leads.length === 0) continue;

    // A reminder normally fires *before* its occurrence, so the occurrences
    // that matter now are the ones still ahead of us, up to the longest lead
    // away. A negative lead reaches the other way, so the search has to open
    // backwards by that much too — clamped at zero on each side so one sign
    // never shrinks the window the other sign needs.
    const ahead = Math.max(0, ...leads);
    const behind = Math.max(0, ...leads.map((m) => -m));

    // Widened another day at each end because this window is a range of
    // instants and the expander speaks in civil dates, whose boundaries move
    // with the zone.
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
      const start = occurrenceStart(occ, event);
      for (const minutes of leads) {
        const fireAt = new Date(start.getTime() - minutes * 60_000);
        if (fireAt > after && fireAt <= upTo) {
          out.push({ event, occurrence: occ, seriesDate: occ.seriesDate, minutes, fireAt });
        }
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
 */
export function reminderText(due: DueReminder): { title: string; body: string } {
  const { occurrence, event, minutes } = due;
  // Within the hour before midnight "tomorrow" undersells it; say the minutes.
  const when = occurrence.allDay
    ? minutes > 0 && minutes < 60
      ? `${lead(minutes)} · midnight`
      : relativeDay(occurrence.date, due.fireAt, event.timezone)
    : `${lead(minutes)} · ${clockLabel(occurrence.startMinutes ?? 0)}`;
  return { title: occurrence.title, body: when };
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
