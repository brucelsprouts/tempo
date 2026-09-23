import { describe, expect, it } from 'vitest';
import type { TempoEvent } from '@/lib/tempo/types';
import { filterVisible } from './visible-events';

function event(id: string, timetable: boolean): TempoEvent {
  return {
    id,
    title: id,
    notes: null,
    kind: 'event',
    categoryId: null,
    allDay: true,
    startsAt: null,
    endsAt: null,
    startDate: '2026-09-21',
    endDate: '2026-09-21',
    dueMinutes: null,
    timezone: 'America/Toronto',
    recurrence: null,
    reminders: [],
    anchorDate: null,
    displayTemplate: null,
    notify: false,
    timetable,
    source: 'tempo',
    googleEventId: null,
    deletedAt: null,
    createdAt: '',
    updatedAt: '',
  };
}

const lecture = event('lecture', true);
const essay = event('essay', false);

describe('hiding the timetable', () => {
  it('drops a timetable entry', () => {
    expect(filterVisible([lecture, essay], false)).toEqual([essay]);
  });

  it('keeps an ordinary entry', () => {
    expect(filterVisible([essay], false)).toEqual([essay]);
  });

  it('keeps everything when revealed', () => {
    expect(filterVisible([lecture, essay], true)).toEqual([lecture, essay]);
  });

  it('survives an empty calendar either way', () => {
    expect(filterVisible([], false)).toEqual([]);
    expect(filterVisible([], true)).toEqual([]);
  });
});

describe('identity', () => {
  it('returns the same array when revealed, so nothing downstream re-expands', () => {
    // Every view memoises `expandAll` on the event list. A fresh array here
    // would walk the whole calendar again on every unrelated render.
    const events = [lecture, essay];
    expect(filterVisible(events, true)).toBe(events);
  });

  it('returns the same array when there is nothing to hide', () => {
    const events = [essay];
    expect(filterVisible(events, false)).toBe(events);
  });
});
