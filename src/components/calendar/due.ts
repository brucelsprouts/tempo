import { dayOfWeek, diffDays, parts, type CivilDate } from '@/lib/tempo/civil';
import type { Occurrence, TempoEvent } from '@/lib/tempo/types';
import { MONTHS, WEEKDAYS } from './constants';
import { formatMinutes } from './TimePicker';

/**
 * When an entry is due, said wherever you are looking.
 *
 * An all-day entry's due time was read by the reminders and the form and drawn
 * by nothing, which is how a deadline at 18:00 comes to be remembered as the
 * end of the day. These are the rules every surface that states it shares, so
 * the bar, the day panel and the list cannot disagree about when something is
 * due.
 */

/** The parts of an occurrence these rules read. */
export type Dated = Pick<Occurrence, 'allDay' | 'date' | 'endDate' | 'startMinutes'> & {
  event: Pick<TempoEvent, 'dueMinutes'>;
};

/**
 * The due time a bar wears beside its chip, or null.
 *
 * All-day entries only. One with a start time is due when it starts, and its
 * bar already leads with that time — a second copy on the same bar would say
 * the same thing twice.
 */
export function barDue(occ: Dated): string | null {
  if (!occ.allDay || occ.event.dueMinutes === null) return null;
  return formatMinutes(occ.event.dueMinutes);
}

/**
 * The same, seen from one day of the entry: the day panel's label.
 *
 * On the day it is due the time is enough. Before it, the day has to be said as
 * well, since the panel is showing a different one — by weekday while that is
 * unambiguous, by date once the deadline is a week or more away.
 */
export function dayDue(occ: Dated, day: CivilDate): string | null {
  const time = barDue(occ);
  if (!time) return null;
  const ahead = diffDays(occ.endDate, day);
  if (ahead <= 0) return `DUE ${time}`;
  if (ahead < 7) return `DUE ${WEEKDAYS[dayOfWeek(occ.endDate)]} ${time}`;
  const { month, day: date } = parts(occ.endDate);
  return `DUE ${String(date).padStart(2, '0')} ${MONTHS[month - 1]} ${time}`;
}

/** When an occurrence is due: the day, and the minute when it states one. */
export interface DueMoment {
  date: CivilDate;
  minutes: number | null;
}

/**
 * An all-day entry is due on its last day at its due time; one with a time is
 * due when it starts — the same points the reminders count back from.
 */
export function dueMoment(occ: Dated): DueMoment {
  if (!occ.allDay) return { date: occ.date, minutes: occ.startMinutes };
  return { date: occ.endDate, minutes: occ.event.dueMinutes };
}

/**
 * A string that sorts the way deadlines do: by day, then by minute, with a day
 * that states no time last within it — due some time that day is due when the
 * day ends. `null`, nothing ahead, sorts after everything.
 */
export function dueSortKey(m: DueMoment | null): string {
  if (!m) return '￿';
  return `${m.date} ${String(m.minutes ?? 24 * 60).padStart(4, '0')}`;
}

/** How far off a due date is. Never in the past: the list looks from today. */
export function dueIn(date: CivilDate, today: CivilDate): string {
  const n = diffDays(date, today);
  if (n <= 0) return 'TODAY';
  if (n === 1) return 'TOMORROW';
  return `IN ${n}D`;
}
