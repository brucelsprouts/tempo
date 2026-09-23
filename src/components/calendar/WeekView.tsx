'use client';

import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type Ref,
} from 'react';
import { groupOverrides, useCalendar } from '@/lib/store/calendar-store';
import {
  getServerZoomSnapshot,
  getZoomSnapshot,
  setZoom,
  subscribeZoom,
} from '@/lib/store/day-zoom';
import { dayOfWeek, minutesInZone, parts, todayIn, type CivilDate } from '@/lib/tempo/civil';
import { expandAll } from '@/lib/tempo/recurrence';
import type { Category, Occurrence } from '@/lib/tempo/types';
import { CategoryChip } from './CategoryChip';
import { MONTHS, WEEKDAYS } from './constants';
import { dayDue } from './due';
import { barColors } from './tint';
import {
  daySegment,
  labelEvery,
  placeSegments,
  resolveHourHeight,
  showsHalfHours,
  zoomIn,
  zoomOut,
  type DaySegment,
} from './timeline';
import { shiftWeek, weekDays } from './week';

/**
 * Seven days at once, with hours down the side.
 *
 * This is where the timetable lives. The continuous grid draws week rows as
 * thin bands with lane packing, and a term of lectures is ten or more entries a
 * week — enough to squeeze out the assignment the calendar was opened for. A
 * seven-column grid has room down every one of them and holds the same ten
 * comfortably. That asymmetry is the whole reason this view exists: the entries
 * did not need filtering, they needed a surface with room.
 *
 * So it reads the store's events **unfiltered**, deliberately. A timetable-only
 * grid would show a free Tuesday evening that has a gym session in it, which is
 * a worse lie than clutter.
 *
 * Dated rather than an idealised "typical week", because a pattern cannot show
 * reading week, a term that has ended, or a single class cancelled or moved —
 * all of which the existing override machinery already gets right, for free, as
 * long as the view asks about real dates.
 *
 * Reuses `timeline.ts` wholesale. `DayView` is one column of this, and the pure
 * helpers that place and stack blocks inside a day never cared how many days
 * were beside them.
 */

export interface WeekHandle {
  /** Page by `n` weeks. Negative goes back. */
  step: (n: number) => void;
  jumpToToday: () => void;
}

interface Props {
  ref?: Ref<WeekHandle>;
  onOpen: (occ: Occurrence) => void;
  onNew: (date: CivilDate, startMinutes?: number) => void;
  onOpenDay: (date: CivilDate) => void;
}

/** The gutter the hour labels sit in. Matches `DayView`'s. */
const GUTTER = 44;

