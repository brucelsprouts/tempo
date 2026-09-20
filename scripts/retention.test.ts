import { describe, expect, it } from 'vitest';
import { parseBackups, stamp, survivors, unstamp, type Backup } from './retention.mts';

const NOW = new Date('2026-09-19T12:00:00.000Z');

/** A backup taken `days` before NOW, at `hour` UTC. */
function old(days: number, hour = 12): Backup {
  const at = new Date(NOW.getTime() - days * 86_400_000);
  at.setUTCHours(hour, 0, 0, 0);
  return { name: `tempo-${stamp(at)}.json`, at };
}

function kept(files: Backup[]): string[] {
  const keep = survivors(files, NOW);
  return files.filter((f) => keep.has(f.name)).map((f) => f.name);
}

describe('stamp / unstamp', () => {
  it('round-trips to the second', () => {
    const at = new Date('2026-09-19T20-30-00Z'.replace(/-(\d{2})-(\d{2})Z$/, ':$1:$2Z'));
    expect(unstamp(`tempo-${stamp(at)}.json`)?.toISOString()).toBe(at.toISOString());
  });

  it('drops the milliseconds a filename cannot round-trip', () => {
    expect(stamp(new Date('2026-09-19T20:30:00.456Z'))).toBe('2026-09-19T20-30-00Z');
  });

  it('ignores anything this script did not write', () => {
    // The prune deletes what `survivors` does not name, so a stray file that
    // parsed as a backup would be a file this script deletes on someone's
    // behalf. Everything unrecognised has to stay unrecognised.
    expect(unstamp('notes.txt')).toBeNull();
    expect(unstamp('tempo-backup.json')).toBeNull();
    expect(unstamp('tempo-2026-09-19.json')).toBeNull();
    expect(unstamp('tempo-2026-13-45T99-99-99Z.json')).toBeNull();
    expect(parseBackups(['notes.txt', 'tempo-2026-09-19T20-30-00Z.json'])).toHaveLength(1);
  });
});

describe('survivors', () => {
  it('keeps every backup inside the week', () => {
    const files = [old(0), old(1), old(1, 9), old(3), old(6)];
    expect(kept(files)).toHaveLength(5);
  });

  it('thins to one a day past the week', () => {
    const files = [old(0), old(30, 8), old(30, 17), old(31)];
    const names = kept(files);
    // The newest of the 30-day-old pair, not the earlier one.
    expect(names).toContain(old(30, 17).name);
    expect(names).not.toContain(old(30, 8).name);
    expect(names).toContain(old(31).name);
  });

  it('thins to one a month past three months', () => {
    // Three from the same month, all older than 90 days.
    const files = [old(0), old(120), old(125), old(130), old(400)];
    const names = kept(files);
    const sameMonth = [old(120), old(125), old(130)].filter((f) => names.includes(f.name));
    expect(sameMonth).toHaveLength(1);
    expect(sameMonth[0].name).toBe(old(120).name);
    expect(names).toContain(old(400).name);
  });

  it('drops everything past two years', () => {
    const files = [old(0), old(1), old(2), old(900), old(1000)];
    const names = kept(files);
    expect(names).not.toContain(old(900).name);
    expect(names).not.toContain(old(1000).name);
  });

  it('keeps the newest three however old they are', () => {
    // A calendar backed up three times and then left alone for five years.
    // Every tier would drop all of these; the floor is the only thing holding
    // them, and without it the folder silently empties itself.
    const files = [old(1800), old(1805), old(1810)];
    expect(kept(files)).toHaveLength(3);
  });

  it('never drops the backup just written', () => {
    const files = [old(0), old(1000), old(1001), old(1002), old(1003)];
    expect(kept(files)).toContain(old(0).name);
  });

  it('holds an empty folder without complaint', () => {
    expect(survivors([], NOW).size).toBe(0);
  });
});
