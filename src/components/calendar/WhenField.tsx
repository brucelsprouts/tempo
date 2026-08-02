'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { dayOfWeek, todayIn, type CivilDate } from '@/lib/tempo/civil';
import { DateInput } from './DateInput';
import { MonthGrid } from './MonthGrid';
import { TimePicker } from './TimePicker';
import { WEEKDAYS } from './constants';
import { inputClass, Popover, Toggle } from './ui';
import { formatWhen, LAST_MINUTE, normalizeWhen, type WhenValue } from './when';

/**
 * When an entry happens, in one place.
 *
 * The entry form used to ask this question with five controls — a SPAN segmented
 * control, two `DatePicker`s and two `TimePicker`s — each of which opened its own
 * popup over the form. Setting "Friday afternoon to Sunday morning" meant four
 * separate popups, and none of them could show you the other three's answers, so the
 * shape of the thing you were describing only existed in your head.
 *
 * This is Notion's arrangement instead: one field, one popover, and inside it the two
 * ends stated as text with a single month underneath serving both. A click in the
 * calendar lands in whichever field has focus — that is what the lit ring on a field
 * is telling you — so the same grid sets the start, then the end, without ever asking
 * which one you meant.
 *
 * `SPAN` is gone rather than relocated. "All day" and "include time" are the same
 * question, and a form that asks it twice will eventually get two answers.
 */

interface Props {
  value: WhenValue;
  onChange: (v: WhenValue) => void;
  /** For resolving what "today" means. */
  timezone: string;
}

