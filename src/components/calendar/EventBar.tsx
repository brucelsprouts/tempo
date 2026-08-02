'use client';

import { useDraggable } from '@dnd-kit/core';
import { useRef } from 'react';
import { useCalendar } from '@/lib/store/calendar-store';
import type { WeekSegment } from '@/lib/tempo/layout';
import type { Occurrence } from '@/lib/tempo/types';
import { DAYS_PER_WEEK } from '@/lib/tempo/layout';
import { KIND_HEIGHT } from '@/lib/tempo/layout';

interface Props {
  segment: WeekSegment;
  /**
   * Which week row this segment is drawn in, and therefore half of the
   * draggable's identity — see the `useDraggable` call below.
   */
  weekIndex: number;
  color: string;
  selected: boolean;
  onOpen: (occ: Occurrence) => void;
  onToggleSelect: (occ: Occurrence) => void;
  /**
   * Resize is reported upward rather than handled here. The gesture has to be
   * able to cross week rows, and a bar can only see its own row.
   */
  onResizeStart: (occ: Occurrence, edge: 'start' | 'end', e: React.PointerEvent) => void;
}

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
 */
const HANDLE_W = 'w-4';

export function EventBar({
  segment,
  weekIndex,
  color,
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

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
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

  const left = startCol;
  const span = endCol - startCol + 1;

  const time = occ.allDay ? null : timeLabel(occ.startMinutes);
  const glyph = occ.kind === 'assignment' && occ.status ? STATUS_GLYPH[occ.status] : null;
  const done = occ.status === 'done';

  // A task has the room for two lines and the most to say; a mark has neither.
  const twoLine = occ.kind === 'assignment';
  const tick = occ.kind === 'milestone';

  return (
    <div
      ref={setNodeRef}
      style={{
        position: 'absolute',
        left: pct(left),
        // 8px off the span against 4px of `ml`, so the bar is inset the same
        // distance from both edges of the columns it covers. This is the whole
        // of the right-hand gutter now: the grid-wide margin that used to hold
        // the Saturday column off the window is gone, and every column is
        // padded instead of one being special.
        width: `calc(${pct(span)} - 8px)`,
        // Both handed down by `layoutWeek`. Derived here, the bar would have to
        // know the height of every kind above it in the row to place itself.
        top: segment.top,
        height: segment.height,
        // Deliberately *not* translated by `transform`.
        //
        // A `DragOverlay` chip already follows the cursor, and the destination
        // rows already draw a dashed footprint, so moving the source as well
        // was a third answer to "where is this going" — and the damaging one:
        // the bar is inside the scroll container, so translating it 400px right
        // pushed the container's `scrollWidth` out past its own width and the
        // whole grid could be dragged sideways. The source stays put and dims.
        opacity: isDragging ? 0.25 : 1,
        // Both ends carry the category colour. Only the left did, which made a
        // bar look like it pointed somewhere — the eye reads a single coloured
        // edge as a direction rather than as a boundary. A clipped end is left
        // bare, so the two ways a bar can stop still look different.
        borderLeft: continuesBefore ? undefined : `2px solid ${color}`,
        borderRight: continuesAfter ? undefined : `2px solid ${color}`,
        // Ink rather than `hairlit`, which is a hairline colour and disappears
        // against `bg-raised` at the one moment it has to be unmistakable.
        // White is spoken for: it marks today.
        outline: selected ? '1px solid var(--color-ink)' : undefined,
      }}
      className={[
        // The bars sit in a pointer-events-none overlay so empty day space falls
        // through to the cell underneath; each bar opts itself back in.
        'pointer-events-auto',
        'group ml-[4px] flex items-center gap-1 overflow-hidden bg-raised pr-1',
        tick ? 'text-[11px]' : 'text-[12px]',
        'border-y border-r border-hair transition-colors',
        continuesBefore ? 'border-l border-l-hairlit pl-1' : 'pl-1.5',
        occ.readOnly || isOffline ? 'cursor-default' : 'cursor-grab hover:border-hairlit hover:bg-sunken',
        occ.event.source === 'google' ? 'opacity-70' : '',
        done ? 'opacity-45' : '',
      ].join(' ')}
      {...attributes}
      {...listeners}
      // After the spread, deliberately. dnd-kit stamps `tabIndex={0}` on every
      // draggable, which puts several dozen bars per screen into the tab order
      // ahead of anything you would actually want to reach with Tab. Modal's
      // `trapTab` filters on `tabIndex >= 0`, so it needs nothing from this.
      tabIndex={-1}
      // Also after the spread, and it must forward: this is dnd-kit's only
      // listener on the bar, so replacing it outright would disable dragging.
      onPointerDown={(e) => {
        fromHandle.current = false;
        listeners?.onPointerDown?.(e);
      }}
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
      {continuesBefore && <span className="shrink-0 text-mute">‹</span>}
      {tick && <span className="shrink-0 text-mute">◆</span>}

      <div className="min-w-0 flex-1">
        {twoLine ? (
          <>
            <div className={`truncate leading-tight ${done ? 'text-mute line-through' : 'text-ink'}`}>
              {occ.title}
            </div>
            {/* The second line is what the extra height was spent on: status and
                when it is due, which are the two things you check without
                opening anything. */}
            <div className="flex items-center gap-1 text-[11px] leading-tight text-mute">
              {glyph && <span className="shrink-0">{glyph}</span>}
              <span className="truncate tabular-nums">{time ?? `DUE ${occ.endDate.slice(5)}`}</span>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-1.5">
            {time && <span className="shrink-0 tabular-nums text-mute">{time}</span>}
            <span className={`truncate ${done ? 'text-mute line-through' : 'text-ink'}`}>
              {occ.title}
            </span>
          </div>
        )}
      </div>

      {continuesAfter && <span className="shrink-0 text-mute">›</span>}

      {/* Resize handles. Hidden on a clipped edge — you can only lengthen a bar
          from an end that is actually in this row, which is also what makes the
          cross-week gesture unambiguous: there is exactly one handle per end of
          an entry, however many rows the entry spans. */}
      {!occ.readOnly && !isOffline && !continuesBefore && (
        <span
          onPointerDown={(e) => {
            fromHandle.current = true;
            onResizeStart(occ, 'start', e);
          }}
          className={`absolute left-0 top-0 h-full ${HANDLE_W} cursor-ew-resize opacity-0 transition-opacity group-hover:opacity-100`}
          style={{ background: `linear-gradient(90deg, ${color}, transparent)` }}
        />
      )}
      {!occ.readOnly && !isOffline && !continuesAfter && (
        <span
          onPointerDown={(e) => {
            fromHandle.current = true;
            onResizeStart(occ, 'end', e);
          }}
          className={`absolute right-0 top-0 h-full ${HANDLE_W} cursor-ew-resize opacity-0 transition-opacity group-hover:opacity-100`}
          style={{ background: `linear-gradient(270deg, ${color}, transparent)` }}
        />
      )}
    </div>
  );
}

/** The bar that follows the cursor mid-drag. */
export function DragGhost({ occ, color }: { occ: Occurrence; color: string }) {
  return (
    <div
      style={{ borderLeft: `2px solid ${color}`, height: KIND_HEIGHT[occ.kind] }}
      className="flex items-center gap-1.5 border-y border-r border-hairlit bg-raised px-1.5 text-[12px] text-ink shadow-[0_4px_16px_rgba(0,0,0,0.6)]"
    >
      <span className="truncate">{occ.title}</span>
    </div>
  );
}
