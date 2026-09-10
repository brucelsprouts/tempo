import type { EventDraft } from '@/lib/store/calendar-store';
import { same } from '@/lib/store/undo';
import { eventSpan } from '@/lib/tempo/recurrence';
import type { Occurrence, OccurrencePatch, TempoEvent } from '@/lib/tempo/types';

const minutesOf = (rs: { minutes: number }[] | undefined) =>
  (rs ?? []).map((r) => r.minutes).sort((a, b) => a - b);

/**
 * What the form's values mean for one date of a series — or `null` when they
 * cannot be said about one date.
 *
 * An exception can move a date, retime it and rename it; that is all an
 * `OccurrencePatch` holds. A change to anything else — the type, the category,
 * the reminders, the repeat, the derived label, the notes, the all-day switch —
 * is a change to what the series *is*, and one date cannot differ from its
 * series in those. Google allows it because every Google instance is a whole
 * event of its own; here an instance is the series seen on one day.
 *
 * `shown` is the form as it reads: the occurrence's dates, not the series'. An
 * empty patch means nothing one date could hold has changed.
 */
export function oneDatePatch(
  existing: TempoEvent,
  occ: Occurrence,
  shown: EventDraft,
): OccurrencePatch | null {
  const seriesLevel =
    shown.kind !== existing.kind ||
    (shown.categoryId ?? null) !== existing.categoryId ||
    !same(minutesOf(shown.reminders), minutesOf(existing.reminders)) ||
    !same(shown.recurrence ?? null, existing.recurrence) ||
    (shown.displayTemplate ?? null) !== existing.displayTemplate ||
    (shown.anchorDate ?? null) !== existing.anchorDate ||
    (shown.notes ?? null) !== existing.notes ||
    shown.allDay !== existing.allDay;
  if (seriesLevel) return null;

  const patch: OccurrencePatch = {};
  if (shown.title !== existing.title) patch.title = shown.title;
  if (shown.startDate !== occ.date || shown.endDate !== occ.endDate) {
    patch.startDate = shown.startDate;
    patch.endDate = shown.endDate;
  }
  if (
    !shown.allDay &&
    (shown.startMinutes !== occ.startMinutes || shown.endMinutes !== occ.endMinutes)
  ) {
    patch.startMinutes = shown.startMinutes;
    patch.endMinutes = shown.endMinutes;
  }
  return patch;
}

/** A title that counts its occurrences — which a new series would restart at 1. */
const NUMBERED = /\{n\}|ordinal\(n\)/;

/**
 * Whether THIS AND LATER is worth offering, and safe.
 *
 * Not on the first date: from there, "and later" is every date. Not on a title
 * that counts its occurrences: the later half is a new series and would number
 * itself from 1.
 */
export function canSplitAt(existing: TempoEvent, occ: Occurrence): boolean {
  if (!existing.recurrence || existing.kind === 'birthday') return false;
  if (existing.displayTemplate && NUMBERED.test(existing.displayTemplate)) return false;
  const span = eventSpan(existing);
  return !!span && occ.seriesDate > span.start;
}
