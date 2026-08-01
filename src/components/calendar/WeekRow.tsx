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
import { DAY_HEADER_H, GUTTER_W, LANE_BUDGET, MONTHS, ROW_H, UNTITLED } from './constants';

/**
 * A footprint in a row that no entry occupies yet.
 *
 * `label` is what separates the two things this draws, and they are genuinely
 * different claims. Unlabelled is a move in flight — an entry that already
 * exists somewhere else, previewing where it would land — so it is dashed and
 * empty, because the thing itself is still under the cursor. Labelled is the
 * entry form's draft, which exists nowhere else at all: the form is the only
 * copy, so the band has to *be* it, drawn like a real bar and reading what the
 * title field reads.
 */
export interface GhostBand {
  start: CivilDate;
  end: CivilDate;
  label?: string;
}

interface Props {
  layout: WeekLayout;
  /** The row's index in the epoch. Bars need it to be uniquely identifiable. */
  weekIndex: number;
  today: CivilDate;
  colorFor: (categoryId: string | null) => string;
  /**
   * Footprints about to exist in this row. Two callers: the entry form's draft,
   * which is always one, and a move in flight, which is one per entry being
   * carried — dragging a lit bar moves the whole selection, and a preview that
   * drew only the grabbed one made the other three look like they had been left
   * behind.
   */
  ghost: readonly GhostBand[];
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
            'text-[13px] tabular-nums leading-none',
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
  const drafts = (() => {
    const touching = ghost.filter((g) => rangesOverlap(g.start, g.end, weekStart, weekEnd));
    if (touching.length === 0) return [];

    const height = KIND_HEIGHT.event;
    const after =
      laneCount === 0 ? 0 : (laneTops[laneCount - 1] ?? 0) + (laneHeights[laneCount - 1] ?? 0) + LANE_GAP;

    return touching.map((g, i) => ({
      label: g.label,
      // A draft that starts before this row is continued *into* it, and the bar
      // it is standing in for would say so with a ‹. Its title belongs on the
      // row the entry begins in, not repeated on every row it crosses.
      clipped: g.start < weekStart,
      startCol: diffDays(maxDate(g.start, weekStart), weekStart),
      endCol: diffDays(minDate(g.end, weekEnd), weekStart),
      // Stacked below one another, then clamped rather than allowed to run past
      // the row: on a full week there is no free slot, and the honest failure is
      // to sit on the last line of the budget rather than to draw outside the
      // row and over the week below. Several bands moving together can exhaust
      // the budget on their own, so they pile up on that last line — which reads
      // as "and more", and is the truth.
      top: Math.min(after + i * (height + LANE_GAP), Math.max(0, LANE_BUDGET - height)),
      height,
    }));
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

      {/* The columns run to the window's edge. Holding the Saturday column off
          it was a grid-wide right margin for one section; the bars inset
          themselves 4px per side now, which buys the same clearance in every
          column instead of in one, and keeps this box exactly as wide as the
          header grid `colWidth` is measured from. */}
      <div className="relative flex-1">
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

            {drafts.map((draft, i) => {
              const written = draft.label !== undefined;
              return (
                <div
                  key={i}
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: `${(draft.startCol / DAYS_PER_WEEK) * 100}%`,
                    // The same 4px-per-side inset a real bar takes. Mid-move this
                    // band is drawn under the bar it is previewing, so any
                    // disagreement here shows up as a rim of the wrong footprint.
                    width: `calc(${((draft.endCol - draft.startCol + 1) / DAYS_PER_WEEK) * 100}% - 8px)`,
                    top: draft.top,
                    height: draft.height,
                    // The lit outline a selected bar wears. A draft is the one
                    // thing on the grid you are currently acting on, which is
                    // what that outline has always meant.
                    outline: written ? '1px solid var(--color-hairlit)' : undefined,
                  }}
                  className={
                    written
                      ? 'ml-[4px] flex items-center overflow-hidden border-y border-r border-hair border-l-2 border-l-dim bg-raised pl-1.5 pr-1 text-[12px]'
                      : 'ml-[4px] border border-dashed border-mute bg-raised/40'
                  }
                >
                  {written && !draft.clipped && (
                    // Empty until a title is typed, and saying so in the colour
                    // the rest of the app uses for absent text — the same name
                    // the entry will be filed under if you click away now, so
                    // committing an untitled draft renames nothing.
                    <span className={`truncate ${draft.label ? 'text-ink' : 'text-mute'}`}>
                      {draft.label || UNTITLED}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export const WeekRow = memo(WeekRowImpl);
