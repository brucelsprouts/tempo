# Scheduled Backups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Tempo's existing backup script nightly on the Oracle box and pull every backup down to the Desktop, so the calendar has a copy that does not live on the machine it is protecting.

**Architecture:** Two halves joined by a directory. Oracle takes the backup at 03:00 America/Toronto via a systemd timer, reads over `localhost:8000`, writes into `~/tempo-backups/YYYY-MM/`, and owns retention. Windows runs a daily Task Scheduler job that lists the box over SSH, fetches what it does not have, and never deletes anything — so the Desktop archive is always a superset of the server's.

**Tech Stack:** Node (type-stripping `.mts`, no build step), vitest, `@supabase/supabase-js`, systemd timers, Windows Task Scheduler, OpenSSH.

**Spec:** `docs/superpowers/specs/2026-09-20-scheduled-backups-design.md`

---

## Status — 2026-09-20

**Tasks 1–7 are done and committed** (`f89a97c`…`a132943`). 498 tests pass,
typecheck and lint clean. That is the whole codebase half.

**Tasks 0 and 8–11 are blocked on two things the user has to supply:**

1. **SSH from the Windows machine to the box does not authenticate.**
   `ubuntu@192.18.158.188: Permission denied (publickey)` — the box is in
   `known_hosts`, so something has reached it before, but not this machine's
   `~/.ssh/id_ed25519`. Until its public key is in the box's
   `authorized_keys`, Tasks 8, 9 and 10 cannot run, and the box's Node version
   (Task 0, the hard blocker) cannot even be read.
2. **`SUPABASE_SERVICE_ROLE_KEY` is empty in the local `.env.local`**, and
   `NEXT_PUBLIC_SUPABASE_URL` there still points at the old hosted
   `*.supabase.co` project rather than `supabase.brucelsprouts.com`. So the
   end-to-end runs in Task 4 Step 6 and Task 5 Step 2 could not be executed
   locally.

**What was verified instead**, since those runs were unavailable:

- `listBackups`'s recursive `readdir` plus separator normalisation, against a
  fabricated folder on Windows: 9 entries in, exactly the 2 correctly-filed
  backups recognised; a backup misfiled under the wrong month, `README.md`,
  `notes.txt` and the canary file all correctly invisible to the prune.
- The pull runner's whole local pipeline: oldest-first ordering, non-backups
  excluded from the fetch plan, month folders created at the right paths, a
  second run a no-op, and the canary file appearing when the box goes quiet and
  deleting itself on recovery.
- The pull's failure path against the real box: fails in 1.6s, exits non-zero,
  names the command — confirming `ConnectTimeout` and `BatchMode` prevent a hang.

**Still unverified at runtime:** the empty-backup guard in Task 5 (typechecked
only), and the `ssh`/`scp` invocations themselves.

---

## Task 0: Verify the box can run the script at all — BLOCKER

`SELF_HOSTING.md` records the box on **Node 20**. Node only strips TypeScript
from `.mts` natively from 22.6 (on by default from 22.18), so `node
scripts/backup.mts` — the command `npm run backup` runs — **cannot work on Node
20**. Every Oracle-side task below depends on resolving this. Do not start Task
1 until this is answered.

Nothing else in this plan touches the box's runtime, so if the Node version
turns out to be fine, this task is three commands and you move on.

- [ ] **Step 1: Read the actual versions on the box**

```bash
ssh ubuntu@192.18.158.188 'node --version; which node; systemd-analyze --version | head -1'
```

Expected: a Node version and a systemd version. Record both — the node path is
needed verbatim in Task 9's `ExecStart`, and systemd must be **≥ 252** for the
timezone suffix in `OnCalendar` (24.04 ships 255).

- [ ] **Step 2: Confirm the box has the service role key**

```bash
ssh ubuntu@192.18.158.188 'grep -c SUPABASE_SERVICE_ROLE_KEY ~/tempo/.env.local; grep -c SUPABASE_INTERNAL_URL ~/tempo/.env.local'
```

Expected: `1` and `1`. If `SUPABASE_SERVICE_ROLE_KEY` is missing, it comes from
Studio → Project Settings → API and must be added to `~/tempo/.env.local`
(which is already chmod 600).

- [ ] **Step 3: Branch on the Node version**

**If Node ≥ 22.18:** nothing to do. Proceed to Task 1.

**If Node < 22.18: STOP and ask the user before proceeding.** The fix is to
upgrade the box's Node, which `SELF_HOSTING.md` already lists as a wanted change
("Upgrade to 22 when convenient") and which also silences the `supabase-js`
deprecation warning. But it means restarting the app the user depends on, so it
is their call, not yours. The upgrade, once approved:

```bash
ssh ubuntu@192.18.158.188
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version                                    # expect v22.x
cd ~/tempo && npm ci && npm run build
pm2 restart tempo && pm2 logs tempo --lines 20    # expect a clean boot
```

Then re-run Step 1 and record the new `which node` path.

---

## Task 1: Retention keeps a yearly tier instead of dropping

**Files:**
- Modify: `scripts/retention.mts:40-56` (doc comment), `scripts/retention.mts:62-73` (the bucket)
- Test: `scripts/retention.test.ts:68-73`

