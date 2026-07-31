'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDays,
  addMonths,
  addYears,
  compareDates,
  dayOfWeek,
  parts,
  startOfMonth,
  startOfWeek,
  todayIn,
  type CivilDate,
} from '@/lib/tempo/civil';
import { epochYears, MONTHS_LONG, WEEKDAYS } from './constants';
import { Button, inputClass } from './ui';

/**
 * A date field that is a date field, rather than a glyph beside one.
 *
 * This replaces `<input type="date">`, which was wrong here in three ways. Its
 * only affordance is a 16px icon parked at the right-hand end of the field, so
 * the other 90% of a control that looks clickable does nothing. It opens the
 * browser's own popup — a bright, rounded, system-coloured month on top of a
 * monochrome hairline interface. And it renders its value through the OS
 * locale, so the one field that had to agree with the `YYYY-MM-DD` printed on
 * every other surface of this app was the one the app did not control.
 *
 * No `Date` object ever holds a value here. Every step, clamp and comparison
 * goes through `civil.ts` — see its header, and DESIGN.md §3, for why an
 * all-day value that becomes a `Date` is a bug waiting for a timezone change.
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

interface Props {
  value: CivilDate;
  onChange: (d: CivilDate) => void;
  /** Earliest selectable date, inclusive. */
  min?: CivilDate;
  /** Timezone, for resolving what "today" means. */
  timezone: string;
  /** Rendered by the caller's <Field>; used for the trigger's aria-label. */
  label: string;
}

