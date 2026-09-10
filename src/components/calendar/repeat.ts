import type { Frequency, Recurrence } from '@/lib/tempo/types';

/** What the REPEATS control can say: a frequency, or that there is none. */
export type RepeatFreq = Frequency | 'NONE';

export const MAX_INTERVAL = 99;

/** An EVERY value made safe to store: a whole number from 1 to 99. */
export function clampInterval(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_INTERVAL, Math.max(1, Math.round(n)));
}

/** The word after EVERY [ N ], pluralised: WEEK, WEEKS. */
export function periodWord(freq: Frequency, n: number): string {
  const word = { DAILY: 'DAY', WEEKLY: 'WEEK', MONTHLY: 'MONTH', YEARLY: 'YEAR' }[freq];
  return n === 1 ? word : `${word}S`;
}

/**
 * The rule REPEATS and EVERY describe, built on the one already stored.
 *
 * The form used to write a fresh rule on every save, which quietly threw away
 * everything it had no control for — a Monday-to-Friday weekday set, an end
 * date, a count, the dates a series skips — so saving a weekday standup from
 * the form turned it into a plain weekly one. The stored rule is the starting
 * point now. The same frequency keeps all of it and changes only the interval.
 * A different frequency keeps where the series ends and what it skips, and
 * drops only the parts that described the old frequency.
 *
 * An unchanged interval returns the stored rule itself, not a copy, so a form
 * opened and closed without touching REPEATS reads as unchanged — even for a
 * rule stored with no explicit interval. The CHANGE WHICH DATES? question
 * relies on that.
 */
export function repeatRule(
  prev: Recurrence | null,
  freq: RepeatFreq,
  interval: number,
): Recurrence | null {
  if (freq === 'NONE') return null;
  const every = clampInterval(interval);
  if (!prev) return { freq, interval: every };
  if (prev.freq === freq) {
    return (prev.interval ?? 1) === every ? prev : { ...prev, interval: every };
  }
  return {
    freq,
    interval: every,
    ...(prev.until ? { until: prev.until } : {}),
    ...(prev.count ? { count: prev.count } : {}),
    ...(prev.exdates?.length ? { exdates: prev.exdates } : {}),
    ...(prev.onInvalid ? { onInvalid: prev.onInvalid } : {}),
  };
}
