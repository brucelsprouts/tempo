'use client';

import { useEffect, useImperativeHandle, useMemo, useState, type Ref } from 'react';
import { useCalendar, type EventDraft } from '@/lib/store/calendar-store';
import { civil, parts, todayIn, yearsBetween, type CivilDate } from '@/lib/tempo/civil';
import {
  needsAnchor as templateNeedsAnchor,
  renderTemplate,
  TEMPLATE_PRESETS,
} from '@/lib/tempo/derive';
import {
  ALL_DAY_PRESETS,
  defaultReminders,
  TIMED_PRESETS,
} from '@/lib/tempo/reminders';
import type { EventKind, Frequency, Occurrence, Recurrence, Reminder } from '@/lib/tempo/types';
import type { EntrySeed } from './CalendarShell';
import { UNTITLED } from './constants';
import { DatePicker } from './DatePicker';
import { WhenField } from './WhenField';
import { LAST_MINUTE, normalizeWhen, type WhenValue } from './when';
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

/**
 * What the shell can ask a live form to do.
 *
 * One method, and it exists because the two halves of "click off and it saves"
 * live in different components: the backdrop belongs to the modal, the draft
 * belongs to the form. The shell mediates. Same shape as `CalendarHandle` for
 * the same reason — an imperative verb that only the parent's event handlers
 * need is cheaper than lifting the entire form state to reach it.
 */
export interface EntryFormHandle {
  /** Save what is in the fields and close, exactly as submitting would. */
  commit: () => void;
}

/** The live shape of a draft, as the calendar behind needs to draw it. */
export interface DraftPreview {
  start: CivilDate;
  end: CivilDate;
  /** Empty until one is typed; the bar shows the placeholder in its place. */
  title: string;
}

interface Props {
  mode: 'new' | 'edit';
  /** `new` only: what the entry is pre-filled with. */
  seed?: EntrySeed;
  /** `edit` only. */
  occurrence?: Occurrence;
  onClose: () => void;
  /**
   * `new` only. Drives the draft bar on the calendar behind — with the form at
   * the centre of the screen rather than under the cursor, this is the only
   * thing that says where the entry is going to land, and what it will say when
   * it gets there.
   */
  onDraftChange?: (draft: DraftPreview) => void;
  /**
   * `edit` only. Opens HISTORY on this entry — the only way to reach the
   * versions of something that was never deleted, since the panel's own list is
   * the trash.
   */
  onHistory?: () => void;
  ref?: Ref<EntryFormHandle>;
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

export function EventForm({
  mode,
  seed,
  occurrence,
  onClose,
  onDraftChange,
  onHistory,
  ref,
}: Props) {
  const timezone = useCalendar((s) => s.timezone);
  const categories = useCalendar((s) => s.categories);
  const createEvent = useCalendar((s) => s.createEvent);
  const updateEventFromDraft = useCalendar((s) => s.updateEventFromDraft);
  const deleteEvent = useCalendar((s) => s.deleteEvent);
  const cancelOccurrence = useCalendar((s) => s.cancelOccurrence);
  const isOffline = useCalendar((s) => s.isOffline);

  const existing = occurrence?.event;
  const readOnly = occurrence?.readOnly || isOffline;
  const today = todayIn(timezone);
  const from = seed?.start ?? occurrence?.date ?? today;

  const [title, setTitle] = useState(existing?.title ?? '');
  const [kind, setKind] = useState<EventKind>(existing?.kind ?? 'event');
  /**
   * When it happens — five values that were five `useState`s.
   *
   * They were never independent: three of the four `onChange` handlers existed
   * only to stop one of them contradicting another, and `commit` held a fourth
   * copy of the same rule. `normalizeWhen` is that rule, once, and `WhenField`
   * is allowed to hand back any combination its controls can produce.
   *
   * Minutes from midnight, all the way through. It is what the store, the
   * expander and the bars already speak, so the form no longer parses a string
   * back into the number it was handed.
   */
  const seedStart = occurrence?.startMinutes ?? seed?.startMinutes ?? null;
  const [when, setWhen] = useState<WhenValue>(() =>
    normalizeWhen({
      startDate: existing?.startDate ?? occurrence?.date ?? from,
      endDate: existing?.endDate ?? occurrence?.endDate ?? seed?.end ?? from,
      // Starting from an hour row states a time, so the form opens timed rather
      // than making you undo an all-day default you never asked for.
      allDay: existing?.allDay ?? seed?.startMinutes == null,
      startMinutes: seedStart ?? 9 * 60,
      endMinutes:
        occurrence?.endMinutes ??
        (seedStart != null ? Math.min(LAST_MINUTE, seedStart + 60) : 10 * 60),
    }),
  );
  // The times are not pulled out: nothing outside `WhenField` reads them any more.
  const { startDate, endDate, allDay } = when;

  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? null);
  const [freq, setFreq] = useState<'NONE' | Frequency>(existing?.recurrence?.freq ?? 'NONE');
  const [templateKey, setTemplateKey] = useState<string>(
    TEMPLATES.find((t) => t.template === existing?.displayTemplate)?.value ?? 'none',
  );
  const [anchorDate, setAnchorDate] = useState<CivilDate>(
    existing?.anchorDate ?? occurrence?.date ?? from,
  );
  const [notes, setNotes] = useState(existing?.notes ?? '');

