'use client';

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { useCalendar, type EditSession, type EventDraft } from '@/lib/store/calendar-store';
import { same } from '@/lib/store/undo';
import { civil, parts, todayIn, yearsBetween, type CivilDate } from '@/lib/tempo/civil';
import { eventSpan } from '@/lib/tempo/recurrence';
import {
  needsAnchor as templateNeedsAnchor,
  renderTemplate,
  TEMPLATE_PRESETS,
} from '@/lib/tempo/derive';
import { defaultReminders } from '@/lib/tempo/reminders';
import type { EventKind, Occurrence, Recurrence } from '@/lib/tempo/types';
import type { EntrySeed } from './CalendarShell';
import { UNTITLED } from './constants';
import { DatePicker } from './DatePicker';
import { ReminderField } from './ReminderField';
import {
  remindersFromRows,
  rowContext,
  rowNotes,
  rowsFromReminders,
  type ReminderRow,
} from './reminder-rows';
import { WhenField } from './WhenField';
import { LAST_MINUTE, normalizeWhen, ontoSeries, type WhenValue } from './when';
import { clampInterval, MAX_INTERVAL, periodWord, repeatRule, type RepeatFreq } from './repeat';
import { canSplitAt, oneDatePatch } from './scope';
import { ScopePrompt } from './ScopePrompt';
import { Button, Field, inputClass, numberClass, SegmentedControl } from './ui';

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
  /**
   * `new` only: the id the entry is saved under, chosen by the shell when it
   * opened the popup — so every save of it is the same row.
   */
  newId?: string;
  /** `edit` only. */
  occurrence?: Occurrence;
  onClose: () => void;
  /**
   * `new` only. Drives the draft bar on the calendar behind — with the form at
   * the centre of the screen rather than under the cursor, this is the only
   * thing that says where the entry is going to land, and what it will say when
   * it gets there. `null` once the entry exists: from then on its real bar is on
   * the calendar, updating as you type.
   */
  onDraftChange?: (draft: DraftPreview | null) => void;
  /**
   * `edit` only. Opens HISTORY on this entry — the only way to reach the
   * versions of something that was never deleted, since the panel's own list is
   * the trash.
   */
  onHistory?: () => void;
  ref?: Ref<EntryFormHandle>;
}

/**
 * What an entry can be: an entry, a birthday, or a mark.
 *
 * ENTRY rather than EVENT — the word the rest of the app already uses (`+ NEW`,
 * `13 ENTRIES`). There is no TASK: this calendar is kept with entries, a task
 * was an entry with a status nobody set, and a row still written as one reads
 * as an entry (`eventFromRow`).
 */
const KINDS = [
  { value: 'event', label: 'ENTRY' },
  { value: 'birthday', label: 'BIRTHDAY' },
  { value: 'milestone', label: 'MARK' },
] as const satisfies readonly { value: EventKind; label: string }[];

/**
 * The frequency, in words.
 *
 * The cells were `1D 1W 1M 2M 1Y` because a sixth cell (every two months) broke
 * the words: six labels across one column truncated DAY and MONTH into each
 * other. The count has its own field now — EVERY [ N ] — so the cells are five
 * again, and five fit as words.
 */
