'use client';

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';
import { groupOverrides, useCalendar } from '@/lib/store/calendar-store';
import { addDays, diffDays, parts, startOfWeek, todayIn, type CivilDate } from '@/lib/tempo/civil';
import { layoutWeek } from '@/lib/tempo/layout';
import { expandAll } from '@/lib/tempo/recurrence';
import type { Occurrence } from '@/lib/tempo/types';
import { DragGhost } from './EventBar';
import { WeekRow } from './WeekRow';
import {
  DEFAULT_CATEGORY_COLOR,
  GUTTER_W,
  LANE_BUDGET,
  MONTHS_LONG,
  ROW_H,
  TODAY_OFFSET,
  TOTAL_H,
  WEEKDAYS,
  WEEKS_BEFORE,
  WEEK_COUNT,
} from './constants';

/** Expansion window, in weeks, quantised so scrolling doesn't re-expand every row. */
const BUCKET = 8;
const PAD_BEFORE = 8;
const PAD_AFTER = 24;

/** Scrolling is owned here, so the app chrome above drives it through this. */
export interface CalendarHandle {
  jumpToToday: () => void;
  jumpTo: (date: CivilDate) => void;
}

interface Props {
  onOpenOccurrence: (occ: Occurrence) => void;
  onOpenDay: (date: CivilDate) => void;
  onNewOnDay: (date: CivilDate) => void;
  selectedDay: CivilDate | null;
  /** Where a draft entry would land. Drawn dashed; never affects layout. */
  ghost?: { start: CivilDate; end: CivilDate } | null;
  /**
   * The viewport band the ghost occupies, so the entry modal's scrim can leave
   * it undimmed. `null` when there is no ghost or it is scrolled out of view.
   */
  onGhostBand?: (band: { top: number; bottom: number } | null) => void;
  ref?: Ref<CalendarHandle>;
}