  /**
   * Reminders, and whether the user has taken them over.
   *
   * A new entry follows its kind — an assignment wants a day's warning and a
   * two-hour one, a dentist appointment wants half an hour — and keeps
   * following it while `kind` and the all-day switch are still being changed.
   * The moment a chip is clicked that stops: `touched` is what makes the
   * defaults a starting point rather than something that keeps overwriting a
   * deliberate choice.
   *
   * An edit starts touched, because every value on an existing row was already
   * a decision, including the decision to have none.
   */
  const [chosenReminders, setChosenReminders] = useState<Reminder[]>(
    () => existing?.reminders ?? [],
  );
  const [remindersTouched, setRemindersTouched] = useState(mode === 'edit');

  // Derived, not synchronised. Following `kind` and the all-day switch with an
  // effect would mean a second render on every change to either, and this is
  // the same fact stated once: until you pick, the defaults *are* the value.
  const reminders = remindersTouched ? chosenReminders : defaultReminders(kind, allDay);

  const presets = allDay ? ALL_DAY_PRESETS : TIMED_PRESETS;

  function toggleReminder(minutes: number) {
    // Built from what is on screen, which before the first click is the
    // defaults — so the first chip you click adds to them rather than
    // replacing them with a list of one.
    const without = reminders.filter((r) => r.minutes !== minutes);
    const deselecting = without.length !== reminders.length;

    setRemindersTouched(true);
    // Five is the parse ceiling, enforced by disabling the remaining chips
    // rather than dropping one here: a click that silently removes an earlier
    // choice to make room reads as the button being broken.
    if (deselecting) setChosenReminders(without);
    else if (reminders.length < 5) {
      setChosenReminders([...reminders, { minutes }].sort((a, b) => b.minutes - a.minutes));
    } else setChosenReminders(reminders);
  }

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

  // Reported on every change, including the first render, so the bar appears
  // with the form rather than only once a field is touched. The title rides
  // along, which is what makes it fill in under the cursor as you type. No
  // clamping on the way out any more — `when` cannot hold a backwards range.
  useEffect(() => {
    onDraftChange?.({ start: startDate, end: endDate, title });
  }, [startDate, endDate, title, onDraftChange]);

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

  /**
   * Save and close, whatever asked.
   *
   * Not a submit handler: the form submits into it, and so does clicking away
   * from the modal, which is a mousedown on a backdrop this component cannot
   * see. Both mean the same thing, so both arrive here.
   *
   * It closes *before* awaiting the write rather than after. Every store
   * mutation is optimistic — the entry is already on the grid by the time the
   * request leaves, and a rejection rolls it back and raises the error banner —
   * so holding the modal open for a round-trip buys nothing and makes clicking
   * away feel like it didn't take.
   */
  function commit() {
    // An empty title is not a reason to refuse. Clicking away from a form you
    // filled in should not silently throw it out, and a draft with nothing in
    // it at all is still a block of time you deliberately marked — it just gets
    // called something until you say otherwise. Escape is how you say no.
    const named = title.trim() || UNTITLED;

    // A birthday is one all-day date whatever the WHEN field last held, and
    // `normalizeWhen` is what decides that an end pulled back before its start
    // means a single day. Both were open-coded here in four lines that had to
    // agree with the four in the form above them.
    const w = normalizeWhen({ ...when, allDay: isBirthday ? true : allDay });

    const shared = {
      title: named,
      kind,
      allDay: w.allDay,
      startDate: w.startDate,
      endDate: isBirthday ? w.startDate : w.endDate,
      startMinutes: w.allDay ? undefined : w.startMinutes,
      endMinutes: w.allDay ? undefined : w.endMinutes,
      categoryId,
      recurrence: buildRecurrence(),
      // Always sent, including when empty. Unlike `notify` this field is the
      // form's to state, so an omitted value would mean "unchanged" when the
      // user meant "I turned them all off".
      reminders,
      anchorDate: effectiveTemplate ? effectiveAnchor : null,
      displayTemplate: effectiveTemplate,
      // `notify` is deliberately absent. It is the Google mirror flag, and the
      // mirror does not exist — no route reads it. The column and the field
      // stay for the day one is written; leaving it out of the draft means an
      // edit preserves whatever a row already holds rather than resetting it.
      notes: notes.trim() || null,
    } satisfies EventDraft;

    onClose();
    if (mode === 'new') {
      void createEvent(shared);
    } else if (occurrence) {
      void updateEventFromDraft(occurrence.eventId, shared);
    }
  }

