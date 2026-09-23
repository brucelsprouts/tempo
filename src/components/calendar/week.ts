import { addDays, startOfWeek, type CivilDate } from '@/lib/tempo/civil';

/**
 * The seven dates of the week containing `date`, Sunday first.
 *
 * Sunday-first to match the continuous grid, which is the calendar this view
 * sits beside — a week view that started on Monday would put the same seven
 * days in different columns from the rows above it.
 *
 * Separated from `WeekView` for the reason `timeline.ts` is separated from
 * `DayView`: none of it is about React and all of it is about dates, and a
 * month or year boundary is exactly the kind of thing worth a test rather than
 * a glance.
 */
export function weekDays(date: CivilDate): CivilDate[] {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/**
 * The same weekday `weeks` weeks away, normalised to the start of that week.
 *
 * Normalised so stepping is idempotent: paging forward and back from a Tuesday
 * returns the Sunday its week opens on, not the Tuesday, and every subsequent
 * step lands on a week boundary rather than drifting.
 */
export function shiftWeek(date: CivilDate, weeks: number): CivilDate {
  return addDays(startOfWeek(date), weeks * 7);
}
