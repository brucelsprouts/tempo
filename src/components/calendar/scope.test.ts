import { describe, expect, it } from 'vitest';
import type { EventDraft } from '@/lib/store/calendar-store';
import type { Occurrence, TempoEvent } from '@/lib/tempo/types';
import { canSplitAt, oneDatePatch } from './scope';

function lecture(over: Partial<TempoEvent> = {}): TempoEvent {
  return {
    id: 's',
    title: 'Lecture',
    notes: null,
    kind: 'event',
    categoryId: 'c5',
    allDay: true,
    startsAt: null,
    endsAt: null,
    startDate: '2026-09-01',
    endDate: '2026-09-01',
    dueMinutes: null,
    timezone: 'America/Toronto',
    recurrence: { freq: 'WEEKLY', interval: 1 },
    reminders: [{ minutes: 900 }, { minutes: 2340 }],
    anchorDate: null,
    displayTemplate: null,
    status: null,
    notify: false,
    source: 'tempo',
    googleEventId: null,
    deletedAt: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function on(e: TempoEvent, date: string): Occurrence {
  return {
    key: `${e.id}:${date}`,
    eventId: e.id,
    event: e,
    date,
    endDate: date,
    seriesDate: date,
    index: 1,
    title: e.title,
    allDay: e.allDay,
    startMinutes: null,
    endMinutes: null,
    kind: e.kind,
    status: e.status,
    categoryId: e.categoryId,
    isOverride: false,
    readOnly: false,
  };
}

/** The form as it reads when opened on `occ` and left alone, plus `over`. */
function shown(e: TempoEvent, occ: Occurrence, over: Partial<EventDraft> = {}): EventDraft {
  return {
    title: e.title,
    kind: e.kind,
    allDay: e.allDay,
    startDate: occ.date,
    endDate: occ.endDate,
    categoryId: e.categoryId,
    recurrence: e.recurrence,
    reminders: e.reminders,
    anchorDate: e.anchorDate,
    displayTemplate: e.displayTemplate,
    notes: e.notes,
    ...over,
  };
}

describe('what a change means for one date', () => {
  const e = lecture();
  const occ = on(e, '2026-09-15');

  it('is nothing when nothing changed', () => {
    expect(oneDatePatch(e, occ, shown(e, occ))).toEqual({});
  });

  it('renames one date', () => {
    expect(oneDatePatch(e, occ, shown(e, occ, { title: 'Guest lecture' }))).toEqual({
      title: 'Guest lecture',
    });
  });

  it('moves one date', () => {
    expect(
      oneDatePatch(e, occ, shown(e, occ, { startDate: '2026-09-16', endDate: '2026-09-16' })),
    ).toEqual({ startDate: '2026-09-16', endDate: '2026-09-16' });
  });

  it('retimes one date of a timed series', () => {
    const t = lecture({ allDay: false });
    const o = { ...on(t, '2026-09-15'), startMinutes: 600, endMinutes: 690 };
    expect(oneDatePatch(t, o, shown(t, o, { startMinutes: 660, endMinutes: 750 }))).toEqual({
      startMinutes: 660,
      endMinutes: 750,
    });
  });

  it('refuses a change to the category', () => {
    expect(oneDatePatch(e, occ, shown(e, occ, { categoryId: 'c6' }))).toBeNull();
  });

  it('refuses a change to the repeat', () => {
    expect(
      oneDatePatch(e, occ, shown(e, occ, { recurrence: { freq: 'WEEKLY', interval: 2 } })),
    ).toBeNull();
  });

  it('does not take reminders listed in another order for a change', () => {
    expect(
      oneDatePatch(e, occ, shown(e, occ, { reminders: [{ minutes: 2340 }, { minutes: 900 }] })),
    ).toEqual({});
  });

  it('refuses a reminder moved to count from the due date', () => {
    const moved = shown(e, occ, { reminders: [{ from: 'dueDay', minutes: 900 }, { minutes: 2340 }] });
    expect(oneDatePatch(e, occ, moved)).toBeNull();
  });

  it('refuses a change to the due time', () => {
    expect(oneDatePatch(e, occ, shown(e, occ, { dueMinutes: 18 * 60 }))).toBeNull();
  });
});

describe('whether THIS AND LATER is offered', () => {
  it('is not, on the first date, where it would mean every date', () => {
    const e = lecture();
    expect(canSplitAt(e, on(e, '2026-09-01'))).toBe(false);
  });

  it('is, on a later date', () => {
    const e = lecture();
    expect(canSplitAt(e, on(e, '2026-09-15'))).toBe(true);
  });

  it('is not, on a title that counts its occurrences', () => {
    const e = lecture({ displayTemplate: '{title} · #{n}' });
    expect(canSplitAt(e, on(e, '2026-09-15'))).toBe(false);
  });

  it('is not, for a birthday or a one-off', () => {
    const b = lecture({ kind: 'birthday' });
    expect(canSplitAt(b, on(b, '2026-09-15'))).toBe(false);
    const once = lecture({ recurrence: null });
    expect(canSplitAt(once, on(once, '2026-09-15'))).toBe(false);
  });
});
