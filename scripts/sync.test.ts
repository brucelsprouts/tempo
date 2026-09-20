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

  it('is unbothered by local paths that are not backups', () => {
    // The local listing is a raw readdir, so it carries the month folders
    // themselves and the canary file. None of that should suppress a fetch.
    const local = ['2026-09', 'notes.txt', 'BACKUPS-MAY-HAVE-STOPPED.txt'];
    expect(toFetch([at(0)], local)).toEqual([at(0)]);
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

  it('is not fooled by a folder full of files that are not backups', () => {
    expect(isStale(['notes.txt', '2026-09/README.md'], NOW)).toBe(true);
  });
});
