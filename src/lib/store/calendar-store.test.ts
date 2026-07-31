import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Occurrence, TempoEvent } from '@/lib/tempo/types';

/**
 * The store's mutation paths carry the decisions that are easiest to get subtly
 * wrong: whether an edit rewrites a series or excepts one instance out of it,
 * and whether a failed write leaves the calendar showing something that isn't
 * actually there. Both are tested against a fake client, not a live database.
 */

interface RecordedCall {
  table: string;
  op: string;
  payload: unknown;
}

const recorded: RecordedCall[] = [];
let shouldFail = false;

function query(table: string) {
  const state: { op: string; payload: unknown } = { op: 'select', payload: null };
  const settle = () => {
    recorded.push({ table, op: state.op, payload: state.payload });
    return Promise.resolve(
      shouldFail ? { data: null, error: { message: 'write rejected' } } : { data: [], error: null },
    );
  };
  const q = {
    select: () => q,
    order: () => q,
    eq: () => q,
    insert: (p: unknown) => ((state.op = 'insert'), (state.payload = p), q),
    update: (p: unknown) => ((state.op = 'update'), (state.payload = p), q),
    upsert: (p: unknown) => ((state.op = 'upsert'), (state.payload = p), q),
    delete: () => ((state.op = 'delete'), q),
    then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => settle().then(ok, err),
  };
  return q;
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => query(table),
    auth: { getUser: async () => ({ data: { user: { id: 'owner-1' } } }) },
  }),
}));

const { useCalendar } = await import('./calendar-store');

// ------------------------------------------------------------------ fixtures

const TZ = 'America/Toronto';

