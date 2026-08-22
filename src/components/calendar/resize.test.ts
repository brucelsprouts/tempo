import { describe, expect, it } from 'vitest';
import { groupResizeDelta, resizedEdge, resizedSpan, spanFloor } from './resize';
import type { Occurrence, TempoEvent } from '@/lib/tempo/types';

/**
 * A group resize is one number applied to several entries, and the number is
 * where all of the interesting behaviour lives: which bar decides it, which bar
 * is allowed to veto it, and what an overnight's hours do to the floor it is
 * measured against. None of that is reachable from a rendering test without
 * building a calendar and a pointer to drag across it.
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
    allDay: true,
    startMinutes: null,
    endMinutes: null,
    kind: 'event',
    status: null,
    categoryId: null,
    isOverride: false,
    readOnly: false,
    ...over,
  };
}

/** An all-day entry over a closed range of dates. */
const band = (date: string, endDate: string) => occ({ date, endDate });

describe('spanFloor', () => {
  it('lets an all-day entry sit on a single date', () => {
    expect(spanFloor(band('2026-08-10', '2026-08-12'), 'end')).toBe(0);
  });

  it('lets an evening collapse, because its end can give up midnight', () => {
    // 18:00 -> 00:00, which becomes 18:00 -> 23:59 on one date.
    const evening = occ({
      allDay: false,
      date: '2026-08-10',
      endDate: '2026-08-11',
      startMinutes: 18 * 60,
      endMinutes: 0,
    });
    expect(spanFloor(evening, 'end')).toBe(0);
  });

  it('keeps a two-day floor where the collapse would leave no length at all', () => {
    // Midnight to midnight: the end occupies none of the date it lands on, so
    // there is no hour for the trailing edge to fall back to.
    const midnight = occ({
      allDay: false,
      date: '2026-08-10',
      endDate: '2026-08-11',
      startMinutes: 0,
      endMinutes: 0,
    });
    expect(spanFloor(midnight, 'end')).toBe(1);
  });

  it('keeps a two-day floor for a leading edge with no room left on its date', () => {
    const lateStart = occ({
      allDay: false,
      date: '2026-08-10',
      endDate: '2026-08-11',
      startMinutes: 1439,
      endMinutes: 0,
    });
    expect(spanFloor(lateStart, 'start')).toBe(1);
  });
});

describe('resizedSpan', () => {
  it('moves the trailing edge to the date under the pointer', () => {
    expect(resizedSpan(band('2026-08-10', '2026-08-12'), 'end', '2026-08-18')).toEqual({
      date: '2026-08-10',
      endDate: '2026-08-18',
    });
  });

  it('moves the leading edge without touching the end', () => {
    expect(resizedSpan(band('2026-08-10', '2026-08-12'), 'start', '2026-08-05')).toEqual({
      date: '2026-08-05',
      endDate: '2026-08-12',
    });
  });

  it('pins the bar at its shortest rather than turning it inside out', () => {
    expect(resizedSpan(band('2026-08-10', '2026-08-12'), 'end', '2026-08-01')).toEqual({
      date: '2026-08-10',
      endDate: '2026-08-10',
    });
  });
});

describe('groupResizeDelta', () => {
  it('reads the delta off the bar the pointer is on', () => {
    const dragged = band('2026-08-10', '2026-08-12');
    expect(groupResizeDelta([dragged], dragged, 'end', '2026-08-15')).toBe(3);
  });

  it('gives every entry in the group the same number of days', () => {
    const dragged = band('2026-08-10', '2026-08-12');
    const group = [dragged, band('2026-08-03', '2026-08-04'), band('2026-08-20', '2026-08-27')];

    const delta = groupResizeDelta(group, dragged, 'end', '2026-08-17');

    expect(delta).toBe(5);
    // Each keeps its own length; only the trailing edge moves.
    expect(group.map((o) => resizedEdge(o, 'end', delta))).toEqual([
      { date: '2026-08-10', endDate: '2026-08-17' },
      { date: '2026-08-03', endDate: '2026-08-09' },
      { date: '2026-08-20', endDate: '2026-09-01' },
    ]);
  });

  it('never clamps a group that is being lengthened', () => {
    const dragged = band('2026-08-10', '2026-08-30');
    const group = [dragged, band('2026-08-05', '2026-08-05')];

    expect(groupResizeDelta(group, dragged, 'end', '2026-09-30')).toBe(31);
  });

  it('shortens the group by what its tightest member can give, not by more', () => {
    const dragged = band('2026-08-10', '2026-08-20');
    // Two days long, so its trailing edge has exactly one day of travel.
    const tight = band('2026-08-01', '2026-08-02');

    // The pointer asks for six days back; the group can only give one.
    expect(groupResizeDelta([dragged, tight], dragged, 'end', '2026-08-14')).toBe(-1);
  });

  it('applies the same clamp to a leading edge, in the other direction', () => {
    const dragged = band('2026-08-10', '2026-08-20');
    const tight = band('2026-08-01', '2026-08-02');

    // Dragging the start forward shortens; the tight bar caps it at one day.
    expect(groupResizeDelta([dragged, tight], dragged, 'start', '2026-08-16')).toBe(1);
  });

  it('leaves a one-entry group to its own floor', () => {
    // A lone bar can still be shortened all the way onto its start date.
    const dragged = band('2026-08-10', '2026-08-20');
    expect(groupResizeDelta([dragged], dragged, 'end', '2026-08-04')).toBe(-10);
  });
});

describe('resizedEdge', () => {
  it('moves the end and leaves the start', () => {
    expect(resizedEdge(band('2026-08-10', '2026-08-12'), 'end', 4)).toEqual({
      date: '2026-08-10',
      endDate: '2026-08-16',
    });
  });

  it('moves the start and leaves the end', () => {
    expect(resizedEdge(band('2026-08-10', '2026-08-12'), 'start', -4)).toEqual({
      date: '2026-08-06',
      endDate: '2026-08-12',
    });
  });
});
