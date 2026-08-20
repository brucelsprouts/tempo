'use client';

import { useMemo } from 'react';
import { useCalendar } from '@/lib/store/calendar-store';
import type { EventKind, EventStatus, Occurrence } from '@/lib/tempo/types';
import { DEFAULT_CATEGORY_COLOR } from './constants';

/**
 * Everything on a day, ranked by how much it is asking of you.
 *
 * The timeline beside this answers "when"; this answers "what". They are
 * different questions — a task due Friday has no hour and would sit at
 * midnight on a 24-hour column, which is exactly where you would not look for
 * it. Ordering here is by consequence rather than by clock.
 */

const STATUS_GLYPH: Record<EventStatus, string> = {
  todo: '[ ]',
  doing: '[~]',
  done: '[x]',
};

/** Click advances one step and wraps, so one control covers the whole cycle. */
const NEXT_STATUS: Record<EventStatus, EventStatus> = {
  todo: 'doing',
  doing: 'done',
  done: 'todo',
};

/** Tasks first, then the dateless markers, then things with a time. */
const RANK: Record<EventKind, number> = {
  assignment: 0,
  birthday: 1,
  milestone: 1,
  event: 2,
};

interface Props {
  occurrences: Occurrence[];
  onOpen: (occ: Occurrence) => void;
}

export function TasksPane({ occurrences, onOpen }: Props) {
  const categories = useCalendar((s) => s.categories);
  const setStatus = useCalendar((s) => s.setStatus);

  const ordered = useMemo(
    () =>
      [...occurrences].sort((a, b) => {
        if (RANK[a.kind] !== RANK[b.kind]) return RANK[a.kind] - RANK[b.kind];
        // Within a rank, unfinished work outranks finished work — a done task
        // has stopped being a task and should not sit above one that hasn't.
        const aDone = a.status === 'done' ? 1 : 0;
        const bDone = b.status === 'done' ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        const am = a.startMinutes ?? -1;
        const bm = b.startMinutes ?? -1;
        if (am !== bm) return am - bm;
        return a.title.localeCompare(b.title);
      }),
    [occurrences],
  );

  const colorFor = (id: string | null) =>
    categories.find((c) => c.id === id)?.color ?? DEFAULT_CATEGORY_COLOR;

  if (ordered.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="label">NOTHING DUE</span>
      </div>
    );
  }

  return (
    <ul className="h-full overflow-y-auto">
      {ordered.map((occ) => {
        const done = occ.status === 'done';
        const advanceable = occ.status !== null && !occ.readOnly;

        return (
          <li key={occ.key} className="border-b border-hair last:border-b-0">
            <div className="flex items-start gap-2 px-3 py-2">
              {advanceable ? (
                <button
                  type="button"
                  onClick={() => setStatus(occ, NEXT_STATUS[occ.status as EventStatus])}
                  aria-label={`Advance ${occ.title} from ${occ.status}`}
                  // `-my-2 py-2` rather than a bare glyph: three characters of
                  // text is a 20×11px target, and this is the control that
                  // advances a task. The padding is hit area and is taken back
                  // out of the layout so the row keeps its rhythm.
                  className="-my-2 shrink-0 py-2 tabular-nums text-[11px] leading-tight text-mute transition-colors hover:text-bright"
                >
                  {STATUS_GLYPH[occ.status as EventStatus]}
                </button>
              ) : (
                <span
                  className="mt-px w-4 shrink-0 text-center text-[11px] leading-tight text-mute"
                  style={{ color: colorFor(occ.categoryId) }}
                  aria-hidden
                >
                  {occ.kind === 'milestone' ? '◆' : occ.kind === 'birthday' ? '✳' : '·'}
                </span>
              )}

              <button
                type="button"
                onClick={() => onOpen(occ)}
                className="min-w-0 flex-1 text-left"
              >
                <span
                  className={`block truncate text-[12px] leading-tight ${
                    done ? 'text-mute line-through' : 'text-ink'
                  }`}
                >
                  {occ.title}
                </span>
                <span className="label mt-1 block">
                  {occ.allDay
                    ? 'ALL DAY'
                    : `${clock(occ.startMinutes)}${occ.endMinutes != null ? `–${clock(occ.endMinutes)}` : ''}`}
                </span>
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function clock(minutes: number | null): string {
  if (minutes === null) return '—';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
