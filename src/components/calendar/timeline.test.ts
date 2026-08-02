import { describe, expect, it } from 'vitest';
import { daySegment, placeSegments } from './timeline';
import type { Occurrence, TempoEvent } from '@/lib/tempo/types';
import type { CivilDate } from '@/lib/tempo/civil';

/**
 * The clipping rules are the whole of "a block covers the duration it occupies".
 * They are pure arithmetic over four values, and every one of the interesting
 * cases — midnight, a fully-enclosed day, a zero-height tail — is unreachable
 * from a rendering test without building a calendar to hold it.
 */

const event = {} as TempoEvent;

function occ(over: Partial<Occurrence>): Occurrence {
  return {
    key: 'e1:2026-08-10',
    eventId: 'e1',
    event,
    date: '2026-08-10',
    endDate: '2026-08-10',
    seriesDate: '2026-08-10',
    index: 1,
    title: 'Thing',
    allDay: false,
    startMinutes: 9 * 60,
    endMinutes: 10 * 60,
    kind: 'event',
    status: null,
    categoryId: null,
    isOverride: false,
    readOnly: false,
    ...over,
  };
}

const DAY: CivilDate = '2026-08-10';

describe('daySegment', () => {
  it('gives a same-day block its own minutes and no continuation', () => {
    expect(daySegment(occ({}), DAY)).toEqual({
      top: 540,
      bottom: 600,
      continuesBefore: false,
      continuesAfter: false,
    });
  });

  it('clips the top of a block that started on an earlier day', () => {
    const o = occ({ date: '2026-08-09', endDate: DAY, startMinutes: 22 * 60, endMinutes: 6 * 60 });
    expect(daySegment(o, DAY)).toEqual({
      top: 0,
      bottom: 360,
      continuesBefore: true,
      continuesAfter: false,
    });
  });

  it('clips the bottom of a block that ends on a later day', () => {
    const o = occ({ endDate: '2026-08-11', startMinutes: 22 * 60, endMinutes: 6 * 60 });
    expect(daySegment(o, DAY)).toEqual({
      top: 1320,
      bottom: 1440,
      continuesBefore: false,
      continuesAfter: true,
    });
  });

  it('runs a fully-enclosed day edge to edge', () => {
    const o = occ({ date: '2026-08-09', endDate: '2026-08-12' });
    expect(daySegment(o, DAY)).toEqual({
      top: 0,
      bottom: 1440,
      continuesBefore: true,
      continuesAfter: true,
    });
  });

  /**
   * The case that puts a 0px sliver at the top of every morning after a late
   * event. It overlaps the day by the range rules and occupies none of it.
   */
  it('returns null for a block ending at exactly 00:00 on this day', () => {
    const o = occ({ date: '2026-08-09', endDate: DAY, startMinutes: 22 * 60, endMinutes: 0 });
    expect(daySegment(o, DAY)).toBeNull();
  });

  it('still gives that block a full-height tail on the day before', () => {
    const o = occ({ date: '2026-08-09', endDate: DAY, startMinutes: 22 * 60, endMinutes: 0 });
    expect(daySegment(o, '2026-08-09')).toEqual({
      top: 1320,
      bottom: 1440,
      continuesBefore: false,
      continuesAfter: true,
    });
  });

  it('returns null for an all-day occurrence, which has no position', () => {
    expect(daySegment(occ({ allDay: true, startMinutes: null, endMinutes: null }), DAY)).toBeNull();
  });

  it('returns null for a day the occurrence does not touch', () => {
    expect(daySegment(occ({}), '2026-08-12')).toBeNull();
  });

  it('defaults a missing end to 30 minutes past the start', () => {
    expect(daySegment(occ({ endMinutes: null }), DAY)).toMatchObject({ top: 540, bottom: 570 });
  });
});

/**
 * The existing `packLanes` assigns lanes correctly and then reports the wrong
 * width: `of` is the lane count for the whole day, so one overlapping pair at
 * 09:00 renders every unrelated block in the day at half width. These tests are
 * about `of`, not about `lane`.
 */
describe('placeSegments', () => {
  const seg = (top: number, bottom: number) => ({
    top,
    bottom,
    continuesBefore: false,
    continuesAfter: false,
  });

  it('gives a lone block the full width', () => {
    expect(placeSegments([{ key: 'a', segment: seg(540, 600) }])).toEqual([
      { key: 'a', segment: seg(540, 600), lane: 0, of: 1 },
    ]);
  });

  it('splits two overlapping blocks into two lanes', () => {
    const out = placeSegments([
      { key: 'a', segment: seg(540, 660) },
      { key: 'b', segment: seg(600, 720) },
    ]);
    expect(out.map((p) => [p.key, p.lane, p.of])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
    ]);
  });

  /** The bug: the lone afternoon block must not be narrowed by the morning pair. */
  it('does not let one cluster narrow another', () => {
    const out = placeSegments([
      { key: 'a', segment: seg(540, 660) },
      { key: 'b', segment: seg(600, 720) },
      { key: 'c', segment: seg(900, 960) },
    ]);
    expect(out.find((p) => p.key === 'c')).toMatchObject({ lane: 0, of: 1 });
  });

  it('reuses a lane once its block has ended', () => {
    const out = placeSegments([
      { key: 'a', segment: seg(540, 600) },
      { key: 'b', segment: seg(570, 630) },
      { key: 'c', segment: seg(600, 660) },
    ]);
    // a and b overlap; c starts as a ends, so c takes a's lane. All three are
    // one cluster because b bridges them, so all three are of: 2.
    expect(out.map((p) => [p.key, p.lane, p.of])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
      ['c', 0, 2],
    ]);
  });

  it('treats blocks that merely touch as non-overlapping', () => {
    const out = placeSegments([
      { key: 'a', segment: seg(540, 600) },
      { key: 'b', segment: seg(600, 660) },
    ]);
    expect(out.every((p) => p.of === 1)).toBe(true);
  });

  it('returns an empty list unchanged', () => {
    expect(placeSegments([])).toEqual([]);
  });
});
