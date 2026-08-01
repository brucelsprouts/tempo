'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { inputClass } from './ui';

/**
 * A time field drawn by this app rather than by the browser.
 *
 * `DatePicker` replaced `<input type="date">` for three reasons; two of them
 * apply here unchanged. `<input type="time">` opens the browser's own spinner —
 * a system-coloured widget on top of a monochrome hairline interface — and
 * renders through the OS locale, so the one field that had to agree with the
 * 24-hour `HH:MM` on every bar in the grid was the one the app did not control.
 *
 * The third reason inverts, and that is the whole difference between the two
 * components. A date input's only affordance is an icon at the far end, so the
 * field itself was dead; a time input is genuinely typeable, and that is the
 * fastest way to enter a time. So the trigger here *is* a text input rather than
 * a button, and everything below exists to keep typing and the list agreeing
 * with each other.
 *
 * Values are minutes from midnight, which is what `EventDraft`,
 * `Occurrence.startMinutes` and `setOccurrenceTime` already speak. No `Date`
 * object holds a time of day — see DESIGN.md §3.
 */

const DAY_MINUTES = 24 * 60;

/**
 * The list is a convenience, not the input. 15 minutes is 96 rows, which is
 * more than fits and is meant to be: the common times are reachable by eye and
 * anything else is one typed word away, whereas a coarser step would make the
 * list *look* like the set of legal values and quietly hide 09:05.
 */
const STEP = 15;
const ROWS = Array.from({ length: DAY_MINUTES / STEP }, (_, i) => i * STEP);

/**
 * Fixed row height, so opening the panel positions the list by arithmetic
 * rather than by `scrollIntoView` on a cell. The same reasoning as the week
 * grid's `ROW_H`: a measured scroll on a list that was laid out this frame
 * either settles visibly or lands on nothing at all.
 */
const ROW_H = 26;
const VISIBLE_ROWS = 8;

/**
 * Always 24-hour and zero-padded, which is the same rule as `EventBar`'s
 * `timeLabel` and for the same reason — a bare "9" is not a time. Deliberately
 * a second copy rather than an import: `EventBar` is in the drag-and-drop path
 * and owes this component nothing, and four lines of `padStart` is a cheaper
 * coupling than a shared module neither file would otherwise reach for.
 */
