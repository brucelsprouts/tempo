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
  LAST_MINUTE_OF_DAY,
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
import { expandAll, eventSpan } from '@/lib/tempo/recurrence';
import type { Occurrence, TempoEvent } from '@/lib/tempo/types';
import { getClipboard, setClipboard } from '@/lib/store/clipboard';
import { DragGhost } from './EventBar';
import type { DraftPreview } from './EventForm';
import { WeekRow, type GhostBand } from './WeekRow';
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

/** Same reason, for the rows: `WeekRow` is memoised on its props. */
const EMPTY_GHOSTS: readonly GhostBand[] = [];

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
 * start pins the bar at its shortest instead of turning it inside out. The
 * commit reads the same function as the preview, so what lands is what was
 * drawn — clamping in only one of the two would show a short bar and then write
 * nothing at all, since the store refuses an inverted span outright.
 *
 * Shortest is one day for nearly everything. Collapsed onto one date the store
 * moves the dragged edge to that date's own boundary — the trailing one to
 * 23:59, the leading one to 00:00 — so an 18:00-to-midnight evening does fit on
 * a single day once its end gives up midnight. What does not fit is what that
 * clamp would leave with no length at all: an entry ending at exactly midnight
 * occupies none of the date it ends on, and one starting at 23:59 has no room
 * left on the date it starts. Those keep a two-day floor, because the drop
 * would decline them.
 */
function resizedSpan(
  occ: Occurrence,
  edge: 'start' | 'end',
  to: CivilDate,
): { date: CivilDate; endDate: CivilDate } {
  const start = occ.startMinutes ?? 0;
  const end = occ.endMinutes ?? 0;
  const fitsOnOneDay =
    occ.allDay ||
    (edge === 'end'
      ? (end < start ? LAST_MINUTE_OF_DAY : end) > start
      : end > (end < start ? 0 : start));
  const floor = fitsOnOneDay ? 0 : 1;
  return edge === 'end'
    ? { date: occ.date, endDate: maxDate(to, addDays(occ.date, floor)) }
    : { date: minDate(to, addDays(occ.endDate, -floor)), endDate: occ.endDate };
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
   * The grid's own Escape layer: the selection. Reports whether there was one
   * to clear, so the shell — which owns the unwind order — can fall through to
   * whatever Escape means next.
   */
  unwind: () => boolean;
  /** Both report whether there was a selection to act on. */
  deleteSelection: () => boolean;
  moveSelection: (deltaDays: number) => boolean;
  /** Reports how many entries it took, so the shell can say so. */
  copySelection: () => number;
  /**
   * Copy in place, and paste what ⌘C is holding.
   *
   * Both report whether they had anything to work with, so an empty selection
   * or an empty clipboard leaves the keypress to the browser rather than
   * swallowing it silently.
   */
  duplicateSelection: () => boolean;
  pasteClipboard: () => boolean;
}

interface Props {
  onOpenOccurrence: (occ: Occurrence) => void;
  onOpenDay: (date: CivilDate) => void;
  onNewOnDay: (date: CivilDate) => void;
  selectedDay: CivilDate | null;
  /**
   * The entry being written in the form, drawn where it will land and reading
   * what it will say. A real-looking bar rather than an outline: it is the
   * entry, a few seconds early. Never affects layout.
   */
  draft?: DraftPreview | null;
  ref?: Ref<CalendarHandle>;
}

