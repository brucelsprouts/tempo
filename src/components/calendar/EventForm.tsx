'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCalendar, type EventDraft } from '@/lib/store/calendar-store';
import { civil, parts, todayIn, yearsBetween, type CivilDate } from '@/lib/tempo/civil';
import {
  needsAnchor as templateNeedsAnchor,
  renderTemplate,
  TEMPLATE_PRESETS,
} from '@/lib/tempo/derive';
import type { EventKind, Frequency, Occurrence, Recurrence } from '@/lib/tempo/types';
import type { EntrySeed } from './CalendarShell';
import { DatePicker } from './DatePicker';
import { TimePicker } from './TimePicker';
import { Button, Field, inputClass, SegmentedControl } from './ui';

/**
 * The one form in the app.
 *
 * It lives in a centred modal rather than a side rail, which is why it lays out
 * in two columns: 640px is enough for the paired fields to sit beside each
 * other, so the common case stops scrolling. It draws no header and no cancel
 * button — the modal owns both, and a form that supplied its own would put two
 * ways to dismiss it three inches apart.
 */

interface Props {
  mode: 'new' | 'edit';
  /** `new` only: what the entry is pre-filled with. */
  seed?: EntrySeed;
  /** `edit` only. */
  occurrence?: Occurrence;
  onClose: () => void;
  /**
   * `new` only. Drives the ghost bar on the calendar behind — with the form at
   * the centre of the screen rather than under the cursor, this is the only
   * thing that says where the entry is going to land.
   */
  onDraftDatesChange?: (start: CivilDate, end: CivilDate) => void;
}

const KINDS = [
  { value: 'event', label: 'EVENT' },
  { value: 'assignment', label: 'TASK' },
  { value: 'birthday', label: 'BIRTHDAY' },
  { value: 'milestone', label: 'MARK' },
] as const;

const FREQS = [
  { value: 'NONE', label: 'ONCE' },
  { value: 'DAILY', label: 'DAY' },
  { value: 'WEEKLY', label: 'WEEK' },
  { value: 'MONTHLY', label: 'MONTH' },
  { value: 'YEARLY', label: 'YEAR' },
] as const;

const TEMPLATES = [
  { value: 'none', label: 'PLAIN TITLE', template: null },
  { value: 'birthday', label: 'AGE', template: TEMPLATE_PRESETS.birthday },
  { value: 'anniversary', label: 'ANNIVERSARY', template: TEMPLATE_PRESETS.anniversary },
  { value: 'counted', label: 'COUNT', template: TEMPLATE_PRESETS.counted },
  { value: 'yearTagged', label: 'YEAR', template: TEMPLATE_PRESETS.yearTagged },
] as const;

/** The last minute a day holds, and the ceiling on a nudged end time. */
const LAST_MINUTE = 23 * 60 + 59;

