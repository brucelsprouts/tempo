import { describe, expect, it } from 'vitest';
import { daySegment } from './timeline';
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