export function ContinuousCalendar({
  onOpenOccurrence,
  onOpenDay,
  onNewOnDay,
  selectedDay,
  draft,
  ref,
}: Props) {
  const events = useCalendar((s) => s.events);
  const overrides = useCalendar((s) => s.overrides);
  const categories = useCalendar((s) => s.categories);
  const timezone = useCalendar((s) => s.timezone);
  const moveOccurrence = useCalendar((s) => s.moveOccurrence);
  const moveOccurrences = useCalendar((s) => s.moveOccurrences);
  const gatherOccurrences = useCalendar((s) => s.gatherOccurrences);
  const resizeOccurrence = useCalendar((s) => s.resizeOccurrence);
  const deleteEvents = useCalendar((s) => s.deleteEvents);
  const duplicateOccurrences = useCalendar((s) => s.duplicateOccurrences);

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

  /**
   * Where the pointer is, always — not only while a gesture is running.
   *
   * Paste has no drag to read a destination off, so it asks the same question
   * drop asks — "what day is under the cursor" — of a position recorded on the
   * way past. A ref rather than state because nothing renders it; at pointer
   * frequency, state here would re-render the whole grid for a number only one
   * keystroke ever reads.
   */
  useEffect(() => {
    const track = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', track, { passive: true });
    return () => window.removeEventListener('pointermove', track);
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

  /**
   * Whether dragging this bar carries the whole selection with it.
   *
   * Dragging a lit bar gathers every lit bar; dragging an unlit one is a single
   * move and leaves the selection alone — otherwise there would be no way to
   * move one entry out of a group you had selected. One entry lit is not a
   * group, so it drags as itself and keeps the grab offset a direct
   * manipulation should have.
   *
   * Shared by the commit and the preview on purpose: they answered this
   * separately before, which is exactly the sort of pair that drifts.
   */
  const carriesSelection = useCallback(
    (occ: Occurrence) => selection.has(occ.key) && selected.length > 1,
    [selection, selected],
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

    const scope = seriesMode.current ? 'series' : 'occurrence';

    /**
     * A lasso'd group lands *on* the day, rather than being shifted by however
     * far the grabbed bar travelled.
     *
     * "Put these here" is a different request from "push these forward three
     * days", and the grabbed bar's own offset — all a shared delta can be
     * computed from — belongs to neither. It is also why there is no zero-delta
     * guard on this path: dropping on a date one of the entries already
     * occupies is a real instruction, because the rest still have to come to it.
     * The shared-delta shift is still available on the arrow keys.
     */
    if (carriesSelection(occ)) {
      void gatherOccurrences(selected, dropOn, scope);
      return;
    }

    // A single bar keeps the grab offset, so a five-day bar picked up by its
    // middle slides under the cursor rather than jumping its start to the day.
    const delta = diffDays(dropOn, grab);
    if (delta === 0) return;
    void moveOccurrence(occ, delta, scope);
  }

  /**
   * Where the bar under the cursor is headed, drawn in the destination row.
   *
   * The chip under the pointer says *what* is moving; this says *where it will
   * land*, which the chip cannot because it follows the cursor rather than the
   * grid. Both together is what makes a cross-row drag legible.
   */
  const dragGhosts = useMemo(() => {
    if (!drag || !dropDate) return null;

    // The same branch `handleDragEnd` takes, off the same predicate, so what is
    // previewed and what is written cannot disagree.
    if (carriesSelection(drag.occ)) {
      // Every footprint starts on the drop date and keeps its own length, which
      // is what `gatherOccurrences` is about to write. They pile up in one
      // column; `WeekRow` stacks and clamps them, so a large selection reads as
      // "and more" rather than running off the row.
      return selected.map((occ) => ({
        start: dropDate,
        end: addDays(dropDate, diffDays(occ.endDate, occ.date)),
      }));
    }

    const delta = diffDays(dropDate, drag.grab);
    if (delta === 0) return null;
    return [{ start: addDays(drag.occ.date, delta), end: addDays(drag.occ.endDate, delta) }];
  }, [drag, dropDate, selected, carriesSelection]);

  /**
   * The draft as the rows want it: a one-element list, memoised so the rows
   * only re-render when it actually changes. Its `label` is what tells `WeekRow`
   * to draw a solid bar rather than the dashed footprint a move preview gets.
   */
  const draftBand = useMemo(
    () => (draft ? [{ start: draft.start, end: draft.end, label: draft.title }] : EMPTY_GHOSTS),
    [draft],
  );

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
    if (selection.size === 0) return false;
    setSelection(NOTHING);
    return true;
  }, [selection]);

  /**
   * Delete, at any size, with no question asked first.
   *
   * There used to be a confirmation strip for more than one entry, on the
   * grounds that a bulk delete could not be undone. That stopped being true
   * when the undo pool arrived: everything one delete removes shares a stamp,
   * so a single UNDO on the toast puts all of it back, and settings keeps a
   * RESTORE beside each entry after the toast is gone. Asking first is now the
   * more expensive of the two — it costs a keystroke every time to insure
   * against a mistake that already has a cheaper remedy.
   */
  const deleteSelection = useCallback(() => {
    const ids = [...new Set(selected.map((o) => o.eventId))];
    if (ids.length === 0) return false;
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

  /**
   * Light up what a duplicate just made.
   *
   * The copies are what you want selected afterwards — it is how you drag them
   * somewhere, delete them if you changed your mind, or press ⌘D again to make
   * a third. A key is `${eventId}:${seriesDate}`, and a fresh entry's series
   * date is wherever its span starts, so the keys are predictable without
   * waiting for the next expansion to hand them over.
   */
  const selectCopies = useCallback((copies: TempoEvent[]) => {
    // `flatMap` rather than filter-then-map: the id and the date have to stay
    // together, and an entry with no resolvable span would otherwise shift
    // every key after it onto the wrong copy.
    const keys = copies.flatMap((e) => {
      const start = eventSpan(e)?.start;
      return start ? [`${e.id}:${start}`] : [];
    });
    setSelection(keys.length > 0 ? new Set(keys) : NOTHING);
  }, []);

  const copySelection = useCallback(() => {
    setClipboard(selected);
    return selected.length;
  }, [selected]);

  /**
   * Where a paste lands: the day under the cursor, or the focused day.
   *
   * The same primitive drop resolves its target with, so paste and drop cannot
   * disagree about what day a pixel is. The fallback covers a pointer that is
   * off the grid or has never moved; `null` from both means "in place", which
   * is the honest answer when there is no target to speak of.
   */
  const pasteTarget = useCallback((): CivilDate | null => {
    const { x, y } = pointer.current;
    return dateUnderPointer(x, y) ?? selectedDay;
  }, [selectedDay]);

  const duplicateSelection = useCallback(() => {
    if (selected.length === 0) return false;
    // In place, whatever the pointer happens to be over — a duplicate is a copy
    // of a thing where it already is, and reading the cursor here would make
    // ⌘D land somewhere different depending on where the mouse was resting.
    void duplicateOccurrences(selected, null).then(selectCopies);
    return true;
  }, [selected, duplicateOccurrences, selectCopies]);

  const pasteClipboard = useCallback(() => {
    const held = getClipboard();
    if (held.length === 0) return false;
    void duplicateOccurrences([...held], pasteTarget()).then(selectCopies);
    return true;
  }, [duplicateOccurrences, pasteTarget, selectCopies]);

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
    () => ({
      jumpToToday,
      jumpTo,
      unwind,
      deleteSelection,
      moveSelection,
      copySelection,
      duplicateSelection,
      pasteClipboard,
    }),
    [
      jumpToToday,
      jumpTo,
      unwind,
      deleteSelection,
      moveSelection,
      copySelection,
      duplicateSelection,
      pasteClipboard,
    ],
  );

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
                'chrome-tight label border-l border-hair px-1.5 py-2',
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
                    ghost={dragGhosts ?? draftBand}
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
    <div className="chrome-tight flex shrink-0 items-center gap-4 border-b border-hair px-3 py-2.5 sm:px-4">
      <div className="flex min-w-0 items-baseline gap-2 truncate">
        <span className="text-[13px] tracking-[0.08em] text-ink">{month}</span>
        <span className="text-[11px] tabular-nums text-mute">{year}</span>
        {nextMonth && (
          <span className="label ml-1">→ {nextMonth}</span>
        )}
      </div>
      <button
        onClick={onToday}
        className="tap label ml-auto shrink-0 border border-hair px-2 py-1 transition-colors hover:border-hairlit hover:text-dim"
      >
        {/* The chord is advertised only where one can be pressed. */}
        <span className="hidden sm:inline">[SPACE] </span>TODAY
      </button>
    </div>
  );
}
