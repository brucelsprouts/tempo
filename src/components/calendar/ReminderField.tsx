'use client';

import { useState } from 'react';
import type { LeadUnit } from '@/lib/tempo/reminders';
import { MAX_REMINDERS } from '@/lib/tempo/mappers';
import {
  addRow,
  fitRow,
  MAX_DAYS,
  ROW_OPTIONS,
  type ReminderRow,
  type RowContext,
  type RowNote,
  type RowWhen,
} from './reminder-rows';
import { TimePicker } from './TimePicker';
import { inputClass, numberClass } from './ui';

/**
 * The entry form's REMIND ME: one row per reminder, each of which can be
 * changed, removed, or joined by another.
 *
 * Rows replaced a set of preset chips. The chips could say "the day before,
 * 09:00" but not "the day before it's due, 07:30", and once a reminder could
 * count from either end of an entry, every preset would have needed a twin. A
 * row states the three things a reminder is — which day, how far back, what
 * time — and the defaults arrive already written as rows, so moving 09:00 to
 * 08:00 is typing over one field rather than finding the chip that means it.
 *
 * Rows are fitted to the entry when drawn rather than rewritten when it
 * changes, so flipping the all-day switch and back finds them as they were.
 */

interface Props {
  ctx: RowContext;
  rows: readonly ReminderRow[];
  onRows: (rows: ReminderRow[]) => void;
  /** What each row says under itself, by row id. See `rowNotes`. */
  notes: Map<number, RowNote>;
  /** All-day entries only: the due time, which the rows below count from. */
  due?: { minutes: number; onChange: (minutes: number) => void };
}

const UNITS: readonly { value: LeadUnit; label: string }[] = [
  { value: 'minutes', label: 'MINUTES' },
  { value: 'hours', label: 'HOURS' },
  { value: 'days', label: 'DAYS' },
  { value: 'weeks', label: 'WEEKS' },
];

const DAY_SHAPES: readonly RowWhen[] = ['daysBeforeStart', 'daysBeforeDue'];

export function ReminderField({ ctx, rows, onRows, notes, due }: Props): React.JSX.Element {
  const replace = (next: ReminderRow) => onRows(rows.map((r) => (r.id === next.id ? next : r)));

  return (
    <div className="space-y-2">
      {due && (
        <div className="flex items-center gap-2">
          <span className="label">DUE AT</span>
          <div className="w-20">
            <TimePicker label="Due time" value={due.minutes} onChange={due.onChange} />
          </div>
        </div>
      )}

      {rows.map((raw) => {
        const row = fitRow(raw, ctx);
        const note = notes.get(row.id);
        const lead = row.when === 'beforeDue';
        const days = DAY_SHAPES.includes(row.when);

        return (
          <div key={row.id}>
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                value={row.when}
                onChange={(e) => {
                  const when = e.target.value as RowWhen;
                  // A row switched to DAYS BEFORE from a day of its own holds a
                  // day count of zero, which is the day itself — the choice it
                  // was just switched away from.
                  replace({ ...row, when, days: DAY_SHAPES.includes(when) ? Math.max(1, row.days) : row.days });
                }}
                aria-label="When to remind"
                className={`${inputClass} min-w-[10rem] flex-1`}
              >
                {ROW_OPTIONS[ctx].map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>

              {/* Two fixed slots after the choice — a count, then a time or a
                  unit — held open when empty, so AT and its time sit in one
                  column down every row rather than wherever a count pushed
                  them. On a phone the slots wrap together. */}
              <div className="flex items-center gap-1.5">
                <div className="w-14">
                  {days && (
                    <NumberBox
                      label="Days before"
                      value={row.days}
                      min={1}
                      max={MAX_DAYS}
                      onChange={(n) => replace({ ...row, days: n })}
                    />
                  )}
                  {lead && (
                    <NumberBox
                      label="How long before"
                      value={row.amount}
                      min={0}
                      onChange={(n) => replace({ ...row, amount: n })}
                    />
                  )}
                </div>
                <div className="flex w-[6.5rem] items-center gap-1.5">
                  {lead ? (
                    <select
                      value={row.unit}
                      onChange={(e) => replace({ ...row, unit: e.target.value as LeadUnit })}
                      aria-label="Unit"
                      className={inputClass}
                    >
                      {UNITS.map((u) => (
                        <option key={u.value} value={u.value}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <span className="label">AT</span>
                      <TimePicker
                        label="Reminder time"
                        value={row.at}
                        onChange={(at) => replace({ ...row, at })}
                      />
                    </>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => onRows(rows.filter((r) => r.id !== row.id))}
                aria-label="Remove reminder"
                className="tap px-2 py-2 text-[12px] leading-none text-mute transition-colors hover:text-ink"
              >
                ×
              </button>
            </div>
            {note && <p className={`label mt-1 ${note.warn ? 'label-lit' : ''}`}>{note.text}</p>}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        {/* Five is the parse ceiling, enforced by disabling rather than by
            dropping a row: a click that silently removes an earlier reminder
            to make room reads as the button being broken. */}
        <button
          type="button"
          disabled={rows.length >= MAX_REMINDERS}
          onClick={() => onRows(addRow(rows, ctx))}
          className="tap border border-dashed border-hair px-2 py-1 text-[10px] tracking-[0.1em] text-mute transition-colors hover:border-hairlit hover:text-dim disabled:opacity-30"
        >
          + ADD REMINDER
        </button>
        {rows.length === 0 && (
          <span className="label">SILENT — NOTHING WILL BE SENT FOR THIS ENTRY.</span>
        )}
      </div>
    </div>
  );
}

/**
 * A count field that can be emptied while it is typed in.
 *
 * Held to the clamped number alone, backspacing the 1 put the 1 straight back
 * and the next digit landed after it — the bug EVERY's field had, fixed the
 * same way. Leaving the field shows the number kept.
 */
function NumberBox({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max?: number;
  onChange: (n: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={text ?? value}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value === '' || Number.isNaN(e.target.valueAsNumber)) return;
        // Clamped at the bottom only. A number past the top is kept so the row
        // can say why it will not be sent, rather than quietly becoming 28.
        onChange(Math.max(min, Math.round(e.target.valueAsNumber)));
      }}
      onBlur={() => setText(null)}
      aria-label={label}
      className={numberClass}
    />
  );
}
