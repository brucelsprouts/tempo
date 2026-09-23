import type { TempoEvent } from '@/lib/tempo/types';

/**
 * The calendar minus the timetable, unless the timetable is being shown.
 *
 * Filtering *events* rather than expanded occurrences is the point: a hidden
 * series is never walked at all, so a term's worth of lectures costs the scroll
 * view nothing rather than costing it an expansion it then throws away.
 *
 * Returns the array it was given whenever nothing would be removed, so the
 * `useMemo` that every view wraps `expandAll` in does not see a new identity on
 * every render.
 *
 * Pure, and in its own file for it: the hook that reads the preference lives in
 * `use-visible-events.ts`, which pulls in the store — and the store builds a
 * Supabase client the moment it is imported, which a unit test has no business
 * needing.
 */
export function filterVisible(events: TempoEvent[], showTimetable: boolean): TempoEvent[] {
  if (showTimetable) return events;
  if (!events.some((e) => e.timetable)) return events;
  return events.filter((e) => !e.timetable);
}