export function EventForm({ mode, seed, occurrence, onClose, onDraftDatesChange }: Props) {
  const timezone = useCalendar((s) => s.timezone);
  const categories = useCalendar((s) => s.categories);
  const createEvent = useCalendar((s) => s.createEvent);
  const updateEventFromDraft = useCalendar((s) => s.updateEventFromDraft);
  const deleteEvent = useCalendar((s) => s.deleteEvent);
  const cancelOccurrence = useCalendar((s) => s.cancelOccurrence);

  const existing = occurrence?.event;
  const today = todayIn(timezone);
  const from = seed?.start ?? occurrence?.date ?? today;

  const [title, setTitle] = useState(existing?.title ?? '');
  const [kind, setKind] = useState<EventKind>(existing?.kind ?? 'event');
  // Starting from an hour row states a time, so the form opens timed rather
  // than making you undo an all-day default you never asked for.
  const [allDay, setAllDay] = useState(existing?.allDay ?? seed?.startMinutes == null);
  const [startDate, setStartDate] = useState<CivilDate>(
    existing?.startDate ?? occurrence?.date ?? from,
  );
  const [endDate, setEndDate] = useState<CivilDate>(
    existing?.endDate ?? occurrence?.endDate ?? seed?.end ?? from,
  );
  // Minutes from midnight, all the way through. It is what the store, the
  // expander and the bars already speak, so the form no longer parses a string
  // back into the number it was handed.
  const seedStart = occurrence?.startMinutes ?? seed?.startMinutes ?? null;
  const [startMinutes, setStartMinutes] = useState(seedStart ?? 9 * 60);
  const [endMinutes, setEndMinutes] = useState(
    occurrence?.endMinutes ??
      (seedStart != null ? Math.min(LAST_MINUTE, seedStart + 60) : 10 * 60),
  );
  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? null);
  const [freq, setFreq] = useState<'NONE' | Frequency>(existing?.recurrence?.freq ?? 'NONE');
  const [templateKey, setTemplateKey] = useState<string>(
    TEMPLATES.find((t) => t.template === existing?.displayTemplate)?.value ?? 'none',
  );
  const [anchorDate, setAnchorDate] = useState<CivilDate>(
    existing?.anchorDate ?? occurrence?.date ?? from,
  );
  const [notes, setNotes] = useState(existing?.notes ?? '');

  // A birthday is the general machinery with the dials pre-set, not a special
  // case: yearly recurrence, an anchor on the birth date, and an age template.
  const isBirthday = kind === 'birthday';
  const effectiveFreq: 'NONE' | Frequency = isBirthday ? 'YEARLY' : freq;
  const effectiveTemplate = isBirthday
    ? TEMPLATE_PRESETS.birthday
    : (TEMPLATES.find((t) => t.value === templateKey)?.template ?? null);
  const effectiveAnchor = isBirthday ? startDate : anchorDate;
  const recurs = effectiveFreq !== 'NONE';
  const needsAnchor = templateNeedsAnchor(effectiveTemplate);

  /**
   * Whether the end time is on the same day as the start, and therefore whether
   * it has to come after it. An entry running Friday 22:00 → Saturday 02:00 is
   * ordinary, so the floor cannot simply be "always the start time".
   *
   * `<=` rather than `===` because `save` normalises an inverted range down to
   * a single day; a form showing an end date before its start is already
   * describing one day, whatever the two fields say.
   */
  const sameDay = endDate <= startDate;

  // Reported on every change, including the first render, so the ghost appears
  // with the form rather than only once a date is touched.
  useEffect(() => {
    onDraftDatesChange?.(startDate, endDate < startDate ? startDate : endDate);
  }, [startDate, endDate, onDraftDatesChange]);

  /** What the title will actually read as, this year. */
  const preview = useMemo(() => {
    if (!effectiveTemplate || !title) return null;
    const anchor = parts(effectiveAnchor);
    const thisYear = parts(today).year;
    const occDate = civil(
      Math.max(thisYear, anchor.year),
      isBirthday || needsAnchor ? anchor.month : parts(startDate).month,
      isBirthday || needsAnchor ? anchor.day : parts(startDate).day,
    );
    return renderTemplate(effectiveTemplate, {
      title,
      date: occDate,
      anchorDate: needsAnchor ? effectiveAnchor : null,
      index: Math.max(1, yearsBetween(effectiveAnchor, occDate) + 1),
    });
  }, [effectiveTemplate, title, effectiveAnchor, startDate, today, isBirthday, needsAnchor]);

  function buildRecurrence(): Recurrence | null {
    if (effectiveFreq === 'NONE') return null;
    return {
      freq: effectiveFreq,
      interval: 1,
      // A leap-day birthday still happens every year, so birthdays clamp
      // rather than following RFC 5545's skip rule.
      ...(isBirthday ? { onInvalid: 'clamp' as const } : {}),
    };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    // The end picker's `min` only holds while the two dates agree, and the
    // dates can be pulled together after the times were set — a Friday 22:00 →
    // Saturday 02:00 entry dragged back onto one day. Normalised here, beside
    // the inverted-date case, because this is already the place that decides
    // what a backwards range means.
    const end = sameDay ? Math.max(startMinutes, endMinutes) : endMinutes;

    const shared = {
      title: title.trim(),
      kind,
      allDay: isBirthday ? true : allDay,
      startDate,
      endDate: endDate < startDate ? startDate : endDate,
      startMinutes: allDay ? undefined : startMinutes,
      endMinutes: allDay ? undefined : end,
      categoryId,
      recurrence: buildRecurrence(),
      anchorDate: effectiveTemplate ? effectiveAnchor : null,
      displayTemplate: effectiveTemplate,
      // `notify` is deliberately absent. It is the Google mirror flag, and the
      // mirror does not exist — no route reads it. The column and the field
      // stay for the day one is written; leaving it out of the draft means an
      // edit preserves whatever a row already holds rather than resetting it.
      notes: notes.trim() || null,
    } satisfies EventDraft;

    if (mode === 'new') {
      await createEvent(shared);
    } else if (occurrence) {
      await updateEventFromDraft(occurrence.eventId, shared);
    }
    onClose();
  }

  return (
    <form onSubmit={save} className="flex h-full flex-col">
      {/* Two columns, and fields that want the width say so. Enter submits from
          anywhere by virtue of being a real form with a real submit button —
          the notes field is the one exception, handled at the textarea. */}
      <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-4 overflow-y-auto px-4 py-4">
        <div className="col-span-2">
          <Field label="[00] TITLE">
            <input
              autoFocus
              // Selected, not just focused: on an edit the field already holds
              // a title, and the common reason to open one is to replace it.
              onFocus={(e) => e.currentTarget.select()}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
              placeholder="…"
            />
          </Field>
        </div>

        {preview && (
          <div className="col-span-2 border-l-2 border-hairlit bg-panel px-3 py-2">
            <span className="label">RENDERS AS</span>
            <div className="mt-1 text-[12px] text-bright">{preview}</div>
          </div>
        )}

        <div className="col-span-2">
          <Field label="[01] TYPE">
            <SegmentedControl
              value={kind}
              options={KINDS}
              onChange={(k) => {
                setKind(k);
                if (k === 'birthday') setAllDay(true);
              }}
            />
          </Field>
        </div>

        {!isBirthday && (
          <Field label="[02] SPAN">
            <SegmentedControl
              value={allDay ? 'ALLDAY' : 'TIMED'}
              options={[
                { value: 'ALLDAY', label: 'ALL DAY' },
                { value: 'TIMED', label: 'TIMED' },
              ]}
              onChange={(v) => setAllDay(v === 'ALLDAY')}
            />
          </Field>
        )}

        {!isBirthday && (
          <Field label="[03] REPEATS">
            <SegmentedControl value={freq} options={FREQS} onChange={setFreq} />
          </Field>
        )}

        <Field label={isBirthday ? 'BIRTH DATE' : 'START'}>
          <DatePicker
            label={isBirthday ? 'Birth date' : 'Start date'}
            value={startDate}
            timezone={timezone}
            onChange={(d) => {
              setStartDate(d);
              if (endDate < d) setEndDate(d);
            }}
          />
        </Field>

        {!isBirthday && (
          <Field label="END">
            <DatePicker
              label="End date"
              value={endDate}
              min={startDate}
              timezone={timezone}
              onChange={setEndDate}
            />
          </Field>
        )}

        {!allDay && !isBirthday && (
          <>
            <Field label="FROM">
              <TimePicker
                label="Start time"
                value={startMinutes}
                onChange={(m) => {
                  setStartMinutes(m);
                  // The same push the date pair makes, for the same reason: a
                  // start that overtakes the end leaves a range that reads
                  // backwards, and correcting it here beats rejecting it later.
                  if (sameDay && endMinutes < m) setEndMinutes(m);
                }}
              />
            </Field>
            <Field label="TO">
              <TimePicker
                label="End time"
                value={endMinutes}
                min={sameDay ? startMinutes : undefined}
                onChange={setEndMinutes}
              />
            </Field>
          </>
        )}

        {recurs && !isBirthday && (
          <Field label="[04] DERIVED LABEL">
            <select
              value={templateKey}
              onChange={(e) => setTemplateKey(e.target.value)}
              className={inputClass}
            >
              {TEMPLATES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        {needsAnchor && !isBirthday && (
          <Field label="ANCHOR DATE">
            <DatePicker
              label="Anchor date"
              value={anchorDate}
              timezone={timezone}
              onChange={setAnchorDate}
            />
          </Field>
        )}

        <Field label="[05] CATEGORY">
          <select
            value={categoryId ?? ''}
            onChange={(e) => setCategoryId(e.target.value || null)}
            className={inputClass}
          >
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="col-span-2">
          <Field label="[06] NOTES">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onKeyDown={(e) => {
                // The only field where Enter has a native meaning worth
                // keeping, so the chord is inverted here rather than everywhere
                // else: Enter saves like it does in every other field, and
                // Shift+Enter is how you get a line break.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              rows={3}
              className={`${inputClass} resize-none`}
              placeholder="…"
            />
          </Field>
        </div>
      </div>

      <div className="shrink-0 space-y-2 border-t border-hair px-4 py-3">
        <div className="flex gap-2">
          <Button type="submit" variant="primary" className="flex-1">
            {mode === 'new' ? 'CREATE' : 'SAVE'}
          </Button>

          {mode === 'edit' && occurrence && (
            <>
              {occurrence.event.recurrence && (
                <Button
                  type="button"
                  variant="quiet"
                  onClick={async () => {
                    await cancelOccurrence(occurrence);
                    onClose();
                  }}
                >
                  SKIP THIS ONE
                </Button>
              )}
              <Button
                type="button"
                variant="quiet"
                onClick={async () => {
                  await deleteEvent(occurrence.eventId);
                  onClose();
                }}
              >
                DELETE {occurrence.event.recurrence ? 'SERIES' : ''}
              </Button>
            </>
          )}
        </div>
      </div>
    </form>
  );
}