export function DatePicker({
  value,
  onChange,
  min,
  timezone,
  label,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);

  /**
   * The highlighted day, and the only navigation state there is.
   *
   * The month on screen is `startOfMonth(cursor)` rather than a second value
   * kept alongside it, so the two can never disagree about where you are.
   * `addMonths` always lands inside the month it was asked for, which is what
   * makes deriving the month back out safe: stepping from the 31st into
   * February clamps the *day* to the 28th, but the month sequence is still
   * Jan → Feb → Mar and stepping back returns to January.
   */
  const [cursor, setCursor] = useState<CivilDate>(value);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const today = useMemo(() => todayIn(timezone), [timezone]);
  const monthStart = startOfMonth(cursor);
  const { year: shownYear, month: shownMonth } = parts(cursor);

  /**
   * Every year in the epoch, plus whichever one is on screen. A `<select>`
   * whose value is absent from its options renders blank in every browser, so
   * an entry dated outside the epoch would silently lose the one number the
   * header exists to state. Same splice, for the same reason, as `YearView`.
   */
  const years = useMemo(() => epochYears(parts(today).year, shownYear), [today, shownYear]);

  const days = useMemo(() => {
    const first = startOfWeek(monthStart);
    return Array.from({ length: GRID_DAYS }, (_, i) => addDays(first, i));
  }, [monthStart]);

  const clamp = (d: CivilDate): CivilDate =>
    min !== undefined && compareDates(d, min) < 0 ? min : d;
  /** Below the floor, so it is drawn but cannot be chosen. */
  const barred = (d: CivilDate): boolean => clamp(d) !== d;

  /**
   * Every cursor move lands here, so the highlight can never come to rest on a
   * day the field is not allowed to hold — it stops at `min` rather than
   * walking past it, which is the same statement the greyed-out cells make.
   * The steppers and the year select move the cursor too rather than moving a
   * view of their own; see the note on `cursor`.
   */
  function moveTo(d: CivilDate) {
    setCursor(clamp(d));
  }

  function close(restoreFocus: boolean) {
    setOpen(false);
    // Focus returns to the trigger on Escape and on picking a date. Not on an
    // outside click: that click has already said where focus belongs, and
    // dragging it back would steal the field you were aiming at.
    if (restoreFocus) triggerRef.current?.focus();
  }

  function commit(d: CivilDate) {
    onChange(d);
    close(true);
  }

  useEffect(() => {
    if (!open) return;
    // The panel takes focus, not a day cell — the cells are deliberately out of
    // the tab order. Focusing it is also what scrolls the popup into view when
    // the field sits near the bottom of a form that scrolls.
    panelRef.current?.focus();
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      // Escape has to stop here. The shell owns one keymap and unwinds one
      // layer per press; without this the same press would reach `window` and
      // take the whole entry modal with it. Registering the picker with the
      // shell instead would mean two listeners racing over listener order,
      // which is the thing the single keymap exists to avoid.
      e.stopPropagation();
      close(true);
      return;
    }

    // The year `<select>` owns the arrow keys while it has focus. Enter inside
    // one is also worth swallowing: in some browsers it triggers the
    // surrounding form's implicit submit, which would save a half-filled entry
    // from a keystroke that meant "this year".
    if ((e.target as HTMLElement).tagName === 'SELECT') {
      if (e.key === 'Enter') e.preventDefault();
      return;
    }

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
        // Only when the panel itself holds focus. On a stepper or on TODAY,
        // Enter is that button's own activation, and taking it would leave a
        // focused control that ignores the key it advertises.
        if (e.target === e.currentTarget) {
          e.preventDefault();
          commit(cursor);
        }
        break;
    }
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        // Inside the entry form's `<form>`, so without this every date field is
        // a submit button.
        type="button"
        onClick={() => {
          if (open) return close(true);
          // Reopening starts from what is stored, not from wherever the last
          // visit wandered off to and abandoned.
          moveTo(value);
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        /*
          The `<Field>` around this reads `[02] START` — a position in a form,
          not the name of a control — and `label` is the human one. They have to
          be merged here because a button's accessible name replaces its text
          rather than adding to it, and the text is the value.
        */
        aria-label={`${label}, ${value}`}
        className={`${inputClass} flex items-center justify-between gap-2 text-left tabular-nums ${
          open ? 'shadow-[inset_0_0_0_1px_var(--color-hairlit)]' : ''
        }`}
      >
        <span>{value}</span>
        <span className="label">{WEEKDAYS[dayOfWeek(value)]}</span>
      </button>

      {open && (
        <>
          {/* Catches the dismissing click. A window listener would race the
              trigger's own onClick and reopen what it just closed. */}
          <div className="fixed inset-0 z-20" onClick={() => close(false)} />

          <div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-label={label}
            onKeyDown={onKeyDown}
            className="absolute left-0 top-[calc(100%+4px)] z-30 w-[256px] border border-hairlit bg-panel p-2 shadow-[0_8px_24px_rgba(0,0,0,0.7)] outline-none"
          >
            <div className="mb-2 flex items-center gap-1">
              <Step label="Previous month" onClick={() => moveTo(addMonths(cursor, -1))}>
                ‹
              </Step>

              <span className="min-w-0 flex-1 truncate px-1 text-[11px] uppercase tracking-[0.16em] text-dim">
                {MONTHS_LONG[shownMonth - 1]}
              </span>

              {/* Width on the wrapper, not on the select: `inputClass` is
                  `w-full`, and a second width beside it would be settled by
                  whichever Tailwind emitted last rather than by which one is
                  written last. Same wrapper, for the same reason, as
                  `YearView`. */}
              <div className="w-[86px] shrink-0">
                <select
                  value={shownYear}
                  onChange={(e) => moveTo(addYears(cursor, Number(e.target.value) - shownYear))}
                  aria-label="Year"
                  className={`${inputClass} tabular-nums`}
                >
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              <Step label="Next month" onClick={() => moveTo(addMonths(cursor, 1))}>
                ›
              </Step>
            </div>

            <div className="grid grid-cols-7 gap-px">
              {WEEKDAYS.map((w) => (
                <div key={w} className="pb-1 text-center text-[9px] leading-none text-mute">
                  {w}
                </div>
              ))}

              {days.map((d) => {
                const off = barred(d);
                const outside = parts(d).month !== shownMonth;

                return (
                  <button
                    key={d}
                    type="button"
                    // Out of the tab order on purpose. Forty-two tab stops is
                    // not navigation, and the arrows already reach every one of
                    // them from the panel's own focus.
                    tabIndex={-1}
                    disabled={off}
                    onClick={() => commit(d)}
                    aria-label={d}
                    aria-current={d === value ? 'date' : undefined}
                    className={[
                      'flex h-[30px] items-center justify-center text-[11px] leading-none tabular-nums transition-colors',
                      off
                        ? 'text-mute opacity-40'
                        : d === today
                          ? // Inversion, not an accent colour: category colour
                            // is the only hue in the app, and today competing
                            // with it would cost more than it says.
                            'bg-bright font-medium text-void'
                          : d === value
                            ? 'bg-raised text-bright'
                            : outside
                              ? 'text-mute hover:bg-raised hover:text-dim'
                              : 'text-dim hover:bg-raised hover:text-ink',
                      // Drawn inside the cell rather than as an outline, which
                      // at this gap would sit on top of the neighbouring day.
                      d === cursor ? 'shadow-[inset_0_0_0_1px_var(--color-dim)]' : '',
                    ].join(' ')}
                  >
                    {parts(d).day}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 flex items-center gap-2 border-t border-hair pt-2">
              {/*
                Takes the date rather than just scrolling to it: a shortcut that
                leaves you one more click from the value you asked for is only a
                third month stepper. It goes dead behind a `min` in the future,
                and needs no explanation for it — the greyed cells above are
                already saying that nothing before START can be chosen.
              */}
              <Button type="button" disabled={barred(today)} onClick={() => commit(today)}>
                TODAY
              </Button>

              <span className="label ml-auto tabular-nums">
                {WEEKDAYS[dayOfWeek(cursor)]} {cursor}
              </span>
            </div>
          </div>
        </>
      )}
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
      className="shrink-0 border border-hair px-2 py-1 text-[12px] leading-none text-mute transition-colors hover:border-hairlit hover:text-ink"
    >
      {children}
    </button>
  );
}