export function formatMinutes(n: number): string {
  const h = Math.floor(n / 60);
  return `${String(h).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

/**
 * What the field will accept from a keyboard, and the only place that decides.
 *
 * Pure and exported so it can be tested against the strings people actually
 * type, which is a much larger set than the strings a component test would
 * think to send. `null` means "this is not a time" — the caller is expected to
 * hold its previous value rather than to display something invalid, because a
 * time field that can be empty is a time field that can be saved empty.
 */
export function parseTimeInput(raw: string): number | null {
  const s = raw.trim();

  const colon = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (colon) return minutesOf(Number(colon[1]), Number(colon[2]));

  if (!/^\d{1,4}$/.test(s)) return null;

  // One or two digits is an hour; three or four is an hour followed by minutes,
  // with the minutes always taking the last two. So `9` is 09:00, `930` and
  // `0930` are both 09:30 — which is what gets typed by anyone who has stopped
  // reaching for the colon.
  return s.length <= 2
    ? minutesOf(Number(s), 0)
    : minutesOf(Number(s.slice(0, -2)), Number(s.slice(-2)));
}

/** Out-of-range digits are garbage, not something to wrap or clamp: `2500` is a typo. */
function minutesOf(h: number, m: number): number | null {
  return h > 23 || m > 59 ? null : h * 60 + m;
}

interface Props {
  /** Minutes from midnight. */
  value: number;
  onChange: (minutes: number) => void;
  /** Earliest selectable time, inclusive. */
  min?: number;
  /** Rendered by the caller's <Field>; used for the input's aria-label. */
  label: string;
}

export function TimePicker({ value, onChange, min, label }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);

  /**
   * What is being typed, and only while the panel is open.
   *
   * Closed, the input renders `value` directly rather than a copy of it, so
   * there is no second source of truth to keep in step and no effect syncing
   * one to the other — an external change, such as the end time being pushed
   * forward when the start time moves past it, simply appears.
   */
  const [text, setText] = useState('');

  /**
   * The pending value: what the field is showing and what Enter will take.
   *
   * It is not snapped to `STEP`. Typing `09:37` moves it to 577, which no row
   * can highlight, and that is correct — the list is 96 shortcuts, not the set
   * of legal times. The arrows are what put it back on the grid.
   */
  const [cursor, setCursor] = useState(value);

  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Distinguishes the first scroll after opening from every later one. */
  const opening = useRef(false);
  /** Whether the close now in flight owes the field its focus back. */
  const restoring = useRef(false);
  const uid = useId();

  const floor = min ?? 0;
  const clamp = (m: number): number => Math.min(DAY_MINUTES - 1, Math.max(floor, m));

  function openPanel() {
    setText(formatMinutes(value));
    setCursor(clamp(value));
    opening.current = true;
    setOpen(true);
  }

  function close(restoreFocus: boolean) {
    setOpen(false);
    // Focus returns to the field on Escape and on picking a time. Not on an
    // outside click: that click has already said where focus belongs. Deferred
    // to the effect below rather than done here — see it for why.
    restoring.current = restoreFocus;
  }

  useEffect(() => {
    if (open || !restoring.current) return;
    restoring.current = false;
    /*
      Selected, not merely focused, and only once the closed value has been
      rendered.

      Programmatic focus fires no focus event, so the handler that normally
      selects the field never runs — and a field that is focused with the caret
      parked after `09:30` turns the next thing you type into `09:3021:00`.
      Doing it before the render would not help either: React assigns the new
      value straight onto the node, which drops any selection made against the
      old one.
    */
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open]);

  function commit(m: number) {
    onChange(clamp(m));
    close(true);
  }

  /**
   * Take whatever the field is currently showing.
   *
   * This is where the two pickers deliberately differ. `DatePicker` throws its
   * cursor away on an outside click, because moving the highlight around a
   * month is browsing. Here the cursor *is* the text in the field, so
   * discarding it would snap a typed `21:30` back to `09:00` the moment you
   * clicked the next control — the one failure a text field must not have.
   * Escape remains the way to abandon an edit.
   */
  function settle(restoreFocus: boolean) {
    onChange(clamp(cursor));
    close(restoreFocus);
  }

  const nearestRow = (m: number) =>
    Math.min(ROWS.length - 1, Math.max(0, Math.round(m / STEP)));

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;

    const top = nearestRow(cursor) * ROW_H;

    if (opening.current) {
      opening.current = false;
      // Centred on open, so the value you already hold has context above and
      // below it instead of sitting against an edge.
      list.scrollTop = top - (list.clientHeight - ROW_H) / 2;
      // `DatePicker` gets this free by focusing its panel. Focus has to stay in
      // the input here or typing would go nowhere, so a form scrolled far
      // enough to put this field near its bottom edge needs telling.
      panelRef.current?.scrollIntoView({ block: 'nearest' });
      return;
    }

    // Afterwards, the minimum scroll that keeps the cursor visible. Re-centring
    // on every arrow press would move the whole list under a key that means
    // "one row".
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + ROW_H > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + ROW_H - list.clientHeight;
    }
  }, [open, cursor]);

  function moveTo(m: number) {
    const next = clamp(m);
    setCursor(next);
    setText(formatMinutes(next));
  }

  /**
   * The next row strictly past the cursor, so a typed 09:37 snaps onto the grid
   * rather than carrying its stray minutes along. Stops at either end instead
   * of running off it — the same statement the greyed-out rows make.
   */
  function step(dir: 1 | -1) {
    const grid = dir === 1 ? Math.floor(cursor / STEP) + 1 : Math.ceil(cursor / STEP) - 1;
    moveTo(ROWS[Math.min(ROWS.length - 1, Math.max(0, grid))]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!open) {
      // Closed, this field claims exactly one thing: the arrows open it, the
      // way they open a native select. Everything else — Escape, and the Enter
      // that submits the form — has to pass, or a closed picker would be a
      // silent hole in the shell's keymap.
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        openPanel();
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        // Escape has to stop here. The shell owns one keymap and unwinds one
        // layer per press; without this the same press would reach `window` and
        // take the whole entry modal with it. React's listener sits on the root
        // container, so stopping the synthetic event stops the native one
        // before `window` ever sees it — which is what keeps "picker before
        // modal" from depending on the order two listeners were registered in.
        e.stopPropagation();
        close(true);
        break;
      case 'ArrowDown':
        e.preventDefault();
        step(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        step(-1);
        break;
      case 'Enter':
        // Swallowed rather than allowed through: this is a real `<form>`, and
        // the Enter that means "this time" would otherwise also mean "save",
        // committing a half-filled entry from one keystroke.
        e.preventDefault();
        settle(true);
        break;
    }
  }

  const activeRow = open && cursor % STEP === 0 ? `${uid}-${cursor}` : undefined;

  return (
    <div className="relative" onKeyDown={onKeyDown}>
      <input
        ref={inputRef}
        type="text"
        // Deliberately not `type="time"`. That is the control this exists to
        // replace, and a browser that decided to render it natively again would
        // undo the whole component silently.
        value={open ? text : formatMinutes(value)}
        onChange={(e) => {
          if (!open) openPanel();
          setText(e.target.value);
          const parsed = parseTimeInput(e.target.value);
          // A half-typed time leaves the cursor where it was rather than
          // snapping somewhere on the way: `9` → `93` → `930` passes through a
          // string that is not a time, and the list must not jump to 09:00 and
          // back on the way to 09:30.
          if (parsed !== null) setCursor(clamp(parsed));
        }}
        onClick={(e) => {
          // Only opens. Clicking an open field is placing the caret, and a
          // toggle here would close the panel out from under a correction.
          if (open) return;
          openPanel();
          // Again, after the click rather than only on focus: the mouseup that
          // preceded this collapsed the selection the focus handler made, so
          // without it the first thing you type lands beside 09:00 instead of
          // replacing it.
          e.currentTarget.select();
        }}
        // Selected, not just focused, for the same reason as the title field:
        // the field already holds a time and the reason to come here is to
        // replace it.
        onFocus={(e) => e.currentTarget.select()}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? `${uid}-list` : undefined}
        aria-activedescendant={activeRow}
        aria-label={label}
        // Above the dismissing overlay below, unlike `DatePicker`'s trigger.
        // The field has to stay clickable while the panel is open or the caret
        // is unreachable, and blurring an input to close its own popup is how
        // you lose a keystroke.
        className={`${inputClass} relative z-30 tabular-nums ${
          open ? 'shadow-[inset_0_0_0_1px_var(--color-hairlit)]' : ''
        }`}
      />

      {open && (
        <>
          {/* Catches the dismissing click. A window listener would race the
              field's own onClick and reopen what it just closed. */}
          <div className="fixed inset-0 z-20" onClick={() => settle(false)} />

          <div
            ref={panelRef}
            className="absolute left-0 top-[calc(100%+4px)] z-30 w-[132px] border border-hairlit bg-panel p-1 shadow-[0_8px_24px_rgba(0,0,0,0.7)]"
          >
            <div
              ref={listRef}
              id={`${uid}-list`}
              role="listbox"
              aria-label={label}
              className="overflow-y-auto"
              style={{ height: VISIBLE_ROWS * ROW_H }}
            >
              {ROWS.map((m) => {
                const off = m < floor;

                return (
                  <button
                    key={m}
                    id={`${uid}-${m}`}
                    type="button"
                    role="option"
                    aria-selected={m === value}
                    // Out of the tab order on purpose, like the date grid's
                    // cells: 96 tab stops is not navigation, and the arrows
                    // already reach every one of them.
                    tabIndex={-1}
                    disabled={off}
                    onClick={() => commit(m)}
                    style={{ height: ROW_H }}
                    className={[
                      'flex w-full items-center px-2 text-[11px] leading-none tabular-nums transition-colors',
                      off
                        ? 'text-mute opacity-40'
                        : m === value
                          ? 'bg-raised text-bright'
                          : // The hour is a step brighter than the quarters
                            // under it. Ninety-six evenly weighted rows is a
                            // wall; this makes the column scannable in fours
                            // without adding a rule or a gap between them.
                            m % 60 === 0
                            ? 'text-dim hover:bg-raised hover:text-ink'
                            : 'text-mute hover:bg-raised hover:text-ink',
                      m === cursor ? 'shadow-[inset_0_0_0_1px_var(--color-dim)]' : '',
                    ].join(' ')}
                  >
                    {formatMinutes(m)}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
