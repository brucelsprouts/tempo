'use client';

import { useDroppable } from '@dnd-kit/core';
import { memo } from 'react';
import { isFirstOfMonth, isoWeek, parts, type CivilDate } from '@/lib/tempo/civil';
import type { WeekLayout } from '@/lib/tempo/layout';
import type { Occurrence } from '@/lib/tempo/types';
import { EventBar } from './EventBar';
import { DAY_HEADER_H, GUTTER_W, MONTHS, ROW_H } from './constants';

interface Props {
  layout: WeekLayout;
  today: CivilDate;
  colWidth: number;
  colorFor: (categoryId: string | null) => string;
  onOpen: (occ: Occurrence) => void;
  onResize: (occ: Occurrence, deltaDays: number, edge: 'start' | 'end') => void;
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

  return (
    <div
      ref={setNodeRef}
      data-date={date}
      onDoubleClick={() => onDayOpen(date)}
      className={[
        'group/day relative h-full border-l border-hair transition-colors',
        // Alternating month bands: the month changes are legible without the
        // grid ever breaking into pages.
        month % 2 === 0 ? 'band-even' : 'band-odd',
        monthStart ? 'border-l-hairlit' : '',
        isOver ? 'bg-raised' : '',
        selected ? 'bg-sunken' : '',
      ].join(' ')}
    >
      <div
        className="flex items-baseline gap-1.5 px-1.5"
        style={{ height: DAY_HEADER_H }}
      >
        {monthStart && (
          <span className="text-[9px] tracking-[0.16em] text-dim">
            {MONTHS[month - 1]}
          </span>
        )}
        <span
          className={[
            'text-[11px] tabular-nums leading-none',
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
          className="absolute bottom-1 left-1.5 text-[9px] tracking-[0.1em] text-mute hover:text-dim"
        >
          +{overflow}
        </button>
      )}
    </div>
  );
}

function WeekRowImpl({
  layout,
  today,
  colWidth,
  colorFor,
  onOpen,
  onResize,
  onDayOpen,
  onDayNew,
  selectedDay,
}: Props) {
  const { weekStart, days, segments, overflow } = layout;
  const containsToday = days.includes(today);

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
          <div className="text-[9px] tracking-[0.12em] text-mute">
            W{String(isoWeek(weekStart)).padStart(2, '0')}
          </div>
        )}
      </div>

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

        {/* Stays inert end to end: a blanket pointer-events-auto here would sit
            over every day cell and swallow the hover and double-click the cells
            below are listening for. Each bar re-enables itself instead. */}
        <div className="pointer-events-none absolute inset-0">
          <div className="relative h-full">
            {segments
              .filter((s) => !s.hidden)
              .map((segment) => (
                <EventBar
                  key={segment.occurrence.key}
                  segment={segment}
                  color={colorFor(segment.occurrence.categoryId)}
                  colWidth={colWidth}
                  onOpen={onOpen}
                  onResize={onResize}
                />
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export const WeekRow = memo(WeekRowImpl);
