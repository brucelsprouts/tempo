'use client';

import { useRef, useState } from 'react';
import { inputClass } from './ui';

/**
 * A time field you type into. That is the whole of it.
 *
 * `<input type="time">` was wrong here for two reasons: it opens the browser's own
 * spinner — a system-coloured widget on top of a monochrome hairline interface — and
 * it renders through the OS locale, so the one field that had to agree with the
 * 24-hour `HH:MM` on every bar in the grid was the one the app did not control.
 *
 * The replacement then spent two versions making a smaller copy of the same mistake.
 * First a 96-row scroller, which read as *the* control and made the field look like
 * something you pick from — and picking from a 15-minute grid is exactly how you fail
 * to enter 09:37. Then six filtered suggestions, which was less of a menu but still a
 * menu: a panel opening under a field that already knew what you meant. Both are gone.
 * There is no panel, nothing opens, and the only way to state a time is to type one —
 * which was always the fast path, and is now the only one.
 *
 * What carries the weight instead is `parseTimeInput`, which is deliberately generous
 * about what counts as a time. A field with no list has to accept `9`, `930` and `9pm`
 * without complaint, because there is nothing else to fall back on.
 *
 * Values are minutes from midnight, which is what `WhenValue`, `Occurrence.startMinutes`
 * and `setOccurrenceTime` already speak. No `Date` object holds a time of day — see
 * DESIGN.md §3.
 */

const DAY_MINUTES = 24 * 60;

/**
 * What an arrow key moves by. Matches `DayView`'s drag snap, so nudging a time here
 * and dragging the same block on the timeline land on the same set of values.
 */
const STEP = 15;

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

/** The digit forms, before anything has decided what half of the day they are in. */
function readDigits(s: string): { h: number; m: number } | null {
  const colon = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (colon) return { h: Number(colon[1]), m: Number(colon[2]) };

  if (!/^\d{1,4}$/.test(s)) return null;

  // One or two digits is an hour; three or four is an hour followed by minutes,
  // with the minutes always taking the last two. So `9` is 09:00, `930` and
  // `0930` are both 09:30 — which is what gets typed by anyone who has stopped
  // reaching for the colon.
  return s.length <= 2
    ? { h: Number(s), m: 0 }
    : { h: Number(s.slice(0, -2)), m: Number(s.slice(-2)) };
}

/**
 * What the field will accept from a keyboard, and the only place that decides.
 *
 * Pure and exported so it can be tested against the strings people actually type,
 * which is a much larger set than the strings a component test would think to send.
 * `null` means "this is not a time" — the caller holds its previous value rather than
 * displaying something invalid, because a time field that can be empty is a time
 * field that can be saved empty.
 *
 * It reads am/pm even though it never writes them. Half the people who type a time
 * type it that way, and with no list to fall back on, refusing `3pm` would leave them
 * with no way in at all. The display stays 24-hour regardless — that is the rule
 * everywhere else in the app, and a field that echoed back what you typed would be
 * the only surface disagreeing with the grid.
 */
export function parseTimeInput(raw: string): number | null {
  const s = raw.trim().toLowerCase();

  if (s === 'noon') return 12 * 60;
  if (s === 'midnight') return 0;

  // `9pm`, `9 pm`, `9p`, `9 p.m.`, `9:30pm`, `930pm`. The letters are stripped here
  // and the digits go through the same reader as an unsuffixed time, so the two
  // paths cannot drift apart on what `930` means.
  const meridiem = /^(.*?)\s*([ap])\.?m?\.?$/.exec(s);
  if (meridiem) {
    const d = readDigits(meridiem[1]);
    // A 12-hour clock has no hour 0 and no hour 13. `0am` and `13pm` are typos, not
    // something to wrap: the unsuffixed form is right there for anyone who meant 13.
    if (!d || d.h < 1 || d.h > 12 || d.m > 59) return null;
    return ((d.h % 12) + (meridiem[2] === 'p' ? 12 : 0)) * 60 + d.m;
  }

  const d = readDigits(s);
  // Out-of-range digits are garbage, not something to wrap or clamp: `2500` is a
  // typo, and 24:00 is a real instant that this app cannot hold — `endMinutes` tops
  // out at 23:59, so accepting it would round-trip wrong.
  return !d || d.h > 23 || d.m > 59 ? null : d.h * 60 + d.m;
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
  /**
   * What is being typed, or `null` for "nothing is".
   *
   * Not editing, the input renders `value` directly rather than a copy of it, so there
   * is no second source of truth to keep in step and no effect syncing one to the
   * other — an external change, such as the end time being pushed forward when the
   * start time moves past it, simply appears.
   */
  const [text, setText] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const floor = min ?? 0;
  const clamp = (m: number): number => Math.min(DAY_MINUTES - 1, Math.max(floor, m));

  /**
   * Take whatever is in the field, and keep the old value if it is not a time.
   *
   * Reverting on an unparseable string rather than clearing or complaining: the field
   * cannot be empty — an entry with no end time is not a thing this app can store — so
   * the only safe reading of `qqq` is that you did not change your mind about 09:00.
   */
  function settle() {
    if (text === null) return;
    const parsed = parseTimeInput(text);
    setText(null);
    if (parsed !== null) onChange(clamp(parsed));
  }

  /**
   * The next 15-minute mark past wherever the field currently is.
   *
   * Strictly past, so a typed 09:37 lands on 09:45 rather than carrying its stray
   * minutes along. This is what the arrows used to do to a list of rows; with the list
   * gone they do it to the value, which is the same gesture with one fewer thing on
   * screen.
   */
  function nudge(dir: 1 | -1) {
    const from = (text !== null ? parseTimeInput(text) : null) ?? value;
    const grid = dir === 1 ? Math.floor(from / STEP) + 1 : Math.ceil(from / STEP) - 1;
    setText(null);
    onChange(clamp(grid * STEP));
  }

  return (
    <input
      ref={inputRef}
      type="text"
      // Deliberately not `type="time"`. That is the control this exists to replace,
      // and a browser that decided to render it natively again would undo the whole
      // component silently.
      value={text ?? formatMinutes(value)}
      onChange={(e) => setText(e.target.value)}
      // Selected, not just focused: the field already holds a time and the reason to
      // come here is to replace it, so the first keystroke should overwrite rather
      // than land beside `09:00`.
      onFocus={(e) => e.currentTarget.select()}
      onBlur={settle}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          // Swallowed rather than allowed through: this is inside a real `<form>`, and
          // the Enter that means "this time" would otherwise also mean "save",
          // committing a half-filled entry from one keystroke.
          e.preventDefault();
          settle();
          e.currentTarget.select();
        } else if (e.key === 'Escape' && text !== null) {
          // One layer at a time. Mid-edit, Escape abandons the edit; with nothing
          // typed it passes, and the popover above closes. Stopping it
          // unconditionally would make this field a hole in the shell's keymap.
          e.stopPropagation();
          setText(null);
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          nudge(e.key === 'ArrowDown' ? 1 : -1);
        }
      }}
      autoComplete="off"
      spellCheck={false}
      inputMode="numeric"
      aria-label={label}
      className={`${inputClass} tabular-nums`}
    />
  );
}
