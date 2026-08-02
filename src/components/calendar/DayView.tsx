'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useCalendar } from '@/lib/store/calendar-store';
import {
  getServerZoomSnapshot,
  getZoomSnapshot,
  setZoom,
  subscribeZoom,
} from '@/lib/store/day-zoom';
import type { CivilDate } from '@/lib/tempo/civil';
import { minutesInZone, parts, todayIn } from '@/lib/tempo/civil';
import type { Occurrence } from '@/lib/tempo/types';
import { DEFAULT_CATEGORY_COLOR, MONTHS } from './constants';
import {
  applyDrag,
  DAY_MINUTES,
  daySegment,
  FINE_MINUTES,
  labelEvery,
  placeSegments,
  resolveHourHeight,
  showsHalfHours,
  SNAP_MINUTES,
  zoomIn,
  zoomOut,
  type DaySegment,
} from './timeline';

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
  const [drag, setDrag] = useState<{ key: string; start: number; end: number } | null>(null);
  /** Set by a drag that re-timed something, so the click it trails can be dropped. */
  const justDragged = useRef(false);
  const [scrolled, setScrolled] = useState(false);

  const zoom = useSyncExternalStore(subscribeZoom, getZoomSnapshot, getServerZoomSnapshot);
  const [paneHeight, setPaneHeight] = useState(0);

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

  /**
   * FIT has to know how tall the column is, and the column is sized by flexbox
   * rather than by anything this component states — so it is measured, and
   * re-measured on resize. A stored pixel height would have stopped being a fit
   * the first time the window changed.
   */
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setPaneHeight(entry.contentRect.height));
    observer.observe(el);
    setPaneHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  const hourHeight = resolveHourHeight(zoom, paneHeight || 1);
  const everyNth = labelEvery(hourHeight);
  const halfHours = showsHalfHours(hourHeight);

  /** The pixel the now-rule sits on, or null on any day that isn't today. */
  const nowY = isToday && nowMinutes !== null ? (nowMinutes / 60) * hourHeight : null;

  /**
   * Where the column opens.
   *
   * Today opens on now; another day opens on its first entry; an empty day falls
   * back to the working morning. A fixed 07:00 was wrong for exactly the days
   * you open the modal to look at.
   *
   * The clock is read here rather than taken from `nowMinutes`, which is still
   * null on the mount this runs in — the ticking state arrives a render later,
   * and this effect deliberately never runs again for the same day.
   */
  useEffect(() => {
    const el = gridRef.current;
    if (!el || hourHeight === 0) return;
    const first = placed.reduce<number | null>(
      (min, p) => (min === null || p.segment.top < min ? p.segment.top : min),
      null,
    );
    const anchor = isToday ? minutesInZone(new Date(), timezone) : (first ?? 7 * 60);
    el.scrollTop = Math.max(0, (anchor / 60) * hourHeight - el.clientHeight / 3);
    // Deliberately not reacting to the clock: re-anchoring every 30 seconds
    // would yank the column out from under whatever you were reading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  /**
   * Zooming keeps the middle of the column pointing at the same time.
   *
   * Holding the pixel offset instead would land you at a different hour every
   * time you changed the scale, which is the single most disorienting thing a
   * timeline can do.
   */
  const previousHeight = useRef(hourHeight);
  useEffect(() => {
    const el = gridRef.current;
    const was = previousHeight.current;
    previousHeight.current = hourHeight;
    if (!el || was === hourHeight || was === 0) return;
    const centreMinutes = ((el.scrollTop + el.clientHeight / 2) / was) * 60;
    el.scrollTop = (centreMinutes / 60) * hourHeight - el.clientHeight / 2;
  }, [hourHeight]);

  /**
   * ⌘/Ctrl-wheel — and a trackpad pinch, which sends the same thing — changes
   * the scale rather than the page's.
   *
   * A native, non-passive listener rather than React's `onWheel`: React registers
   * `wheel` on the root as passive, so `preventDefault` there is ignored and the
   * browser zooms the whole page out from under the gesture.
   */
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Without the guard this would hijack ordinary scrolling.
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(e.deltaY < 0 ? zoomIn(zoom, paneHeight) : zoomOut(zoom, paneHeight));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, paneHeight]);

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
    /**
     * A block whose drawn edges are both cuts, or whose stored end reads earlier
     * than its stored start, spans more than this day. `setOccurrenceTime` takes
     * only minutes and cannot say "and also move it a day", so the drag holds it
     * still rather than silently truncating it.
     */
    const lockDates = segment.continuesBefore || segment.continuesAfter;

    const resolve = (ev: PointerEvent | React.PointerEvent) =>
      applyDrag({
        start: segment.top,
        end: segment.bottom,
        deltaMinutes: ((ev.clientY - originY) / hourHeight) * 60,
        mode,
        // Alt is the deliberate escape from the grid.
        step: ev.altKey ? FINE_MINUTES : SNAP_MINUTES,
        lockDates,
      });

    const move = (ev: PointerEvent) => {
      const { start, end } = resolve(ev);
      setDrag({ key: occ.key, start, end });
    };

    const finish = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      setDrag(null);
      /**
       * Whatever the browser selected on the way past, unselected.
       *
       * `preventDefault` on the press above is not enough: Chrome suppresses the
       * compatibility mouse events it would imply only for touch, so a mouse
       * drag still anchors a text selection and paints half the modal blue the
       * moment you let go. The blocks now carry `select-none` so nothing starts
       * there in the first place; this covers the range a press that began just
       * outside one left behind.
       */
      window.getSelection()?.removeAllRanges();
      const { start, end } = resolve(ev);
      if (start === segment.top && end === segment.bottom) return;

      /**
       * The click this release is about to produce belongs to the drag, not to
       * the block.
       *
       * `drag` state cannot say so: it is cleared above, and the browser
       * dispatches `click` after `pointerup`, so by the time the handler runs a
       * finished drag is indistinguishable from a press that never moved —
       * which is why letting go used to re-time the entry *and* throw the edit
       * form open on top of it. The flag is cleared on the task after this one,
       * by which point that click has been and gone.
       *
       * Only a drag that actually moved something sets it. A press that jiggles
       * and lands back on its own start is a click, and should still open.
       */
      justDragged.current = true;
      window.setTimeout(() => {
        justDragged.current = false;
      }, 0);

      setOccurrenceTime(occ, start, end, ev.shiftKey ? 'series' : 'occurrence');
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  }

  return (
    <div className="flex h-full flex-col">
      {bars.length > 0 && (
        <div
          className={[
            'relative z-10 shrink-0 space-y-1 border-b border-hair px-3 py-2.5',
            // Reads as pinned rather than as the first thing in the scroll.
            scrolled ? 'shadow-[0_4px_8px_-4px_rgba(0,0,0,0.6)]' : '',
          ].join(' ')}>
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

      <div
        ref={gridRef}
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}
        className="relative flex-1 overflow-y-auto"
      >
        <div className="relative" style={{ height: 24 * hourHeight }}>
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              onClick={() => onNew(date, h * 60)}
              className="absolute inset-x-0 cursor-copy border-t border-hair transition-colors hover:bg-panel"
              style={{ top: h * hourHeight, height: hourHeight }}
            >
              {/* The hour gives its place up to the clock when they would land
                  on each other. Both sit at `left-2` in a 44px gutter with no
                  room to pass, and for the seventeen minutes either side of an
                  hour they printed on top of one another — `05:17` struck
                  through by an `05`. Now is the more specific of the two, and
                  it is the one being looked for. */}
              {h % everyNth === 0 && (nowY === null || Math.abs(nowY - h * hourHeight) >= 14) && (
                <span className="label absolute left-2 top-1">
                  {String(h).padStart(2, '0')}
                </span>
              )}
              {halfHours && (
                <div
                  className="pointer-events-none absolute inset-x-0 border-t border-hair/40"
                  style={{ top: hourHeight / 2 }}
                />
              )}
            </div>
          ))}

          <div className="absolute inset-y-0 left-11 right-2">
            {placed.map(({ key, occ, segment, lane, of }) => {
              const active = drag?.key === key ? drag : null;
              const top = active?.start ?? segment.top;
              const bottom = active?.end ?? segment.bottom;
              const color = colorFor(occ.categoryId);
              const height = Math.max(18, ((bottom - top) / 60) * hourHeight - 2);

              return (
                <div
                  key={key}
                  onPointerDown={(e) => beginTimeDrag(e, occ, segment, 'move')}
                  onClick={() => !drag && !justDragged.current && onOpen(occ)}
                  style={{
                    position: 'absolute',
                    top: (top / 60) * hourHeight,
                    height,
                    left: `${(lane / of) * 100}%`,
                    width: `calc(${100 / of}% - 3px)`,
                    borderLeft: `2px solid ${color}`,
                    zIndex: active ? 20 : 1,
                  }}
                  className={[
                    'group overflow-hidden border-r border-hair bg-raised px-1.5 py-1',
                    // A block is a handle, not a paragraph. Without this the
                    // press that starts a move also starts a text selection,
                    // and the drag drags that instead.
                    'select-none',
                    'text-[11px] text-ink transition-colors hover:border-hairlit hover:bg-sunken',
                    // A cut edge gets no border: a block ending flush at the
                    // bottom of the column would otherwise be indistinguishable
                    // from one that genuinely ends at midnight.
                    segment.continuesBefore ? '' : 'border-t',
                    segment.continuesAfter ? '' : 'border-b',
                    active ? 'cursor-grabbing shadow-[0_6px_18px_rgba(0,0,0,0.6)]' : 'cursor-grab',
                  ].join(' ')}
                >
                  {segment.continuesBefore && height >= 40 && (
                    <div className="label leading-none opacity-70">↑ FROM {shortDate(occ.date)}</div>
                  )}

                  {/* Three densities. A 15-minute entry used to render two
                      stacked lines inside an 18px box and overflow itself. */}
                  {height >= 40 ? (
                    <>
                      <div className="truncate leading-tight">{occ.title}</div>
                      <div className="label mt-0.5">{clockLabel(top)}</div>
                    </>
                  ) : height >= 22 ? (
                    <div className="flex items-baseline gap-1.5 leading-tight">
                      <span className="truncate">{occ.title}</span>
                      <span className="label shrink-0 opacity-70">{clockLabel(top)}</span>
                    </div>
                  ) : (
                    <div className="truncate leading-none">{occ.title}</div>
                  )}

                  {segment.continuesAfter && height >= 40 && (
                    <div className="label absolute inset-x-1.5 bottom-0.5 leading-none opacity-70">
                      ↓ TO {shortDate(occ.endDate)}
                    </div>
                  )}

                  {/* The readout that turns a drag from an estimate into a
                      measurement — and makes the quarter-hour snap legible. */}
                  {active && (
                    <div className="absolute -right-1 -top-6 z-40 whitespace-nowrap border border-hairlit bg-panel px-1.5 py-0.5 text-[10px] text-bright shadow-[0_4px_12px_rgba(0,0,0,0.6)]">
                      {clockLabel(top)} – {clockLabel(bottom)}
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

          {nowY !== null && nowMinutes !== null && (
            <div
              // Never intercepts a drag: this is a readout, not a target.
              className="pointer-events-none absolute inset-x-0 z-30"
              style={{ top: nowY }}
              aria-hidden="true"
            >
              {/* Exactly the box the blocks are laid out in — `left-11 right-2`
                  — so the rule crosses every entry it is meant to be read
                  against. `inset-x-11` mirrored the gutter onto the right and
                  stopped the line 44px short of the last block, which read as a
                  tick that had failed to draw rather than as now. */}
              <div className="absolute left-11 right-2 h-px bg-[#c8553d]" />
              {/* An origin for the line, so it does not read as a hairline border. */}
              <div className="absolute left-[42px] top-[-2.5px] h-[5px] w-[5px] rounded-full bg-[#c8553d]" />
              {/* On the hour numbers' own left edge rather than against the
                  frame: the readout sits in their column and should share it. */}
              <span className="absolute left-2 top-[-6px] text-[10px] leading-none text-[#c8553d]">
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
