'use client';

import { useMemo } from 'react';
import {
  addDays,
  addMonths,
  addYears,
  compareDates,
  parts,
  setMonth,
  startOfMonth,
  startOfWeek,
  type CivilDate,
} from '@/lib/tempo/civil';
import { MONTHS, pickerYears, WEEKDAYS } from './constants';

/**
 * One month, drawn once.
 *
 * This was `DatePicker`'s entire body until `WhenField` needed the same forty-two
 * cells with two endpoints lit instead of one. Two copies of a month grid is two
 * places for the leap-year arithmetic and the six-row height rule to drift apart,
 * so the grid moved here and both callers wrap it.
 *
 * It owns the keyboard. The cells are deliberately out of the tab order — forty-two
 * tab stops is not navigation — so the grid itself takes focus and the arrows walk
 * the cursor from there. That has to live with the cells rather than with either
 * caller: both callers now open onto a text field and reach the grid by Tab, so
 * neither has a panel with the focus to hang an arrow handler on.
 *
 * No `Date` object ever holds a value here. Every step and comparison goes through
 * `civil.ts` — see DESIGN.md §3 for why a civil date that becomes a `Date` is a bug
 * waiting for a timezone change.
 */

/**
 * Six rows, always, even for a month that only occupies five.
 *
 * A grid sized to the month it is showing changes height between February and
 * March, which walks the TODAY button out from under the pointer while you are
 * stepping through months. The spare cells are the neighbouring months' days,
 * drawn muted rather than blanked: the cursor can arrow onto them either way,
 * so they may as well say which date they are.
 */
const GRID_DAYS = 42;

/**
 * The header row's one height, shared by the year select, TODAY and both steppers.
 *
 * Four controls of three different element types sat at three different heights,
 * because each was carrying padding from a different source — `inputClass`, `Button`,
 * and the stepper's own. A fixed height and centred content is the only version of
 * this that stays aligned when one of those upstream paddings changes.
 */
const CONTROL =
  'inline-flex h-[26px] shrink-0 items-center justify-center border border-hair bg-panel text-[11px] leading-none outline-none transition-colors';

/**
 * One lit cell, or two with the span between them filled.
 *
 * A bare `CivilDate` rather than `{ start: d, end: d }` for the single case, so a
 * caller that has only one date cannot accidentally describe a one-day range and
 * get the range's heavier painting for it.
 */
export type MonthSelection = CivilDate | { start: CivilDate; end: CivilDate };

interface Props {
  /** The highlighted day. The month on screen is `startOfMonth(cursor)`. */
  cursor: CivilDate;
  onCursor: (d: CivilDate) => void;
  /** A click, or Enter on the cursor. */
  onPick: (d: CivilDate) => void;
  /** Resolved by the caller, which is the one that knows the timezone. */
  today: CivilDate;
  selection: MonthSelection;
  /** Earliest selectable date, inclusive. */
  min?: CivilDate;
  /** Names the grid for a screen reader; the caller has the human word for it. */
  label: string;
}

