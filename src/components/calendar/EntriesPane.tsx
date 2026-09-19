'use client';

import { useMemo } from 'react';
import { useCalendar } from '@/lib/store/calendar-store';
import type { CivilDate } from '@/lib/tempo/civil';
import type { Occurrence } from '@/lib/tempo/types';
import { DEFAULT_CATEGORY_COLOR, KIND_GLYPH } from './constants';
import { CategoryChip } from './CategoryChip';
import { dayDue, dueMoment, dueSortKey } from './due';
import { formatMinutes } from './TimePicker';

/**
 * Everything on a day, ranked by how much it is asking of you.
 *
 * The timeline beside this answers "when"; this answers "what". They are
 * different questions — something due Friday has no hour and would sit at
 * midnight on a 24-hour column, which is exactly where you would not look for
 * it. So the order is by consequence rather than by clock: the day's markers,
 * then what is due, soonest deadline first, then what happens at a time.
 */

/** Birthdays and marks, then all-day entries, then entries with a time. */
function rank(occ: Occurrence): number {
  if (occ.kind !== 'event') return 0;
  return occ.allDay ? 1 : 2;
}

interface Props {
  /** The day on show, which a deadline on another day is said relative to. */
  date: CivilDate;
  occurrences: Occurrence[];
  onOpen: (occ: Occurrence) => void;
}

export function EntriesPane({ date, occurrences, onOpen }: Props) {
  const categories = useCalendar((s) => s.categories);

  const ordered = useMemo(
    () =>
      [...occurrences].sort(
        (a, b) =>
          rank(a) - rank(b) ||
          dueSortKey(dueMoment(a)).localeCompare(dueSortKey(dueMoment(b))) ||
          a.title.localeCompare(b.title),
      ),
    [occurrences],
  );

  const categoryFor = (id: string | null) => categories.find((c) => c.id === id) ?? null;

  if (ordered.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="label">NOTHING DUE</span>
      </div>
    );
  }

  return (
    <ul className="h-full overflow-y-auto">
      {ordered.map((occ) => (
        <li key={occ.key} className="border-b border-hair last:border-b-0">
          <button
            type="button"
            onClick={() => onOpen(occ)}
            className="flex w-full items-start gap-2 px-3 py-2 text-left"
          >
            <span
              className="mt-px w-4 shrink-0 text-center text-[11px] leading-tight"
              style={{ color: categoryFor(occ.categoryId)?.color ?? DEFAULT_CATEGORY_COLOR }}
              aria-hidden
            >
              {KIND_GLYPH[occ.kind]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] leading-tight text-ink">{occ.title}</span>
              <span className="mt-1 flex min-w-0 items-center gap-2">
                <span className="label shrink-0">{when(occ, date)}</span>
                <CategoryChip category={categoryFor(occ.categoryId)} className="min-w-0" />
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A time, a deadline, or the plain fact that it takes the day. */
function when(occ: Occurrence, date: CivilDate): string {
  if (occ.allDay) return dayDue(occ, date) ?? 'ALL DAY';
  const start = occ.startMinutes === null ? '—' : formatMinutes(occ.startMinutes);
  return occ.endMinutes === null ? start : `${start}–${formatMinutes(occ.endMinutes)}`;
}
