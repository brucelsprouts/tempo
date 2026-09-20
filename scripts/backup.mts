/**
 * Tempo — take a backup of the calendar, and thin the old ones.
 *
 *   npm run backup
 *
 * Writes one JSON file per run to ~/Desktop/tempo-backups (override with
 * TEMPO_BACKUP_DIR), then prunes what it no longer needs to keep.
 *
 * Why a plain JSON dump rather than pg_dump: the thing worth protecting here is
 * the calendar, not the schema. The schema is already in `supabase/migrations`
 * and in git, so a rebuild is "run the migrations, then load this file" — and
 * that path works into a brand-new Supabase project, which is exactly the case
 * a backup exists for. A pg_dump would also need the Postgres client tools
 * installed and version-matched, which is one more thing to be broken on the
 * day you need it.
 *
 * Restoring is deliberately NOT automated. A restore overwrites a live calendar
 * and the right move depends on what went wrong — see the note at the bottom of
 * this file.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBackups, stamp, survivors, type Backup } from './retention.mts';

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(here, '../.env.local') });

const PUBLIC_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!PUBLIC_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.');
  console.error('The service role key is in Studio -> Project Settings -> API.');
  process.exit(1);
}

// Read over the internal URL when there is one, exactly as `server.ts` and
// `proxy.ts` do. Run on the box without this, the backup leaves the machine,
// goes out to DNS and Cloudflare, and comes back to localhost:8000 — so a
// night when Cloudflare is unhappy is a night with no backup, for no reason.
// A backup should not depend on more of the world than the thing it protects.
//
// Below the guard above, so it inherits the narrowing that makes PUBLIC_URL a
// string rather than a string that might not be there.
const READ_URL = process.env.SUPABASE_INTERNAL_URL || PUBLIC_URL;

const DIR = process.env.TEMPO_BACKUP_DIR ?? join(homedir(), 'Desktop', 'tempo-backups');

/**
 * What a restore actually needs.
 *
 * `push_subscriptions` and `reminder_deliveries` are left out on purpose. Both
 * are operational state rather than calendar truth: a push subscription is a
 * token for a browser install that a restored project could not deliver to
 * anyway, and the delivery log exists only to suppress duplicate sends inside a
 * 30-day window that a disaster has already taken you outside of. Backing them
 * up would mean keeping device tokens in a folder for no recoverable benefit.
 *
 * Order matters on the way back in: categories before the events that point at
 * them, events before the overrides and versions that point at those.
 */
const TABLES = ['categories', 'events', 'occurrence_overrides', 'event_versions'] as const;

/** PostgREST's default ceiling per request. Exceeded by `event_versions` first. */
const PAGE = 1000;

const supabase = createClient(READ_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

async function fetchAll(table: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    // Ordered so the page boundary is stable. Without it PostgREST is free to
    // return rows in any order per request, and a row can be paged over twice
    // or skipped entirely — a backup that silently loses entries is worse than
    // no backup, because you stop looking for the problem.
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('id')
      .range(from, from + PAGE - 1);

    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < PAGE) return rows;
  }
}

/** Newest first. Anything this script did not write is not listed, so not pruned. */
async function listBackups(): Promise<Backup[]> {
  return parseBackups(await readdir(DIR));
}

async function run() {
  const now = new Date();
  await mkdir(DIR, { recursive: true });

  console.log(`Reading ${READ_URL}`);

  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const t of TABLES) {
    tables[t] = await fetchAll(t);
    console.log(`  ${t.padEnd(22)} ${String(tables[t].length).padStart(6)} rows`);
  }

  // Hashed over the data alone, so two runs with nothing changed in between
  // produce the same hash and only the first becomes a file. A folder where
  // every entry is a distinct calendar is one you can actually read; one with
  // forty identical copies of a quiet fortnight is not.
  const hash = createHash('sha256').update(JSON.stringify(tables)).digest('hex').slice(0, 16);

  const existing = await listBackups();
  let unchanged = false;
  if (existing.length > 0) {
    const newest = JSON.parse(await readFile(join(DIR, existing[0].name), 'utf8'));
    unchanged = newest.contentHash === hash;
  }

  if (unchanged) {
    console.log(`\nUnchanged since ${existing[0].name} — no new file written.`);
  } else {
    const name = `tempo-${stamp(now)}.json`;
    const payload = {
      takenAt: now.toISOString(),
      // The public URL even when read over localhost: this field's job is to
      // say which project the data came from, and `http://localhost:8000`
      // identifies nothing once the file is sitting on another machine.
      project: PUBLIC_URL,
      contentHash: hash,
      tables,
    };
    await writeFile(join(DIR, name), JSON.stringify(payload, null, 2));
    console.log(`\nWrote ${name}`);
  }

  // Pruned against the folder as it stands *after* this run, so a backup just
  // written counts towards the floor rather than being judged against a folder
  // that does not yet include it.
  const all = await listBackups();
  const keep = survivors(all, now);
  const dropped = all.filter((f) => !keep.has(f.name));
  for (const f of dropped) await unlink(join(DIR, f.name));

  const kept = all.length - dropped.length;
  console.log(
    `${kept} backup${kept === 1 ? '' : 's'} kept` +
      (dropped.length > 0 ? `, ${dropped.length} pruned` : '') +
      `\n${DIR}`,
  );
}

run().catch((err) => {
  console.error(`\nBackup failed: ${err instanceof Error ? err.message : err}`);
  // Non-zero, so anything wrapped around this can tell. A backup that fails
  // quietly is the exact failure the whole exercise exists to prevent.
  process.exit(1);
});

/**
 * To restore, from a throwaway script against a fresh project:
 *
 *   1. Run every migration in `supabase/migrations` against the target project.
 *   2. Make sure the auth user exists and note its id — the rows carry the old
 *      `owner_id`, and a different project means a different user. Rewrite it
 *      across all four tables before inserting, or the RLS policies will hide
 *      everything you just loaded.
 *   3. Insert the tables in the order they appear in `TABLES` above.
 *
 * Load into an empty project, not over a live one. An upsert over a calendar
 * that has moved on since the backup merges two versions of the truth, and the
 * result is not either of them.
 */
