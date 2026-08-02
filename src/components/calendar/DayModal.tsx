'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { groupOverrides, useCalendar } from '@/lib/store/calendar-store';
import {
  getServerZoomSnapshot,
  getZoomSnapshot,
  setZoom,
  subscribeZoom,
} from '@/lib/store/day-zoom';
import { addDays, dayOfWeek, parts, todayIn, type CivilDate } from '@/lib/tempo/civil';
import { expandAll } from '@/lib/tempo/recurrence';
import type { Occurrence } from '@/lib/tempo/types';
import { DayView } from './DayView';
import { TasksPane } from './TasksPane';
import { HOUR_H_DEFAULT, MONTHS_LONG, WEEKDAYS } from './constants';
import { zoomIn, zoomOut } from './timeline';
import { Modal, SegmentedControl } from './ui';

/**
 * A day, in full, over the calendar rather than beside it.
 *
 * This is where the density the grid gives up goes. A row is 146px and holds
 * about three bars before it starts counting the rest into a "+N" chip; that
 * chip opens this, and everything the row could not draw is here with room to
 * spare. The grid stays a legible overview because it is allowed to stop being
 * exhaustive.
 */

/**
 * How tall a pane is, and the same answer for both — they sit side by side
 * above the breakpoint, so two figures here would be two panes of different
 * heights in the one arrangement where that is visible.
 *
 * The floor is proportional as well as absolute. A flat 360px is taller than a
 * phone held sideways has to spare once the modal's own header and toolbar are
 * paid for, so the pane overflowed the frame and handed its scroll upward —
 * two nested scrollers over one 24-hour column, and the outer one moving the
 * toolbar off the top of the modal as you used it.
 */
const PANE_H = 'h-[min(72vh,calc(100vh-14rem))] min-h-[min(360px,55vh)] min-w-0';

interface Props {
  date: CivilDate;
  onDate: (d: CivilDate) => void;
  onOpen: (occ: Occurrence) => void;
  onNew: (date: CivilDate, startMinutes?: number) => void;
  onClose: () => void;
}

export function DayModal({ date, onDate, onOpen, onNew, onClose }: Props) {
  const events = useCalendar((s) => s.events);
  const overrides = useCalendar((s) => s.overrides);
  const timezone = useCalendar((s) => s.timezone);

  // Expanded once here and handed to both panes. They show the same day from
  // two angles; expanding twice would let them disagree mid-render if a write
  // landed between the two memos.
  const occurrences = useMemo(
    () => expandAll(events, groupOverrides(overrides), date, date),
    [events, overrides, date],
  );

  const wide = useWide();
  const [pane, setPane] = useState<'day' | 'tasks'>('day');
  const zoom = useSyncExternalStore(subscribeZoom, getZoomSnapshot, getServerZoomSnapshot);

  const { year, month, day } = parts(date);
  const isToday = date === todayIn(timezone);

  return (
    <Modal
      size="day"
      title={`${WEEKDAYS[dayOfWeek(date)]} ${String(day).padStart(2, '0')}`}
      meta={`${MONTHS_LONG[month - 1].toUpperCase()} ${year}${isToday ? ' · TODAY' : ''}`}
      onClose={onClose}
    >
      <div className="flex items-center gap-2 border-b border-hair px-3 py-2">
        <Stepper label="Previous day" onClick={() => onDate(addDays(date, -1))}>
          ‹
        </Stepper>
        <Stepper label="Next day" onClick={() => onDate(addDays(date, 1))}>
          ›
        </Stepper>

        {/* `zoomIn`/`zoomOut` are passed 0 for the pane height: from FIT the
            modal cannot know the column's measured height, and both clamp to
            the floor — so the first click out of FIT lands on the minimum and
            steps up from there. */}
        <div className="ml-2 flex items-center gap-1">
          <Stepper label="Zoom out" onClick={() => setZoom(zoomOut(zoom, 0))}>
            −
          </Stepper>
          <button
            type="button"
            onClick={() => setZoom(zoom === 'fit' ? HOUR_H_DEFAULT : 'fit')}
            aria-pressed={zoom === 'fit'}
            className={[
              'tap border px-2 py-1 text-[10px] leading-none tracking-[0.12em] transition-colors',
              zoom === 'fit'
                ? 'border-hairlit bg-raised text-bright'
                : 'border-hair text-mute hover:border-hairlit hover:text-ink',
            ].join(' ')}
          >
            FIT
          </button>
          <Stepper label="Zoom in" onClick={() => setZoom(zoomIn(zoom, 0))}>
            +
          </Stepper>
        </div>

        {/* Only a switch when there isn't room for both. Above the breakpoint
            the timeline and the list are the same surface, and a control that
            hides half of what is already on screen is just a way to lose it. */}
        {!wide && (
          <div className="ml-auto">
            <SegmentedControl
              value={pane}
              options={[
                { value: 'day', label: 'DAY' },
                { value: 'tasks', label: 'TASKS' },
              ]}
              onChange={setPane}
              grow={false}
            />
          </div>
        )}
      </div>

      <div className={wide ? 'grid grid-cols-2 divide-x divide-hair' : ''}>
        {(wide || pane === 'day') && (
          <div className={PANE_H}>
            <DayView date={date} occurrences={occurrences} onOpen={onOpen} onNew={onNew} />
          </div>
        )}
        {(wide || pane === 'tasks') && (
          <div className={PANE_H}>
            <TasksPane occurrences={occurrences} onOpen={onOpen} />
          </div>
        )}
      </div>
    </Modal>
  );
}

function Stepper({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="tap min-w-[30px] border border-hair px-2 py-1 text-[11px] leading-none text-mute transition-colors hover:border-hairlit hover:text-ink"
    >
      {children}
    </button>
  );
}

/**
 * Two panes or one, decided once.
 *
 * Rendering both and hiding one with `lg:hidden` would mount two 24-hour
 * timelines, each with its own scroll container and its own "open on the
 * working day" effect — and the hidden one has no height, so its scroll silently
 * clamps to zero and it is wrong the moment it becomes visible.
 */
function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(min-width: 1024px)');
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia('(min-width: 1024px)').matches,
    () => true,
  );
}

