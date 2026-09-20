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