- [x] **Step 1: Replace the failing test**

In `scripts/retention.test.ts`, replace the whole `it('drops everything past two years', ...)` block with:

```ts
  it('thins to one a year past two years, and keeps it for good', () => {
    // Four from the same calendar year, all older than two years, plus one
    // from a different year. The old tail is the whole point of the change:
    // it used to be dropped outright.
    const files = [old(0), old(800), old(830), old(860), old(1200)];
    const names = kept(files);
    const sameYear = [old(800), old(830), old(860)].filter((f) => names.includes(f.name));
    expect(sameYear).toHaveLength(1);
    expect(sameYear[0].name).toBe(old(800).name);
    expect(names).toContain(old(1200).name);
  });

  it('never drops the oldest backup there is', () => {
    // A ten-year-old calendar. Nothing ages out of the archive entirely.
    const files = [old(0), old(3650)];
    expect(kept(files)).toContain(old(3650).name);
  });
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/retention.test.ts`
Expected: FAIL — both new tests. The first because everything past 730 days is
currently dropped, so `sameYear` has length 0; the second because `old(3650)` is
dropped.

- [x] **Step 3: Make the bucket fall through to a year**

In `scripts/retention.mts`, replace these lines:

```ts
    const bucket =
      days < 90
        ? f.at.toISOString().slice(0, 10)
        : days < 730
          ? f.at.toISOString().slice(0, 7)
          : null;
    if (bucket === null) continue;
```

with:

```ts
    // Day, month and year keys are 10, 7 and 4 characters, so they cannot
    // collide across tiers even though they share one map.
    const bucket =
      days < 90
        ? f.at.toISOString().slice(0, 10)
        : days < 730
          ? f.at.toISOString().slice(0, 7)
          : f.at.toISOString().slice(0, 4);
```

- [x] **Step 4: Correct the doc comment, which now describes something untrue**

In `scripts/retention.mts`, replace:

```
 *   under a week    every run. You still remember what you changed.
 *   under 3 months  the newest of each day.
 *   under 2 years   the newest of each month.
 *   beyond          dropped.
 *
 * Plus a floor of three, so a calendar left alone for years does not age out of
 * having any backup at all.
```

with:

```
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
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run scripts/retention.test.ts`
Expected: PASS, all tests. The existing `keeps the newest three however old they
are` case still passes — `old(1800)`, `old(1805)` and `old(1810)` all land in
the same calendar year, so the yearly tier keeps one and the floor tops it to
three.

- [x] **Step 6: Commit**

```bash
git add scripts/retention.mts scripts/retention.test.ts
git commit -m "Keep one backup a year instead of dropping the old ones"
```

---

## Task 2: Backups live in monthly folders

**Files:**
- Modify: `scripts/retention.mts` (add `folder`, rewrite `parseBackups`)
- Test: `scripts/retention.test.ts`

- [x] **Step 1: Write the failing tests**

In `scripts/retention.test.ts`, replace the `it('ignores anything this script did not write', ...)` block with:

```ts
  it('ignores anything this script did not write', () => {
    // The prune deletes what `survivors` does not name, so a stray file that
    // parsed as a backup would be a file this script deletes on someone's
    // behalf. Everything unrecognised has to stay unrecognised.
    expect(unstamp('notes.txt')).toBeNull();
    expect(unstamp('tempo-backup.json')).toBeNull();
    expect(unstamp('tempo-2026-09-19.json')).toBeNull();
    expect(unstamp('tempo-2026-13-45T99-99-99Z.json')).toBeNull();
  });

  it('names the monthly folder a backup belongs in', () => {
    expect(folder(new Date('2026-09-19T20:30:00Z'))).toBe('2026-09');
    // UTC, like every other bucket here: the folder a file lands in should not
    // depend on where the machine writing it happened to be.
    expect(folder(new Date('2026-10-01T03:59:00Z'))).toBe('2026-10');
  });

  it('reads backups out of their monthly folders', () => {
    const paths = ['2026-09/tempo-2026-09-19T20-30-00Z.json', 'notes.txt', '2026-09/README.md'];
    expect(parseBackups(paths).map((f) => f.name)).toEqual([
      '2026-09/tempo-2026-09-19T20-30-00Z.json',
    ]);
  });

  it('refuses a backup filed under the wrong month', () => {
    // A file a human moved by hand. Refusing to parse it means the prune
    // cannot see it, so it is never deleted on someone's behalf — the same
    // protection `notes.txt` gets, extended to a stray that is a real backup.
    expect(parseBackups(['2026-01/tempo-2026-09-19T20-30-00Z.json'])).toHaveLength(0);
  });

  it('refuses a backup sitting loose in the root', () => {
    expect(parseBackups(['tempo-2026-09-19T20-30-00Z.json'])).toHaveLength(0);
  });
```

Then update the import at the top of the file to pull in `folder`:

```ts
import { folder, parseBackups, stamp, survivors, unstamp, type Backup } from './retention.mts';
```

And update the `old()` helper so every `survivors` test works on realistic
paths rather than bare filenames:

