'use client';

import { useDraggable } from '@dnd-kit/core';
import { useRef, type CSSProperties } from 'react';
import { useCalendar } from '@/lib/store/calendar-store';
import type { WeekSegment } from '@/lib/tempo/layout';
import type { Category, Occurrence } from '@/lib/tempo/types';
import { DAYS_PER_WEEK, KIND_HEIGHT } from '@/lib/tempo/layout';
import { CategoryChip } from './CategoryChip';
import { useEntryFocus } from './entry-focus';
import { barColors } from './tint';

interface Props {
  segment: WeekSegment;
  /**
   * Which week row this segment is drawn in, and therefore half of the
   * draggable's identity — see the `useDraggable` call below.
   */
  weekIndex: number;
  /**
   * What the entry is filed under. `null` keeps the plain grey bar and wears no
   * chip, so "no category" still looks different from every category.
   */
  category: Category | null;
  selected: boolean;
  onOpen: (occ: Occurrence) => void;
  onToggleSelect: (occ: Occurrence) => void;
  /**
   * Resize is reported upward rather than handled here. The gesture has to be
   * able to cross week rows, and a bar can only see its own row.
   */
  onResizeStart: (occ: Occurrence, edge: 'start' | 'end', e: React.PointerEvent) => void;
}

/** The bar's style, plus the category colour the hover ring in globals.css draws with. */
type BarStyle = CSSProperties & { '--cat': string };

const pct = (cols: number) => `${(cols / DAYS_PER_WEEK) * 100}%`;

