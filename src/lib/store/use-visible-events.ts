'use client';

import { useMemo, useSyncExternalStore } from 'react';
import type { TempoEvent } from '@/lib/tempo/types';
import { useCalendar } from './calendar-store';
import {
  getServerTimetableSnapshot,
  getTimetableSnapshot,
  subscribeTimetable,
} from './timetable-visibility';
import { filterVisible } from './visible-events';

/**
 * What the scroll, list, year and day views draw.
 *
 * `History` and `Settings` deliberately keep reading the store directly: a
 * hidden entry that was deleted still has to be recoverable, and the counts in
 * settings have to be true.
 */
export function useVisibleEvents(): TempoEvent[] {
  const events = useCalendar((s) => s.events);
  const showTimetable = useSyncExternalStore(
    subscribeTimetable,
    getTimetableSnapshot,
    getServerTimetableSnapshot,
  );
  return useMemo(() => filterVisible(events, showTimetable), [events, showTimetable]);
}