function event(over: Partial<TempoEvent>): TempoEvent {
  return {
    id: 'e1',
    title: 'Thing',
    notes: null,
    kind: 'event',
    categoryId: null,
    allDay: true,
    startsAt: null,
    endsAt: null,
    startDate: '2026-08-10',
    endDate: '2026-08-10',
    timezone: TZ,
    recurrence: null,
    anchorDate: null,
    displayTemplate: null,
    status: null,
    notify: false,
    source: 'tempo',
    googleEventId: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function occurrenceOf(e: TempoEvent, date: string, endDate = date): Occurrence {
  return {
    key: `${e.id}:${date}`,
    eventId: e.id,
    event: e,
    date,
    endDate,
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
    readOnly: e.source === 'google',
  };
}

function seed(events: TempoEvent[]) {
  useCalendar.setState({
    ownerId: 'owner-1',
    timezone: TZ,
    events,
    overrides: [],
    categories: [],
    status: 'ready',
    error: null,
  });
}

const lastCall = (op: string) => [...recorded].reverse().find((c) => c.op === op);

beforeEach(() => {
  recorded.length = 0;
  shouldFail = false;
});

// ------------------------------------------------------------------- moving

describe('moving an occurrence', () => {
  it('shifts the event itself when it does not recur', async () => {
    const e = event({ startDate: '2026-08-10', endDate: '2026-08-12' });
    seed([e]);

    await useCalendar.getState().moveOccurrence(occurrenceOf(e, '2026-08-10', '2026-08-12'), 5, 'occurrence');

    const moved = useCalendar.getState().events[0];
    expect(moved.startDate).toBe('2026-08-15');
    expect(moved.endDate).toBe('2026-08-17');
    expect(useCalendar.getState().overrides).toHaveLength(0);
  });

  it('excepts a single instance out of a series rather than moving all of it', async () => {
    const e = event({ recurrence: { freq: 'WEEKLY' } });
    seed([e]);

    await useCalendar.getState().moveOccurrence(occurrenceOf(e, '2026-08-10'), 2, 'occurrence');

    // the series definition is untouched
    expect(useCalendar.getState().events[0].startDate).toBe('2026-08-10');

    const [override] = useCalendar.getState().overrides;
    expect(override.occurrenceDate).toBe('2026-08-10');
    expect(override.patch.startDate).toBe('2026-08-12');
    expect(lastCall('upsert')).toBeDefined();
  });

  it('rewrites the whole series when the edit is scoped to it', async () => {
    const e = event({ recurrence: { freq: 'WEEKLY' } });
    seed([e]);

    await useCalendar.getState().moveOccurrence(occurrenceOf(e, '2026-08-10'), 3, 'series');

    expect(useCalendar.getState().events[0].startDate).toBe('2026-08-13');
    expect(useCalendar.getState().overrides).toHaveLength(0);
  });

  it('keeps wall-clock time when a timed event crosses a DST boundary', async () => {
    // 09:00 EDT on 2026-10-30, dragged three days over the fall-back
    const e = event({
      allDay: false,
      startDate: null,
      endDate: null,
      startsAt: '2026-10-30T13:00:00Z',
      endsAt: '2026-10-30T14:00:00Z',
    });
    seed([e]);

    await useCalendar.getState().moveOccurrence(occurrenceOf(e, '2026-10-30'), 3, 'series');

    const moved = useCalendar.getState().events[0];
    // still 09:00 local, which is now 14:00Z rather than 13:00Z
    expect(moved.startsAt).toBe('2026-11-02T14:00:00.000Z');
  });

  it('refuses to move a read-only Google event', async () => {
    const e = event({ source: 'google' });
    seed([e]);

    await useCalendar.getState().moveOccurrence(occurrenceOf(e, '2026-08-10'), 4, 'occurrence');

    expect(useCalendar.getState().events[0].startDate).toBe('2026-08-10');
    expect(recorded).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ resizing

describe('resizing an occurrence', () => {
  it('extends the trailing edge', async () => {
    const e = event({ startDate: '2026-08-10', endDate: '2026-08-12' });
    seed([e]);

    await useCalendar.getState().resizeOccurrence(occurrenceOf(e, '2026-08-10', '2026-08-12'), 3, 'end', 'series');

    expect(useCalendar.getState().events[0].startDate).toBe('2026-08-10');
    expect(useCalendar.getState().events[0].endDate).toBe('2026-08-15');
  });

  it('pulls the leading edge without touching the end', async () => {
    const e = event({ startDate: '2026-08-10', endDate: '2026-08-12' });
    seed([e]);

    await useCalendar.getState().resizeOccurrence(occurrenceOf(e, '2026-08-10', '2026-08-12'), -2, 'start', 'series');

    expect(useCalendar.getState().events[0].startDate).toBe('2026-08-08');
    expect(useCalendar.getState().events[0].endDate).toBe('2026-08-12');
  });

  it('refuses to turn a bar inside out', async () => {
    const e = event({ startDate: '2026-08-10', endDate: '2026-08-12' });
    seed([e]);

    await useCalendar.getState().resizeOccurrence(occurrenceOf(e, '2026-08-10', '2026-08-12'), -9, 'end', 'series');

    expect(useCalendar.getState().events[0].endDate).toBe('2026-08-12');
    expect(recorded).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- cancelling

describe('cancelling', () => {
  it('marks one instance cancelled without deleting the series', async () => {
    const e = event({ recurrence: { freq: 'WEEKLY' } });
    seed([e]);

    await useCalendar.getState().cancelOccurrence(occurrenceOf(e, '2026-08-10'));

    expect(useCalendar.getState().events).toHaveLength(1);
    expect(useCalendar.getState().overrides[0].cancelled).toBe(true);
  });

  it('deletes a one-off outright, since there is no series to except it from', async () => {
    const e = event({});
    seed([e]);

    await useCalendar.getState().cancelOccurrence(occurrenceOf(e, '2026-08-10'));

    expect(useCalendar.getState().events).toHaveLength(0);
    expect(lastCall('delete')).toBeDefined();
  });
});

// ----------------------------------------------------------------- rollback

describe('failed writes', () => {
  it('restores the previous state so the calendar never shows a phantom edit', async () => {
    const e = event({ startDate: '2026-08-10', endDate: '2026-08-10' });
    seed([e]);
    shouldFail = true;

    await useCalendar.getState().moveOccurrence(occurrenceOf(e, '2026-08-10'), 5, 'series');

    expect(useCalendar.getState().events[0].startDate).toBe('2026-08-10');
    expect(useCalendar.getState().error).toBe('write rejected');
  });

  it('rolls a rejected override back out of the list', async () => {
    const e = event({ recurrence: { freq: 'WEEKLY' } });
    seed([e]);
    shouldFail = true;

    await useCalendar.getState().moveOccurrence(occurrenceOf(e, '2026-08-10'), 2, 'occurrence');

    expect(useCalendar.getState().overrides).toHaveLength(0);
    expect(useCalendar.getState().error).toBe('write rejected');
  });
});
