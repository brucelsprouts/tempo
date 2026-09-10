import { addDays, type CivilDate } from './civil';
import type { Recurrence } from './types';

/**
 * One series cut in two at `at`, for "this and later".
 *
 * The earlier half keeps its own rule and stops the day before `at`. The later
 * half takes the rule the edit asked for, from `at` on. Between them they must
 * say exactly what the uncut series said about every date the edit did not
 * change:
 *
 * - **Skipped dates** go with the half they fall in.
 * - **A count** is a total for the whole series, so the later half gets what is
 *   left of it. The occurrence at `at` is number `index`, so `index - 1` were
 *   spent before it — skipped dates included, which is RFC 5545's rule and
 *   `occurrenceDates`', and which `index` already reflects.
 * - **An end date** stays on the later half, where the series actually ends.
 *   The earlier half's end becomes the day before the cut, and its count is
 *   dropped because the date now says where it stops.
 *
 * `edited` is `null` when the edit turned the repeat off: the later half is a
 * one-off.
 */
export function splitRule(
  current: Recurrence,
  at: CivilDate,
  index: number,
  edited: Recurrence | null,
): { earlier: Recurrence; later: Recurrence | null } {
  const earlier: Recurrence = {
    ...current,
    until: addDays(at, -1),
    count: null,
    exdates: (current.exdates ?? []).filter((d) => d < at),
  };
  if (!edited) return { earlier, later: null };

  return {
    earlier,
    later: {
      ...edited,
      count: edited.count ? Math.max(1, edited.count - (index - 1)) : null,
      exdates: (edited.exdates ?? []).filter((d) => d >= at),
    },
  };
}