```ts
/** A backup taken `days` before NOW, at `hour` UTC, in the folder it belongs in. */
function old(days: number, hour = 12): Backup {
  const at = new Date(NOW.getTime() - days * 86_400_000);
  at.setUTCHours(hour, 0, 0, 0);
  return { name: `${folder(at)}/tempo-${stamp(at)}.json`, at };
}
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/retention.test.ts`
Expected: FAIL — `folder` is not exported, so the file does not even compile.

- [x] **Step 3: Add `folder` and rewrite `parseBackups`**

In `scripts/retention.mts`, add after `unstamp`:

```ts
/** `2026-09` — the monthly folder a backup taken at this moment belongs in. */
export function folder(at: Date): string {
  return at.toISOString().slice(0, 7);
}
```

Then replace `parseBackups` entirely:

```ts
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
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/retention.test.ts`
Expected: PASS, all tests.

- [x] **Step 5: Commit**

```bash
git add scripts/retention.mts scripts/retention.test.ts
git commit -m "File backups under the month they were taken"
```

---

## Task 3: The backup reads over the internal URL

**Files:**
- Modify: `scripts/backup.mts:33-47`, `scripts/backup.mts:57-59`, `scripts/backup.mts:96`, `scripts/backup.mts:127`

This one has no test: it is a change to which environment variable a process
reads at startup, and a test would only assert that the code says what it says.
It is verified on the box in Task 8.

- [x] **Step 1: Split the identity of the project from the address used to read it**

In `scripts/backup.mts`, replace:

```ts
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.');
  console.error('The service role key is in Dashboard -> Project Settings -> API.');
  process.exit(1);
}
```

with:

```ts
const PUBLIC_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Read over the internal URL when there is one, exactly as `server.ts` and
// `proxy.ts` do. Run on the box without this, the backup leaves the machine,
// goes out to DNS and Cloudflare, and comes back to localhost:8000 — so a
// night when Cloudflare is unhappy is a night with no backup, for no reason.
// A backup should not depend on more of the world than the thing it protects.
const READ_URL = process.env.SUPABASE_INTERNAL_URL || PUBLIC_URL;

if (!PUBLIC_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.');
  console.error('The service role key is in Studio -> Project Settings -> API.');
  process.exit(1);
}
```

- [x] **Step 2: Point the client at `READ_URL`**

Replace:

```ts
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
```

with:

```ts
const supabase = createClient(READ_URL, SERVICE_KEY, {
```

- [x] **Step 3: Log the address actually being read**

Replace ``console.log(`Reading ${SUPABASE_URL}`);`` with:

```ts
  console.log(`Reading ${READ_URL}`);
```

- [x] **Step 4: Keep the recorded project stable**

In the `payload` object, replace `project: SUPABASE_URL,` with:

```ts
      // The public URL even when read over localhost: this field's job is to
      // say which project the data came from, and `http://localhost:8000`
      // identifies nothing once the file is sitting on another machine.
      project: PUBLIC_URL,