export function ContinuousCalendar({
  onOpenOccurrence,
  onOpenDay,
  onNewOnDay,
  selectedDay,
  ghost,
  onGhostBand,
  ref,
}: Props) {
  const events = useCalendar((s) => s.events);
  const overrides = useCalendar((s) => s.overrides);
  const categories = useCalendar((s) => s.categories);
  const timezone = useCalendar((s) => s.timezone);
  const moveOccurrence = useCalendar((s) => s.moveOccurrence);
  const resizeOccurrence = useCalendar((s) => s.resizeOccurrence);

  const today = useMemo(() => todayIn(timezone), [timezone]);
  const epochStart = useMemo(
    () => addDays(startOfWeek(today), -WEEKS_BEFORE * 7),
    [today],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [colWidth, setColWidth] = useState(120);
  const [viewportH, setViewportH] = useState(0);
  const [dragging, setDragging] = useState<Occurrence | null>(null);
  const grabDate = useRef<CivilDate | null>(null);
  const seriesMode = useRef(false);

  const virtualizer = useVirtualizer({
    count: WEEK_COUNT,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 4,
    initialOffset: TODAY_OFFSET,
  });

  // Rows are a fixed height, so landing on today is exact arithmetic rather
  // than a measured scroll that settles visibly after paint. The retry covers
  // the case where the container still has no layout on the first pass.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = TODAY_OFFSET;
    if (el.scrollTop !== TODAY_OFFSET) {
      requestAnimationFrame(() => {
        el.scrollTop = TODAY_OFFSET;
      });
    }
  }, []);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setColWidth(entry.contentRect.width / 7));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setViewportH(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Shift held at drop time means "rewrite the series", not "move this one".
  useEffect(() => {
    const set = (e: KeyboardEvent) => {
      seriesMode.current = e.shiftKey;
    };
    window.addEventListener('keydown', set);
    window.addEventListener('keyup', set);
    return () => {
      window.removeEventListener('keydown', set);
      window.removeEventListener('keyup', set);
    };
  }, []);

  const items = virtualizer.getVirtualItems();

  // Derived from the scroll offset, not from the rendered items: those include
  // overscan, which would make the readout claim a month you can't see.
  const clampIndex = (n: number) => Math.min(WEEK_COUNT - 1, Math.max(0, n));
  const scrollOffset = virtualizer.scrollOffset ?? TODAY_OFFSET;
  const topIndex = clampIndex(Math.floor(scrollOffset / ROW_H));
  const bottomIndex = clampIndex(
    Math.floor((scrollOffset + Math.max(viewportH, ROW_H) - 1) / ROW_H),
  );
  const bucket = Math.floor(topIndex / BUCKET) * BUCKET;

  const rangeFrom = useMemo(
    () => addDays(epochStart, (bucket - PAD_BEFORE) * 7),
    [epochStart, bucket],
  );
  const rangeTo = useMemo(
    () => addDays(epochStart, (bucket + PAD_AFTER) * 7 + 6),
    [epochStart, bucket],
  );

  const occurrences = useMemo(
    () => expandAll(events, groupOverrides(overrides), rangeFrom, rangeTo),
    [events, overrides, rangeFrom, rangeTo],
  );

  /** Occurrences bucketed by the week rows they touch. */
  const byWeek = useMemo(() => {
    const map = new Map<number, Occurrence[]>();
    for (const occ of occurrences) {
      const from = Math.floor(diffDays(occ.date, epochStart) / 7);
      const to = Math.floor(diffDays(occ.endDate, epochStart) / 7);
      for (let w = from; w <= to; w++) {
        const list = map.get(w);
        if (list) list.push(occ);
        else map.set(w, [occ]);
      }
    }
    return map;
  }, [occurrences, epochStart]);

  const colorFor = useCallback(
    (categoryId: string | null) =>
      categories.find((c) => c.id === categoryId)?.color ?? DEFAULT_CATEGORY_COLOR,
    [categories],
  );

  const sensors = useSensors(
    // A few pixels of slop so a click on a bar still reads as a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function handleDragStart(e: DragStartEvent) {
    const occ = e.active.data.current?.occurrence as Occurrence | undefined;
    setDragging(occ ?? null);

    // Which day of a multi-day bar was actually grabbed. The day cell sits
    // behind the bar, so the whole hit stack has to be inspected.
    const pointer = e.activatorEvent as PointerEvent;
    const stack = document.elementsFromPoint(pointer.clientX, pointer.clientY);
    const cell = stack.find((el) => el.hasAttribute('data-date'));
    grabDate.current = cell?.getAttribute('data-date') ?? null;
  }

  function handleDragEnd(e: DragEndEvent) {
    const occ = e.active.data.current?.occurrence as Occurrence | undefined;
    const dropDate = e.over?.id as CivilDate | undefined;
    setDragging(null);
    if (!occ || !dropDate) return;

    const delta = diffDays(dropDate, grabDate.current ?? occ.date);
    if (delta !== 0) {
      moveOccurrence(occ, delta, seriesMode.current ? 'series' : 'occurrence');
    }
  }

  const jumpToToday = useCallback(() => {
    scrollRef.current?.scrollTo({ top: TODAY_OFFSET, behavior: 'smooth' });
  }, []);

  // Fixed row height again: the target week is arithmetic, not a search.
  const jumpTo = useCallback(
    (date: CivilDate) => {
      const week = Math.floor(diffDays(startOfWeek(date), epochStart) / 7);
      const top = Math.min(TOTAL_H - ROW_H, Math.max(0, week * ROW_H));
      scrollRef.current?.scrollTo({ top, behavior: 'smooth' });
    },
    [epochStart],
  );

  useImperativeHandle(ref, () => ({ jumpToToday, jumpTo }), [jumpToToday, jumpTo]);

  /**
   * Where the ghost sits on screen, in viewport pixels.
   *
   * Arithmetic, not measurement. Every row is exactly `ROW_H` tall, so the top
   * of week *n* is `n * ROW_H` into the scrolled content and no row has to be
   * found in the DOM — which matters because the rows that matter here are
   * virtualised and the ones off screen do not exist to be measured. This is
   * the same identity `jumpTo` and the ruler are built on.
   *
   * Reported through a callback and only when it actually changes: the consumer
   * stores it in state, so echoing an equal value back every render would spin.
   */
  const lastBand = useRef<string>('');
  useEffect(() => {
    if (!onGhostBand) return;

    const el = scrollRef.current;
    let band: { top: number; bottom: number } | null = null;

    if (ghost && el) {
      const gridTop = el.getBoundingClientRect().top;
      const firstWeek = Math.floor(diffDays(startOfWeek(ghost.start), epochStart) / 7);
      const lastWeek = Math.floor(diffDays(startOfWeek(ghost.end), epochStart) / 7);
      const top = gridTop + firstWeek * ROW_H - scrollOffset;
      const bottom = gridTop + (lastWeek + 1) * ROW_H - scrollOffset;

      // Fully above or below the scroll viewport: there is nothing to keep lit,
      // and a band clamped to a zero-height sliver at the edge would read as a
      // rendering fault rather than as "your draft is somewhere else".
      const visibleTop = Math.max(top, gridTop);
      const visibleBottom = Math.min(bottom, gridTop + el.clientHeight);
      if (visibleBottom > visibleTop) band = { top: visibleTop, bottom: visibleBottom };
    }

    const key = band ? `${band.top}:${band.bottom}` : '';
    if (key === lastBand.current) return;
    lastBand.current = key;
    onGhostBand(band);
  }, [ghost, scrollOffset, epochStart, onGhostBand]);

  // Which month the viewport is currently sitting in. There is no "current
  // page" here, so the readout is derived from what you can actually see.
  const topWeek = addDays(epochStart, topIndex * 7);
  const lastVisible = addDays(epochStart, bottomIndex * 7 + 6);
  const head = parts(addDays(topWeek, 3));
  const tail = parts(lastVisible);
  const spansMonths = head.month !== tail.month || head.year !== tail.year;

  return (
    <div className="flex h-full flex-col">
      <Header
        month={MONTHS_LONG[head.month - 1]}
        year={head.year}
        nextMonth={spansMonths ? MONTHS_LONG[tail.month - 1] : null}
        onToday={jumpToToday}
      />

      <div className="flex shrink-0 border-b border-hairlit bg-panel">
        <div className="shrink-0" style={{ width: GUTTER_W }} />
        <div ref={gridRef} className="grid flex-1 grid-cols-7">
          {WEEKDAYS.map((d) => (
            <div key={d} className="label border-l border-hair px-1.5 py-2">
              {d}
            </div>
          ))}
        </div>
      </div>

      <DndContext
        sensors={sensors}
        // Must be pointer-based. The default resolves the drop target from the
        // dragged element's rectangle, but the grab date is read from the
        // pointer — mixing the two offsets every drop by wherever you happened
        // to grab the bar. Both ends now measure the same thing.
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div ref={scrollRef} className="relative flex-1 overflow-y-auto overflow-x-hidden">
          <div className="relative w-full" style={{ height: TOTAL_H }}>
            {items.map((item) => {
              const weekStart = addDays(epochStart, item.index * 7);
              const layout = layoutWeek(weekStart, byWeek.get(item.index) ?? [], LANE_BUDGET);
              return (
                <div
                  key={item.key}
                  className="absolute inset-x-0 top-0"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <WeekRow
                    layout={layout}
                    today={today}
                    colWidth={colWidth}
                    colorFor={colorFor}
                    ghost={ghost ?? null}
                    onOpen={onOpenOccurrence}
                    onResize={(occ, delta, edge) =>
                      resizeOccurrence(occ, delta, edge, seriesMode.current ? 'series' : 'occurrence')
                    }
                    onDayOpen={onOpenDay}
                    onDayNew={onNewOnDay}
                    selectedDay={selectedDay}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {dragging && <DragGhost occ={dragging} color={colorFor(dragging.categoryId)} />}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function Header({
  month,
  year,
  nextMonth,
  onToday,
}: {
  month: string;
  year: number;
  nextMonth: string | null;
  onToday: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-4 border-b border-hair px-4 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] tracking-[0.08em] text-ink">{month}</span>
        <span className="text-[11px] tabular-nums text-mute">{year}</span>
        {nextMonth && (
          <span className="label ml-1">→ {nextMonth}</span>
        )}
      </div>
      <button
        onClick={onToday}
        className="label ml-auto border border-hair px-2 py-1 transition-colors hover:border-hairlit hover:text-dim"
      >
        [SPACE] TODAY
      </button>
    </div>
  );
}
