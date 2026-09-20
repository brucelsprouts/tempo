/**
 * Tempo — which backups survive, and how a backup's filename is spelled.
 *
 * Split out from `backup.mts` so it can be tested. This is the half of the
 * script that deletes things, and it is the half with no network, no clock of
 * its own and no filesystem — the window is always passed in, which is what
 * makes the boundaries testable at all.
 */

export interface Backup {
  name: string;
  at: Date;
}

/** `2026-09-19T20-30-00Z` — ISO, with the colons a filename cannot hold. */
export function stamp(at: Date): string {
  return at.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
}

/** The inverse, or nothing for a file this script did not write. */
export function unstamp(name: string): Date | null {
  const m = /^tempo-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.json$/.exec(name);
  if (!m) return null;
  const at = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** `2026-09` — the monthly folder a backup taken at this moment belongs in. */
export function folder(at: Date): string {
  return at.toISOString().slice(0, 7);
}

/**
 * Newest first, from paths relative to the backup root — `2026-09/tempo-….json`.
 *
 * A path counts as a backup only if its folder is the one its own stamp names.
 * A file moved into the wrong month by hand therefore does not parse, so the
 * prune cannot see it and will not delete it. That is the same protection
 * `notes.txt` already had, extended to the more dangerous case: a stray that
 * *is* a real backup, which a looser parser would happily delete.
 */
export function parseBackups(paths: string[]): Backup[] {
  return paths
    .map((name): { name: string; at: Date | null } => {
      const slash = name.indexOf('/');
      if (slash === -1) return { name, at: null };
      const at = unstamp(name.slice(slash + 1));
      if (at === null || name.slice(0, slash) !== folder(at)) return { name, at: null };
      return { name, at };
    })
    .filter((f): f is Backup => f.at !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

/**
 * Which backups survive.
 *
 * The same shape as the app's own version retention, and for the same reason:
 * counting backups answers the wrong question. "Keep the last 20" means a week
 * where you ran the script often silently pushes out the copy from before the
 * mistake you are trying to undo — and the whole point of a backup is the one
 * from *before* you noticed.
 *
 *   under a week    every run. You still remember what you changed.
 *   under 3 months  the newest of each day.
 *   under 2 years   the newest of each month.
 *   beyond          the newest of each year, kept for good.
 *
 * The yearly tail never expires. At roughly a megabyte a file that is a cost
 * worth not counting, and the alternative — a cliff at two years — deletes the
 * only copy of a calendar from an era you can no longer reconstruct.
 *
 * Plus a floor of three, for a folder holding fewer than three distinct years.
 */
export function survivors(files: Backup[], now: Date): Set<string> {
  const ageDays = (at: Date) => (now.getTime() - at.getTime()) / 86_400_000;
  const newestPer = new Map<string, Backup>();
  const keep = new Set<string>();

  for (const f of files) {
    const days = ageDays(f.at);
    if (days < 7) {
      keep.add(f.name);
      continue;
    }

    // UTC calendar days and months, deliberately: grouping by the runner's
    // local midnight would mean a backup folder that thins differently
    // depending on where you were sitting when you ran it.
    // Day, month and year keys are 10, 7 and 4 characters, so they cannot
    // collide across tiers even though they share one map.
    const bucket =
      days < 90
        ? f.at.toISOString().slice(0, 10)
        : days < 730
          ? f.at.toISOString().slice(0, 7)
          : f.at.toISOString().slice(0, 4);

    const held = newestPer.get(bucket);
    if (!held || f.at > held.at) newestPer.set(bucket, f);
  }

  for (const f of newestPer.values()) keep.add(f.name);

  // The floor is a safety net, not a tier: it tops the folder up to three only
  // when everything above kept fewer than that — which, now that the yearly
  // tail never expires, means a folder spanning fewer than three calendar
  // years rather than one that has aged out entirely.
  //
  // Conditional rather than an unconditional "always keep the newest three",
  // which sounds equivalent and is not: it would pin recent files the daily and
  // monthly tiers had just deliberately thinned, so "the newest of each month"
  // would quietly mean "the newest of each month, plus a couple of stragglers".
  if (keep.size < 3) {
    const newestFirst = [...files].sort((a, b) => b.at.getTime() - a.at.getTime());
    for (const f of newestFirst) {
      if (keep.size >= 3) break;
      keep.add(f.name);
    }
  }

  return keep;
}