```

- [x] **Step 5: Verify it still typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [x] **Step 6: Commit**

```bash
git add scripts/backup.mts
git commit -m "Read the backup over the internal URL when there is one"
```

---

## Task 4: The backup writes, lists and prunes monthly folders

**Files:**
- Modify: `scripts/backup.mts` (imports, `DIR`, `listBackups`, the write, the prune)

- [x] **Step 1: Update the imports**

In `scripts/backup.mts`, replace:

```ts
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBackups, stamp, survivors, type Backup } from './retention.mts';
```

with:

```ts
import { mkdir, readdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { folder, parseBackups, stamp, survivors, type Backup } from './retention.mts';
```

- [x] **Step 2: Default to the folder the Desktop pull uses**

Replace:

```ts
const DIR = process.env.TEMPO_BACKUP_DIR ?? join(homedir(), 'Desktop', 'tempo-backups');
```

with:

```ts
// The same place `pull-backups.mts` writes, so a backup taken by hand from
// Windows lands in the archive rather than beside it. The Oracle timer sets
// this explicitly; the box has no Desktop.
const DIR =
  process.env.TEMPO_BACKUP_DIR ?? join(homedir(), 'Desktop', 'stuff', 'tempo-backups');
```

- [x] **Step 3: List through the subfolders**

Replace:

```ts
/** Newest first. Anything this script did not write is not listed, so not pruned. */
async function listBackups(): Promise<Backup[]> {
  return parseBackups(await readdir(DIR));
}
```

with:

```ts
/** Newest first. Anything this script did not write is not listed, so not pruned. */
async function listBackups(): Promise<Backup[]> {
  const names = await readdir(DIR, { recursive: true });
  // `parseBackups` speaks in forward slashes on every platform, because the
  // same paths are compared against a Linux box's listing by the pull script.
  return parseBackups(names.map((n) => n.split(sep).join('/')));
}
```

- [x] **Step 4: Write into this month's folder**

Replace:

```ts
    const name = `tempo-${stamp(now)}.json`;
```

with:

```ts
    const name = `${folder(now)}/tempo-${stamp(now)}.json`;
    await mkdir(join(DIR, folder(now)), { recursive: true });
```

- [x] **Step 5: Sweep up month folders the prune has emptied**

Replace:

```ts
  const dropped = all.filter((f) => !keep.has(f.name));
  for (const f of dropped) await unlink(join(DIR, f.name));
```

with:

```ts
  const dropped = all.filter((f) => !keep.has(f.name));
  for (const f of dropped) await unlink(join(DIR, f.name));

  // A month whose last backup just aged out leaves an empty folder behind.
  // `rmdir` refuses a folder with anything in it, so this can only remove the
  // ones the prune emptied — it will never take a folder holding a file this
  // script does not recognise.
  for (const month of new Set(dropped.map((f) => f.name.split('/')[0]))) {
    await rmdir(join(DIR, month)).catch(() => {});
  }
```

- [x] **Step 6: Verify end to end against the real project**

Run from the repo root, with a `.env.local` that points at Supabase:

```bash
TEMPO_BACKUP_DIR=/tmp/tempo-backup-check npm run backup
```

Expected: row counts for the four tables, `Wrote 2026-09/tempo-….json`, and a
kept count of 1. Confirm the shape:

```bash
find /tmp/tempo-backup-check -type f
```

Expected: exactly one path, of the form `…/2026-09/tempo-<ISO>Z.json`.

Then run it a second time immediately:

```bash
TEMPO_BACKUP_DIR=/tmp/tempo-backup-check npm run backup
```

Expected: `Unchanged since 2026-09/tempo-….json — no new file written.` and
still exactly one file. This proves the hash check survived the folder change —
if `listBackups` were returning nothing, this run would write a second file.

- [x] **Step 7: Commit**

```bash
git add scripts/backup.mts
git commit -m "Write and prune backups inside their monthly folders"
```

---

## Task 5: Refuse to write an empty backup

**Files:**
- Modify: `scripts/backup.mts` (the `run` body, around the existing `unchanged` check)

- [x] **Step 1: Read the previous backup once, for both checks**

In `scripts/backup.mts`, replace:

```ts
  const existing = await listBackups();
  let unchanged = false;
  if (existing.length > 0) {
    const newest = JSON.parse(await readFile(join(DIR, existing[0].name), 'utf8'));
    unchanged = newest.contentHash === hash;
  }
```

with:

```ts
  const existing = await listBackups();
  let previous: { contentHash?: string; tables?: { events?: unknown[] } } | null = null;
  if (existing.length > 0) {
    previous = JSON.parse(await readFile(join(DIR, existing[0].name), 'utf8'));
  }

  // The one failure the rest of this script cannot see. A service-role key that
  // has been rotated, or an RLS policy that starts applying, returns success
  // and zero rows — a valid-looking empty file that then becomes newest-of-day
  // and prunes away the good backup taken the same morning. Throwing here means
  // nothing is written and nothing is pruned, and the exit code is non-zero.
  const before = previous?.tables?.events?.length ?? 0;
  if (tables.events.length === 0 && before > 0) {
    throw new Error(
      `events came back empty, but ${existing[0].name} holds ${before}. ` +
        `Refusing to write or prune. Check SUPABASE_SERVICE_ROLE_KEY.`,
    );
  }

  const unchanged = previous?.contentHash === hash;
```

- [x] **Step 2: Verify the guard trips**

Take a good backup first, then run again with a key that reads nothing — a
token re-signed as `anon`, which PostgREST accepts and RLS then empties:

```bash
TEMPO_BACKUP_DIR=/tmp/tempo-guard-check npm run backup
SUPABASE_SERVICE_ROLE_KEY="$(node -e "
  const [h,p] = process.env.SUPABASE_SERVICE_ROLE_KEY.split('.');
  const b = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  console.log(h + '.' + b({ ...JSON.parse(Buffer.from(p, 'base64url')), role: 'anon' }) + '.x');
")" TEMPO_BACKUP_DIR=/tmp/tempo-guard-check npm run backup
```

Expected: the first run writes a file; the second exits non-zero with
`Backup failed: events came back empty, but 2026-09/tempo-….json holds N.`

If the second run instead fails with a JWT signature error, that is also an
acceptable pass for this step — the guard is not reached because the request
never succeeds, which is the safe direction. In that case verify the guard
directly by pointing at an empty project instead, or accept the code review.

Then confirm nothing was lost:

```bash
find /tmp/tempo-guard-check -type f | wc -l
```

Expected: `1` — the good backup is still there, un-pruned.

- [x] **Step 3: Verify the ordinary path still works**

```bash
TEMPO_BACKUP_DIR=/tmp/tempo-guard-check npm run backup
```

Expected: `Unchanged since …` — the real key reads rows again and the guard
stays out of the way.

- [x] **Step 4: Commit**

```bash
git add scripts/backup.mts
git commit -m "Refuse to write a backup that came back empty"
```

---

## Task 6: The pull's decisions, as pure functions

**Files:**
- Create: `scripts/sync.mts`
- Test: `scripts/sync.test.ts`

Split from the runner for the reason `retention.mts` was split from
`backup.mts`: the interesting part has no network, no filesystem and no clock,
and that is what makes it testable.

- [x] **Step 1: Write the failing tests**

Create `scripts/sync.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isStale, toFetch } from './sync.mts';

