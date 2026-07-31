'use client';

import { useDroppable } from '@dnd-kit/core';
import { memo } from 'react';
import {
  dayOfWeek,
  diffDays,
  isFirstOfMonth,
  isoWeek,
  maxDate,
  minDate,
  parts,
  rangesOverlap,
  type CivilDate,
} from '@/lib/tempo/civil';
import { DAYS_PER_WEEK, KIND_HEIGHT, LANE_GAP, type WeekLayout } from '@/lib/tempo/layout';
import type { Occurrence } from '@/lib/tempo/types';
import { EventBar } from './EventBar';
import { DAY_HEADER_H, GRID_PAD_R, GUTTER_W, LANE_BUDGET, MONTHS, ROW_H } from './constants';

interface Props {
  layout: WeekLayout;
  /** The row's index in the epoch. Bars need it to be uniquely identifiable. */
  weekIndex: number;
  today: CivilDate;
  colorFor: (categoryId: string | null) => string;
  /**
   * Where a draft entry would land, if it touches this row — and, mid-drag,
   * where the bar under the cursor is headed. One dashed band, two callers:
   * both questions are "what footprint is about to exist here".
   */
  ghost: { start: CivilDate; end: CivilDate } | null;
  /** Occurrence keys drawn with a lit outline. */
  selection: ReadonlySet<string>;
  onOpen: (occ: Occurrence) => void;
  onToggleSelect: (occ: Occurrence) => void;
  onResizeStart: (occ: Occurrence, edge: 'start' | 'end', e: React.PointerEvent) => void;
  onDayOpen: (date: CivilDate) => void;
  onDayNew: (date: CivilDate) => void;
  selectedDay: CivilDate | null;
}

