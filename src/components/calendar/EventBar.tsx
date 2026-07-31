'use client';

import { useDraggable } from '@dnd-kit/core';
import { useRef, useState } from 'react';
import type { WeekSegment } from '@/lib/tempo/layout';
import type { Occurrence } from '@/lib/tempo/types';
import { DAYS_PER_WEEK } from '@/lib/tempo/layout';
import { LANE_H, laneTop } from './constants';

interface Props {
  segment: WeekSegment;
  color: string;
  /** Pixel width of one day column, needed to convert a drag into whole days. */
  colWidth: number;
  onOpen: (occ: Occurrence) => void;
  onResize: (occ: Occurrence, deltaDays: number, edge: 'start' | 'end') => void;
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

export function EventBar({ segment, color, colWidth, onOpen, onResize }: Props) {
  const { occurrence: occ, startCol, endCol, continuesBefore, continuesAfter } = segment;

  // Live resize preview, in whole day columns. Committed on pointer-up.
  const [preview, setPreview] = useState<{ edge: 'start' | 'end'; delta: number } | null>(null);
  const resizing = useRef(false);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: occ.key,
    data: { occurrence: occ },
    disabled: occ.readOnly || preview !== null,
  });

  let left = startCol;
  let span = endCol - startCol + 1;
  if (preview) {
    if (preview.edge === 'end') {
      span = Math.max(1, span + preview.delta);
    } else {
      const shift = Math.min(preview.delta, span - 1);
      left += shift;
      span -= shift;
    }
  }

  function beginResize(e: React.PointerEvent, edge: 'start' | 'end') {
    // Stop dnd-kit from reading this as the start of a drag.
    e.stopPropagation();
    e.preventDefault();
    if (occ.readOnly) return;

    resizing.current = true;
    const originX = e.clientX;

    const move = (ev: PointerEvent) => {
      setPreview({ edge, delta: Math.round((ev.clientX - originX) / colWidth) });
    };
    const finish = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      resizing.current = false;
      setPreview(null);
      const delta = Math.round((ev.clientX - originX) / colWidth);
      if (delta !== 0) onResize(occ, delta, edge);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  }

  const time = occ.allDay ? null : timeLabel(occ.startMinutes);
  const glyph = occ.kind === 'assignment' && occ.status ? STATUS_GLYPH[occ.status] : null;
  const done = occ.status === 'done';

  return (
    <div
      ref={setNodeRef}
      style={{
        position: 'absolute',
        left: pct(left),
        width: `calc(${pct(span)} - 3px)`,
        top: laneTop(segment.lane),
        height: LANE_H,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        opacity: isDragging ? 0.25 : 1,
        borderLeft: continuesBefore ? undefined : `2px solid ${color}`,
        zIndex: preview ? 30 : undefined,
      }}
      className={[
        // The bars sit in a pointer-events-none overlay so empty day space falls
        // through to the cell underneath; each bar opts itself back in.
        'pointer-events-auto',
        'group ml-[2px] flex items-center gap-1.5 overflow-hidden bg-raised pr-1 text-[11px]',
        'border-y border-r border-hair transition-colors',
        continuesBefore ? 'border-l border-l-hairlit pl-1' : 'pl-1.5',
        occ.readOnly ? 'cursor-default opacity-70' : 'cursor-grab hover:border-hairlit hover:bg-sunken',
        done ? 'opacity-45' : '',
      ].join(' ')}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        e.stopPropagation();
        if (!resizing.current) onOpen(occ);
      }}
      title={occ.title}
    >
      {continuesBefore && <span className="shrink-0 text-mute">‹</span>}

      {glyph && <span className="shrink-0 text-mute">{glyph}</span>}
      {time && <span className="shrink-0 tabular-nums text-mute">{time}</span>}

      <span className={`truncate ${done ? 'text-mute line-through' : 'text-ink'}`}>
        {occ.title}
      </span>

      {continuesAfter && <span className="ml-auto shrink-0 text-mute">›</span>}

      {/* Resize handles. Hidden on a clipped edge — you can only lengthen a bar
          from an end that is actually in this row. */}
      {!occ.readOnly && !continuesBefore && (
        <span
          onPointerDown={(e) => beginResize(e, 'start')}
          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize opacity-0 transition-opacity group-hover:opacity-100"
          style={{ background: `linear-gradient(90deg, ${color}, transparent)` }}
        />
      )}
      {!occ.readOnly && !continuesAfter && (
        <span
          onPointerDown={(e) => beginResize(e, 'end')}
          className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize opacity-0 transition-opacity group-hover:opacity-100"
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
      style={{ borderLeft: `2px solid ${color}`, height: LANE_H }}
      className="flex items-center gap-1.5 border-y border-r border-hairlit bg-raised px-1.5 text-[11px] text-ink shadow-[0_4px_16px_rgba(0,0,0,0.6)]"
    >
      <span className="truncate">{occ.title}</span>
    </div>
  );
}
