import { addDays, diffDays, LAST_MINUTE_OF_DAY, maxDate, minDate } from '@/lib/tempo/civil';
import type { CivilDate } from '@/lib/tempo/civil';
import type { Occurrence } from '@/lib/tempo/types';

/**
 * The arithmetic behind dragging an entry's edge.
 *
 * Separated from `ContinuousCalendar` for the same reason `timeline.ts` is
 * separated from `DayView`: none of it is about React and all of it is about
 * cases you cannot reliably click your way to — an overnight collapsing onto
 * one date, a selection where one member has two days to give and the rest have
 * a fortnight. Dates in, a number of days out.
 *
 * The preview and the commit both read these, so what lands is what was drawn.
 */

/** The two ends a bar can be dragged by. */
export type Edge = 'start' | 'end';

/**
 * The fewest days this entry is allowed to span, dragged from this edge.
 *
 * One day for nearly everything. Collapsed onto one date the store moves the
 * dragged edge to that date's own boundary — the trailing one to 23:59, the
 * leading one to 00:00 — so an 18:00-to-midnight evening does fit on a single
 * day once its end gives up midnight. What does not fit is what that clamp
 * would leave with no length at all: an entry ending at exactly midnight
 * occupies none of the date it ends on, and one starting at 23:59 has no room
 * left on the date it starts. Those keep a two-day floor, because the store
 * would decline them.
 */
export function spanFloor(occ: Occurrence, edge: Edge): number {
  const start = occ.startMinutes ?? 0;
  const end = occ.endMinutes ?? 0;
  const fitsOnOneDay =
    occ.allDay ||
    (edge === 'end'
      ? (end < start ? LAST_MINUTE_OF_DAY : end) > start
      : end > (end < start ? 0 : start));
  return fitsOnOneDay ? 0 : 1;
}

/**
 * The span a half-finished resize is describing, for the bar under the pointer.
 *
 * Inversion is clamped rather than flipped: dragging the end handle above the
 * start pins the bar at its shortest instead of turning it inside out. Clamping
 * in the preview but not the commit would show a short bar and then write
 * nothing at all, since the store refuses an inverted span outright.
 */
export function resizedSpan(
  occ: Occurrence,
  edge: Edge,
  to: CivilDate,
): { date: CivilDate; endDate: CivilDate } {
  const floor = spanFloor(occ, edge);
  return edge === 'end'
    ? { date: occ.date, endDate: maxDate(to, addDays(occ.date, floor)) }
    : { date: minDate(to, addDays(occ.endDate, -floor)), endDate: occ.endDate };
}

/**
 * How many days the resize is asking every entry in the group to move by.
 *
 * The dragged bar sets the number — it is the one the pointer is on, so it is
 * the one whose edge has to end up under the cursor — and then the group gets a
 * say, because "the same amount of days" is the whole request and an entry that
 * stopped short at its own floor would break it. So the delta is clamped by the
 * *tightest* member rather than per entry: three bars dragged four days
 * shorter, one of which only has two days to give, all move two. The
 * alternative — each shortening as far as it can — silently turns one gesture
 * into several different edits, which is exactly what a shared delta exists to
 * prevent, and it is the rule `moveOccurrences` already follows for the arrow
 * keys.
 *
 * Only the shortening side ever clamps. Lengthening has no ceiling, which is
 * the direction this is nearly always dragged in.
 *
 * A single-bar resize passes a group of one, where the clamp is a no-op:
 * `resizedSpan` has already respected that bar's floor.
 */
export function groupResizeDelta(
  group: readonly Occurrence[],
  dragged: Occurrence,
  edge: Edge,
  to: CivilDate,
): number {
  const span = resizedSpan(dragged, edge, to);
  let delta =
    edge === 'end'
      ? diffDays(span.endDate, dragged.endDate)
      : diffDays(span.date, dragged.date);

  for (const occ of group) {
    // How far this entry's dragged edge can travel inward before the bar has
    // nothing left.
    const room = diffDays(occ.endDate, occ.date) - spanFloor(occ, edge);
    delta = edge === 'end' ? Math.max(delta, -room) : Math.min(delta, room);
  }
  return delta;
}

/** The one end a resize moves, as a patch over an occurrence. */
export function resizedEdge(
  occ: Occurrence,
  edge: Edge,
  delta: number,
): { date: CivilDate; endDate: CivilDate } {
  return edge === 'end'
    ? { date: occ.date, endDate: addDays(occ.endDate, delta) }
    : { date: addDays(occ.date, delta), endDate: occ.endDate };
}