export function WhenField({ value, onChange, timezone }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);

  /**
   * Whether the entry has a distinct end, and the one piece of state here that is
   * not derived.
   *
   * `endDate !== startDate` would seem to be the same fact, and it is — right up
   * until you switch the toggle on, at which point the end still equals the start and
   * the toggle would read itself back as off. A control that undoes itself the
   * instant you touch it has to remember that it was touched.
   */
  const [hasEnd, setHasEnd] = useState(value.endDate !== value.startDate);

  /** Which field a calendar click belongs to. */
  const [focused, setFocused] = useState<'start' | 'end'>('start');

  /**
   * The date being typed, and only the focused one — two fields cannot be mid-edit at
   * once, so one slot is enough and there is no pair to keep in step. `null` means
   * "nothing typed", and the field renders the stored value directly rather than a
   * copy of it, so a date set from the calendar simply appears.
   */
  const [draft, setDraft] = useState<string | null>(null);

  /** The highlighted day in the grid. */
  const [cursor, setCursor] = useState<CivilDate>(value.startDate);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);

  const today = useMemo(() => todayIn(timezone), [timezone]);
  const sameDay = value.startDate === value.endDate;

  function openPanel() {
    setHasEnd(value.endDate !== value.startDate);
    setFocused('start');
    setDraft(null);
    setCursor(value.startDate);
    setOpen(true);
  }

  function close(restoreFocus: boolean) {
    setOpen(false);
    setDraft(null);
    // Focus returns to the trigger on Escape. Not on an outside click: that click has
    // already said where focus belongs, and dragging it back would steal the field
    // you were aiming at.
    if (restoreFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    // The start field takes focus, not the grid — the point of this layout is that
    // typing is available the moment it opens, and the grid is reachable by Tab.
    if (open) startRef.current?.focus();
  }, [open]);

  /** Every write goes through here, so nothing can store a backwards range. */
  const patch = (p: Partial<WhenValue>) => onChange(normalizeWhen({ ...value, ...p }));

  function setDate(which: 'start' | 'end', d: CivilDate) {
    setCursor(d);
    // With no separate end, the two dates are one date, and letting them drift apart
    // behind a switched-off toggle is how you get an entry whose length nobody asked
    // for.
    if (which === 'start') patch(hasEnd ? { startDate: d } : { startDate: d, endDate: d });
    else patch({ endDate: d });
  }

  function pick(d: CivilDate) {
    setDraft(null);
    setDate(focused, d);
    // Notion's touch, and it is the right one: after the start is set the thing you
    // are most likely to want next is the end, and moving focus there also moves
    // where the next click in this same grid will land.
    if (focused === 'start' && hasEnd) {
      setFocused('end');
      endRef.current?.focus();
    }
  }

  function toggleEnd(on: boolean) {
    setHasEnd(on);
    if (on) {
      setFocused('end');
      // Deferred past this render: the field does not exist yet.
      queueMicrotask(() => endRef.current?.focus());
    } else {
      setFocused('start');
      patch({ endDate: value.startDate });
    }
  }

  const dateField = (which: 'start' | 'end') => {
    const stored = which === 'start' ? value.startDate : value.endDate;
    const isFocused = focused === which;

    return (
      <DateInput
        inputRef={which === 'start' ? startRef : endRef}
        value={stored}
        // Only the focused field is mid-edit — two cannot be at once, which is why one
        // draft slot serves both — so the other renders what is stored.
        draft={isFocused ? draft : null}
        onDraft={setDraft}
        onCommit={(d) => setDate(which, d)}
        onFocus={() => {
          setFocused(which);
          setCursor(stored);
        }}
        lit={isFocused}
        label={which === 'start' ? 'Start date' : 'End date'}
      />
    );
  };

  const startTime = (
    <TimePicker
      label="Start time"
      value={value.startMinutes}
      onChange={(m) =>
        patch({
          startMinutes: m,
          // The same push the dates make, for the same reason: a start that overtakes
          // the end leaves a range that reads backwards, and correcting it here beats
          // rejecting it later.
          endMinutes:
            sameDay && value.endMinutes < m ? Math.min(LAST_MINUTE, m) : value.endMinutes,
        })
      }
    />
  );

  const endTime = (
    <TimePicker
      label="End time"
      value={value.endMinutes}
      // The floor only holds while the two dates agree. An entry running Friday 22:00
      // → Saturday 02:00 is ordinary.
      min={sameDay ? value.startMinutes : undefined}
      onChange={(m) => patch({ endMinutes: m })}
    />
  );

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        // Inside the entry form's `<form>`, so without this the field is a submit
        // button.
        type="button"
        onClick={() => (open ? close(true) : openPanel())}
        aria-haspopup="dialog"
        aria-expanded={open}
        // A button's accessible name replaces its text rather than adding to it, and
        // the text here is the value.
        aria-label={`When, ${formatWhen(value)}`}
        className={`${inputClass} flex items-center justify-between gap-2 text-left tabular-nums ${
          open ? 'shadow-[inset_0_0_0_1px_var(--color-hairlit)]' : ''
        }`}
      >
        <span className="truncate">{formatWhen(value)}</span>
        <span className="label shrink-0">{WEEKDAYS[dayOfWeek(value.startDate)]}</span>
      </button>

      {open && (
        <Popover
          anchorRef={triggerRef}
          onDismiss={() => close(false)}
          width={292}
          label="When"
          onKeyDown={(e) => {
            // Escape has to stop here. The shell owns one keymap and unwinds one
            // layer per press; without this the same press would reach `window` and
            // take the whole entry modal with it. The inner controls — a time field
            // with its list open, a date field mid-edit — stop it before this,
            // which is what makes the unwind ordered rather than a race between
            // listeners.
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            close(true);
          }}
        >
          <div>
            {/*
              The fields, laid out by what is switched on. All-day with an end is the
              pictured case — two dates side by side. Timed gains a column, so each
              row becomes one end of the range stated in full.
            */}
            <div className="mb-2 space-y-1.5">
              {value.allDay ? (
                hasEnd ? (
                  <div className="grid grid-cols-2 gap-1.5">
                    {dateField('start')}
                    {dateField('end')}
                  </div>
                ) : (
                  dateField('start')
                )
              ) : hasEnd ? (
                <div className="grid grid-cols-2 gap-1.5">
                  {dateField('start')}
                  {startTime}
                  {dateField('end')}
                  {endTime}
                </div>
              ) : (
                /*
                  One date and two times — where this deliberately parts company with
                  the screenshot. Notion's "include time" with no end date describes an
                  instant, because a date on a page is a stamp. An entry in a calendar
                  has a length, and the overwhelmingly common one is an hour on a single
                  day, so that case keeps both times rather than making you switch on an
                  end date to say when a meeting finishes.
                */
                <>
                  {dateField('start')}
                  <div className="grid grid-cols-2 gap-1.5">
                    {startTime}
                    {endTime}
                  </div>
                </>
              )}
            </div>

            <MonthGrid
              label="Calendar"
              cursor={cursor}
              onCursor={setCursor}
              onPick={pick}
              today={today}
              selection={sameDay ? value.startDate : { start: value.startDate, end: value.endDate }}
              // Only the end is floored, and only against the start. Flooring the start
              // would make an entry you are moving earlier impossible to move.
              min={focused === 'end' ? value.startDate : undefined}
            />

            <div className="mt-2 space-y-0.5 border-t border-hair pt-2">
              <Row label="END DATE">
                <Toggle checked={hasEnd} onChange={toggleEnd} label="End date" />
              </Row>
              <Row label="INCLUDE TIME">
                <Toggle
                  checked={!value.allDay}
                  onChange={(on) => patch({ allDay: !on })}
                  label="Include time"
                />
              </Row>
            </div>
          </div>
        </Popover>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-0.5 py-1">
      <span className="label">{label}</span>
      {children}
    </div>
  );
}
