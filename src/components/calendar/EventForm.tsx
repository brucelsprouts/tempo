'use client';

import { useMemo, useState } from 'react';
import { useCalendar, type EventDraft } from '@/lib/store/calendar-store';
import { civil, parts, todayIn, yearsBetween, type CivilDate } from '@/lib/tempo/civil';
import {
  needsAnchor as templateNeedsAnchor,
  renderTemplate,
  TEMPLATE_PRESETS,
} from '@/lib/tempo/derive';
import type { EventKind, Frequency, Occurrence, Recurrence } from '@/lib/tempo/types';
import { Button, Field, inputClass, PanelHeader, SegmentedControl } from './ui';

interface Props {
  mode: 'new' | 'edit';
  date?: CivilDate;
  /** Set when the entry was started from an hour row, which also means "timed". */
  startMinutes?: number;
  occurrence?: Occurrence;
  onClose: () => void;
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

const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const fromMinutes = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

export function EventForm({ mode, date, startMinutes, occurrence, onClose }: Props) {
  const timezone = useCalendar((s) => s.timezone);
  const categories = useCalendar((s) => s.categories);
  const createEvent = useCalendar((s) => s.createEvent);
  const updateEvent = useCalendar((s) => s.updateEvent);
  const deleteEvent = useCalendar((s) => s.deleteEvent);
  const cancelOccurrence = useCalendar((s) => s.cancelOccurrence);

  const existing = occurrence?.event;
  const today = todayIn(timezone);
  const seed = date ?? occurrence?.date ?? today;

  const [title, setTitle] = useState(existing?.title ?? '');
  const [kind, setKind] = useState<EventKind>(existing?.kind ?? 'event');
  // Clicking an hour row states a time, so the form opens timed rather than
  // making you undo an all-day default you never asked for.
  const [allDay, setAllDay] = useState(existing?.allDay ?? startMinutes == null);
  const [startDate, setStartDate] = useState<CivilDate>(
    existing?.startDate ?? occurrence?.date ?? seed,
  );
  const [endDate, setEndDate] = useState<CivilDate>(
    existing?.endDate ?? occurrence?.endDate ?? seed,
  );
  const seedStart = occurrence?.startMinutes ?? startMinutes ?? null;
  const [startTime, setStartTime] = useState(
    seedStart != null ? fromMinutes(seedStart) : '09:00',
  );
  const [endTime, setEndTime] = useState(
    occurrence?.endMinutes != null
      ? fromMinutes(occurrence.endMinutes)
      : seedStart != null
        ? fromMinutes(Math.min(23 * 60 + 59, seedStart + 60))
        : '10:00',
  );
  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? null);
  const [freq, setFreq] = useState<'NONE' | Frequency>(existing?.recurrence?.freq ?? 'NONE');
  const [templateKey, setTemplateKey] = useState<string>(
    TEMPLATES.find((t) => t.template === existing?.displayTemplate)?.value ?? 'none',
  );
  const [anchorDate, setAnchorDate] = useState<CivilDate>(
    existing?.anchorDate ?? occurrence?.date ?? seed,
  );
  const [notify, setNotify] = useState(existing?.notify ?? false);
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

    const shared = {
      title: title.trim(),
      kind,
      allDay: isBirthday ? true : allDay,
      startDate,
      endDate: endDate < startDate ? startDate : endDate,
      startMinutes: allDay ? undefined : toMinutes(startTime),
      endMinutes: allDay ? undefined : toMinutes(endTime),
      categoryId,
      recurrence: buildRecurrence(),
      anchorDate: effectiveTemplate ? effectiveAnchor : null,
      displayTemplate: effectiveTemplate,
      notify,
      notes: notes.trim() || null,
    } satisfies EventDraft;

    if (mode === 'new') {
      await createEvent(shared);
    } else if (occurrence) {
      await updateEvent(occurrence.eventId, {
        ...shared,
        startDate: shared.allDay ? shared.startDate : null,
        endDate: shared.allDay ? shared.endDate : null,
      });
    }
    onClose();
  }

  return (
    <form onSubmit={save} className="flex h-full flex-col">
      <PanelHeader
        title={mode === 'new' ? 'NEW ENTRY' : 'EDIT'}
        meta={recurs && mode === 'edit' ? 'EDITS APPLY TO THE WHOLE SERIES' : undefined}
        onClose={onClose}
      />

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <Field label="[00] TITLE">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
            placeholder="…"
          />
        </Field>

        {preview && (
          <div className="border-l-2 border-hairlit bg-panel px-3 py-2">
            <span className="label">RENDERS AS</span>
            <div className="mt-1 text-[12px] text-bright">{preview}</div>
          </div>
        )}

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

        <div className="grid grid-cols-2 gap-3">
          <Field label={isBirthday ? 'BIRTH DATE' : 'START'}>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (endDate < e.target.value) setEndDate(e.target.value);
              }}
              className={inputClass}
            />
          </Field>
          {!isBirthday && (
            <Field label="END">
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputClass}
              />
            </Field>
          )}
        </div>

        {!allDay && !isBirthday && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="FROM">
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="TO">
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
        )}

        {!isBirthday && (
          <Field label="[03] REPEATS">
            <SegmentedControl value={freq} options={FREQS} onChange={setFreq} />
          </Field>
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
            <input
              type="date"
              value={anchorDate}
              onChange={(e) => setAnchorDate(e.target.value)}
              className={inputClass}
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

        <Field label="[06] NOTES">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className={`${inputClass} resize-none`}
            placeholder="…"
          />
        </Field>

        <label className="flex cursor-pointer items-center gap-2.5 border border-hair px-3 py-2.5">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            className="accent-white"
          />
          <span className="text-[11px] text-dim">Mirror to Google for reminders</span>
        </label>
      </div>

      <div className="shrink-0 space-y-2 border-t border-hair px-4 py-3">
        <div className="flex gap-2">
          <Button type="submit" variant="primary" className="flex-1">
            {mode === 'new' ? 'CREATE' : 'SAVE'}
          </Button>
          <Button type="button" onClick={onClose}>
            CANCEL
          </Button>
        </div>

        {mode === 'edit' && occurrence && (
          <div className="flex gap-2">
            {occurrence.event.recurrence && (
              <Button
                type="button"
                variant="quiet"
                className="flex-1"
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
              className="flex-1"
              onClick={async () => {
                await deleteEvent(occurrence.eventId);
                onClose();
              }}
            >
              DELETE {occurrence.event.recurrence ? 'SERIES' : ''}
            </Button>
          </div>
        )}
      </div>
    </form>
  );
}