function DayCell({
  date,
  today,
  overflow,
  onDayOpen,
  onDayNew,
  selected,
}: {
  date: CivilDate;
  today: CivilDate;
  overflow: number;
  onDayOpen: (d: CivilDate) => void;
  onDayNew: (d: CivilDate) => void;
  selected: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: date });
  const { month, day } = parts(date);
  const monthStart = isFirstOfMonth(date);
  const isToday = date === today;
  const past = date < today;
  const dow = dayOfWeek(date);
  const weekend = dow === 0 || dow === 6;

  return (
    <div
      ref={setNodeRef}
      data-date={date}
      onDoubleClick={() => onDayOpen(date)}
      className={[
        // Unselectable, because a drag across the grid is a lasso: without this
        // the browser would answer the same gesture by highlighting the day
        // numbers it swept over.
        'group/day relative h-full select-none border-l border-hair transition-colors',
        // Alternating month bands: the month changes are legible without the
        // grid ever breaking into pages. The weekend shade composes with the
        // month rather than overriding it, so a Saturday still says which
        // month it is in — a flat weekend colour would have taken the boundary
        // out of two columns in every seven.
        month % 2 === 0
          ? weekend
            ? 'band-even-wk'
            : 'band-even'
          : weekend
            ? 'band-odd-wk'
            : 'band-odd',
        monthStart ? 'border-l-hairlit' : '',
        isOver ? 'bg-raised' : '',
        selected ? 'bg-sunken' : '',
      ].join(' ')}
    >
      {/* Padded off the top hairline rather than centred: the number has to
          line up across all seven columns, and the month label beside it is a
          different size, so a baseline set from the top edge is the only one
          that holds. */}
      <div
        className="flex items-baseline gap-1.5 px-1.5 pt-1"
        style={{ height: DAY_HEADER_H }}
      >
        {monthStart && (
          <span className="text-[10px] tracking-[0.16em] text-dim">
            {MONTHS[month - 1]}
          </span>
        )}
        <span
          className={[
            'text-[12px] tabular-nums leading-none',
            isToday
              ? 'bg-bright px-1 py-0.5 font-medium text-void'
              : past
                ? 'text-mute'
                : 'text-dim',
          ].join(' ')}
        >
          {day}
        </span>

        {/* Reveals on hover, the way a Notion row does: the affordance is where
            the cursor already is, so adding an entry never needs a menu. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDayNew(date);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          title="New entry"
          aria-label={`New entry on ${date}`}
          className="ml-auto flex h-[17px] w-[17px] shrink-0 self-center items-center justify-center border border-hair bg-panel text-[12px] leading-none text-mute opacity-0 transition-opacity hover:border-hairlit hover:text-bright focus-visible:opacity-100 group-hover/day:opacity-100"
        >
          +
        </button>
      </div>

      {overflow > 0 && (
        <button
          onClick={() => onDayOpen(date)}
          className="absolute bottom-1 left-1.5 text-[10px] tracking-[0.1em] text-mute hover:text-dim"
        >
          +{overflow}
        </button>
      )}
    </div>
  );
}

function WeekRowImpl({
  layout,
  weekIndex,
  today,
  colorFor,
  ghost,
  selection,
  onOpen,
  onToggleSelect,
  onResizeStart,
  onDayOpen,
  onDayNew,
  selectedDay,
}: Props) {
  const { weekStart, weekEnd, days, segments, overflow, laneTops, laneHeights, laneCount } = layout;
  const containsToday = days.includes(today);

  /**
   * The draft's footprint in this row, if it has one.
   *
   * Clipped to the week the same way a real segment is, but assigned a lane
   * *after* the last real one rather than through `layoutWeek` — a draft that
   * competed for lanes could push a real bar into the overflow counter, so the
   * calendar would rearrange itself while you were still deciding whether to
   * create anything at all. It stacks on top and displaces nothing.
   */
  const draft = (() => {
    if (!ghost || !rangesOverlap(ghost.start, ghost.end, weekStart, weekEnd)) return null;

    const height = KIND_HEIGHT.event;
    const after =
      laneCount === 0 ? 0 : (laneTops[laneCount - 1] ?? 0) + (laneHeights[laneCount - 1] ?? 0) + LANE_GAP;
    // Clamped rather than allowed to run past the row: on a full week there is
    // no free slot, and the honest failure is to sit on the last line of the
    // budget rather than to draw outside the row and over the week below.
    const top = Math.min(after, Math.max(0, LANE_BUDGET - height));

    return {
      startCol: diffDays(maxDate(ghost.start, weekStart), weekStart),
      endCol: diffDays(minDate(ghost.end, weekEnd), weekStart),
      top,
      height,
    };
  })();

  // Month label in the gutter whenever a month begins inside this row.
  const monthStartDay = days.find(isFirstOfMonth);

  return (
    <div className="flex border-b border-hair" style={{ height: ROW_H }}>
      <div
        className="relative shrink-0 select-none pt-1.5 pr-2 text-right"
        style={{ width: GUTTER_W }}
      >
        {monthStartDay ? (
          <div className="text-[10px] leading-tight tracking-[0.12em] text-dim">
            {MONTHS[parts(monthStartDay).month - 1]}
            <div className="text-[9px] text-mute">{parts(monthStartDay).year}</div>
          </div>
        ) : (
          <div className="text-[10px] tracking-[0.12em] text-mute">
            W{String(isoWeek(weekStart)).padStart(2, '0')}
          </div>
        )}
      </div>

      {/* The right gutter is a margin on this box and not padding on the row,
          so the columns, the bars laid out in percentages of them, and the
          `colWidth` measured off the header grid all keep describing the same
          width. The `border-b` stays on the row outside it, so the hairline
          still runs edge to edge and the gutter reads as a margin rather than
          as a gap in the rule. */}
      <div className="relative flex-1" style={{ marginRight: GRID_PAD_R }}>
        <div className="grid h-full grid-cols-7">
          {days.map((date, i) => (
            <DayCell
              key={date}
              date={date}
              today={today}
              overflow={overflow[i]}
              onDayOpen={onDayOpen}
              onDayNew={onDayNew}
              selected={date === selectedDay}
            />
          ))}
        </div>

        {containsToday && (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-bright/25"
            aria-hidden
          />
        )}

        {/* Offset by the header rather than pinned to the top of the row.
            `segment.top` is measured from the top of the lane area and
            `LANE_BUDGET` already excludes the header, so this is the single
            place `DAY_HEADER_H` is added — at `inset-0` lane 0 was drawn
            straight over the day numbers and the hover `+`, which is what made
            both unreliable to click. The draft band below inherits it for free.

            Stays inert end to end: a blanket pointer-events-auto here would sit
            over every day cell and swallow the hover and double-click the cells
            below are listening for. Each bar re-enables itself instead. */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0"
          style={{ top: DAY_HEADER_H }}
        >
          <div className="relative h-full">
            {segments
              .filter((s) => !s.hidden)
              .map((segment) => (
                <EventBar
                  key={segment.occurrence.key}
                  segment={segment}
                  weekIndex={weekIndex}
                  color={colorFor(segment.occurrence.categoryId)}
                  selected={selection.has(segment.occurrence.key)}
                  onOpen={onOpen}
                  onToggleSelect={onToggleSelect}
                  onResizeStart={onResizeStart}
                />
              ))}

            {draft && (
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  left: `${(draft.startCol / DAYS_PER_WEEK) * 100}%`,
                  width: `calc(${((draft.endCol - draft.startCol + 1) / DAYS_PER_WEEK) * 100}% - 3px)`,
                  top: draft.top,
                  height: draft.height,
                }}
                className="ml-[2px] border border-dashed border-mute bg-raised/40"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export const WeekRow = memo(WeekRowImpl);