export function WeekView({ ref, onOpen, onNew, onOpenDay }: Props) {
  // Unfiltered on purpose. See the note above.
  const events = useCalendar((s) => s.events);
  const overrides = useCalendar((s) => s.overrides);
  const categories = useCalendar((s) => s.categories);
  const timezone = useCalendar((s) => s.timezone);

  const today = todayIn(timezone);
  const [anchor, setAnchor] = useState<CivilDate>(() => shiftWeek(today, 0));
  const days = useMemo(() => weekDays(anchor), [anchor]);

  const gridRef = useRef<HTMLDivElement>(null);
  const [paneHeight, setPaneHeight] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const zoom = useSyncExternalStore(subscribeZoom, getZoomSnapshot, getServerZoomSnapshot);
  const nowMinutes = useNowMinutes(timezone);

  useImperativeHandle(
    ref,
    () => ({
      step: (n: number) => setAnchor((a) => shiftWeek(a, n)),
      jumpToToday: () => setAnchor(shiftWeek(today, 0)),
    }),
    [today],
  );

  const occurrences = useMemo(
    () => expandAll(events, groupOverrides(overrides), days[0], days[6]),
    [events, overrides, days],
  );

  const categoryFor = (id: string | null): Category | null =>
    categories.find((c) => c.id === id) ?? null;

  /**
   * Every entry of the week, sorted into its own day.
   *
   * Stacking is per column: two entries overlap only if they overlap on the
   * same day, so `placeSegments` runs seven times rather than once over the
   * whole week. A single pass would put a Monday 09:00 lecture in a lane
   * because a Thursday 09:00 one exists.
   */
  const columns = useMemo(
    () =>
      days.map((date) => {
        const segments = occurrences
          .map((occ) => ({ occ, segment: daySegment(occ, date) }))
          .filter((s): s is { occ: Occurrence; segment: DaySegment } => s.segment !== null);
        const byKey = new Map(segments.map((s) => [s.occ.key, s.occ]));
        return {
          date,
          // A multi-day all-day entry marks every day it covers, the way it
          // marks every square in the year view.
          bars: occurrences.filter((o) => o.allDay && date >= o.date && date <= o.endDate),
          placed: placeSegments(
            segments.map((s) => ({ key: s.occ.key, segment: s.segment })),
          ).map((p) => ({ ...p, occ: byKey.get(p.key)! })),
        };
      }),
    [days, occurrences],
  );

  const anyBars = columns.some((c) => c.bars.length > 0);

  /** FIT has to know how tall the grid is, and flexbox is what decides that. */
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
  const nowY = days.includes(today) && nowMinutes !== null ? (nowMinutes / 60) * hourHeight : null;

  /**
   * Opens on the earliest entry of the week, or on the working morning when
   * there is none. A timetable starting at 08:30 should not need a scroll to be
   * seen, and a fixed 07:00 was wrong for exactly the weeks worth opening.
   *
   * Keyed on the week rather than run once, so paging to a week that starts
   * earlier scrolls to meet it — but only once per week, so it does not fight
   * the scrollbar afterwards.
   */
  const opened = useRef<CivilDate | null>(null);
  useEffect(() => {
    const el = gridRef.current;
    if (!el || hourHeight === 0 || opened.current === anchor) return;
    opened.current = anchor;
    const first = columns.reduce<number | null>(
      (min, c) =>
        c.placed.reduce((m, p) => (m === null || p.segment.top < m ? p.segment.top : m), min),
      null,
    );
    el.scrollTop = Math.max(0, ((first ?? 8 * 60) / 60) * hourHeight - 24);
  }, [anchor, columns, hourHeight]);

  /**
   * ⌘/Ctrl-wheel — and a trackpad pinch, which sends the same thing — changes
   * the scale rather than the page's. A native, non-passive listener because
   * React registers `wheel` on the root as passive, so `preventDefault` there
   * is ignored and the browser zooms the page out from under the gesture.
   */
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(e.deltaY < 0 ? zoomIn(zoom, paneHeight) : zoomOut(zoom, paneHeight));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, paneHeight]);

  const first = parts(days[0]);
  const last = parts(days[6]);
  const span =
    first.month === last.month
      ? `${MONTHS[first.month - 1]} ${first.day}–${last.day}`
      : `${MONTHS[first.month - 1]} ${first.day} – ${MONTHS[last.month - 1]} ${last.day}`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-hair px-3 py-2">
        <button
          onClick={() => setAnchor((a) => shiftWeek(a, -1))}
          aria-label="Previous week"
          className="tap label border border-hair px-2 py-1 transition-colors hover:border-hairlit hover:text-ink"
        >
          ←
        </button>
        <button
          onClick={() => setAnchor((a) => shiftWeek(a, 1))}
          aria-label="Next week"
          className="tap label border border-hair px-2 py-1 transition-colors hover:border-hairlit hover:text-ink"
        >
          →
        </button>
        <span className="label ml-1 text-bright">{span}</span>
        <span className="label text-mute">{first.year}</span>
        {/* Only when it would do something. On this week it is a button that
            says where you already are. */}
        {!days.includes(today) && (
          <button
            onClick={() => setAnchor(shiftWeek(today, 0))}
            className="tap label ml-auto border border-hair px-2 py-1 transition-colors hover:border-hairlit hover:text-ink"
          >
            THIS WEEK
          </button>
        )}
      </div>

      {/* The weekday header and the all-day strip under it. Both are laid out on
          the same seven-column track as the grid below, each opening with a
          spacer the width of the hour gutter, so Wednesday lines up with
          Wednesday. */}
      <div className="shrink-0 border-b border-hair">
        <div className="flex">
          <div className="shrink-0" style={{ width: GUTTER }} />
          {days.map((date) => {
            const isToday = date === today;
            return (
              <button
                key={date}
                onClick={() => onOpenDay(date)}
                className={[
                  'tap min-w-0 flex-1 border-l border-hair px-1 py-1.5 text-center transition-colors hover:bg-sunken',
                  // Inversion and weight, not an accent: category colour is the
                  // only hue on screen and has to stay the only one that means
                  // something.
                  isToday ? 'bg-raised' : '',
                ].join(' ')}
              >
                <div className="label">{WEEKDAYS[dayOfWeek(date)]}</div>
                <div
                  className={[
                    'mt-0.5 text-[12px] leading-none tabular-nums',
                    isToday ? 'text-bright' : 'text-dim',
                  ].join(' ')}
                >
                  {parts(date).day}
                </div>
              </button>
            );
          })}
        </div>

        {anyBars && (
          <div
            className={[
              'flex border-t border-hair',
              scrolled ? 'shadow-[0_4px_8px_-4px_rgba(0,0,0,0.6)]' : '',
            ].join(' ')}
          >
            <div className="label shrink-0 px-2 py-1.5 leading-none" style={{ width: GUTTER }}>
              ALL
            </div>
            {columns.map(({ date, bars }) => (
              <div key={date} className="min-w-0 flex-1 space-y-0.5 border-l border-hair p-1">
                {bars.map((occ) => {
                  const category = categoryFor(occ.categoryId);
                  const colors = barColors(category?.color ?? null);
                  const due = dayDue(occ, date);
                  return (
                    <button
                      key={occ.key}
                      onClick={() => onOpen(occ)}
                      // The column is a seventh of the screen wide, so the due
                      // time that `DayView` prints beside the title lives in the
                      // tooltip here rather than being truncated into nothing.
                      title={due ? `${occ.title} · ${due}` : occ.title}
                      style={
                        {
                          background: colors.fill,
                          color: colors.ink,
                          borderLeft: `3px solid ${colors.edge}`,
                          '--cat': colors.edge,
                        } as CSSProperties
                      }
                      className="tint-hover block w-full truncate px-1 py-0.5 text-left text-[10px] leading-tight"
                    >
                      {occ.title}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        ref={gridRef}
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}
        className="relative flex-1 overflow-y-auto"
      >
        <div className="relative flex" style={{ height: 24 * hourHeight }}>
          {/* One hour gutter for all seven columns. */}
          <div className="relative shrink-0" style={{ width: GUTTER }}>
            {Array.from({ length: 24 }, (_, h) =>
              h % everyNth === 0 ? (
                <span key={h} className="label absolute left-2" style={{ top: h * hourHeight + 2 }}>
                  {String(h).padStart(2, '0')}
                </span>
              ) : null,
            )}
          </div>

          {columns.map(({ date, placed }) => (
            <div key={date} className="relative min-w-0 flex-1 border-l border-hair">
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  onClick={() => onNew(date, h * 60)}
                  className="absolute inset-x-0 cursor-copy border-t border-hair transition-colors hover:bg-panel"
                  style={{ top: h * hourHeight, height: hourHeight }}
                >
                  {halfHours && (
                    <div
                      className="pointer-events-none absolute inset-x-0 border-t border-hair/40"
                      style={{ top: hourHeight / 2 }}
                    />
                  )}
                </div>
              ))}

              {date === today && nowY !== null && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-10 border-t border-ink"
                  style={{ top: nowY }}
                />
              )}

              <div className="absolute inset-y-0 left-0 right-0.5">
                {placed.map(({ key, occ, segment, lane, of }) => {
                  const category = categoryFor(occ.categoryId);
                  const colors = barColors(category?.color ?? null);
                  const height = Math.max(14, ((segment.bottom - segment.top) / 60) * hourHeight - 2);
                  return (
                    <button
                      key={key}
                      onClick={() => onOpen(occ)}
                      title={`${occ.title} · ${clockLabel(segment.top)}`}
                      style={
                        {
                          position: 'absolute',
                          top: (segment.top / 60) * hourHeight,
                          height,
                          left: `${(lane / of) * 100}%`,
                          width: `calc(${100 / of}% - 2px)`,
                          background: colors.fill,
                          color: colors.ink,
                          borderLeft: `3px solid ${colors.edge}`,
                          '--cat': colors.edge,
                        } as CSSProperties
                      }
                      className={[
                        'tint-hover overflow-hidden border-hair px-1 py-0.5 text-left text-[10px]',
                        // A cut edge gets no border: a block ending flush at the
                        // bottom of the column would otherwise be
                        // indistinguishable from one that ends at midnight.
                        segment.continuesBefore ? '' : 'border-t',
                        segment.continuesAfter ? '' : 'border-b',
                      ].join(' ')}
                    >
                      {/* Two densities, where `DayView` affords itself three. A
                          column a seventh of the screen wide has no room for
                          the middle one. */}
                      {height >= 34 ? (
                        <>
                          <div className="truncate leading-tight">{occ.title}</div>
                          <div className="label mt-0.5 leading-none" style={{ color: colors.soft }}>
                            {clockLabel(segment.top)}
                          </div>
                          {height >= 56 && category && (
                            <div className="mt-1 flex min-w-0">
                              <CategoryChip category={category} />
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="truncate leading-tight">{occ.title}</div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function clockLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  return `${String(h).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * The clock, to the minute, or null until the first tick after mount.
 *
 * Null on the server and on the first client render deliberately: a now-rule
 * drawn during hydration is a mismatch waiting to happen.
 */
function useNowMinutes(timezone: string): number | null {
  const [minutes, setMinutes] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setMinutes(minutesInZone(new Date(), timezone));
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [timezone]);
  return minutes;
}
