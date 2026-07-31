'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { groupOverrides, useCalendar } from '@/lib/store/calendar-store';
import { diffDays, dayOfWeek, parts, todayIn, type CivilDate } from '@/lib/tempo/civil';
import { expandAll } from '@/lib/tempo/recurrence';
import type { Occurrence } from '@/lib/tempo/types';
import { DEFAULT_CATEGORY_COLOR, MONTHS_LONG, WEEKDAYS } from './constants';
import { Button, PanelHeader } from './ui';

/**
 * The day panel is where time-of-day lives.
 *
 * The continuous grid deliberately owns dates only — putting hour rows in the
 * main scroll would wreck the density that makes it readable. Precision moves
 * here instead, where a 24-hour column has room to be dragged accurately.
 */

const HOUR_H = 44;
const SNAP_MINUTES = 15;
const DAY_MINUTES = 24 * 60;

interface Props {
  date: CivilDate;
  onOpen: (occ: Occurrence) => void;
  onNew: (date: CivilDate, startMinutes?: number) => void;
  onClose: () => void;
}

/** Side-by-side lanes for timed blocks that overlap in the column. */
function packLanes(items: Occurrence[]): Map<string, { lane: number; of: number }> {
  const sorted = [...items].sort((a, b) => (a.startMinutes ?? 0) - (b.startMinutes ?? 0));
  const laneEnds: number[] = [];
  const assignment = new Map<string, number>();

  for (const occ of sorted) {
    const start = occ.startMinutes ?? 0;
    const end = occ.endMinutes ?? start + 30;
    let lane = laneEnds.findIndex((e) => e <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    assignment.set(occ.key, lane);
  }

  const total = Math.max(1, laneEnds.length);
  return new Map([...assignment].map(([k, lane]) => [k, { lane, of: total }]));
}

export function DayView({ date, onOpen, onNew, onClose }: Props) {
  const events = useCalendar((s) => s.events);
  const overrides = useCalendar((s) => s.overrides);
  const categories = useCalendar((s) => s.categories);
  const timezone = useCalendar((s) => s.timezone);
  const setOccurrenceTime = useCalendar((s) => s.setOccurrenceTime);

  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ key: string; startDelta: number; endDelta: number } | null>(
    null,
  );

  const occurrences = useMemo(
    () => expandAll(events, groupOverrides(overrides), date, date),
    [events, overrides, date],
  );

  const bars = occurrences.filter((o) => o.allDay || diffDays(o.endDate, o.date) > 0);
  const timed = occurrences.filter((o) => !o.allDay && diffDays(o.endDate, o.date) === 0);
  const lanes = useMemo(() => packLanes(timed), [timed]);

  const colorFor = (id: string | null) =>
    categories.find((c) => c.id === id)?.color ?? DEFAULT_CATEGORY_COLOR;

  // Open on the working day rather than at midnight.
  useEffect(() => {
    if (gridRef.current) gridRef.current.scrollTop = 7 * HOUR_H;
  }, [date]);

  function beginTimeDrag(e: React.PointerEvent, occ: Occurrence, mode: 'move' | 'resize') {
    e.stopPropagation();
    e.preventDefault();
    if (occ.readOnly) return;

    const originY = e.clientY;
    const snap = (dy: number) => {
      const minutes = (dy / HOUR_H) * 60;
      return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
    };

    const move = (ev: PointerEvent) => {
      const d = snap(ev.clientY - originY);
      setDrag({
        key: occ.key,
        startDelta: mode === 'move' ? d : 0,
        endDelta: d,
      });
    };

    const finish = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      setDrag(null);
      const d = snap(ev.clientY - originY);
      if (d === 0) return;

      const start = (occ.startMinutes ?? 0) + (mode === 'move' ? d : 0);
      const end = (occ.endMinutes ?? 60) + d;
      if (start < 0 || end > DAY_MINUTES || end <= start) return;

      setOccurrenceTime(occ, start, end, ev.shiftKey ? 'series' : 'occurrence');
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  }

  const { year, month, day } = parts(date);
  const isToday = date === todayIn(timezone);

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title={`${WEEKDAYS[dayOfWeek(date)]} ${String(day).padStart(2, '0')}`}
        meta={`${MONTHS_LONG[month - 1].toUpperCase()} ${year}${isToday ? ' · TODAY' : ''}`}
        onClose={onClose}
      />

      {bars.length > 0 && (
        <div className="shrink-0 space-y-1 border-b border-hair px-3 py-2.5">
          <div className="label mb-1.5">ALL DAY</div>
          {bars.map((occ) => (
            <button
              key={occ.key}
              onClick={() => onOpen(occ)}
              style={{ borderLeftColor: colorFor(occ.categoryId) }}
              className="flex w-full items-center gap-2 border-l-2 bg-raised px-2 py-1.5 text-left text-[11px] text-ink transition-colors hover:bg-sunken"
            >
              <span className="truncate">{occ.title}</span>
            </button>
          ))}
        </div>
      )}

      <div ref={gridRef} className="relative flex-1 overflow-y-auto">
        <div className="relative" style={{ height: 24 * HOUR_H }}>
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              onClick={() => onNew(date, h * 60)}
              className="absolute inset-x-0 cursor-copy border-t border-hair transition-colors hover:bg-panel"
              style={{ top: h * HOUR_H, height: HOUR_H }}
            >
              <span className="label absolute left-2 top-1">
                {String(h).padStart(2, '0')}
              </span>
            </div>
          ))}

          <div className="absolute inset-y-0 left-11 right-2">
            {timed.map((occ) => {
              const lane = lanes.get(occ.key) ?? { lane: 0, of: 1 };
              const active = drag?.key === occ.key ? drag : null;
              const start = (occ.startMinutes ?? 0) + (active?.startDelta ?? 0);
              const end = (occ.endMinutes ?? 60) + (active?.endDelta ?? 0);
              const color = colorFor(occ.categoryId);

              return (
                <div
                  key={occ.key}
                  onPointerDown={(e) => beginTimeDrag(e, occ, 'move')}
                  onClick={() => !drag && onOpen(occ)}
                  style={{
                    position: 'absolute',
                    top: (start / 60) * HOUR_H,
                    height: Math.max(18, ((end - start) / 60) * HOUR_H - 2),
                    left: `${(lane.lane / lane.of) * 100}%`,
                    width: `calc(${100 / lane.of}% - 3px)`,
                    borderLeft: `2px solid ${color}`,
                    zIndex: active ? 20 : 1,
                  }}
                  className="group overflow-hidden border-y border-r border-hair bg-raised px-1.5 py-1 text-[11px] text-ink transition-colors hover:border-hairlit hover:bg-sunken"
                >
                  <div className="truncate leading-tight">{occ.title}</div>
                  <div className="label mt-0.5">
                    {String(Math.floor(start / 60)).padStart(2, '0')}:
                    {String(start % 60).padStart(2, '0')}
                  </div>
                  <span
                    onPointerDown={(e) => beginTimeDrag(e, occ, 'resize')}
                    className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ background: `linear-gradient(0deg, ${color}, transparent)` }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-hair px-3 py-2.5">
        <Button type="button" variant="primary" className="w-full" onClick={() => onNew(date)}>
          + NEW ON THIS DAY
        </Button>
      </div>
    </div>
  );
}
