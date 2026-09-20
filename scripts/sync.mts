/**
 * Tempo — what the desktop still needs from the box, and whether the box has
 * gone quiet.
 *
 * The pure half of `pull-backups.mts`: no network, no filesystem, no clock of
 * its own. The same split as `retention.mts`, for the same reason — this is the
 * half with the decisions in it, so this is the half worth testing.
 */

import { parseBackups } from './retention.mts';

/**
 * Remote paths with no local counterpart, oldest first.
 *
 * Filtered through `parseBackups`, so anything on the box that is not a backup
 * is not something the desktop copies down — the runner hands this list
 * straight to `scp`.
 *
 * Oldest first so that an interrupted catch-up leaves a contiguous run of
 * history rather than a scattering with holes in it.
 */
export function toFetch(remote: string[], local: string[]): string[] {
  const have = new Set(local);
  return parseBackups(remote.filter((r) => !have.has(r)))
    .map((f) => f.name)
    .reverse();
}

/**
 * True when the newest backup on the box is older than `days`.
 *
 * The canary. A backup system that fails silently is the exact failure the
 * whole exercise exists to prevent, and the desktop is the surface that
 * actually gets looked at. An empty list counts as stale — no backups at all is
 * the loudest version of the problem, not the absence of one.
 */
export function isStale(remote: string[], now: Date, days = 2): boolean {
  const newest = parseBackups(remote)[0];
  if (!newest) return true;
  return now.getTime() - newest.at.getTime() > days * 86_400_000;
}