const FREQS = [
  { value: 'NONE', label: 'ONCE' },
  { value: 'DAILY', label: 'DAY' },
  { value: 'WEEKLY', label: 'WEEK' },
  { value: 'MONTHLY', label: 'MONTH' },
  { value: 'YEARLY', label: 'YEAR' },
] as const satisfies readonly { value: RepeatFreq; label: string }[];

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
  newId,
  occurrence,
  onClose,
  onDraftChange,
  onHistory,
  ref,
}: Props) {
  const timezone = useCalendar((s) => s.timezone);
  const categories = useCalendar((s) => s.categories);
  const beginEdit = useCalendar((s) => s.beginEdit);
  const saveDraft = useCalendar((s) => s.saveDraft);
  const flushEdit = useCalendar((s) => s.flushEdit);
  const endEdit = useCalendar((s) => s.endEdit);
  const updateEventFromDraft = useCalendar((s) => s.updateEventFromDraft);
  const deleteEvent = useCalendar((s) => s.deleteEvent);
  const cancelOccurrence = useCalendar((s) => s.cancelOccurrence);
  const wouldChange = useCalendar((s) => s.wouldChange);
  const editOccurrence = useCalendar((s) => s.editOccurrence);
  const splitSeries = useCalendar((s) => s.splitSeries);
  const isOffline = useCalendar((s) => s.isOffline);

  const existing = occurrence?.event;
  const readOnly = occurrence?.event.source === 'google' || isOffline;
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

  /**
   * Whether the date field holds the row's own date or one occurrence of it.
   *
   * A birthday's is labelled BIRTH DATE and holds the anchor — 1974, not this
   * year's cake — so it opens on the row. Everything else opens on the instance
   * you clicked, the way every other calendar does: click October and the form
   * says October rather than making you work out which September it descends
   * from. Read off the stored kind rather than the live one, because it
   * describes what the field was filled in *with*.
   */
  const opensOnSeries = existing?.kind === 'birthday';

  /**
   * What WHEN held when the form opened, kept for as long as the form is.
   *
   * It is the baseline an edit is measured against. This form always writes the
   * whole row, so a date typed into it has to reach the series as a shift —
   * `ontoSeries` — and a shift needs something to be a shift *from*.
   */
  const [opened] = useState<WhenValue>(() =>
    normalizeWhen({
      startDate: (opensOnSeries ? existing?.startDate : occurrence?.date) ?? from,
      endDate:
        (opensOnSeries ? existing?.endDate : occurrence?.endDate) ?? seed?.end ?? from,
      // Starting from an hour row states a time, so the form opens timed rather
      // than making you undo an all-day default you never asked for.
      allDay: existing?.allDay ?? seed?.startMinutes == null,
      startMinutes: seedStart ?? 9 * 60,
      endMinutes:
        occurrence?.endMinutes ??
        (seedStart != null ? Math.min(LAST_MINUTE, seedStart + 60) : 10 * 60),
    }),
  );
  const [when, setWhen] = useState<WhenValue>(opened);
  // The times are not pulled out: nothing outside `WhenField` reads them any more.
  const { startDate, endDate, allDay } = when;

  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? null);
  const [freq, setFreq] = useState<RepeatFreq>(existing?.recurrence?.freq ?? 'NONE');
  const [every, setEvery] = useState(existing?.recurrence?.interval ?? 1);
  /**
   * What the EVERY field says while it is being typed in, kept apart from
   * `every` so the field can be emptied. Held to the clamped number alone,
   * backspacing a 1 put the 1 straight back and the next digit landed after
   * it — typing 3 there said 13. Leaving the field shows the number kept.
   */
  const [everyText, setEveryText] = useState<string | null>(null);
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
  const effectiveFreq: RepeatFreq = isBirthday ? 'YEARLY' : freq;
  const effectiveTemplate = isBirthday
    ? TEMPLATE_PRESETS.birthday
    : (TEMPLATES.find((t) => t.value === templateKey)?.template ?? null);
  const effectiveAnchor = isBirthday ? startDate : anchorDate;
  const recurs = effectiveFreq !== 'NONE';
  const needsAnchor = templateNeedsAnchor(effectiveTemplate);

  /**
   * When an all-day entry is due, on its last day, or `null` for one that is
   * due some time that day and does not say when.
   *
   * Empty is the new entry's state, not 23:55: most of what gets entered as a
   * day — rent, a form to hand in — is wanted that day rather than at a minute
   * of it, and a time nobody typed is a deadline nobody set. It is also what
   * picks the reminders below, so filling it in is the same gesture as saying
   * "this one is a deadline".
   */
  const [dueMinutes, setDueMinutes] = useState<number | null>(existing?.dueMinutes ?? null);

  /**
   * Reminders, as rows, and whether the user has taken them over.
   *
   * A new entry follows what it is — three reminders for something that happens
   * once, one for a repeat, a birthday's own pair — and keeps following while
   * the type, the all-day switch and the repeat are still being changed. The
   * moment a row is edited that stops: `touched` is what makes the defaults a
   * starting point rather than something that keeps overwriting a deliberate
   * choice.
   *
   * An edit starts touched, because every value on an existing row was already
   * a decision, including the decision to have none.
   */
  const ctx = rowContext(kind, allDay, dueMinutes);
  const [chosenRows, setChosenRows] = useState<ReminderRow[]>(() =>
    rowsFromReminders(
      existing?.reminders ?? [],
      rowContext(existing?.kind ?? 'event', existing?.allDay ?? true, existing?.dueMinutes ?? null),
    ),
  );
  const [remindersTouched, setRemindersTouched] = useState(mode === 'edit');

  // Derived, not synchronised. Following the type and the switches with an
  // effect would mean a second render on every change to any of them, and this
  // is the same fact stated once: until you edit, the defaults *are* the value.
  // The first edit is made to what is on screen, so it changes the defaults
  // rather than replacing them with a list of one.
  const rows = remindersTouched
    ? chosenRows
    : rowsFromReminders(defaultReminders(kind, { allDay, repeats: recurs, dueMinutes }), ctx);
  const reminders = remindersFromRows(rows, ctx);
  const rowNotesById = rowNotes(
    rows,
    ctx,
    {
      allDay: isBirthday || allDay,
      startDate,
      endDate: isBirthday ? startDate : endDate,
      startMinutes: when.startMinutes,
    },
    ctx === 'allDay' ? dueMinutes : null,
    timezone,
  );

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
    // A leap-day birthday still happens every year, so birthdays clamp rather
    // than following RFC 5545's skip rule — and their rule is theirs, not the
    // form's to reshape.
    if (isBirthday) return { freq: 'YEARLY', interval: 1, onInvalid: 'clamp' };
    return repeatRule(existing?.recurrence ?? null, freq, every);
  }

  /**
   * Whether saving has to ask which dates a change is for: an existing
   * repeating entry. Not a birthday — its one date is the anchor, and every
   * edit to it means every year.
   */
  const asksWhichDates =
    mode === 'edit' && !readOnly && !!existing?.recurrence && existing.kind !== 'birthday';
  const [asking, setAsking] = useState(false);

  /**
   * Whether this form saves as it changes: everything but a repeating entry,
   * which cannot be written until it is known which dates a change is for, and
   * anything this device may not edit.
   */
  const autosaves = !readOnly && !asksWhichDates;
  const targetId = newId ?? occurrence?.eventId ?? null;

  /** The draft as the form opened, which the first save is measured against. */
  const [openedDraft] = useState(() => draftFor('series'));
  /** The draft last handed to the store. */
  const lastSaved = useRef<EventDraft | null>(null);
  /** Whether the entry exists yet: an edit's always has, a new one's from its first save. */
  const exists = useRef(mode === 'edit');

  /**
   * The popup's edit session: begun when it opens, ended when it unmounts —
   * however that happens, closing or HISTORY stepping in front of it. Ending it
   * writes anything still waiting and records the popup's changes as one undo.
   * Begun in an effect rather than during render, so Strict Mode's rehearsal
   * mount opens and closes an empty one instead of leaking it.
   */
  const session = useRef<EditSession | null>(null);
  useEffect(() => {
    const s = beginEdit();
    session.current = s;
    // A phone suspends a page it has hidden, and a timer that has not fired by
    // then never does: switching apps is the moment to write.
    const hidden = () => {
      if (document.visibilityState === 'hidden') void flushEdit(s);
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      session.current = null;
      void endEdit(s);
    };
  }, [beginEdit, flushEdit, endEdit]);

  /**
   * Hand the store the form as it stands, if it has changed since last time.
   *
   * `force` is for the one save that is not a change: closing a new entry
   * nobody touched, which still creates it, as UNTITLED.
   */
  function save(force = false) {
    if (!autosaves || !session.current || !targetId) return;
    const draft = draftFor('series');
    if (!force && same(draft, lastSaved.current ?? openedDraft)) return;
    lastSaved.current = draft;
    exists.current = true;
    saveDraft(session.current, targetId, draft);
  }

  // After every render: the fields are this form's state, and this is where
  // that state reaches the calendar. Most renders change nothing, and `save`
  // then does nothing.
  useEffect(() => save());

  // Reported after every render too, and after the save above, so a first
  // save and the draft bar giving way to the real one happen in the same
  // commit. The shell ignores a report that changes nothing.
  useEffect(() => {
    onDraftChange?.(exists.current ? null : { start: startDate, end: endDate, title });
  });

  /**
   * The form as a draft, with its dates read one of two ways.
   *
   * `series` is what EVERY DATE writes. The form opens on the occurrence you
   * clicked, so a date typed into it reaches the row as a shift — `ontoSeries`.
   * `shown` is the form as it reads, the occurrence's own dates: what THIS DATE
   * compares against, and where THIS AND LATER starts the new series.
   */
  function draftFor(dates: 'series' | 'shown'): EventDraft {
    // An empty title is not a reason to refuse. Clicking away from a form you
    // filled in should not silently throw it out, and a draft with nothing in
    // it at all is still a block of time you deliberately marked — it just gets
    // called something until you say otherwise. Escape is how you say no.
    const named = title.trim() || UNTITLED;

    // A birthday is one all-day date whatever the WHEN field last held, and
    // `normalizeWhen` is what decides that an end pulled back before its start
    // means a single day.
    const w = normalizeWhen({ ...when, allDay: isBirthday ? true : allDay });

    /**
     * The row's own dates, which are not the ones on screen.
     *
     * `null` for a new entry, for a birthday, whose field was already the
     * row's, and for the `shown` reading — see `ontoSeries`, which is the
     * identity when there is no series date to shift.
     */
    const span = dates === 'series' && existing && !opensOnSeries ? eventSpan(existing) : null;
    const startDate = ontoSeries(w.startDate, opened.startDate, span?.start);

    return {
      title: named,
      kind,
      allDay: w.allDay,
      startDate,
      endDate: isBirthday ? startDate : ontoSeries(w.endDate, opened.endDate, span?.end),
      startMinutes: w.allDay ? undefined : w.startMinutes,
      endMinutes: w.allDay ? undefined : w.endMinutes,
      dueMinutes: ctx === 'allDay' ? dueMinutes : null,
      categoryId,
      recurrence: buildRecurrence(),
      // Always sent, including when empty. Unlike `notify` this field is the
      // form's to state, so an omitted value would mean "unchanged" when the
      // user meant "I turned them all off".
      reminders,
      anchorDate: effectiveTemplate ? effectiveAnchor : null,
      displayTemplate: effectiveTemplate,
      // `notify` is deliberately absent. It is the Google mirror flag, and the
      // mirror does not exist — no route reads it. Leaving it out of the draft
      // means an edit preserves whatever a row already holds.
      notes: notes.trim() || null,
    };
  }

  /**
   * Close, keeping what is in the fields, whatever asked.
   *
   * Every way out comes here — the bottom button, Enter, clicking away, the
   * header's button and Escape, which the shell routes through `dismissEntry`
   * — and they all mean the same thing now: keep it. The saving already
   * happened as the fields changed; this settles the last details.
   *
   * A change to a repeating entry is the exception: it stops and asks which
   * dates the change is for, and the answer is what saves. While the question
   * is up this does nothing, so a second click away cannot slip past it.
   */
  function commit() {
    if (asking) return;

    if (asksWhichDates && occurrence) {
      // Only when something changed: opening an entry to look at it and
      // clicking away is not an edit, and must not be asked about as one.
      if (wouldChange(occurrence.eventId, draftFor('series'))) {
        setAsking(true);
        return;
      }
      onClose();
      return;
    }

    // A new entry nobody touched is still created — under UNTITLED, the name
    // its draft bar has had the whole time. Anything else is saved already,
    // bar a last keystroke whose save has not run yet, which this catches.
    save(mode === 'new' && !exists.current);
    onClose();
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
      <fieldset disabled={readOnly || asking} className="grid flex-1 grid-cols-1 gap-x-4 gap-y-4 overflow-y-auto px-4 py-4 sm:grid-cols-2 disabled:opacity-90">
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
          <Field label="[01] TYPE" group>
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
            so it keeps the plain picker.

            Every date field here is a group, though each holds one control:
            its picker's panel opens inside the field, and as a label the field
            sent every click on the panel's words and gaps to the trigger, which
            shut the panel. So the caption no longer opens the picker, which
            costs little — the trigger is the width of the field, directly
            beneath it. */}
        {isBirthday ? (
          <Field label="[02] BIRTH DATE" group>
            <DatePicker
              label="Birth date"
              value={startDate}
              timezone={timezone}
              onChange={(d) => setWhen((w) => normalizeWhen({ ...w, startDate: d, endDate: d }))}
            />
          </Field>
        ) : (
          <div className="col-span-full">
            <Field label="[02] WHEN" group>
              <WhenField value={when} onChange={setWhen} timezone={timezone} />
            </Field>
          </div>
        )}

        {!isBirthday && (
          <Field label="[03] REPEATS" group>
            <div className="flex flex-wrap items-center gap-2">
              {/* 260px: five cells as wide as MONTH needs. Allowed to shrink
                  past that, the cells gave their room to the EVERY count and
                  truncated to O… D… W… in the half-width column; held here,
                  the count wraps onto its own line instead. */}
              <div className="min-w-[260px] flex-1">
                <SegmentedControl value={freq} options={FREQS} onChange={setFreq} />
              </div>
              {freq !== 'NONE' && (
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="label">EVERY</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_INTERVAL}
                    value={everyText ?? every}
                    onChange={(e) => {
                      setEveryText(e.target.value);
                      if (e.target.value !== '') setEvery(clampInterval(e.target.valueAsNumber));
                    }}
                    onBlur={() => setEveryText(null)}
                    aria-label="Repeat every"
                    className={numberClass}
                  />
                  <span className="label">{periodWord(freq, every)}</span>
                </span>
              )}
            </div>
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
          <Field label="ANCHOR DATE" group>
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
          <Field label="[06] REMIND ME" group>
            <ReminderField
              ctx={ctx}
              rows={rows}
              onRows={(next) => {
                setRemindersTouched(true);
                setChosenRows(next);
              }}
              notes={rowNotesById}
              due={
                ctx === 'allDay' || ctx === 'anyTime'
                  ? {
                      minutes: dueMinutes,
                      onChange: setDueMinutes,
                      onClear: () => setDueMinutes(null),
                    }
                  : undefined
              }
            />
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
        {asking && occurrence && existing ? (
          <ScopePrompt
            patch={oneDatePatch(existing, occurrence, draftFor('shown'))}
            canSplit={canSplitAt(existing, occurrence)}
            onThisDate={(patch) => {
              onClose();
              void editOccurrence(occurrence, patch);
            }}
            onThisAndLater={() => {
              onClose();
              void splitSeries(occurrence, draftFor('shown'));
            }}
            onEveryDate={() => {
              onClose();
              void updateEventFromDraft(occurrence.eventId, draftFor('series'));
            }}
            onBack={() => setAsking(false)}
            onDiscard={onClose}
          />
        ) : (
          /* Wraps, because an edit on a recurring entry puts four buttons in
             here and SAVE is `flex-1` — on a phone the other three were being
             squeezed to their padding. */
          <div className="flex flex-wrap gap-2">
            {readOnly ? (
              <Button type="button" variant="quiet" onClick={onClose} className="flex-1">
                CLOSE
              </Button>
            ) : (
              // DONE rather than SAVE: nothing waits for it. It is the same close
              // as clicking away, kept because the bottom of a form is where a
              // thumb goes looking for the way out.
              <Button type="submit" variant="primary" className="flex-1">
                DONE
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
        )}
      </div>
    </form>
  );
}
