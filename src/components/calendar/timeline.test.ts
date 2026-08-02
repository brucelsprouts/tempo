import { describe, expect, it } from 'vitest';
import {
  applyDrag,
  daySegment,
  labelEvery,
  placeSegments,
  resolveHourHeight,
  showsHalfHours,
  snapMinutes,
  zoomIn,
  zoomOut,
} from './timeline';
import { HOUR_H_MAX, HOUR_H_MIN } from './constants';
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

/**
 * The old code snapped the *distance travelled*, which meant an entry starting
 * at 09:07 moved in clean quarter-hours and was therefore at 09:07, 09:22,
 * 09:37 forever — it could never reach the grid, which is the opposite of what
 * snapping is for.
 */
describe('snapMinutes', () => {
  it('pulls a time down to the nearest quarter hour', () => {
    expect(snapMinutes(9 * 60 + 7)).toBe(9 * 60);
  });

  it('pulls a time up to the nearest quarter hour', () => {
    expect(snapMinutes(9 * 60 + 8)).toBe(9 * 60 + 15);
  });

  it('leaves a time already on the grid alone', () => {
    expect(snapMinutes(9 * 60 + 15)).toBe(9 * 60 + 15);
  });

  it('honours a finer step', () => {
    expect(snapMinutes(9 * 60 + 7, 1)).toBe(9 * 60 + 7);
  });
});

describe('applyDrag', () => {
  const base = { start: 9 * 60, end: 10 * 60 };

  it('moves both edges and preserves the duration', () => {
    expect(applyDrag({ ...base, deltaMinutes: 37, mode: 'move' })).toEqual({
      start: 9 * 60 + 30,
      end: 10 * 60 + 30,
    });
  });

  it('pulls an off-grid start onto the grid when moved', () => {
    expect(applyDrag({ start: 9 * 60 + 7, end: 10 * 60 + 7, deltaMinutes: 5, mode: 'move' })).toEqual({
      start: 9 * 60 + 15,
      end: 10 * 60 + 15,
    });
  });

  it('moves only the end when resizing', () => {
    expect(applyDrag({ ...base, deltaMinutes: 37, mode: 'resize' })).toEqual({
      start: 9 * 60,
      end: 10 * 60 + 30,
    });
  });

  it('refuses to resize an end above its start', () => {
    expect(applyDrag({ ...base, deltaMinutes: -600, mode: 'resize' })).toEqual({
      start: 9 * 60,
      end: 9 * 60 + 15,
    });
  });

  /**
   * The old code discarded the whole gesture on an overshoot and sprang the
   * block back with no explanation. Clamping is the feedback.
   */
  it('clamps a move at the end of the day instead of discarding it', () => {
    // 20 hours past 09:00 is well off the end of the column; a delta small
    // enough to land inside the day would assert nothing about clamping.
    expect(applyDrag({ ...base, deltaMinutes: 20 * 60, mode: 'move' })).toEqual({
      start: 23 * 60,
      end: 24 * 60,
    });
  });

  it('clamps a move at the start of the day', () => {
    expect(applyDrag({ ...base, deltaMinutes: -10 * 60, mode: 'move' })).toEqual({
      start: 0,
      end: 60,
    });
  });

  it('clamps a resize at the end of the day', () => {
    expect(applyDrag({ ...base, deltaMinutes: 20 * 60, mode: 'resize' })).toEqual({
      start: 9 * 60,
      end: 24 * 60,
    });
  });

  it('takes a fine step when asked', () => {
    expect(applyDrag({ ...base, deltaMinutes: 7, mode: 'move', step: 1 })).toEqual({
      start: 9 * 60 + 7,
      end: 10 * 60 + 7,
    });
  });

  /**
   * A block crossing midnight is longer than a day, so the ordinary clamp would
   * squash it. `lockDates` holds both edges still instead, because
   * `setOccurrenceTime` speaks only minutes and cannot say "and also move it a
   * day" — a drag that appeared to work and silently truncated the event would
   * be worse than one that does not move.
   */
  it('refuses to move a block that would have to change dates', () => {
    expect(
      applyDrag({ start: 22 * 60, end: 6 * 60, deltaMinutes: 120, mode: 'move', lockDates: true }),
    ).toEqual({ start: 22 * 60, end: 6 * 60 });
  });
});

describe('resolveHourHeight', () => {
  /**
   * FIT is a mode rather than a stored pixel height. Storing the resolved
   * number would freeze it at whatever the window was when it was chosen, and
   * it would stop being a fit the moment the window resized.
   */
  it('divides the pane across 24 hours in fit mode', () => {
    expect(resolveHourHeight('fit', 720)).toBe(30);
  });

  it('never fits below the floor', () => {
    expect(resolveHourHeight('fit', 24)).toBe(HOUR_H_MIN);
  });

  it('returns a manual height unchanged', () => {
    expect(resolveHourHeight(44, 720)).toBe(44);
  });

  it('clamps a manual height to the range', () => {
    expect(resolveHourHeight(500, 720)).toBe(HOUR_H_MAX);
    expect(resolveHourHeight(1, 720)).toBe(HOUR_H_MIN);
  });
});

describe('zoomIn / zoomOut', () => {
  it('steps up from a manual height', () => {
    expect(zoomIn(44, 720)).toBeGreaterThan(44);
  });

  it('steps down from a manual height', () => {
    expect(zoomOut(44, 720)).toBeLessThan(44);
  });

  /** Zooming out of FIT has nowhere to go; zooming in leaves it. */
  it('leaves fit mode by resolving it first', () => {
    expect(zoomIn('fit', 720)).toBeGreaterThan(30);
  });

  it('does not exceed the ceiling', () => {
    expect(zoomIn(HOUR_H_MAX, 720)).toBe(HOUR_H_MAX);
  });

  it('does not fall below the floor', () => {
    expect(zoomOut(HOUR_H_MIN, 720)).toBe(HOUR_H_MIN);
  });
});

describe('labelEvery / showsHalfHours', () => {
  it('labels every hour when there is room', () => {
    expect(labelEvery(44)).toBe(1);
  });

  it('thins labels when there is not', () => {
    expect(labelEvery(20)).toBe(3);
  });

  it('draws half-hour rules only when they can be told apart', () => {
    expect(showsHalfHours(44)).toBe(true);
    expect(showsHalfHours(20)).toBe(false);
  });
});