const NOW = new Date('2026-09-19T12:00:00.000Z');

/** The path a backup taken `days` before NOW would have. */
function at(days: number): string {
  const d = new Date(NOW.getTime() - days * 86_400_000);
  d.setUTCHours(3, 0, 0, 0);
  const s = d.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
  return `${d.toISOString().slice(0, 7)}/tempo-${s}.json`;
}

describe('toFetch', () => {
  it('asks for nothing when the desktop is current', () => {
    expect(toFetch([at(0), at(1)], [at(0), at(1)])).toEqual([]);
  });

  it('asks for the one new file on an ordinary night', () => {
    expect(toFetch([at(0), at(1)], [at(1)])).toEqual([at(0)]);
  });

  it('asks oldest first, so an interrupted catch-up leaves a contiguous run', () => {
    expect(toFetch([at(0), at(1), at(2)], [])).toEqual([at(2), at(1), at(0)]);
  });

  it('ignores remote paths that are not backups', () => {
    // The runner feeds this straight to scp. Anything unrecognised must not
    // become a file the desktop copies down on someone's behalf.
    expect(toFetch(['2026-09/README.md', 'notes.txt', at(0)], [])).toEqual([at(0)]);
  });

  it('never asks for something already held, even out of order', () => {
    expect(toFetch([at(2), at(0), at(1)], [at(1)])).toEqual([at(2), at(0)]);
  });
});

