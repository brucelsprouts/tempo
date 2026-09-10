import { addDays, parts, type CivilDate } from '@/lib/tempo/civil';

export interface Month {
  year: number;
  month: number;
}

/**
 * Which month the screen is showing, and whether the next one has begun on it.
 *
 * The readout used to name the month of the topmost row with any pixel on
 * screen, so a week that had scrolled nine-tenths out of view still decided it
 * — the label ran about a row ahead of the eye, and further once rows grew to
 * fit their entries. Now every visible day votes for its month, weighted by how
 * much of its row is on screen, and the month with the most wins. A tie goes to
 * the earlier month, so an exact half cannot make the label flicker.
 *
 * `next` is the month of the last visible day when it is later than the head:
 * the `→ OCTOBER` that says October has started further down.
 *
 * `null` when nothing is visible yet — before the first measurement.
 */
export function monthReadout(
  rows: ReadonlyArray<{ weekStart: CivilDate; visible: number }>,
): { head: Month; next: Month | null } | null {
  const weight = new Map<number, number>();
  let last = -Infinity;

  for (const { weekStart, visible } of rows) {
    if (!(visible > 0)) continue;
    for (let i = 0; i < 7; i++) {
      const { year, month } = parts(addDays(weekStart, i));
      const key = year * 12 + (month - 1);
      weight.set(key, (weight.get(key) ?? 0) + visible);
      last = Math.max(last, key);
    }
  }
  if (weight.size === 0) return null;

  let head = -1;
  for (const key of [...weight.keys()].sort((a, b) => a - b)) {
    if (head === -1 || weight.get(key)! > weight.get(head)!) head = key;
  }

  const month = (key: number): Month => ({ year: Math.floor(key / 12), month: (key % 12) + 1 });
  return { head: month(head), next: last > head ? month(last) : null };
}