function timeLabel(minutes: number | null): string | null {
  if (minutes === null) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  // Always 24-hour and zero-padded: a bare "9" next to a title reads as part of
  // the title, and mixed widths make a column of chips look ragged.
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const STATUS_GLYPH = { todo: '[ ]', doing: '[~]', done: '[x]' } as const;

/**
 * How much of each end of a bar grabs a resize rather than a move.
 *
 * 16px, up from 8. A resize is the harder gesture to start — it is aimed at an
 * edge rather than at a shape — and 8px asked for a precision the gesture does
 * not deserve. The cost is paid by the move, which keeps everything between the
 * two: 135px of it on the narrowest column this layout produces, so the easier
 * gesture is still by far the larger target.
 *
 * On a coarse pointer `.bar-grip` narrows this to 12px and stops hiding it —
 * see the grip rules in globals.css.
 */
const HANDLE_W = 'w-4';

export function EventBar({
  segment,
  weekIndex,
  category,
  selected,
  onOpen,
  onToggleSelect,
  onResizeStart,
}: Props) {
  const { occurrence: occ, startCol, endCol, continuesBefore, continuesAfter } = segment;

  /**
   * Whether the press that is about to end began on a resize handle.
   *
   * A press and release on a handle with no movement still produces a `click`
   * on the bar, which would open the entry modal on top of the resize that was
   * just committed. The flag is cleared by the bar's own pointer-down, so it
   * can never go stale and eat a later, genuine click: the handles stop
   * propagation, so a press anywhere else on the bar always resets it first.
   */
  const fromHandle = useRef(false);
  const isOffline = useCalendar((s) => s.isOffline);

  /**
   * Hover and drag, answered per entry rather than per bar — see
   * `entry-focus.ts`. Each is a selector on this entry's key, so a hover
   * anywhere else on the grid does not re-render this bar.
   */
  const lit = useEntryFocus((s) => s.hovered === occ.key);
  const carried = useEntryFocus((s) => s.carried.has(occ.key));
  const hover = useEntryFocus((s) => s.hover);
  const unhover = useEntryFocus((s) => s.unhover);

  const { attributes, listeners, setNodeRef } = useDraggable({
    // Not `occ.key`. A bar crossing a week boundary is drawn as two segments,
    // and dnd-kit keys its node registry by id — under one id the second
    // registration clobbered the first, so both halves translated together and
    // the active rect belonged to whichever had mounted last. The two halves
    // are two draggables; the occurrence rides along in `data`, which is what
    // the drag handlers actually read.
    id: `${occ.key}#${weekIndex}`,
    data: { occurrence: occ },
    disabled: occ.readOnly || isOffline,
  });

  const colors = barColors(category?.color ?? null);
  const left = startCol;
  const span = endCol - startCol + 1;

  const time = occ.allDay ? null : timeLabel(occ.startMinutes);
  const glyph = occ.kind === 'assignment' && occ.status ? STATUS_GLYPH[occ.status] : null;
  const done = occ.status === 'done';

  const task = occ.kind === 'assignment';
  const tick = occ.kind === 'milestone';
  /** A birthday and a mark are one line and wear no chip. */
  const oneLine = tick || occ.kind === 'birthday';
  const editable = !occ.readOnly && !isOffline;

  const style: BarStyle = {
    position: 'absolute',
    left: pct(left),
    // 8px off the span against 4px of `ml`, so the bar is inset the same
    // distance from both edges of the columns it covers.
    width: `calc(${pct(span)} - 8px)`,
    // Both handed down by `layoutWeek`. Derived here, the bar would have to
    // know the height of every kind above it in the row to place itself.
    top: segment.top,
    height: segment.height,
    // Deliberately *not* translated by `transform`. A `DragOverlay` chip
    // already follows the cursor and the destination rows draw a footprint, so
    // moving the source as well was a third answer to "where is this going" —
    // and the bar is inside the scroll container, so translating it pushed the
    // container's `scrollWidth` out and the grid could be dragged sideways. The
    // source stays put and dims: every bar of every entry being carried.
    opacity: carried ? 0.25 : undefined,
    background: colors.fill,
    color: colors.ink,
    /**
     * One coloured edge, on the leading end.
     *
     * Both ends carried the colour while the bar was grey, because a single
     * coloured edge on a grey bar read as a direction rather than a boundary. A
     * filled bar has its shape already — the fill is the extent — so the second
     * edge was noise and it went. A clipped start is still left bare, so the two
     * ways a bar can begin still look different.
     */
    borderLeft: continuesBefore ? undefined : `3px solid ${colors.edge}`,
    '--cat': colors.edge,
    // Ink rather than `hairlit`, which is a hairline colour and disappears at
    // the one moment it has to be unmistakable. White is spoken for: it marks
    // today.
    outline: selected ? '1px solid var(--color-ink)' : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-lit={lit || undefined}
      className={[
        // The bars sit in a pointer-events-none overlay so empty day space falls
        // through to the cell underneath; each bar opts itself back in.
        'pointer-events-auto',
        // Its own container, so everything inside can size itself against the
        // room this bar actually has. See the `.tempo-bar` rules in globals.css.
        'tempo-bar',
        'ml-[4px] flex items-stretch gap-1 overflow-hidden pr-1',
        oneLine ? '' : 'py-[5px]',
        tick ? 'text-[11px]' : 'text-[12px]',
        continuesBefore ? 'pl-1' : 'pl-1.5',
        editable ? 'cursor-grab' : 'cursor-default',
        occ.event.source === 'google' ? 'opacity-70' : '',
        done ? 'opacity-45' : '',
      ].join(' ')}
      {...attributes}
      {...listeners}
      // After the spread, deliberately. dnd-kit stamps `tabIndex={0}` on every
      // draggable, which puts several dozen bars per screen into the tab order.
      tabIndex={-1}
      // Also after the spread: purely the flag reset. `pointerdown` precedes
      // both dnd-kit activators on either input, so the flag is always cleared
      // before the gesture that might set it.
      onPointerDown={() => {
        fromHandle.current = false;
      }}
      // A mouse only. A finger has no hover, and a tap that lit a bar would
      // leave it lit.
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') hover(occ.key);
      }}
      onPointerLeave={() => unhover(occ.key)}
      onClick={(e) => {
        e.stopPropagation();
        if (fromHandle.current) {
          fromHandle.current = false;
          return;
        }
        // Cmd/Ctrl rather than Shift: Shift already means "rewrite the series"
        // at drop time, and one modifier cannot mean two things on one bar.
        if (e.metaKey || e.ctrlKey) {
          onToggleSelect(occ);
          return;
        }
        onOpen(occ);
      }}
      title={occ.title}
    >
      {continuesBefore && (
        <span className="shrink-0 self-center" style={{ color: colors.soft }}>
          ‹
        </span>
      )}
      {tick && (
        <span className="shrink-0 self-center" style={{ color: colors.soft }}>
          ◆
        </span>
      )}

      <div
        className={[
          'bar-body flex min-w-0 flex-1 flex-col',
          oneLine ? 'justify-center' : 'justify-between',
          // Events alone give up a title line to the chip in the middle width
          // tier; see `.bar-event` in globals.css.
          oneLine || task ? '' : 'bar-event',
        ].join(' ')}
      >
        {oneLine ? (
          /* `bar-tick` holds one line at every width, and gives up the clock
             under 90px: a mark is a date rather than a time. */
          <div className="bar-line bar-tick flex items-center gap-1.5">
            {time && (
              <span className="bar-time shrink-0 tabular-nums" style={{ color: colors.soft }}>
                {time}
              </span>
            )}
            <span className="bar-title truncate">{occ.title}</span>
          </div>
        ) : (
          <>
            {/* The title, with what precedes it: the time on an event, the
                status box on a task. Under 90px of content `.bar-line` turns
                the column and the time moves above the title. The title is its
                own flex column, so a second line hangs under itself rather than
                under the time. */}
            <div className="bar-line flex gap-1.5">
              {task
                ? glyph && (
                    <span className="bar-glyph shrink-0 tabular-nums" style={{ color: colors.soft }}>
                      {glyph}
                    </span>
                  )
                : time && (
                    <span className="bar-time shrink-0 tabular-nums" style={{ color: colors.soft }}>
                      {time}
                    </span>
                  )}
              <span className={`bar-title bar-clamp ${done ? 'line-through' : ''}`}>{occ.title}</span>
            </div>

            {/* Everything else sits on the bottom edge together: a task's due
                line, then the chip. */}
            <div className="flex min-w-0 flex-col gap-[3px]">
              {task && (
                <div
                  className="bar-meta truncate text-[11px] leading-tight tabular-nums"
                  style={{ color: colors.soft }}
                >
                  {time ?? (
                    <>
                      <span className="bar-due">DUE </span>
                      {occ.endDate.slice(5)}
                    </>
                  )}
                </div>
              )}
              {category && (
                <div className="bar-chips flex min-w-0">
                  <CategoryChip category={category} />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {continuesAfter && (
        <span className="shrink-0 self-center" style={{ color: colors.soft }}>
          ›
        </span>
      )}

      {/* Resize handles. Hidden on a clipped edge — you can only lengthen a bar
          from an end that is actually in this row, which is also what makes the
          cross-week gesture unambiguous. Revealed by the entry's hover
          (`[data-lit]` in globals.css) rather than this bar's own, so hovering
          either half of a split entry shows both of its ends.

          `bar-grip` is what makes them exist on a touch screen; see the grip
          rules in globals.css. `stopPropagation` is said on the mouse and touch
          events as well as the pointer one, because those bubble on their own
          and would start a move at the same time as the resize. */}
      {editable && !continuesBefore && (
        <span
          onPointerDown={(e) => {
            fromHandle.current = true;
            onResizeStart(occ, 'start', e);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className={`bar-grip absolute left-0 top-0 h-full ${HANDLE_W} cursor-ew-resize opacity-0 transition-opacity`}
          style={{ background: `linear-gradient(90deg, ${colors.edge}, transparent)` }}
        />
      )}
      {editable && !continuesAfter && (
        <span
          onPointerDown={(e) => {
            fromHandle.current = true;
            onResizeStart(occ, 'end', e);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className={`bar-grip absolute right-0 top-0 h-full ${HANDLE_W} cursor-ew-resize opacity-0 transition-opacity`}
          style={{ background: `linear-gradient(270deg, ${colors.edge}, transparent)` }}
        />
      )}
    </div>
  );
}

/**
 * The bar that follows the cursor mid-drag: the same fill, edge, title and chip
 * as the bar it lifted, at its kind's height.
 */
export function DragGhost({ occ, category }: { occ: Occurrence; category: Category | null }) {
  const colors = barColors(category?.color ?? null);
  const oneLine = occ.kind === 'milestone' || occ.kind === 'birthday';
  return (
    <div
      style={{
        background: colors.fill,
        color: colors.ink,
        borderLeft: `3px solid ${colors.edge}`,
        height: KIND_HEIGHT[occ.kind],
      }}
      className={[
        'flex flex-col overflow-hidden px-1.5 text-[12px] shadow-[0_4px_16px_rgba(0,0,0,0.6)]',
        oneLine ? 'justify-center' : 'justify-between py-[5px]',
      ].join(' ')}
    >
      <span className={oneLine ? 'truncate' : 'bar-clamp'}>{occ.title}</span>
      {!oneLine && category && (
        <div className="flex min-w-0">
          <CategoryChip category={category} />
        </div>
      )}
    </div>
  );
}