describe('isStale', () => {
  it('is quiet when the box backed up last night', () => {
    expect(isStale([at(0), at(5)], NOW)).toBe(false);
  });

  it('warns when the newest is three days old', () => {
    expect(isStale([at(3), at(4)], NOW)).toBe(true);
  });

  it('warns loudest when there are no backups at all', () => {
    // No backups is the strongest version of the problem this watches for,
    // not the absence of one.
    expect(isStale([], NOW)).toBe(true);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/sync.test.ts`
Expected: FAIL — cannot resolve `./sync.mts`.

- [x] **Step 3: Write `scripts/sync.mts`**

```ts
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
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/sync.test.ts`
Expected: PASS, all eight tests.

- [x] **Step 5: Commit**

```bash
git add scripts/sync.mts scripts/sync.test.ts
git commit -m "Decide what the desktop still needs from the box"
```

---

## Task 7: The pull itself

**Files:**
- Create: `scripts/pull-backups.mts`
- Modify: `package.json` (the `scripts` block)

- [x] **Step 1: Write `scripts/pull-backups.mts`**

```ts
/**
 * Tempo — copy the box's backups down to this machine.
 *
 *   npm run pull-backups
 *
 * Lists what is on the Oracle box over SSH, subtracts what is already here, and
 * fetches the rest into ~/Desktop/stuff/tempo-backups/YYYY-MM/.
 *
 * This script never deletes a backup. Retention runs on the box, so the archive
 * here is always a superset of the server's — and nothing automated deletes a
 * file on a personal machine. It also means a backup pruned on the box before
 * this ran is simply one this machine never sees, which is the intended trade:
 * the box stays bounded, the desktop keeps everything it caught.
 */

import { execFileSync } from 'node:child_process';
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { isStale, toFetch } from './sync.mts';

const HOST = process.env.TEMPO_BACKUP_HOST ?? 'ubuntu@192.18.158.188';
const REMOTE = process.env.TEMPO_REMOTE_DIR ?? 'tempo-backups';
const DIR =
  process.env.TEMPO_PULL_DIR ?? join(homedir(), 'Desktop', 'stuff', 'tempo-backups');

/** Named so it is easy to spot in the folder, and easy to explain once spotted. */
const WARNING = 'BACKUPS-MAY-HAVE-STOPPED.txt';

/**
 * Fail fast rather than hang.
 *
 * Without `ConnectTimeout` an unreachable box or a captive-portal wifi leaves
 * ssh waiting for minutes, and a hung background process is the only way a job
 * this small becomes something you notice. `BatchMode` stops it stalling on a
 * passphrase prompt nobody is there to answer.
 */
const SSH = ['-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes'];

/** Paths under `DIR`, in forward slashes, the way the box spells them. */
async function listLocal(): Promise<string[]> {
  const names = await readdir(DIR, { recursive: true }).catch(() => [] as string[]);
  return names.map((n) => n.split(sep).join('/'));
}

/** Paths under `REMOTE` on the box. `|| true` so an empty folder is not an error. */
function listRemote(): string[] {
  const out = execFileSync('ssh', [...SSH, HOST, `ls -1 ${REMOTE}/*/*.json 2>/dev/null || true`], {
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.slice(REMOTE.length + 1));
}

async function run() {
  await mkdir(DIR, { recursive: true });

  console.log(`Listing ${HOST}:${REMOTE}`);
  const remote = listRemote();
  const plan = toFetch(remote, await listLocal());

  for (const rel of plan) {
    const month = rel.slice(0, rel.indexOf('/'));
    await mkdir(join(DIR, month), { recursive: true });
    // One connection per file. On an ordinary night that is one; the only time
    // it is more is a catch-up after the machine was off for a while, which is
    // rare enough not to be worth batching for.
    execFileSync('scp', [...SSH, `${HOST}:${REMOTE}/${rel}`, join(DIR, month)], {
      stdio: 'inherit',
    });
    console.log(`  ${rel}`);
  }

  console.log(
    plan.length === 0
      ? `Already current — ${remote.length} on the box.`
      : `\nFetched ${plan.length} of ${remote.length}.`,
  );
  console.log(DIR);

  // The warning is a file rather than only a log line because this runs hidden
  // on a schedule: nobody reads the output, but everybody notices a strange
  // file in the backup folder. Removed again as soon as the box recovers.
  const path = join(DIR, WARNING);
  if (isStale(remote, new Date())) {
    const msg =
      `The newest backup on ${HOST} is more than two days old.\n\n` +
      `The nightly timer may have stopped. On the box:\n\n` +
      `  systemctl status tempo-backup.timer\n` +
      `  journalctl -u tempo-backup.service -n 50\n\n` +
      `This file deletes itself once backups are arriving again.\n`;
    await writeFile(path, msg);
    console.warn(`\n!! ${msg}`);
  } else {
    await unlink(path).catch(() => {});
  }
}

run().catch((err) => {
  console.error(`\nPull failed: ${err instanceof Error ? err.message : err}`);
  // Non-zero so Task Scheduler's Last Run Result shows it, which is the only
  // place a hidden task reports anything at all.
  process.exit(1);
});
```

- [x] **Step 2: Add the npm script**

In `package.json`, replace:

```json
    "backup": "node scripts/backup.mts"
```

with:

```json
    "backup": "node scripts/backup.mts",
    "pull-backups": "node scripts/pull-backups.mts"
```

- [x] **Step 3: Verify against the real box**

```bash
npm run pull-backups
```

Expected: `Listing ubuntu@192.18.158.188:tempo-backups`, then — because Task 8
has not run yet — `Already current — 0 on the box.` followed by the stale
warning, since a box with no backups is stale by definition.

Confirm the warning file landed:

```bash
ls ~/Desktop/stuff/tempo-backups
```

Expected: `BACKUPS-MAY-HAVE-STOPPED.txt`. This is the canary proving itself
before there is anything to lose — it deletes itself in Task 10.

- [x] **Step 4: Verify the whole suite and the types**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [x] **Step 5: Commit**

```bash
git add scripts/pull-backups.mts package.json
git commit -m "Pull the box's backups down to the desktop"
```

---

## Task 8: Push the code to the box

**Files:** none — this deploys what the previous tasks built.

- [ ] **Step 1: Push and pull**

```bash
git push origin main
ssh ubuntu@192.18.158.188 'cd ~/tempo && git pull'
```

Expected: the `scripts/` files and `package.json` updated.

Note: no `npm run build` and no `pm2 restart` — nothing in this plan touches the
running app. The scripts are run directly by node, outside Next.

- [ ] **Step 2: Take the first backup by hand, before automating it**

```bash
ssh ubuntu@192.18.158.188 'cd ~/tempo && TEMPO_BACKUP_DIR=$HOME/tempo-backups npm run backup'
```

Expected: `Reading http://localhost:8000` — confirming Task 3 worked and the
read stayed on the box — then four row counts, `Wrote 2026-09/tempo-….json`,
and `1 backup kept`.

If it instead prints `Reading https://supabase.brucelsprouts.com`, then
`SUPABASE_INTERNAL_URL` is not set in `~/tempo/.env.local`; add
`SUPABASE_INTERNAL_URL=http://localhost:8000` and re-run.

- [ ] **Step 3: Confirm the file is real**

```bash
ssh ubuntu@192.18.158.188 'find ~/tempo-backups -type f; du -sh ~/tempo-backups'
```

Expected: one path of the form `…/2026-09/tempo-<ISO>Z.json`, around 1 MB.

---

## Task 9: The nightly timer on Oracle

**Files:**
- Create on the box: `/etc/systemd/system/tempo-backup.service`, `/etc/systemd/system/tempo-backup.timer`
- Create in the repo: `deploy/tempo-backup.service`, `deploy/tempo-backup.timer`

Use the node path recorded in Task 0 Step 1 wherever `/usr/bin/node` appears
below. If `which node` gave something else, substitute it — systemd has no PATH
to fall back on.

- [ ] **Step 1: Write the service unit**

```bash
ssh ubuntu@192.18.158.188 'sudo tee /etc/systemd/system/tempo-backup.service > /dev/null' <<'UNIT'
[Unit]
Description=Tempo — nightly calendar backup
# The stack has to be up for localhost:8000 to answer. Not a hard dependency:
# if Docker is slow after a reboot, Persistent= will have the timer try again.
After=network-online.target docker.service

[Service]
Type=oneshot
User=ubuntu
WorkingDirectory=/home/ubuntu/tempo
Environment=TEMPO_BACKUP_DIR=/home/ubuntu/tempo-backups
ExecStart=/usr/bin/node scripts/backup.mts
StandardOutput=append:/home/ubuntu/tempo-backup.log
StandardError=append:/home/ubuntu/tempo-backup.log
UNIT
```

The log lives outside the backup folder on purpose: a `.log` inside it would be
a file the prune has to be trusted not to touch, and the simplest way to trust
that is not to put it there.

- [ ] **Step 2: Write the timer unit**

```bash
ssh ubuntu@192.18.158.188 'sudo tee /etc/systemd/system/tempo-backup.timer > /dev/null' <<'UNIT'
[Unit]
Description=Tempo — nightly calendar backup

[Timer]
# 03:00 local, and the zone is pinned on the job rather than on the box:
# pg_cron drives the reminder dispatcher off the system clock every minute, and
# that is not a thing to perturb for a backup.
#
# 03:00 Eastern is 07:00 or 08:00 UTC — the same calendar date, with about
# seven hours of clearance either side, so the UTC buckets retention groups by
# always agree with the local day. 23:59 would not: it is 03:59 UTC tomorrow,
# which files every backup under the following day and puts the last one in
# September into 2026-10/.
OnCalendar=*-*-* 03:00:00 America/Toronto
Persistent=true

[Install]
WantedBy=timers.target
UNIT
```

- [ ] **Step 3: Enable it**

```bash
ssh ubuntu@192.18.158.188 'sudo systemctl daemon-reload && sudo systemctl enable --now tempo-backup.timer'
```

Expected: a symlink created into `timers.target.wants`.

- [ ] **Step 4: Verify the schedule resolves to the hour you meant**

```bash
ssh ubuntu@192.18.158.188 'systemctl list-timers tempo-backup.timer --all'
```

Expected: a `NEXT` of the coming 03:00 Eastern, shown in the box's own timezone
(so 07:00 or 08:00 UTC). **If `NEXT` is blank or the unit failed to load, the
systemd version does not accept the timezone suffix** — check Task 0 Step 1's
version, and fall back to `OnCalendar=*-*-* 07:00:00` with a comment in the unit
recording that it then drifts an hour across DST.

- [ ] **Step 5: Verify the service runs when fired**

```bash
ssh ubuntu@192.18.158.188 'sudo systemctl start tempo-backup.service && sleep 5 && cat ~/tempo-backup.log'
```

Expected: `Reading http://localhost:8000`, the row counts, and `Unchanged since
2026-09/tempo-….json — no new file written.` — unchanged because Task 8 Step 2
already took today's, which is the hash check doing its job.

- [ ] **Step 6: Commit the units into the repo for the record**

```bash
mkdir -p deploy
ssh ubuntu@192.18.158.188 'cat /etc/systemd/system/tempo-backup.service' > deploy/tempo-backup.service
ssh ubuntu@192.18.158.188 'cat /etc/systemd/system/tempo-backup.timer' > deploy/tempo-backup.timer
git add deploy/
git commit -m "Record the units that run the nightly backup"
```

---

## Task 10: The daily pull on Windows

**Files:** none in the repo — this registers a scheduled task.

Run these in **PowerShell**, not the Bash tool.

- [ ] **Step 1: Find the real node path**

```powershell
(Get-Command node).Source
```

Expected: something like `C:\Program Files\nodejs\node.exe`. Task Scheduler has
no PATH of its own, so this goes in verbatim below.

- [ ] **Step 2: Register the task**

Substitute the node path from Step 1 for `C:\Program Files\nodejs\node.exe` if
it differs.

```powershell
$action = New-ScheduledTaskAction `
  -Execute "C:\Program Files\nodejs\node.exe" `
  -Argument "scripts/pull-backups.mts" `
  -WorkingDirectory "C:\Users\bruce\Documents\GitHub\tempo"

$trigger = New-ScheduledTaskTrigger -Daily -At 3:30am

# StartWhenAvailable is the whole point: a week with the PC off becomes one
# catch-up run at next boot rather than a week-shaped hole in the archive.
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -Hidden `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -MultipleInstances IgnoreNew

# S4U runs it without a visible console window. -Hidden alone does not: while
# you are logged in, a task running as you still pops a terminal once a day,
# which is the only way a job this small would actually bother anyone.
$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited

Register-ScheduledTask -TaskName "Tempo backup pull" `
  -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description "Copies Tempo's nightly backups down from the Oracle box. Never deletes."
```

Expected: the task object printed back, `State: Ready`.

- [ ] **Step 3: Run it once by hand and confirm no window appears**

```powershell
Start-ScheduledTask -TaskName "Tempo backup pull"
Start-Sleep -Seconds 20
Get-ScheduledTaskInfo -TaskName "Tempo backup pull" | Select-Object LastRunTime, LastTaskResult
```

Expected: `LastTaskResult` of `0`, and **no console window flashed on screen**.
A non-zero result means the pull failed — run `npm run pull-backups` in a normal
terminal to see the error, since the hidden task shows nothing.

If `LastTaskResult` is `0x2` the node path in Step 2 is wrong. If the run hangs
or returns `0x800704DD`, S4U could not reach the SSH key; re-register with
`-LogonType Interactive` instead and accept the once-a-day window.

- [ ] **Step 4: Confirm the backup actually arrived**

```powershell
Get-ChildItem "C:\Users\bruce\Desktop\stuff\tempo-backups" -Recurse -File
```

Expected: `2026-09\tempo-<ISO>Z.json`, about 1 MB — the backup Task 8 took on
the box, now on the Desktop. And **no `BACKUPS-MAY-HAVE-STOPPED.txt`**: the
canary written in Task 7 Step 3 deleted itself once a fresh backup appeared,
which is the round trip working end to end.

- [ ] **Step 5: Prove the file is a readable calendar, not just bytes**

```powershell
$f = (Get-ChildItem "C:\Users\bruce\Desktop\stuff\tempo-backups" -Recurse -Filter *.json | Select-Object -First 1).FullName
node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(d.project,d.takenAt);console.log(Object.entries(d.tables).map(([k,v])=>k+'='+v.length).join(' '))" $f
```

Expected: the **public** Supabase URL (not `localhost:8000` — that is Task 3
Step 4 working), a timestamp, and four row counts with `events` non-zero. A
backup nobody has ever opened is a guess, not a backup.

---

## Task 11: Write down how it is wired

**Files:**
- Modify: `docs/SELF_HOSTING.md`

- [ ] **Step 1: Remove the stale note**

In `docs/SELF_HOSTING.md`, remove this bullet from "Known rough edges":

```
- Nothing backs this up yet. That was deferred deliberately; `npm run backup`
  works against it once `SUPABASE_SERVICE_ROLE_KEY` and
  `NEXT_PUBLIC_SUPABASE_URL` in a local `.env.local` point here.
```

And if Task 0 upgraded the box's Node, remove the `**Node 20.**` bullet too.

- [ ] **Step 2: Add a section before "Known rough edges"**

```markdown
## Backups

A systemd timer takes one nightly and the desktop copies it down. Neither half
knows about the other; they meet in a directory.

| | |
|---|---|
| On the box | `~/tempo-backups/YYYY-MM/tempo-<ISO>Z.json`, ~1 MB each |
| Timer | `tempo-backup.timer`, 03:00 `America/Toronto`, `Persistent=true` |
| Log | `~/tempo-backup.log` |
| Units | copied into the repo at `deploy/`, if one ever needs rebuilding |
| On the desktop | `C:\Users\bruce\Desktop\stuff\tempo-backups\YYYY-MM\` |
| Pull | Task Scheduler, "Tempo backup pull", 03:30 daily, hidden, catches up after the PC has been off |

**Retention runs on the box only.** Under a week keeps every run; under three
months the newest of each day; under two years the newest of each month; beyond
that the newest of each year, kept for good. The desktop never deletes
anything, so its archive is always a superset of the server's — which is also
why the box stays around 115 MB while the desktop grows slowly.

**The timezone is pinned on the timer, not the box.** `pg_cron` drives the
reminder dispatcher off the system clock, so the host stays UTC. 03:00 Eastern
is 07:00–08:00 UTC — the same calendar day, which matters because retention
buckets by UTC. A late-evening slot would file every backup under the following
day, and the last one in September under October.

**If `BACKUPS-MAY-HAVE-STOPPED.txt` appears** in the desktop folder, the newest
backup on the box is over two days old:

```bash
systemctl status tempo-backup.timer
journalctl -u tempo-backup.service -n 50
```

The file deletes itself once backups are arriving again.

**To restore**, see the comment at the bottom of `scripts/backup.mts`. It is
deliberately not automated: a restore overwrites a live calendar and the right
move depends on what went wrong.
```

- [ ] **Step 3: Commit and push**

```bash
git add docs/SELF_HOSTING.md
git commit -m "Write down how the backups are wired"
git push origin main
```

---

## Self-review notes

**Spec coverage.** Internal URL → Task 3. Monthly subfolders → Tasks 2, 4.
Empty-backup guard → Task 5. Yearly tier → Task 1. `pull-backups.mts` with
`ConnectTimeout` and canary → Tasks 6, 7. systemd timer with timezone and
`Persistent` → Task 9. Task Scheduler hidden with missed-start → Task 10.
Paths → Tasks 4, 7. Testing → Tasks 1, 2, 6. Docs → Task 11. Restore left
manual, no desktop pruning, no failure-push beyond the canary → honoured by
omission.

**Not in the spec, added while planning.** Task 0, the Node 20 blocker — found
by reading `SELF_HOSTING.md` against how `node` runs `.mts`, and nothing else
works until it is settled. The empty-month sweep in Task 4 Step 5. The `deploy/`
copies of the units in Task 9 Step 6. The restore-readability check in Task 10
Step 5.

**Names used consistently throughout:** `folder(at)`, `parseBackups(paths)`,
`survivors(files, now)`, `toFetch(remote, local)`, `isStale(remote, now, days)`,
`PUBLIC_URL`, `READ_URL`, `TEMPO_BACKUP_DIR` (box and manual runs),
`TEMPO_PULL_DIR` (desktop), `TEMPO_BACKUP_HOST`, `TEMPO_REMOTE_DIR`.
