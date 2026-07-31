'use client';

import { useMemo } from 'react';
import { groupOverrides, useCalendar } from '@/lib/store/calendar-store';
import {
  addDays,
  civil,
  dayOfWeek,
  daysInMonth,
  diffDays,
  minDate,
  parts,
  todayIn,
  type CivilDate,
} from '@/lib/tempo/civil';
import { expandAll } from '@/lib/tempo/recurrence';
import type { Occurrence } from '@/lib/tempo/types';
import { DEFAULT_CATEGORY_COLOR, epochYears, MONTHS } from './constants';
import { inputClass } from './ui';

/**
 * Twelve months at once.
 *
 * The continuous scroll answers "what is around this week"; this answers "what
 * shape did this year have", which is the only question the scroll is bad at.
 * Same data, same expansion — nothing here is a second source of truth.
 *
 * Density is carried by category colour rather than by counts: at this scale a
 * number is unreadable, but three coloured ticks under a date are not.
 */

const DOTS_PER_DAY = 3;

interface Props {
  year: number;
  onYear: (y: number) => void;
  onOpenDay: (date: CivilDate) => void;
  selectedDay: CivilDate | null;
}

export function YearView({ year, onYear, onOpenDay, selectedDay }: Props) {
  const events = useCalendar((s) => s.events);
  const overrides = useCalendar((s) => s.overrides);
  const categories = useCalendar((s) => s.categories);
  const timezone = useCalendar((s) => s.timezone);

  const today = useMemo(() => todayIn(timezone), [timezone]);
  const thisYear = parts(today).year;

  const yearStart = civil(year, 1, 1);
  const yearEnd = civil(year, 12, 31);

  /** Every day in the year that has something on it, in colour order. */
  const byDay = useMemo(() => {
    const colorFor = (id: string | null) =>
      categories.find((c) => c.id === id)?.color ?? DEFAULT_CATEGORY_COLOR;

    const map = new Map<CivilDate, Occurrence[]>();
    for (const occ of expandAll(events, groupOverrides(overrides), yearStart, yearEnd)) {
      // A multi-day bar marks every square it covers, clipped to this year.
      let d = occ.date < yearStart ? yearStart : occ.date;
      const last = minDate(occ.endDate, yearEnd);
      // Guard against a pathological span; a year is 366 squares at most.
      for (let i = 0; i <= 366 && diffDays(last, d) >= 0; i++) {
        const list = map.get(d);
        if (list) list.push(occ);
        else map.set(d, [occ]);
        d = addDays(d, 1);
      }
    }
    return { map, colorFor };
  }, [events, overrides, categories, yearStart, yearEnd]);

  const total = useMemo(
    () => new Set([...byDay.map.values()].flat().map((o) => o.key)).size,
    [byDay],
  );

  /**
   * Every year in the epoch, plus whichever one is on screen.
   *
   * The steppers are unbounded and can walk past either end. A `<select>` whose
   * value is absent from its options renders blank in every browser, so the one
   * number the header exists to state would silently vanish exactly when you
   * had navigated somewhere unusual. Same splice, for the same reason, as the
   * timezone list in `Settings`.
   */
  const years = useMemo(() => epochYears(thisYear, year), [thisYear, year]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-4 border-b border-hair px-4 py-2.5">
        {/*
          A native select rather than the strip of 16 buttons this replaces. The
          strip had to live in an `overflow-x-auto` sliver, so most of the epoch
          was off-screen and reachable only by scrolling sideways through a
          scrollbar that is now hidden. It also carried a second, redundant jump
          control beside it. A select states the current year, lists every other
          one, and needs no custom behaviour — the app already uses native
          selects for timezone and category.
        */}
        <div className="flex items-center gap-1">
          <YearStep label="‹" onClick={() => onYear(year - 1)} title="Previous year" />
          <div className="w-[116px]">
            <select
              value={year}
              onChange={(e) => onYear(Number(e.target.value))}
              aria-label="Year"
              className={`${inputClass} tabular-nums`}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y === thisYear ? `${y} · TODAY` : y}
                </option>
              ))}
            </select>
          </div>
          <YearStep label="›" onClick={() => onYear(year + 1)} title="Next year" />
        </div>

        <span className="label">{total} ENTRIES</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-x-5 gap-y-6">
          {Array.from({ length: 12 }, (_, m) => (
            <MonthGrid
              key={m}
              year={year}
              month={m + 1}
              today={today}
              selectedDay={selectedDay}
              byDay={byDay.map}
              colorFor={byDay.colorFor}
              onOpenDay={onOpenDay}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function YearStep({
  label,
  onClick,
  title,
}: {
  label: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="border border-hair px-2 py-1 text-[12px] leading-none text-mute transition-colors hover:border-hairlit hover:text-ink"
    >
      {label}
    </button>
  );
}

function MonthGrid({
  year,
  month,
  today,
  selectedDay,
  byDay,
  colorFor,
  onOpenDay,
}: {
  year: number;
  month: number;
  today: CivilDate;
  selectedDay: CivilDate | null;
  byDay: Map<CivilDate, Occurrence[]>;
  colorFor: (id: string | null) => string;
  onOpenDay: (d: CivilDate) => void;
}) {
  const first = civil(year, month, 1);
  const lead = dayOfWeek(first);
  const length = daysInMonth(year, month);

  const days = Array.from({ length }, (_, i) => civil(year, month, i + 1));
  const count = days.reduce((n, d) => n + (byDay.get(d)?.length ?? 0), 0);

  return (
    <section>
      <div className="mb-1.5 flex items-baseline gap-2 border-b border-hair pb-1.5">
        <h3 className="text-[11px] tracking-[0.16em] text-dim">{MONTHS[month - 1]}</h3>
        {count > 0 && <span className="label ml-auto">{count}</span>}
      </div>

      <div className="grid grid-cols-7 gap-px">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className="pb-1 text-center text-[9px] leading-none text-mute">
            {d}
          </div>
        ))}

        {Array.from({ length: lead }, (_, i) => (
          <div key={`pad-${i}`} />
        ))}

        {days.map((date) => {
          const items = byDay.get(date);
          const isToday = date === today;
          const selected = date === selectedDay;

          return (
            <button
              key={date}
              onClick={() => onOpenDay(date)}
              title={
                items
                  ? `${date} — ${items.map((o) => o.title).join(', ')}`
                  : `${date} — nothing scheduled`
              }
              className={[
                'flex h-[26px] flex-col items-center justify-center gap-[3px] transition-colors',
                selected ? 'bg-raised' : 'hover:bg-raised',
              ].join(' ')}
            >
              {/* Every number gets the same box, today's is merely filled.
                  Padding the highlighted one instead left the digit riding high
                  in its block — `leading-none` gives a 10px line no room to
                  centre in — and made today's square a different size from the
                  other thirty, so the whole grid stepped sideways around it. */}
              <span
                className={[
                  'inline-flex h-[13px] min-w-[13px] items-center justify-center px-[3px]',
                  'text-[10px] leading-none tabular-nums',
                  isToday
                    ? 'bg-bright font-medium text-void'
                    : items
                      ? 'text-ink'
                      : 'text-mute',
                ].join(' ')}
              >
                {parts(date).day}
              </span>

              <span className="flex h-[3px] items-center gap-[2px]">
                {items?.slice(0, DOTS_PER_DAY).map((o, i) => (
                  <span
                    key={`${o.key}-${i}`}
                    className="h-[3px] w-[3px]"
                    style={{ background: colorFor(o.categoryId) }}
                  />
                ))}
                {items && items.length > DOTS_PER_DAY && (
                  <span className="h-[3px] w-[3px] bg-mute" />
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
