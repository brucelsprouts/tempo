'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCalendar } from '@/lib/store/calendar-store';
import type { CivilDate } from '@/lib/tempo/civil';
import { minutesInZone, parts, todayIn } from '@/lib/tempo/civil';
import type { Occurrence } from '@/lib/tempo/types';
import { DEFAULT_CATEGORY_COLOR, HOUR_H_DEFAULT, MONTHS } from './constants';
import { DAY_MINUTES, daySegment, placeSegments, type DaySegment } from './timeline';

/**
 * The 24-hour timeline: where time-of-day lives.
 *
 * The continuous grid deliberately owns dates only — putting hour rows in the
 * main scroll would wreck the density that makes it readable. Precision moves
 * here instead, where a 24-hour column has room to be dragged accurately.
 *
 * A pane, not a panel. It draws no header and no footer of its own: it is one
 * half of `DayModal`, which owns the date, the steppers and dismissal, so the
 * chrome lives in one place rather than being negotiated between them.
 */

const HOUR_H = HOUR_H_DEFAULT;
const SNAP_MINUTES = 15;

interface Props {
  date: CivilDate;
  /** Expanded by `DayModal` and shared with the tasks pane. */
  occurrences: Occurrence[];
  onOpen: (occ: Occurrence) => void;
  onNew: (date: CivilDate, startMinutes?: number) => void;
}

export function DayView({ date, occurrences, onOpen, onNew }: Props) {
  const categories = useCalendar((s) => s.categories);
  const setOccurrenceTime = useCalendar((s) => s.setOccurrenceTime);

  const timezone = useCalendar((s) => s.timezone);
  const nowMinutes = useNowMinutes(timezone);
  const isToday = date === todayIn(timezone);

  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ key: string; startDelta: number; endDelta: number } | null>(
    null,
  );

  /**
   * The strip holds only what genuinely has no time of day. A multi-day *timed*
   * entry used to land here too, which is why an overnight shift showed as a
   * chip with no position and left the morning it ate looking free.
   */
  const bars = occurrences.filter((o) => o.allDay);

  /** Every timed entry that touches this day, clipped to it. */
  const placed = useMemo(() => {
    const segments = occurrences
      .map((occ) => ({ occ, segment: daySegment(occ, date) }))
      .filter((s): s is { occ: Occurrence; segment: DaySegment } => s.segment !== null);

    const byKey = new Map(segments.map((s) => [s.occ.key, s.occ]));
    return placeSegments(segments.map((s) => ({ key: s.occ.key, segment: s.segment }))).map(
      (p) => ({ ...p, occ: byKey.get(p.key)! }),
    );
  }, [occurrences, date]);

  const colorFor = (id: string | null) =>
    categories.find((c) => c.id === id)?.color ?? DEFAULT_CATEGORY_COLOR;

  // Open on the working day rather than at midnight.
  useEffect(() => {
    if (gridRef.current) gridRef.current.scrollTop = 7 * HOUR_H;
  }, [date]);

  function beginTimeDrag(
    e: React.PointerEvent,
    occ: Occurrence,
    segment: DaySegment,
    mode: 'move' | 'resize',
  ) {
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
      setDrag({ key: occ.key, startDelta: mode === 'move' ? d : 0, endDelta: d });
    };

    const finish = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      setDrag(null);
      const d = snap(ev.clientY - originY);
      if (d === 0) return;

      const start = segment.top + (mode === 'move' ? d : 0);
      const end = segment.bottom + d;
      if (start < 0 || end > DAY_MINUTES || end <= start) return;

      setOccurrenceTime(occ, start, end, ev.shiftKey ? 'series' : 'occurrence');
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  }

  return (
    <div className="flex h-full flex-col">
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
            {placed.map(({ key, occ, segment, lane, of }) => {
              const active = drag?.key === key ? drag : null;
              const top = segment.top + (active?.startDelta ?? 0);
              const bottom = segment.bottom + (active?.endDelta ?? 0);
              const color = colorFor(occ.categoryId);
              const height = Math.max(18, ((bottom - top) / 60) * HOUR_H - 2);

              return (
                <div
                  key={key}
                  onPointerDown={(e) => beginTimeDrag(e, occ, segment, 'move')}
                  onClick={() => !drag && onOpen(occ)}
                  style={{
                    position: 'absolute',
                    top: (top / 60) * HOUR_H,
                    height,
                    left: `${(lane / of) * 100}%`,
                    width: `calc(${100 / of}% - 3px)`,
                    borderLeft: `2px solid ${color}`,
                    zIndex: active ? 20 : 1,
                  }}
                  className={[
                    'group overflow-hidden border-r border-hair bg-raised px-1.5 py-1',
                    'text-[11px] text-ink transition-colors hover:border-hairlit hover:bg-sunken',
                    // A cut edge gets no border: a block ending flush at the
                    // bottom of the column would otherwise be indistinguishable
                    // from one that genuinely ends at midnight.
                    segment.continuesBefore ? '' : 'border-t',
                    segment.continuesAfter ? '' : 'border-b',
                  ].join(' ')}
                >
                  {segment.continuesBefore && (
                    <div className="label leading-none opacity-70">↑ FROM {shortDate(occ.date)}</div>
                  )}
                  <div className="truncate leading-tight">{occ.title}</div>
                  <div className="label mt-0.5">{clockLabel(top)}</div>
                  {segment.continuesAfter && (
                    <div className="label absolute inset-x-1.5 bottom-0.5 leading-none opacity-70">
                      ↓ TO {shortDate(occ.endDate)}
                    </div>
                  )}
                  {/* Nothing to grab on an edge that is a clip rather than an end. */}
                  {!segment.continuesAfter && (
                    <span
                      onPointerDown={(e) => beginTimeDrag(e, occ, segment, 'resize')}
                      className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
                      style={{ background: `linear-gradient(0deg, ${color}, transparent)` }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {isToday && nowMinutes !== null && (
            <div
              // Never intercepts a drag: this is a readout, not a target.
              className="pointer-events-none absolute inset-x-0 z-30"
              style={{ top: (nowMinutes / 60) * HOUR_H }}
              aria-hidden="true"
            >
              <div className="absolute inset-x-11 h-px bg-[#c8553d]" />
              {/* An origin for the line, so it does not read as a hairline border. */}
              <div className="absolute left-[42px] top-[-2.5px] h-[5px] w-[5px] rounded-full bg-[#c8553d]" />
              <span className="absolute left-1 top-[-6px] text-[10px] leading-none text-[#c8553d]">
                {clockLabel(nowMinutes)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Minutes past midnight, now, in the calendar's zone — or null until mounted.
 *
 * Null first, deliberately. A clock read during render is a hydration mismatch:
 * the server renders one minute and the client another, and React replaces the
 * tree. The rule appears a frame later instead, which nobody sees.
 *
 * Thirty seconds is the tick. A minute would let the line sit visibly wrong for
 * up to a minute against a gridline it is meant to be read alongside.
 */
function useNowMinutes(timezone: string): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const read = () => setNow(minutesInZone(new Date(), timezone));
    read();
    const timer = window.setInterval(read, 30_000);
    return () => window.clearInterval(timer);
  }, [timezone]);

  return now;
}

/** `2026-08-11` → `AUG 11`. What a continuation chevron points at. */
function shortDate(d: CivilDate): string {
  const { month, day } = parts(d);
  return `${MONTHS[month - 1]} ${day}`;
}

function clockLabel(minutes: number): string {
  const m = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
