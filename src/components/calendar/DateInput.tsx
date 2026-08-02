'use client';

import type { CivilDate } from '@/lib/tempo/civil';
import { inputClass } from './ui';
import { parseDateInput } from './when';

/**
 * A date you can type, wherever a date is being asked for.
 *
 * This was `WhenField`'s private `dateField` closure, and it stayed private for
 * exactly as long as there was one surface that let you type a date. `DatePicker` —
 * BIRTH DATE and ANCHOR DATE — did not: its trigger was a button and the only way in
 * was the grid, so setting a birth date in 1994 meant three hundred and eighty-four
 * clicks on the month stepper or a trip through the year select. Two date surfaces in
 * the same form, one of which could be typed into and one of which could not, is not
 * a distinction anyone filling in the form was going to discover.
 *
 * The draft is *controlled* rather than owned here, which looks like a wart and is
 * load-bearing. `WhenField` clears the draft when you click the calendar, and the
 * grid's cells suppress mousedown so that the click never blurs this input — an input
 * holding its own draft would go on displaying half-typed text while the stored value
 * changed underneath it. Handing the draft up is what lets a caller say "that edit is
 * over" for a reason this component cannot see.
 *
 * `null` means "nothing typed", and the field renders `value` directly rather than a
 * copy of it, so a date set from the calendar simply appears.
 */

interface Props {
  /** The stored date, shown whenever `draft` is null. */
  value: CivilDate;
  draft: string | null;
  onDraft: (s: string | null) => void;
  /**
   * A parsed date. `source` is how it was committed: a caller with one date to collect
   * can close itself on `enter` and must not on `blur`, which is also what Tabbing to
   * the grid looks like from here.
   */
  onCommit: (d: CivilDate, source: 'enter' | 'blur') => void;
  /** The caller's own focus bookkeeping. Runs after the draft is cleared. */
  onFocus?: () => void;
  /** Draws the focus ring. Not `:focus`, because `WhenField` keeps it lit on the field a grid click will land in. */
  lit: boolean;
  label: string;
  /**
   * Focusing this on open is the caller's job, and it has to be done from an effect
   * against this ref rather than with React's `autoFocus`. `Popover` lays itself out
   * once at `visibility: hidden` so it can measure itself before placing itself, and
   * React applies `autoFocus` during that first commit — at which point the browser
   * refuses the focus, silently, and the keystrokes go to whatever had it before. In
   * this form that is the title field, so a typed date ends up as the entry's name.
   */
  inputRef?: React.Ref<HTMLInputElement>;
}

export function DateInput({
  value,
  draft,
  onDraft,
  onCommit,
  onFocus,
  lit,
  label,
  inputRef,
}: Props): React.JSX.Element {
  function commit(source: 'enter' | 'blur') {
    if (draft === null) return;
    // Parsed against the value the field already holds, so `8/4` and a bare `12` land
    // in the month and year you were looking at.
    const parsed = parseDateInput(draft, value);
    onDraft(null);
    if (parsed !== null) onCommit(parsed, source);
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={draft ?? value}
      onChange={(e) => onDraft(e.target.value)}
      onFocus={(e) => {
        onDraft(null);
        // Selected, not just focused: the field already holds a date and the reason to
        // come here is to replace it.
        e.currentTarget.select();
        onFocus?.();
      }}
      onBlur={() => commit('blur')}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          // Swallowed rather than allowed through: this sits inside a real `<form>`,
          // and the Enter that means "this date" would otherwise also mean "save".
          e.preventDefault();
          commit('enter');
        } else if (e.key === 'Escape' && draft !== null) {
          // One layer at a time. Mid-edit, Escape abandons the edit; the next press
          // finds no draft and reaches the popover, which closes.
          e.stopPropagation();
          onDraft(null);
        }
      }}
      autoComplete="off"
      spellCheck={false}
      aria-label={label}
      className={`${inputClass} tabular-nums ${
        lit ? 'shadow-[inset_0_0_0_1px_var(--color-hairlit)]' : ''
      }`}
    />
  );
}
