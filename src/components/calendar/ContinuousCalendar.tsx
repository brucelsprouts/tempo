'use client';

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
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
import {
  addDays,
  diffDays,
  maxDate,
  minDate,
  parts,
  startOfWeek,
  todayIn,
  type CivilDate,
} from '@/lib/tempo/civil';
import {
  DAYS_PER_WEEK,
  layoutWeek,
  occurrencesInMarquee,
  type MarqueeRect,
  type WeekLayout,
} from '@/lib/tempo/layout';
import { expandAll } from '@/lib/tempo/recurrence';
import type { Occurrence } from '@/lib/tempo/types';
import { DragGhost } from './EventBar';
import { WeekRow } from './WeekRow';
import { Button } from './ui';
import {
  DAY_HEADER_H,
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

/**
 * Movement before a press becomes a drag. The same figure the `PointerSensor`
 * is given below, so a click on whitespace and a click on a bar have the same
 * tolerance — a hand that is steady enough for one is steady enough for both.
 */
const GESTURE_SLOP = 4;

/**
 * Edge autoscroll, for the two gestures dnd-kit does not run.
 *
 * Without it, "extend this into a week three rows down" still means dragging
 * off the bottom of the screen and hoping, which is half of what was wrong with
 * resize in the first place.
 */
const AUTOSCROLL_EDGE = 40;
const AUTOSCROLL_SPEED = 22;

/** Stable identity for "nothing is selected", so clearing twice re-renders once. */
const NOTHING: ReadonlySet<string> = new Set();

/**
 * The one primitive every grid gesture is built on: where the pointer is, as a
 * date.
 *
 * Move, resize and lasso all need this and all three must work across week
 * rows, so all three ask the same question of the same DOM in the same way.
 * Resize was broken precisely because it measured something else — a pixel
 * delta along X — which is the failure [DESIGN.md §7] records for drop targets.
 * The whole hit stack is inspected because a day cell sits *behind* the bars.
 */
function dateUnderPointer(clientX: number, clientY: number): CivilDate | null {
  const hit = document
    .elementsFromPoint(clientX, clientY)
    .find((el) => el.hasAttribute('data-date'));
  return hit?.getAttribute('data-date') ?? null;
}

/** How fast the grid should scroll itself, given where the pointer is sitting. */
function edgeScroll(el: HTMLElement, clientY: number): number {
  const { top, bottom } = el.getBoundingClientRect();
  const past = clientY - (bottom - AUTOSCROLL_EDGE);
  if (past > 0) return AUTOSCROLL_SPEED * Math.min(1, past / AUTOSCROLL_EDGE);
  const above = top + AUTOSCROLL_EDGE - clientY;
  if (above > 0) return -AUTOSCROLL_SPEED * Math.min(1, above / AUTOSCROLL_EDGE);
  return 0;
}

/**
 * The span a half-finished resize is describing.
 *
 * Inversion is clamped rather than flipped: dragging the end handle above the
 * start pins the bar at one day instead of turning it inside out. The commit
 * reads the same function as the preview, so what lands is what was drawn —
 * clamping in only one of the two would show a one-day bar and then write
 * nothing at all, since the store refuses an inverted span outright.
 */
function resizedSpan(
  occ: Occurrence,
  edge: 'start' | 'end',
  to: CivilDate,
): { date: CivilDate; endDate: CivilDate } {
  return edge === 'end'
    ? { date: occ.date, endDate: maxDate(to, occ.date) }
    : { date: minDate(to, occ.endDate), endDate: occ.endDate };
}

/**
 * A pointer gesture in flight, other than a dnd-kit move.
 *
 * One state for both, because both need the same window listeners and the same
 * autoscroll loop, and because they are mutually exclusive: the press that
 * starts one is a press that cannot have started the other.
 */
type Gesture =
  | { kind: 'resize'; occ: Occurrence; edge: 'start' | 'end' }
  | {
      kind: 'lasso';
      /** The anchor, in content coordinates, so autoscroll cannot move it. */
      origin: { x: number; y: number };
      /** The same press in viewport coordinates, which is where slop is measured. */
      press: { x: number; y: number };
    };

/** Scrolling is owned here, so the app chrome above drives it through this. */
export interface CalendarHandle {
  jumpToToday: () => void;
  jumpTo: (date: CivilDate) => void;
  /**
   * The grid's own Escape layers, innermost first: a pending bulk-delete
   * confirmation, then the selection. Reports whether one was actually there,
   * so the shell — which owns the unwind order — can fall through to whatever
   * Escape means next.
   */
  unwind: () => boolean;
  /** Both report whether there was a selection to act on. */
  deleteSelection: () => boolean;
  moveSelection: (deltaDays: number) => boolean;
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
  const moveOccurrences = useCalendar((s) => s.moveOccurrences);
  const resizeOccurrence = useCalendar((s) => s.resizeOccurrence);
  const deleteEvents = useCalendar((s) => s.deleteEvents);

  const today = useMemo(() => todayIn(timezone), [timezone]);
  const epochStart = useMemo(
    () => addDays(startOfWeek(today), -WEEKS_BEFORE * 7),
    [today],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [colWidth, setColWidth] = useState(120);
  const [viewportH, setViewportH] = useState(0);
  const [drag, setDrag] = useState<{ occ: Occurrence; grab: CivilDate } | null>(null);
  const [dropDate, setDropDate] = useState<CivilDate | null>(null);
  const seriesMode = useRef(false);

  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [resizeTo, setResizeTo] = useState<CivilDate | null>(null);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const [selection, setSelection] = useState<ReadonlySet<string>>(NOTHING);
  const [confirming, setConfirming] = useState<string[] | null>(null);

  /** Live pointer position, so the autoscroll loop can act between moves. */
  const pointer = useRef({ x: 0, y: 0 });
  /** The last resolved date of a resize, read at commit without re-subscribing. */
  const hovered = useRef<CivilDate | null>(null);
  /** Whether a lasso has cleared the slop. Below it, the press is still a click. */
  const armed = useRef(false);

  /**
   * Column width read from the DOM rather than from `colWidth` state.
   *
   * The state is fed by a `ResizeObserver`, which is the right shape for
   * rendering — it re-renders the bars when the window changes — but it is a
   * promise that something already fired. The lasso converts a pixel into a
   * column index, so a stale width does not smudge the result, it selects the
   * wrong entries: at the initial guess of 120 against a real 174, a marquee
   * over three columns resolves to four. Measured live, the gesture cannot
   * disagree with the grid it is drawn on.
   */
  const liveColWidth = useCallback(() => {
    const w = gridRef.current?.getBoundingClientRect().width ?? 0;
    // Falls back to the observed value rather than to zero: a zero divisor
    // would resolve every column index to Infinity and select nothing at all,
    // which is a harder failure to recognise than a slightly wrong width.
    return w > 0 ? w / DAYS_PER_WEEK : colWidth;
  }, [colWidth]);

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

  /**
   * The resize preview, as a post-pass over the expansion.
   *
   * One occurrence is cloned with the span the gesture currently describes, and
   * everything downstream — bucketing, lane assignment, the rows themselves —
   * runs on the altered list without knowing a gesture is in progress. So a bar
   * stretched into next week actually appears in next week's row, laid out
   * against that row's other bars, which is the feedback that was missing.
   *
   * A post-pass rather than a re-expansion: `expandAll` walks every event in the
   * window, and doing that per pointer move to change one date would be paying
   * for the whole calendar to answer a question about a single bar.
   */
  const previewed = useMemo(() => {
    if (!gesture || gesture.kind !== 'resize' || !resizeTo) return occurrences;
    const span = resizedSpan(gesture.occ, gesture.edge, resizeTo);
    if (span.date === gesture.occ.date && span.endDate === gesture.occ.endDate) {
      return occurrences;
    }
    return occurrences.map((o) => (o.key === gesture.occ.key ? { ...o, ...span } : o));
  }, [occurrences, gesture, resizeTo]);

  /** Occurrences bucketed by the week rows they touch. */
  const byWeek = useMemo(() => {
    const map = new Map<number, Occurrence[]>();
    for (const occ of previewed) {
      const from = Math.floor(diffDays(occ.date, epochStart) / 7);
      const to = Math.floor(diffDays(occ.endDate, epochStart) / 7);
      for (let w = from; w <= to; w++) {
        const list = map.get(w);
        if (list) list.push(occ);
        else map.set(w, [occ]);
      }
    }
    return map;
  }, [previewed, epochStart]);

  /**
   * One week's laid-out row, by index — for the rows on screen and for the rows
   * the lasso has to reason about but the virtualiser never mounted.
   */
  const layoutOf = useCallback(
    (weekIndex: number): WeekLayout | null => {
      if (weekIndex < 0 || weekIndex >= WEEK_COUNT) return null;
      return layoutWeek(
        addDays(epochStart, weekIndex * 7),
        byWeek.get(weekIndex) ?? [],
        LANE_BUDGET,
      );
    },
    [epochStart, byWeek],
  );

  const colorFor = useCallback(
    (categoryId: string | null) =>
      categories.find((c) => c.id === categoryId)?.color ?? DEFAULT_CATEGORY_COLOR,
    [categories],
  );

  const selected = useMemo(
    () => occurrences.filter((o) => selection.has(o.key)),
    [occurrences, selection],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: GESTURE_SLOP } }),
  );

  // ------------------------------------------------------------------ moving

  function handleDragStart(e: DragStartEvent) {
    const occ = e.active.data.current?.occurrence as Occurrence | undefined;
    if (!occ) return;
    const pressed = e.activatorEvent as PointerEvent;
    // Which day of a multi-day bar was actually grabbed.
    const grab = dateUnderPointer(pressed.clientX, pressed.clientY) ?? occ.date;
    setDrag({ occ, grab });
  }

  function handleDragOver(e: DragOverEvent) {
    const over = e.over?.id;
    setDropDate(typeof over === 'string' ? over : null);
  }

  function handleDragEnd(e: DragEndEvent) {
    const occ = e.active.data.current?.occurrence as Occurrence | undefined;
    const dropOn = e.over?.id as CivilDate | undefined;
    const grab = drag?.grab ?? occ?.date;
    setDrag(null);
    setDropDate(null);
    if (!occ || !dropOn || !grab) return;

    const delta = diffDays(dropOn, grab);
    if (delta === 0) return;

    const scope = seriesMode.current ? 'series' : 'occurrence';
    // Dragging one lit bar moves every lit bar by the same delta. Dragging an
    // unlit one is a single move and leaves the selection alone — otherwise
    // there would be no way to move one entry out of a group you had selected.
    if (selection.has(occ.key) && selected.length > 1) {
      void moveOccurrences(selected, delta, scope);
    } else {
      void moveOccurrence(occ, delta, scope);
    }
  }

  /**
   * Where the bar under the cursor is headed, drawn in the destination row.
   *
   * The chip under the pointer says *what* is moving; this says *where it will
   * land*, which the chip cannot because it follows the cursor rather than the
   * grid. Both together is what makes a cross-row drag legible.
   */
  const dragGhost = useMemo(() => {
    if (!drag || !dropDate) return null;
    const delta = diffDays(dropDate, drag.grab);
    if (delta === 0) return null;
    return {
      start: addDays(drag.occ.date, delta),
      end: addDays(drag.occ.endDate, delta),
    };
  }, [drag, dropDate]);

  // ------------------------------------------------------- resize and lasso

  const beginResize = useCallback(
    (occ: Occurrence, edge: 'start' | 'end', e: React.PointerEvent) => {
      // Keeps dnd-kit from reading the press as the beginning of a move.
      e.stopPropagation();
      e.preventDefault();
      pointer.current = { x: e.clientX, y: e.clientY };
      hovered.current = null;
      setResizeTo(null);
      setGesture({ kind: 'resize', occ, edge });
    },
    [],
  );

  /** Content coordinates: x from the first column's left edge, y from week 0. */
  const contentPoint = useCallback((clientX: number, clientY: number) => {
    const el = scrollRef.current;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return { x: clientX - box.left - GUTTER_W, y: clientY - box.top + el.scrollTop };
  }, []);

  function handleGridPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || gesture) return;

    const target = e.target as HTMLElement;
    // The hover `+`, the "+N" chip — anything with its own answer to a click.
    if (target.closest('button')) return;
    // Whitespace only. A bar lives in the overlay beside the cells rather than
    // inside one, so this is also what hands a press on a bar to dnd-kit.
    if (!target.closest('[data-date]')) return;

    const origin = contentPoint(e.clientX, e.clientY);
    if (!origin) return;

    pointer.current = { x: e.clientX, y: e.clientY };
    armed.current = false;
    setGesture({ kind: 'lasso', origin, press: { x: e.clientX, y: e.clientY } });
  }

  /**
   * Everything a gesture needs from the window, in one subscription.
   *
   * Re-bound whenever the layout it reads from changes, so a marquee always
   * hit-tests against the rows as they are now rather than as they were when
   * the press landed — which matters because autoscrolling far enough moves the
   * expansion window underneath it.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!gesture || !el) return;

    const apply = () => {
      const { x, y } = pointer.current;

      if (gesture.kind === 'resize') {
        const date = dateUnderPointer(x, y);
        if (!date) return;
        hovered.current = date;
        setResizeTo(date);
        return;
      }

      if (
        !armed.current &&
        Math.abs(x - gesture.press.x) < GESTURE_SLOP &&
        Math.abs(y - gesture.press.y) < GESTURE_SLOP
      ) {
        return;
      }
      armed.current = true;

      const at = contentPoint(x, y);
      if (!at) return;
      const rect = { x0: gesture.origin.x, y0: gesture.origin.y, x1: at.x, y1: at.y };
      setMarquee(rect);
      setSelection(
        occurrencesInMarquee(rect, layoutOf, {
          colWidth: liveColWidth(),
          rowH: ROW_H,
          headerH: DAY_HEADER_H,
        }),
      );
    };

    const move = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      apply();
    };

    // The pointer can sit still against the edge and still be asking for more
    // rows, so the scroll is driven by a frame loop rather than by movement.
    let frame = requestAnimationFrame(function tick() {
      frame = requestAnimationFrame(tick);
      const delta = edgeScroll(el, pointer.current.y);
      if (delta === 0) return;
      const before = el.scrollTop;
      el.scrollTop += delta;
      if (el.scrollTop !== before) apply();
    });

    const finish = () => {
      setGesture(null);

      if (gesture.kind === 'resize') {
        setResizeTo(null);
        const to = hovered.current;
        if (!to) return;
        const span = resizedSpan(gesture.occ, gesture.edge, to);
        const delta =
          gesture.edge === 'start'
            ? diffDays(span.date, gesture.occ.date)
            : diffDays(span.endDate, gesture.occ.endDate);
        if (delta !== 0) {
          void resizeOccurrence(
            gesture.occ,
            delta,
            gesture.edge,
            seriesMode.current ? 'series' : 'occurrence',
          );
        }
        return;
      }

      setMarquee(null);
      // Below the slop the gesture was a click, and a click on empty grid
      // creates nothing — it drops the selection. Creating is the day header's
      // `+`, the `N` key and `+ NEW`, and nothing else; whitespace that made
      // entries would fight the lasso for the same press.
      if (!armed.current) setSelection(NOTHING);
      armed.current = false;
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [gesture, layoutOf, liveColWidth, contentPoint, resizeOccurrence]);

  // --------------------------------------------------------- what a selection does

  const toggleSelect = useCallback((occ: Occurrence) => {
    // Google-sourced instances refuse every edit a selection can apply.
    if (occ.readOnly) return;
    setSelection((s) => {
      const next = new Set(s);
      if (!next.delete(occ.key)) next.add(occ.key);
      return next.size === 0 ? NOTHING : next;
    });
  }, []);

  const unwind = useCallback(() => {
    if (confirming) {
      setConfirming(null);
      return true;
    }
    if (selection.size === 0) return false;
    setSelection(NOTHING);
    return true;
  }, [confirming, selection]);

  const deleteSelection = useCallback(() => {
    const ids = [...new Set(selected.map((o) => o.eventId))];
    if (ids.length === 0) return false;

    // One is a mistake you can see; several is a mistake you cannot reconstruct.
    // A move is undone by dragging back, a bulk delete by nothing at all.
    if (ids.length > 1) {
      setConfirming(ids);
      return true;
    }
    setSelection(NOTHING);
    void deleteEvents(ids);
    return true;
  }, [selected, deleteEvents]);

  const moveSelection = useCallback(
    (deltaDays: number) => {
      if (selected.length === 0) return false;
      const scope = seriesMode.current ? 'series' : 'occurrence';
      void moveOccurrences(selected, deltaDays, scope);

      // Follow the entries to where they just went. A key is
      // `${eventId}:${seriesDate}`, and a series rewrite takes the series date
      // with it — without this, holding → moves each entry exactly one day and
      // then loses sight of it.
      setSelection(
        new Set(
          selected.map((o) =>
            scope === 'series' || !o.event.recurrence
              ? `${o.eventId}:${addDays(o.seriesDate, deltaDays)}`
              : o.key,
          ),
        ),
      );
      return true;
    },
    [selected, moveOccurrences],
  );

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

  useImperativeHandle(
    ref,
    () => ({ jumpToToday, jumpTo, unwind, deleteSelection, moveSelection }),
    [jumpToToday, jumpTo, unwind, deleteSelection, moveSelection],
  );

  /**
   * Where the ghost sits on screen, in viewport pixels.
   *
   * Arithmetic, not measurement. Every row is exactly `ROW_H` tall, so the top
   * of week *n* is `n * ROW_H` into the scrolled content and no row has to be
   * found in the DOM — which matters because the rows that matter here are
   * virtualised and the ones off screen do not exist to be measured. This is
   * the same identity `jumpTo` and the lasso's hit test are built on.
   *
   * Reads the prop rather than the drag ghost beside it: this exists to keep
   * the entry modal's scrim off a draft, and there is no modal open mid-drag.
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
    <div className="relative flex h-full flex-col">
      <Header
        month={MONTHS_LONG[head.month - 1]}
        year={head.year}
        nextMonth={spansMonths ? MONTHS_LONG[tail.month - 1] : null}
        onToday={jumpToToday}
      />

      <div className="flex shrink-0 border-b border-hairlit bg-panel">
        <div className="shrink-0" style={{ width: GUTTER_W }} />
        {/* Exactly as wide as the week rows' column box, which is what makes
            `colWidth` — this element's `contentRect` divided by seven — the
            same number the bars are laid out in percentages of. Neither box
            carries a margin now; the clearance on the Saturday edge is the
            bars' own side inset. */}
        <div ref={gridRef} className="grid flex-1 grid-cols-7">
          {WEEKDAYS.map((d, i) => (
            <div
              key={d}
              className={[
                'label border-l border-hair px-1.5 py-2',
                // Sunday and Saturday keep `.label`'s weight while the five
                // weekdays lift, so the header marks the same two columns the
                // weekend bands mark in the grid below.
                i === 0 || i === 6 ? '' : 'label-lit',
              ].join(' ')}
            >
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
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setDrag(null);
          setDropDate(null);
        }}
      >
        <div
          ref={scrollRef}
          onPointerDown={handleGridPointerDown}
          className="relative flex-1 overflow-y-auto overflow-x-hidden"
        >
          <div className="relative w-full" style={{ height: TOTAL_H }}>
            {items.map((item) => {
              const layout = layoutOf(item.index);
              if (!layout) return null;
              return (
                <div
                  key={item.key}
                  className="absolute inset-x-0 top-0"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <WeekRow
                    layout={layout}
                    weekIndex={item.index}
                    today={today}
                    colorFor={colorFor}
                    ghost={dragGhost ?? ghost ?? null}
                    selection={selection}
                    onOpen={onOpenOccurrence}
                    onToggleSelect={toggleSelect}
                    onResizeStart={beginResize}
                    onDayOpen={onOpenDay}
                    onDayNew={onNewOnDay}
                    selectedDay={selectedDay}
                  />
                </div>
              );
            })}

            {/* Drawn in the same content coordinates it is hit-tested in, so
                what it covers and what it selects cannot disagree. */}
            {marquee && (
              <div
                aria-hidden
                className="pointer-events-none absolute border border-dim bg-dim/10"
                style={{
                  left: GUTTER_W + Math.min(marquee.x0, marquee.x1),
                  top: Math.min(marquee.y0, marquee.y1),
                  width: Math.abs(marquee.x1 - marquee.x0),
                  height: Math.abs(marquee.y1 - marquee.y0),
                }}
              />
            )}
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {drag && <DragGhost occ={drag.occ} color={colorFor(drag.occ.categoryId)} />}
        </DragOverlay>
      </DndContext>

      {/* Inline, the way the category delete asks, rather than as a fourth
          overlay: the thing being confirmed is still lit on the grid behind it,
          and a scrim would dim the only answer to "which ones". */}
      {confirming && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-3 border border-hairlit bg-panel px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.7)]">
            <span className="text-[11px] text-dim">
              Delete {confirming.length} entries?
            </span>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                const ids = confirming;
                setConfirming(null);
                setSelection(NOTHING);
                void deleteEvents(ids);
              }}
            >
              DELETE
            </Button>
            <Button type="button" variant="quiet" onClick={() => setConfirming(null)}>
              KEEP
            </Button>
          </div>
        </div>
      )}
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