  useImperativeHandle(ref, () => ({ commit }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
      className="flex h-full flex-col"
    >
      {/* Two columns, and fields that want the width say so. Enter submits from
          anywhere by virtue of being a real form with a real submit button —
          the notes field is the one exception, handled at the textarea.

          One column on a phone. The pairing is what 640px bought — REPEATS
          beside CATEGORY, ANCHOR beside DERIVED LABEL — and at 393px it buys
          the opposite: a five-cell segmented control in 170px, which is how
          MONTH and YEAR came to be written over the field next to them. The
          spans say `full` rather than `2` so they mean the same thing in both.
      */}
      <fieldset disabled={readOnly} className="grid flex-1 grid-cols-1 gap-x-4 gap-y-4 overflow-y-auto px-4 py-4 sm:grid-cols-2 disabled:opacity-90">
        <div className="col-span-full">
          <Field label="[00] TITLE">
            <input
              autoFocus
              // Both, and they are not redundant. `autoFocus` is React's, and
              // it wins when the modal was opened from the keyboard; the
              // attribute is what `Modal` looks for when it did not, which is
              // every time + NEW is clicked with a mouse.
              data-autofocus
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
          <div className="col-span-full border-l-2 border-hairlit bg-panel px-3 py-2">
            <span className="label">RENDERS AS</span>
            <div className="mt-1 text-[12px] text-bright">{preview}</div>
          </div>
        )}

        <div className="col-span-full">
          <Field label="[01] TYPE">
            <SegmentedControl
              value={kind}
              options={KINDS}
              onChange={(k) => {
                setKind(k);
                if (k === 'birthday') setWhen((w) => ({ ...w, allDay: true }));
              }}
            />
          </Field>
        </div>

        {/* A birthday has one date, no end and no time — the whole apparatus
            would be four switched-off controls around the only field it needs,
            so it keeps the plain picker. */}
        {isBirthday ? (
          <Field label="[02] BIRTH DATE">
            <DatePicker
              label="Birth date"
              value={startDate}
              timezone={timezone}
              onChange={(d) => setWhen((w) => normalizeWhen({ ...w, startDate: d, endDate: d }))}
            />
          </Field>
        ) : (
          <div className="col-span-full">
            <Field label="[02] WHEN">
              <WhenField value={when} onChange={setWhen} timezone={timezone} />
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

        <div className="col-span-full">
          <Field label="[06] REMIND ME">
            {/* Chips rather than a select: reminders are a set, not a choice,
                and the pairing people actually want — one to start, one to
                turn up — is two clicks here and a nested multi-select in any
                other control. */}
            <div className="flex flex-wrap gap-1.5">
              {presets.map(({ minutes, label }) => {
                const on = reminders.some((r) => r.minutes === minutes);
                const full = !on && reminders.length >= 5;
                return (
                  <button
                    key={minutes}
                    type="button"
                    disabled={full}
                    aria-pressed={on}
                    onClick={() => toggleReminder(minutes)}
                    className={`tap max-w-full truncate border px-2 py-1 text-[10px] tracking-[0.1em] transition-colors disabled:opacity-30 ${
                      on
                        ? 'border-hairlit bg-raised text-bright'
                        : 'border-hair text-mute hover:border-hairlit hover:text-dim'
                    }`}
                  >
                    {label.toUpperCase()}
                  </button>
                );
              })}
            </div>
            {reminders.length === 0 && (
              <p className="label mt-2">SILENT — NOTHING WILL BE SENT FOR THIS ENTRY.</p>
            )}
          </Field>
        </div>

        <div className="col-span-full">
          <Field label="[07] NOTES">
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
      </fieldset>

      <div className="shrink-0 space-y-2 border-t border-hair px-4 py-3">
        {/* Wraps, because an edit on a recurring entry puts four buttons in
            here and SAVE is `flex-1` — on a phone the other three were being
            squeezed to their padding. */}
        <div className="flex flex-wrap gap-2">
          {readOnly ? (
            <Button type="button" variant="quiet" onClick={onClose} className="flex-1">
              CLOSE
            </Button>
          ) : (
            <Button type="submit" variant="primary" className="flex-1">
              {mode === 'new' ? 'CREATE' : 'SAVE'}
            </Button>
          )}

          {mode === 'edit' && occurrence && (
            <>
              {onHistory && (
                <Button type="button" variant="quiet" onClick={onHistory}>
                  HISTORY
                </Button>
              )}
              {!readOnly && occurrence.event.recurrence && (
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
              {!readOnly && (
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
              )}
            </>
          )}
        </div>
      </div>
    </form>
  );
}