export function MonthGrid({
  cursor,
  onCursor,
  onPick,
  today,
  selection,
  min,
  label,
}: Props): React.JSX.Element {
  const monthStart = startOfMonth(cursor);
  const { year: shownYear, month: shownMonth } = parts(cursor);

  /**
   * Every year in the epoch, plus whichever one is on screen. A `<select>` whose
   * value is absent from its options renders blank in every browser, so an entry
   * dated outside the epoch would silently lose the one number the header exists
   * to state. Same splice, for the same reason, as `YearView`.
   */
  const years = useMemo(() => pickerYears(parts(today).year, shownYear), [today, shownYear]);

  const days = useMemo(() => {
    const first = startOfWeek(monthStart);
    return Array.from({ length: GRID_DAYS }, (_, i) => addDays(first, i));
  }, [monthStart]);

  const clamp = (d: CivilDate): CivilDate =>
    min !== undefined && compareDates(d, min) < 0 ? min : d;
  /** Below the floor, so it is drawn but cannot be chosen. */
  const barred = (d: CivilDate): boolean => clamp(d) !== d;

  /**
   * Every cursor move lands here, so the highlight can never come to rest on a day
   * the field is not allowed to hold — it stops at `min` rather than walking past
   * it, which is the same statement the greyed-out cells make. The steppers and the
   * year select move the cursor too rather than moving a view of their own, so the
   * month on screen and the highlight can never disagree about where you are.
   */
  const moveTo = (d: CivilDate) => onCursor(clamp(d));

  const [from, to] =
    typeof selection === 'string'
      ? [selection, selection]
      : [selection.start, selection.end];
  const isRange = typeof selection !== 'string' && from !== to;

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        moveTo(addDays(cursor, -1));
        break;
      case 'ArrowRight':
        e.preventDefault();
        moveTo(addDays(cursor, 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveTo(addDays(cursor, -7));
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveTo(addDays(cursor, 7));
        break;
      case 'Enter':
        // Only when the grid itself holds focus. Enter on a stepper or on TODAY is
        // that button's own activation, and taking it would leave a focused control
        // that ignores the key it advertises.
        if (e.target === e.currentTarget) {
          e.preventDefault();
          onPick(cursor);
        }
        break;
    }
    // Escape is deliberately not handled: it belongs to whichever surface opened
    // this one, and that surface is an ancestor, so it gets the event by bubbling.
  }

  return (
    <div>
      {/*
        Notion's arrangement — the month reads first, the controls sit together at
        the far end — rather than a stepper on either side of a centred title. The
        year stays a `<select>` in the middle of it: Tempo's epoch spans decades and
        two arrows that move a month at a time cannot reach 2031 in any useful
        number of clicks.
      */}
      <div className="mb-2 flex items-center gap-1">
        {/*
          The month was a `<span>` — the one word in this header that names where you
          are and the only one you could not change by pointing at it. Reaching next
          March meant five presses of `›`, and reaching a birth date meant giving up on
          the steppers entirely and going through the year select first.

          Abbreviated rather than spelled out, which is where this parts company with
          the arrangement it is copied from. `September` set in this row's tracking is
          wider than the year select, and the header is a fixed run of five controls
          inside a 238px popover that `September` already overflowed before it became a
          control at all. Three letters is unambiguous, it is how `MONTHS` is spelled
          everywhere else in the app, and it leaves this row narrower than it was.
        */}
        <select
          value={shownMonth}
          onChange={(e) => moveTo(setMonth(cursor, Number(e.target.value)))}
          aria-label="Month"
          className={`${CONTROL} w-[46px] appearance-none px-1 text-center tracking-[0.08em] text-ink hover:border-hairlit`}
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>

        {/*
          `appearance-none`, so no native chevron. The one this drew was the only
          system-rendered glyph left in the app — a light-grey arrow on a dark panel,
          sized and coloured by the OS — which is the whole reason `<input type="date">`
          was replaced in the first place. Losing it costs nothing: the field is a year
          beside two month arrows, and there is no reading of it that is not a control.
        */}
        <select
          value={shownYear}
          onChange={(e) => moveTo(addYears(cursor, Number(e.target.value) - shownYear))}
          aria-label="Year"
          className={`${CONTROL} w-[58px] appearance-none px-1 text-center tabular-nums text-ink hover:border-hairlit`}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        {/*
          Takes the date rather than just scrolling to it: a shortcut that leaves you
          one more click from the value you asked for is only a third month stepper.
          It goes dead behind a `min` in the future, and needs no explanation for it —
          the greyed cells below are already saying that nothing before the start can
          be chosen.

          Not the shared `Button`: that one carries its own `py-2`, and this row's four
          controls have to agree on a height to the pixel. They are all `CONTROL` now,
          which is the only way three different elements — a select, a button and two
          steppers — line up without being nudged one at a time.
        */}
        <button
          type="button"
          disabled={barred(today)}
          onClick={() => onPick(today)}
          className={`${CONTROL} ml-auto px-2 tracking-[0.14em] text-dim hover:border-hairlit hover:text-ink disabled:opacity-40`}
        >
          TODAY
        </button>

        <Step label="Previous month" onClick={() => moveTo(addMonths(cursor, -1))}>
          ‹
        </Step>
        <Step label="Next month" onClick={() => moveTo(addMonths(cursor, 1))}>
          ›
        </Step>
      </div>

      <div
        tabIndex={0}
        role="grid"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="grid grid-cols-7 gap-px outline-none"
      >
        {WEEKDAYS.map((w) => (
          <div key={w} className="pb-1 text-center text-[9px] leading-none text-mute">
            {w}
          </div>
        ))}

        {days.map((d) => {
          const off = barred(d);
          const outside = parts(d).month !== shownMonth;
          const endpoint = d === from || d === to;
          /** Strictly between, so the two lit ends keep their heavier treatment. */
          const inside = isRange && d > from && d < to;

          return (
            <button
              key={d}
              type="button"
              // Out of the tab order on purpose. Forty-two tab stops is not
              // navigation, and the arrows already reach every one of them from the
              // grid's own focus.
              tabIndex={-1}
              disabled={off}
              // Keeps focus wherever it already was. `WhenField` decides which of its
              // two date fields a click lands in by which one holds focus, and a
              // button that takes focus on mousedown would answer that question by
              // destroying it.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(d)}
              aria-label={d}
              aria-current={endpoint ? 'date' : undefined}
              className={[
                'flex h-[30px] items-center justify-center text-[11px] leading-none tabular-nums transition-colors',
                off
                  ? 'text-mute opacity-40'
                  : d === today
                    ? // Inversion, not an accent colour: category colour is the only
                      // hue in the app, and today competing with it would cost more
                      // than it says.
                      'bg-bright font-medium text-void'
                    : endpoint
                      ? 'bg-raised text-bright'
                      : inside
                        ? // A step under the endpoints rather than the same fill. The
                          // span has to read as belonging to them without competing
                          // for which cell you actually chose.
                          'bg-sunken text-dim hover:bg-raised hover:text-ink'
                        : outside
                          ? 'text-mute hover:bg-raised hover:text-dim'
                          : 'text-dim hover:bg-raised hover:text-ink',
                // Drawn inside the cell rather than as an outline, which at this gap
                // would sit on top of the neighbouring day.
                d === cursor ? 'shadow-[inset_0_0_0_1px_var(--color-dim)]' : '',
              ].join(' ')}
            >
              {parts(d).day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Step({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`${CONTROL} w-[26px] text-[12px] text-mute hover:border-hairlit hover:text-ink`}
    >
      {children}
    </button>
  );
}
