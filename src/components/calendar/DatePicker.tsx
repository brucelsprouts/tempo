'use client';

import { useMemo, useRef, useState } from 'react';
import { dayOfWeek, todayIn, type CivilDate } from '@/lib/tempo/civil';
import { MonthGrid } from './MonthGrid';
import { WEEKDAYS } from './constants';
import { inputClass, Popover } from './ui';

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
 * What is left here is the popup and the trigger: the month itself is `MonthGrid`,
 * shared with `WhenField`. This is now the single-date picker only — the entry
 * form's start and end moved to `WhenField`, and the one caller left is ANCHOR
 * DATE, which genuinely has one date and no time.
 */

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
   * The highlighted day, handed down to the grid. Kept here rather than inside
   * `MonthGrid` so that reopening starts from what is stored, not from wherever
   * the last visit wandered off to and abandoned.
   */
  const [cursor, setCursor] = useState<CivilDate>(value);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const today = useMemo(() => todayIn(timezone), [timezone]);

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

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        // Inside the entry form's `<form>`, so without this every date field is
        // a submit button.
        type="button"
        onClick={() => {
          if (open) return close(true);
          setCursor(value);
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        /*
          The `<Field>` around this reads `ANCHOR DATE` — a position in a form,
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
        <Popover
          anchorRef={triggerRef}
          onDismiss={() => close(false)}
          width={256}
          label={label}
          onKeyDown={(e) => {
            // Escape has to stop here. The shell owns one keymap and unwinds one
            // layer per press; without this the same press would reach `window`
            // and take the whole entry modal with it. Registering the picker with
            // the shell instead would mean two listeners racing over listener
            // order, which is the thing the single keymap exists to avoid.
            //
            // The arrows and Enter are `MonthGrid`'s, and it has focus.
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            close(true);
          }}
        >
          <MonthGrid
            label={label}
            cursor={cursor}
            onCursor={setCursor}
            onPick={commit}
            today={today}
            selection={value}
            min={min}
            // The grid takes focus, not a day cell.
            autoFocus
          />
        </Popover>
      )}
    </div>
  );
}
