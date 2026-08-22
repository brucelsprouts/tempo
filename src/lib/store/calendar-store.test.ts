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
  filters: [string, string, unknown][];
}

const recorded: RecordedCall[] = [];
let shouldFail = false;
/**
 * Tables whose writes fail on their own.
 *
 * `shouldFail` says "the network is down", which every write should notice.
 * This says "one table is unavailable", which is the case history has to
 * survive: a version log that cannot be written must not take the edit with it.
 */
const failing = new Set<string>();
/** What a `select()` on a table returns. */
const stored: Record<string, unknown[]> = {};

function query(table: string) {
  const state: { op: string; payload: unknown; filters: [string, string, unknown][] } = {
    op: 'select',
    payload: null,
    filters: [],
  };
  const settle = () => {
    recorded.push({ table, op: state.op, payload: state.payload, filters: state.filters });
    if (shouldFail || failing.has(table)) {
      return Promise.resolve({ data: null, error: { message: 'write rejected' } });
    }
    return Promise.resolve({
      data: state.op === 'select' ? (stored[table] ?? []) : [],
      error: null,
    });
  };
  const filter = (name: string) => (column: string, value: unknown) => {
    state.filters.push([name, column, value]);
    return q;
  };
  const q = {
    select: () => q,
    order: () => q,
    eq: filter('eq'),
    in: filter('in'),
    lt: filter('lt'),
    is: filter('is'),
    insert: (p: unknown) => ((state.op = 'insert'), (state.payload = p), q),
    update: (p: unknown) => ((state.op = 'update'), (state.payload = p), q),
    upsert: (p: unknown) => ((state.op = 'upsert'), (state.payload = p), q),
    delete: () => ((state.op = 'delete'), q),
    then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => settle().then(ok, err),
  };
  return q;
}

/**
 * The other device, as a function you can call.
 *
 * Realtime is the one part of the store driven by something that is not a user
 * action, so the fake exposes the handlers rather than the socket: a test says
 * "a row changed over there" by invoking one, which is exactly what the channel
 * would do, without any of the transport in between.
 */
let handlers: Record<string, (payload: unknown) => void> = {};
let subscribed = false;

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => query(table),
    auth: { getUser: async () => ({ data: { user: { id: 'owner-1' } } }) },
    channel: () => {
      const ch = {
        on: (_event: string, config: { table: string }, cb: (payload: unknown) => void) => {
          handlers[config.table] = cb;
          return ch;
        },
        subscribe: () => ((subscribed = true), ch),
      };
      return ch;
    },
    removeChannel: () => {
      handlers = {};
      subscribed = false;
    },
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
    reminders: [],
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

/** The row shape `load()` reads, for the two tests that exercise the read path. */
function row(over: Record<string, unknown>) {
  return {
    id: 'e1',
    title: 'Thing',
    notes: null,
    kind: 'event',
    category_id: null,
    all_day: true,
    starts_at: null,
    ends_at: null,
    start_date: '2026-08-10',
    end_date: '2026-08-10',
    timezone: TZ,
    recurrence: null,
    anchor_date: null,
    display_template: null,
    status: null,
    notify: false,
    source: 'tempo',
    google_event_id: null,
    deleted_at: null,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

/** A timed event, which carries instants instead of bare dates. */
function timed(startsAt: string, endsAt: string): TempoEvent {
  return event({ allDay: false, startsAt, endsAt, startDate: null, endDate: null });
}

/** The occurrence a timed event draws, with the wall-clock minutes it reads at. */
function timedOccurrence(
  e: TempoEvent,
  date: string,
  endDate: string,
  startMinutes: number,
  endMinutes: number,
): Occurrence {
  return { ...occurrenceOf(e, date, endDate), startMinutes, endMinutes };
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
    deleted: [],
    versions: [],
    versionsFor: null,
    status: 'ready',
    error: null,
    // A seeded calendar is a fresh one. The stack lives in the store rather
    // than in the fixture, so without this it carries the previous test's
    // actions into the next one.
    undoStack: [],
  });
}

const lastCall = (op: string) => [...recorded].reverse().find((c) => c.op === op);
const callsOn = (table: string, op: string) =>
  recorded.filter((c) => c.table === table && c.op === op);
const lastCallOn = (table: string, op: string) => callsOn(table, op).at(-1);

beforeEach(() => {
  recorded.length = 0;
  shouldFail = false;
  failing.clear();
  for (const key of Object.keys(stored)) delete stored[key];
  // The channel is held outside the store's state, so it survives `setState`
  // and would leak a subscription from one test into the next.
  useCalendar.getState().disconnect();
});

/**
 * Several tests reject every write on purpose, and a rejected write includes
 * the version insert riding along beside it — which says so, once, on the
 * console. That line is correct behaviour and is asserted for elsewhere; here
 * it would just be noise in the run.
 */
vi.spyOn(console, 'warn').mockImplementation(() => {});

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

// ------------------------------------------------------------ bulk mutations

/**
 * A selection has to move or vanish as one unit.
 *
 * The interesting property is not that the dates come out right — that is
 * `moveOccurrence` again — but that a group is one snapshot and one statement
 * per table. A loop of single writes would leave four entries moved and two not
 * on a failure partway through, which the snapshot rollback has no way to
 * express, let alone undo.
 */
describe('moving a selection', () => {
  it('splits into one write per table, whatever the mix', async () => {
    const one = event({ id: 'e1', startDate: '2026-08-10', endDate: '2026-08-10' });
    const two = event({ id: 'e2', startDate: '2026-08-12', endDate: '2026-08-14' });
    const series = event({ id: 'e3', recurrence: { freq: 'WEEKLY' } });
    seed([one, two, series]);

    await useCalendar.getState().moveOccurrences(
      [
        occurrenceOf(one, '2026-08-10'),
        occurrenceOf(two, '2026-08-12', '2026-08-14'),
        occurrenceOf(series, '2026-08-10'),
      ],
      7,
      'occurrence',
    );

    const moved = new Map(useCalendar.getState().events.map((e) => [e.id, e]));
    expect(moved.get('e1')!.startDate).toBe('2026-08-17');
    expect(moved.get('e2')!.endDate).toBe('2026-08-21');
    // The recurring one is excepted rather than rewritten, exactly as a single
    // occurrence-scoped move would be.
    expect(moved.get('e3')!.startDate).toBe('2026-08-10');
    expect(useCalendar.getState().overrides[0].patch.startDate).toBe('2026-08-17');

    expect(recorded.filter((c) => c.table === 'events')).toHaveLength(1);
    expect(recorded.filter((c) => c.table === 'occurrence_overrides')).toHaveLength(1);
  });

  it('collapses two occurrences of one series into a single row', async () => {
    const e = event({ recurrence: { freq: 'WEEKLY' } });
    seed([e]);

    await useCalendar
      .getState()
      .moveOccurrences([occurrenceOf(e, '2026-08-10'), occurrenceOf(e, '2026-08-17')], 1, 'series');

    // Both describe the same row, and one statement cannot touch a row twice.
    expect(lastCall('upsert')!.payload).toHaveLength(1);
    expect(useCalendar.getState().events[0].startDate).toBe('2026-08-11');
  });

  it('leaves read-only instances where they are', async () => {
    const mine = event({ id: 'e1' });
    const theirs = event({ id: 'e2', source: 'google' });
    seed([mine, theirs]);

    await useCalendar
      .getState()
      .moveOccurrences(
        [occurrenceOf(mine, '2026-08-10'), occurrenceOf(theirs, '2026-08-10')],
        2,
        'occurrence',
      );

    const after = new Map(useCalendar.getState().events.map((e) => [e.id, e]));
    expect(after.get('e1')!.startDate).toBe('2026-08-12');
    expect(after.get('e2')!.startDate).toBe('2026-08-10');
  });

  it('rolls the whole group back together', async () => {
    const one = event({ id: 'e1' });
    const two = event({ id: 'e2', startDate: '2026-08-12', endDate: '2026-08-12' });
    seed([one, two]);
    shouldFail = true;

    await useCalendar
      .getState()
      .moveOccurrences([occurrenceOf(one, '2026-08-10'), occurrenceOf(two, '2026-08-12')], 3, 'occurrence');

    expect(useCalendar.getState().events.map((e) => e.startDate)).toEqual([
      '2026-08-10',
      '2026-08-12',
    ]);
    expect(useCalendar.getState().error).toBe('write rejected');
  });
});

/**
 * Dropping a lasso'd selection on a day.
 *
 * The distinction from `moveOccurrences` is the whole point: that one shifts a
 * group by a shared delta and preserves the spacing between entries, this one
 * collapses them onto one date and destroys it. Both are wanted — the arrow keys
 * mean the first, a drag onto a day means the second — so the property to hold
 * is that each entry gets its *own* delta, computed from where it starts.
 */
describe('gathering a selection onto one date', () => {
  it('puts every entry on the drop date and keeps each length', async () => {
    const one = event({ id: 'e1', startDate: '2026-08-10', endDate: '2026-08-10' });
    const two = event({ id: 'e2', startDate: '2026-08-12', endDate: '2026-08-14' });
    seed([one, two]);

    await useCalendar
      .getState()
      .gatherOccurrences(
        [occurrenceOf(one, '2026-08-10'), occurrenceOf(two, '2026-08-12', '2026-08-14')],
        '2026-08-20',
        'occurrence',
      );

    const after = new Map(useCalendar.getState().events.map((e) => [e.id, e]));
    expect(after.get('e1')!.startDate).toBe('2026-08-20');
    expect(after.get('e1')!.endDate).toBe('2026-08-20');
    // Three days long before, three days long after — the entry moved, it was
    // not reshaped to fit the day it landed on.
    expect(after.get('e2')!.startDate).toBe('2026-08-20');
    expect(after.get('e2')!.endDate).toBe('2026-08-22');
  });

  /**
   * The case a shared delta cannot express, and the one that prompted this.
   *
   * Dropping on a date the grabbed entry already sits on is a delta of zero,
   * which `moveOccurrences` correctly refuses as a no-op. Here it is the whole
   * request: the others still have to come to it.
   */
  it('accepts a drop on a date one of the entries already occupies', async () => {
    const here = event({ id: 'e1', startDate: '2026-08-10', endDate: '2026-08-10' });
    const there = event({ id: 'e2', startDate: '2026-08-15', endDate: '2026-08-15' });
    seed([here, there]);

    await useCalendar
      .getState()
      .gatherOccurrences(
        [occurrenceOf(here, '2026-08-10'), occurrenceOf(there, '2026-08-15')],
        '2026-08-10',
        'occurrence',
      );

    const after = new Map(useCalendar.getState().events.map((e) => [e.id, e]));
    expect(after.get('e1')!.startDate).toBe('2026-08-10');
    expect(after.get('e2')!.startDate).toBe('2026-08-10');
  });

  it('excepts a recurring instance rather than dragging its series along', async () => {
    const series = event({ id: 'e1', recurrence: { freq: 'WEEKLY' } });
    seed([series]);

    await useCalendar
      .getState()
      .gatherOccurrences([occurrenceOf(series, '2026-08-17')], '2026-08-20', 'occurrence');

    expect(useCalendar.getState().events[0].startDate).toBe('2026-08-10');
    const [override] = useCalendar.getState().overrides;
    expect(override.occurrenceDate).toBe('2026-08-17');
    expect(override.patch.startDate).toBe('2026-08-20');
  });

  it('leaves read-only instances where they are', async () => {
    const mine = event({ id: 'e1' });
    const theirs = event({ id: 'e2', source: 'google' });
    seed([mine, theirs]);

    await useCalendar
      .getState()
      .gatherOccurrences(
        [occurrenceOf(mine, '2026-08-10'), occurrenceOf(theirs, '2026-08-10')],
        '2026-08-20',
        'occurrence',
      );

    const after = new Map(useCalendar.getState().events.map((e) => [e.id, e]));
    expect(after.get('e1')!.startDate).toBe('2026-08-20');
    expect(after.get('e2')!.startDate).toBe('2026-08-10');
  });

  /**
   * Two instances of one series, gathered under Shift, describe one row with two
   * destinations — genuinely contradictory, since a weekly series cannot have
   * every instance on a single day. There is no right answer, only a predictable
   * one: the earliest instance sets where the series lands.
   */
  it('resolves a series with two instances selected to a single row', async () => {
    const e = event({ id: 'e1', recurrence: { freq: 'WEEKLY' } });
    seed([e]);

    await useCalendar
      .getState()
      .gatherOccurrences(
        [occurrenceOf(e, '2026-08-17'), occurrenceOf(e, '2026-08-10')],
        '2026-08-20',
        'series',
      );

    expect(lastCall('upsert')!.payload).toHaveLength(1);
    // Driven by 2026-08-10, the earlier of the two, whatever order they arrived in.
    expect(useCalendar.getState().events[0].startDate).toBe('2026-08-20');
  });

  it('writes nothing when everything already starts there', async () => {
    const one = event({ id: 'e1', startDate: '2026-08-10', endDate: '2026-08-10' });
    const two = event({ id: 'e2', startDate: '2026-08-10', endDate: '2026-08-11' });
    seed([one, two]);

    await useCalendar
      .getState()
      .gatherOccurrences(
        [occurrenceOf(one, '2026-08-10'), occurrenceOf(two, '2026-08-10', '2026-08-11')],
        '2026-08-10',
        'occurrence',
      );

    expect(recorded).toHaveLength(0);
  });

  it('keeps wall-clock time when an entry is gathered across a DST boundary', async () => {
    // 09:00 EDT, gathered onto a date after the fall-back
    const e = event({
      id: 'e1',
      allDay: false,
      startDate: null,
      endDate: null,
      startsAt: '2026-10-30T13:00:00Z',
      endsAt: '2026-10-30T14:00:00Z',
    });
    seed([e]);

    await useCalendar
      .getState()
      .gatherOccurrences([occurrenceOf(e, '2026-10-30')], '2026-11-02', 'series');

    expect(useCalendar.getState().events[0].startsAt).toBe('2026-11-02T14:00:00.000Z');
  });

  it('rolls the whole group back together', async () => {
    const one = event({ id: 'e1', startDate: '2026-08-10', endDate: '2026-08-10' });
    const two = event({ id: 'e2', startDate: '2026-08-12', endDate: '2026-08-12' });
    seed([one, two]);
    shouldFail = true;

    await useCalendar
      .getState()
      .gatherOccurrences(
        [occurrenceOf(one, '2026-08-10'), occurrenceOf(two, '2026-08-12')],
        '2026-08-20',
        'occurrence',
      );

    expect(useCalendar.getState().events.map((e) => e.startDate)).toEqual([
      '2026-08-10',
      '2026-08-12',
    ]);
    expect(useCalendar.getState().error).toBe('write rejected');
  });
});

describe('duplicating a selection', () => {
  const dup = (occs: Occurrence[], to: string | null = null) =>
    useCalendar.getState().duplicateOccurrences(occs, to);
  const titles = () => useCalendar.getState().events.map((e) => e.title);

  it('copies in place when given no date', async () => {
    const one = event({ id: 'e1', title: 'Standup' });
    seed([one]);

    await dup([occurrenceOf(one, '2026-08-10')]);

    const [, copy] = useCalendar.getState().events;
    expect(copy.title).toBe('Standup (1)');
    expect(copy.startDate).toBe('2026-08-10');
    expect(copy.id).not.toBe('e1');
  });

  it('numbers each copy past the ones already there', async () => {
    const one = event({ id: 'e1', title: 'Standup' });
    seed([one]);

    await dup([occurrenceOf(one, '2026-08-10')]);
    await dup([occurrenceOf(one, '2026-08-10')]);

    expect(titles()).toEqual(['Standup', 'Standup (1)', 'Standup (2)']);
  });

  it('does not give two copies made at once the same name', async () => {
    const one = event({ id: 'e1', title: 'Standup' });
    const two = event({ id: 'e2', title: 'Standup' });
    seed([one, two]);

    await dup([occurrenceOf(one, '2026-08-10'), occurrenceOf(two, '2026-08-10')]);

    expect(titles()).toEqual(['Standup', 'Standup', 'Standup (1)', 'Standup (2)']);
  });

  it('lands the earliest copy on the date and keeps the spacing', async () => {
    const one = event({ id: 'e1', title: 'A', startDate: '2026-08-10', endDate: '2026-08-10' });
    const two = event({ id: 'e2', title: 'B', startDate: '2026-08-12', endDate: '2026-08-13' });
    seed([one, two]);

    await dup(
      [occurrenceOf(one, '2026-08-10'), occurrenceOf(two, '2026-08-12', '2026-08-13')],
      '2026-08-20',
    );

    const copies = useCalendar.getState().events.slice(2);
    // +10 days for both, so the two-day gap between them survives — and so does
    // the second entry's own length.
    expect(copies.map((e) => [e.startDate, e.endDate])).toEqual([
      ['2026-08-20', '2026-08-20'],
      ['2026-08-22', '2026-08-23'],
    ]);
  });

  it('measures the delta from the earliest, whatever order the selection arrives in', async () => {
    const one = event({ id: 'e1', title: 'A', startDate: '2026-08-10', endDate: '2026-08-10' });
    const two = event({ id: 'e2', title: 'B', startDate: '2026-08-12', endDate: '2026-08-12' });
    seed([one, two]);

    await dup(
      [occurrenceOf(two, '2026-08-12'), occurrenceOf(one, '2026-08-10')],
      '2026-08-20',
    );

    expect(
      useCalendar
        .getState()
        .events.slice(2)
        .map((e) => e.startDate)
        .sort(),
    ).toEqual(['2026-08-20', '2026-08-22']);
  });

  it('carries the recurrence rule, so a copy of a series is a series', async () => {
    const weekly = event({
      id: 'e1',
      title: 'Standup',
      recurrence: { freq: 'WEEKLY', interval: 1, byWeekday: [1] },
      reminders: [{ minutes: 10 }],
      notes: 'bring coffee',
    });
    seed([weekly]);

    await dup([occurrenceOf(weekly, '2026-08-10')]);

    const copy = useCalendar.getState().events[1];
    expect(copy.recurrence).toEqual({ freq: 'WEEKLY', interval: 1, byWeekday: [1] });
    expect(copy.reminders).toEqual([{ minutes: 10 }]);
    expect(copy.notes).toBe('bring coffee');
  });

  it('makes one copy of a series however many of its instances are selected', async () => {
    const weekly = event({
      id: 'e1',
      title: 'Standup',
      recurrence: { freq: 'WEEKLY', interval: 1 },
    });
    seed([weekly]);

    await dup([occurrenceOf(weekly, '2026-08-10'), occurrenceOf(weekly, '2026-08-17')]);

    expect(useCalendar.getState().events).toHaveLength(2);
    expect(titles()).toEqual(['Standup', 'Standup (1)']);
  });

  it('shifts a timed copy by whole days, keeping the time of day', async () => {
    const timed = event({
      id: 'e1',
      title: 'Call',
      allDay: false,
      startDate: null,
      endDate: null,
      startsAt: '2026-08-10T13:00:00.000Z',
      endsAt: '2026-08-10T14:00:00.000Z',
    });
    seed([timed]);

    await dup([occurrenceOf(timed, '2026-08-10')], '2026-08-12');

    const copy = useCalendar.getState().events[1];
    expect(copy.startsAt).toBe('2026-08-12T13:00:00.000Z');
    expect(copy.endsAt).toBe('2026-08-12T14:00:00.000Z');
    expect(copy.startDate).toBeNull();
  });

  it('refuses a read-only source and reports nothing copied', async () => {
    const fromGoogle = event({ id: 'e1', title: 'Imported', source: 'google' });
    seed([fromGoogle]);

    const made = await dup([occurrenceOf(fromGoogle, '2026-08-10')]);

    expect(made).toEqual([]);
    expect(useCalendar.getState().events).toHaveLength(1);
    expect(callsOn('events', 'insert')).toHaveLength(0);
  });

  it('writes every copy in one statement', async () => {
    seed([event({ id: 'e1', title: 'A' }), event({ id: 'e2', title: 'B' })]);
    const [one, two] = useCalendar.getState().events;

    await dup([occurrenceOf(one, '2026-08-10'), occurrenceOf(two, '2026-08-10')]);

    const inserts = callsOn('events', 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload).toHaveLength(2);
  });

  it('returns the rows it made, so the caller can light them up', async () => {
    const one = event({ id: 'e1', title: 'Standup' });
    seed([one]);

    const made = await dup([occurrenceOf(one, '2026-08-10')]);

    expect(made).toHaveLength(1);
    expect(made[0].title).toBe('Standup (1)');
    expect(useCalendar.getState().events[1].id).toBe(made[0].id);
  });

  it('rolls the copies back out when the write is rejected', async () => {
    const one = event({ id: 'e1', title: 'Standup' });
    seed([one]);
    shouldFail = true;

    const made = await dup([occurrenceOf(one, '2026-08-10')]);

    expect(made).toEqual([]);
    expect(useCalendar.getState().events).toHaveLength(1);
    expect(useCalendar.getState().error).toBe('write rejected');
    // A rejected write must not offer to take back something that never landed.
    expect(useCalendar.getState().undoStack).toHaveLength(0);
  });

  it('undoes to nothing, deleting the copies outright', async () => {
    const one = event({ id: 'e1', title: 'Standup' });
    seed([one]);

    await dup([occurrenceOf(one, '2026-08-10')]);
    expect(useCalendar.getState().events).toHaveLength(2);

    await useCalendar.getState().undo();

    expect(useCalendar.getState().events.map((e) => e.id)).toEqual(['e1']);
    // A copy has no earlier shape to return to, so it is removed rather than
    // trashed — the same path that takes back a create.
    expect(useCalendar.getState().deleted).toHaveLength(0);
    expect(lastCallOn('events', 'delete')).toBeDefined();
  });

  it('says what it duplicated', async () => {
    const one = event({ id: 'e1', title: 'Standup' });
    seed([one, event({ id: 'e2', title: 'Retro' })]);

    await dup([occurrenceOf(one, '2026-08-10')]);
    expect(useCalendar.getState().undoStack[0].label).toBe('Duplicated Standup (1)');

    const [, two] = useCalendar.getState().events;
    await dup([occurrenceOf(one, '2026-08-10'), occurrenceOf(two, '2026-08-10')]);
    expect(useCalendar.getState().undoStack[0].label).toBe('Duplicated 2 entries');
  });

  it('pastes an entry that has been deleted since it was copied', async () => {
    const one = event({ id: 'e1', title: 'Standup' });
    seed([one]);
    // What a clipboard holds is a snapshot, so the original going away must not
    // turn the pending paste into a no-op.
    const copied = occurrenceOf(one, '2026-08-10');
    await useCalendar.getState().deleteEvent('e1');

    const made = await dup([copied], '2026-08-20');

    expect(made).toHaveLength(1);
    expect(made[0].title).toBe('Standup (1)');
    expect(made[0].startDate).toBe('2026-08-20');
  });

  it('does nothing at all on an empty selection', async () => {
    seed([event({ id: 'e1' })]);

    const made = await dup([]);

    expect(made).toEqual([]);
    expect(callsOn('events', 'insert')).toHaveLength(0);
    expect(useCalendar.getState().undoStack).toHaveLength(0);
  });
});

describe('deleting a selection', () => {
  it('takes the rows in one statement and leaves their exceptions alone', async () => {
    seed([event({ id: 'e1' }), event({ id: 'e2' }), event({ id: 'e3' })]);
    useCalendar.setState({
      overrides: [
        { id: 'o1', eventId: 'e2', occurrenceDate: '2026-08-10', cancelled: false, patch: {} },
      ],
    });

    await useCalendar.getState().deleteEvents(['e1', 'e2']);

    expect(useCalendar.getState().events.map((e) => e.id)).toEqual(['e3']);
    expect(useCalendar.getState().deleted.map((e) => e.id)).toEqual(['e1', 'e2']);
    // Nothing cascaded, because nothing was deleted. The exception is still
    // sitting there waiting for its series to come back.
    expect(useCalendar.getState().overrides).toHaveLength(1);
    expect(callsOn('events', 'update')).toHaveLength(1);
    expect(callsOn('events', 'delete')).toHaveLength(0);
  });

  it('restores every row when the delete is rejected', async () => {
    seed([event({ id: 'e1' }), event({ id: 'e2' })]);
    shouldFail = true;

    await useCalendar.getState().deleteEvents(['e1', 'e2']);

    expect(useCalendar.getState().events).toHaveLength(2);
    expect(useCalendar.getState().error).toBe('write rejected');
  });
});

// ------------------------------------------------------------------ recovery

/**
 * A delete that leaves the row where it is.
 *
 * The behaviour worth pinning down is that `events` still means "live" — every
 * view in the app reads it and none of them check a flag — and that a restore
 * is an edit to a row that never left rather than a re-insert of one that did.
 * The exceptions come along for free now, which is precisely why the test that
 * they survive is still here: it is the behaviour that matters, not the trick.
 */
describe('soft delete', () => {
  const exception = (eventId: string, date: string) => ({
    id: `o-${eventId}-${date}`,
    eventId,
    occurrenceDate: date,
    cancelled: true,
    patch: {},
  });

  it('stamps the row instead of removing it', async () => {
    seed([event({ id: 'e1' }), event({ id: 'e2' })]);

    await useCalendar.getState().deleteEvent('e1');

    expect(useCalendar.getState().events.map((e) => e.id)).toEqual(['e2']);
    expect(useCalendar.getState().deleted.map((e) => e.id)).toEqual(['e1']);
    expect(callsOn('events', 'delete')).toHaveLength(0);

    const patch = lastCallOn('events', 'update')!.payload as Record<string, unknown>;
    // The client picks the stamp rather than leaving it to `now()`, so the row
    // the calendar is holding and the row on the server say the same thing.
    expect(patch.deleted_at).toBe(useCalendar.getState().deleted[0].deletedAt);
  });

  it('brings a series back with its exceptions intact', async () => {
    seed([event({ recurrence: { freq: 'WEEKLY' } }), event({ id: 'e2' })]);
    useCalendar.setState({
      overrides: [
        exception('e1', '2026-08-17'),
        exception('e1', '2026-08-24'),
        exception('e2', '2026-08-17'),
      ],
    });

    await useCalendar.getState().deleteEvent('e1');
    await useCalendar.getState().restoreDeleted('e1');

    const back = useCalendar.getState().overrides.filter((o) => o.eventId === 'e1');
    expect(back.map((o) => o.occurrenceDate)).toEqual(['2026-08-17', '2026-08-24']);
    // A cancelled instance that came back uncancelled is the failure this
    // whole mechanism exists to prevent.
    expect(back.every((o) => o.cancelled)).toBe(true);
    expect(useCalendar.getState().events).toHaveLength(2);
    expect(useCalendar.getState().deleted).toHaveLength(0);
  });

  it('restores by clearing the stamp, not by re-inserting the row', async () => {
    seed([event({})]);

    await useCalendar.getState().deleteEvent('e1');
    await useCalendar.getState().restoreDeleted('e1');

    expect(callsOn('events', 'insert')).toHaveLength(0);
    expect((lastCallOn('events', 'update')!.payload as Record<string, unknown>).deleted_at).toBeNull();
    expect(useCalendar.getState().events[0].deletedAt).toBeNull();
  });

  it('leaves the entry live when the delete is rejected', async () => {
    seed([event({})]);
    shouldFail = true;

    await useCalendar.getState().deleteEvent('e1');

    expect(useCalendar.getState().events).toHaveLength(1);
    // An entry that never left has nothing to offer an undo for.
    expect(useCalendar.getState().deleted).toHaveLength(0);
  });

  it('rolls a rejected restore back into the trash', async () => {
    seed([event({})]);
    await useCalendar.getState().deleteEvent('e1');
    shouldFail = true;

    await useCalendar.getState().restoreDeleted('e1');

    expect(useCalendar.getState().events).toHaveLength(0);
    expect(useCalendar.getState().deleted).toHaveLength(1);
    expect(useCalendar.getState().error).toBe('write rejected');
  });

  it('gives one delete one stamp, whatever it took', async () => {
    seed([event({ id: 'e1' }), event({ id: 'e2' }), event({ id: 'e3' })]);

    await useCalendar.getState().deleteEvents(['e1', 'e2']);
    await useCalendar.getState().deleteEvent('e3');

    const trash = useCalendar.getState().deleted;
    // Newest first, and the pair deleted together share the stamp a single
    // UNDO is keyed on.
    expect(trash.map((e) => e.id)).toEqual(['e3', 'e1', 'e2']);
    expect(trash[1].deletedAt).toBe(trash[2].deletedAt);
    expect(trash[0].deletedAt! > trash[1].deletedAt!).toBe(true);
  });

  it('covers a one-off skipped through cancelOccurrence, which deletes it', async () => {
    const e = event({});
    seed([e]);

    await useCalendar.getState().cancelOccurrence(occurrenceOf(e, '2026-08-10'));

    expect(useCalendar.getState().deleted[0].id).toBe('e1');
  });
});

describe('emptying the trash back onto the calendar', () => {
  it('restores every entry in one statement', async () => {
    seed([event({ id: 'e1' }), event({ id: 'e2' }), event({ id: 'e3' })]);
    await useCalendar.getState().deleteEvents(['e1', 'e2']);
    recorded.length = 0;

    await useCalendar.getState().restoreDeleted();

    expect(useCalendar.getState().deleted).toHaveLength(0);
    expect(useCalendar.getState().events.map((e) => e.id).sort()).toEqual(['e1', 'e2', 'e3']);
    // One update, not one per entry: a loop would leave half the trash restored
    // on a failure partway, which the snapshot rollback cannot describe.
    expect(callsOn('events', 'update')).toHaveLength(1);
    expect(useCalendar.getState().events.every((e) => e.deletedAt === null)).toBe(true);
  });

  it('writes nothing when the trash is already empty', async () => {
    seed([event({ id: 'e1' })]);

    await useCalendar.getState().restoreDeleted();

    expect(recorded).toHaveLength(0);
  });

  it('puts the whole group back in the trash when the write is rejected', async () => {
    seed([event({ id: 'e1' }), event({ id: 'e2' })]);
    await useCalendar.getState().deleteEvents(['e1', 'e2']);
    shouldFail = true;

    await useCalendar.getState().restoreDeleted();

    expect(useCalendar.getState().deleted).toHaveLength(2);
    expect(useCalendar.getState().events).toHaveLength(0);
    expect(useCalendar.getState().error).toBe('write rejected');
  });
});

/**
 * The one hard delete left in the app.
 *
 * Everything else is reversible, so this is the only path that can lose data —
 * which is why it is also the only one that takes the exceptions with it, and
 * why the test asserts the statement type rather than just the state.
 */
describe('purging the trash', () => {
  it('removes one entry for good, exceptions and all', async () => {
    seed([event({ id: 'e1' }), event({ id: 'e2' })]);
    useCalendar.setState({
      overrides: [
        { id: 'o1', eventId: 'e1', occurrenceDate: '2026-08-17', cancelled: true, patch: {} },
        { id: 'o2', eventId: 'e2', occurrenceDate: '2026-08-17', cancelled: true, patch: {} },
      ],
    });
    await useCalendar.getState().deleteEvents(['e1', 'e2']);

    await useCalendar.getState().purgeDeleted('e1');

    expect(useCalendar.getState().deleted.map((e) => e.id)).toEqual(['e2']);
    expect(useCalendar.getState().overrides.map((o) => o.id)).toEqual(['o2']);
    expect(callsOn('events', 'delete')).toHaveLength(1);
  });

  it('empties the whole trash in one statement', async () => {
    seed([event({ id: 'e1' }), event({ id: 'e2' })]);
    await useCalendar.getState().deleteEvents(['e1', 'e2']);

    await useCalendar.getState().purgeDeleted();

    expect(useCalendar.getState().deleted).toHaveLength(0);
    expect(callsOn('events', 'delete')).toHaveLength(1);
  });

  it('puts the entries back when the purge is rejected', async () => {
    seed([event({ id: 'e1' })]);
    await useCalendar.getState().deleteEvent('e1');
    shouldFail = true;

    await useCalendar.getState().purgeDeleted('e1');

    expect(useCalendar.getState().deleted).toHaveLength(1);
    expect(useCalendar.getState().error).toBe('write rejected');
  });
});

// ---------------------------------------------------------------------- load

describe('loading', () => {
  it('splits live rows from deleted ones', async () => {
    stored.events = [
      row({ id: 'e1' }),
      row({ id: 'e2', deleted_at: '2026-07-30T10:00:00.000Z' }),
      row({ id: 'e3', deleted_at: '2026-07-31T10:00:00.000Z' }),
    ];

    await useCalendar.getState().load();

    expect(useCalendar.getState().events.map((e) => e.id)).toEqual(['e1']);
    // Newest first, so the trash reads the way the toast does.
    expect(useCalendar.getState().deleted.map((e) => e.id)).toEqual(['e3', 'e2']);
    expect(useCalendar.getState().status).toBe('ready');
  });

  /**
   * Retention, without which the trash is a second copy of the calendar that
   * nobody ever looks at. Thirty days is stated in the empty state, so it has
   * to be true.
   */
  it('hard-deletes anything past thirty days, and shows nothing older', async () => {
    const old = new Date(Date.now() - 31 * 86400_000).toISOString();
    const recent = new Date(Date.now() - 2 * 86400_000).toISOString();
    stored.events = [row({ id: 'e1', deleted_at: old }), row({ id: 'e2', deleted_at: recent })];

    await useCalendar.getState().load();

    expect(useCalendar.getState().deleted.map((e) => e.id)).toEqual(['e2']);
    const prune = callsOn('events', 'delete')[0];
    expect(prune).toBeDefined();
    // Bounded by a `lt` on the stamp, which no live row can satisfy: its
    // `deleted_at` is null, and null compares to nothing.
    expect(prune.filters.some(([op, col]) => op === 'lt' && col === 'deleted_at')).toBe(true);
  });

  it('leaves the calendar alone when there is nothing old enough to prune', async () => {
    stored.events = [row({ id: 'e1' })];

    await useCalendar.getState().load();

    expect(callsOn('events', 'delete')).toHaveLength(0);
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

  /**
   * A timed entry running 18:00 to midnight covers two dates and one evening.
   * Pulling its trailing edge onto the first date leaves the dates equal, while
   * the clock still reads 18:00 to 00:00 — backwards, and the database rejects
   * it as such. Shortening the bar is what the drag asked for, so the end moves
   * to the last minute of the day it was dropped on and the evening keeps its
   * start.
   */
  it('shortens an evening onto its own day by ending it at 23:59', async () => {
    const e = timed('2026-08-02T22:00:00.000Z', '2026-08-03T04:00:00.000Z');
    seed([e]);

    await useCalendar
      .getState()
      .resizeOccurrence(timedOccurrence(e, '2026-08-02', '2026-08-03', 1080, 0), -1, 'end', 'series');

    // 23:59 in Toronto, which is UTC-4 in August.
    expect(useCalendar.getState().events[0].startsAt).toBe('2026-08-02T22:00:00.000Z');
    expect(useCalendar.getState().events[0].endsAt).toBe('2026-08-03T03:59:00.000Z');
  });

  /** The mirror: the leading edge lands on the end date and starts at 00:00. */
  it('starts an overnight at midnight when its leading edge lands on the end date', async () => {
    const e = timed('2026-08-02T22:00:00.000Z', '2026-08-04T09:00:00.000Z');
    seed([e]);

    await useCalendar
      .getState()
      .resizeOccurrence(timedOccurrence(e, '2026-08-02', '2026-08-04', 1080, 300), 2, 'start', 'series');

    expect(useCalendar.getState().events[0].startsAt).toBe('2026-08-04T04:00:00.000Z');
    expect(useCalendar.getState().events[0].endsAt).toBe('2026-08-04T09:00:00.000Z');
  });

  /**
   * The one drop clamping cannot rescue. An entry ending at exactly midnight
   * occupies none of the date it ends on, so starting it there would leave
   * 00:00 to 00:00 — nothing at all.
   */
  it('refuses a drop that would leave the entry with no length', async () => {
    const e = timed('2026-08-02T22:00:00.000Z', '2026-08-03T04:00:00.000Z');
    seed([e]);

    await useCalendar
      .getState()
      .resizeOccurrence(timedOccurrence(e, '2026-08-02', '2026-08-03', 1080, 0), 1, 'start', 'series');

    expect(useCalendar.getState().events[0].startsAt).toBe('2026-08-02T22:00:00.000Z');
    expect(recorded).toHaveLength(0);
  });

  /**
   * Clamping is for the collapse onto one date and nothing else. This drag
   * still leaves two dates, so the hours are none of its business.
   */
  it('leaves the clock alone while the dates stay apart', async () => {
    const e = timed('2026-08-02T22:00:00.000Z', '2026-08-05T09:00:00.000Z');
    seed([e]);

    await useCalendar
      .getState()
      .resizeOccurrence(timedOccurrence(e, '2026-08-02', '2026-08-05', 1080, 300), -2, 'end', 'series');

    expect(useCalendar.getState().events[0].startsAt).toBe('2026-08-02T22:00:00.000Z');
    expect(useCalendar.getState().events[0].endsAt).toBe('2026-08-03T09:00:00.000Z');
  });

  /**
   * The same collapse onto one date, but the clock survives it: 05:30 to 11:19
   * still reads forwards. This is the case the check must not sweep up with the
   * one above.
   */
  it('still shortens an overnight whose hours survive the collapse', async () => {
    const e = timed('2026-08-02T09:30:00.000Z', '2026-08-03T15:19:00.000Z');
    seed([e]);

    await useCalendar
      .getState()
      .resizeOccurrence(timedOccurrence(e, '2026-08-02', '2026-08-03', 330, 679), -1, 'end', 'series');

    expect(useCalendar.getState().events[0].startsAt).toBe('2026-08-02T09:30:00.000Z');
    expect(useCalendar.getState().events[0].endsAt).toBe('2026-08-02T15:19:00.000Z');
  });
});

// ------------------------------------------------------- resizing a selection

describe('resizing a selection', () => {
  it('gives every entry the same number of extra days', async () => {
    const a = event({ id: 'e1', startDate: '2026-08-10', endDate: '2026-08-12' });
    const b = event({ id: 'e2', startDate: '2026-08-20', endDate: '2026-08-20' });
    const c = event({ id: 'e3', startDate: '2026-09-01', endDate: '2026-09-08' });
    seed([a, b, c]);

    await useCalendar
      .getState()
      .resizeOccurrences(
        [
          occurrenceOf(a, '2026-08-10', '2026-08-12'),
          occurrenceOf(b, '2026-08-20'),
          occurrenceOf(c, '2026-09-01', '2026-09-08'),
        ],
        3,
        'end',
        'series',
      );

    const spans = useCalendar.getState().events.map((e) => [e.startDate, e.endDate]);
    expect(spans).toEqual([
      // Every start where it was; every end three days later.
      ['2026-08-10', '2026-08-15'],
      ['2026-08-20', '2026-08-23'],
      ['2026-09-01', '2026-09-11'],
    ]);
  });

  it('pulls every leading edge by the shared delta', async () => {
    const a = event({ id: 'e1', startDate: '2026-08-10', endDate: '2026-08-12' });
    const b = event({ id: 'e2', startDate: '2026-08-20', endDate: '2026-08-24' });
    seed([a, b]);

    await useCalendar
      .getState()
      .resizeOccurrences(
        [occurrenceOf(a, '2026-08-10', '2026-08-12'), occurrenceOf(b, '2026-08-20', '2026-08-24')],
        -2,
        'start',
        'series',
      );

    const spans = useCalendar.getState().events.map((e) => [e.startDate, e.endDate]);
    expect(spans).toEqual([
      ['2026-08-08', '2026-08-12'],
      ['2026-08-18', '2026-08-24'],
    ]);
  });

  it('lands the whole group under one undo step', async () => {
    const a = event({ id: 'e1', startDate: '2026-08-10', endDate: '2026-08-12' });
    const b = event({ id: 'e2', startDate: '2026-08-20', endDate: '2026-08-20' });
    seed([a, b]);

    await useCalendar
      .getState()
      .resizeOccurrences(
        [occurrenceOf(a, '2026-08-10', '2026-08-12'), occurrenceOf(b, '2026-08-20')],
        4,
        'end',
        'series',
      );

    // One gesture, however many rows it reached.
    expect(useCalendar.getState().undoStack).toHaveLength(1);
    expect(useCalendar.getState().undoStack[0].label).toBe('Resized 2 entries');

    await useCalendar.getState().undo();

    const spans = useCalendar.getState().events.map((e) => [e.startDate, e.endDate]);
    expect(spans).toEqual([
      ['2026-08-10', '2026-08-12'],
      ['2026-08-20', '2026-08-20'],
    ]);
  });

  it('records the reason as a resize, not a move', async () => {
    const a = event({ id: 'e1', startDate: '2026-08-10', endDate: '2026-08-12' });
    seed([a]);

    await useCalendar
      .getState()
      .resizeOccurrences([occurrenceOf(a, '2026-08-10', '2026-08-12')], 2, 'end', 'series');

    expect(
      callsOn('event_versions', 'insert').map((c) => (c.payload as { reason: string }).reason),
    ).toEqual(['resize']);
  });

  it('leaves a read-only entry alone without holding up the rest', async () => {
    const mine = event({ id: 'e1', startDate: '2026-08-10', endDate: '2026-08-12' });
    const theirs = event({ id: 'e2', startDate: '2026-08-20', endDate: '2026-08-22', source: 'google' });
    seed([mine, theirs]);

    await useCalendar
      .getState()
      .resizeOccurrences(
        [
          occurrenceOf(mine, '2026-08-10', '2026-08-12'),
          occurrenceOf(theirs, '2026-08-20', '2026-08-22'),
        ],
        3,
        'end',
        'series',
      );

    const spans = useCalendar.getState().events.map((e) => [e.startDate, e.endDate]);
    expect(spans).toEqual([
      ['2026-08-10', '2026-08-15'],
      ['2026-08-20', '2026-08-22'],
    ]);
  });

  it('drops an entry the delta would turn inside out rather than refusing the group', async () => {
    const long = event({ id: 'e1', startDate: '2026-08-10', endDate: '2026-08-20' });
    const short = event({ id: 'e2', startDate: '2026-08-01', endDate: '2026-08-01' });
    seed([long, short]);

    // The grid clamps before it gets here, so this is the store having the last
    // word: a one-day bar has nothing to give, and it says so on its own.
    await useCalendar
      .getState()
      .resizeOccurrences(
        [occurrenceOf(long, '2026-08-10', '2026-08-20'), occurrenceOf(short, '2026-08-01')],
        -4,
        'end',
        'series',
      );

    const spans = useCalendar.getState().events.map((e) => [e.startDate, e.endDate]);
    expect(spans).toEqual([
      ['2026-08-10', '2026-08-16'],
      ['2026-08-01', '2026-08-01'],
    ]);
  });

  it('writes one row for a series, however many of its instances are selected', async () => {
    const e = event({
      id: 'e1',
      startDate: '2026-08-10',
      endDate: '2026-08-10',
      recurrence: { freq: 'WEEKLY' },
    });
    seed([e]);

    await useCalendar
      .getState()
      .resizeOccurrences(
        [occurrenceOf(e, '2026-08-17'), occurrenceOf(e, '2026-08-10')],
        2,
        'end',
        'series',
      );

    // The earliest instance settles it, whatever order the selection arrived in.
    expect(useCalendar.getState().events[0].endDate).toBe('2026-08-12');
    expect(useCalendar.getState().overrides).toHaveLength(0);
  });

  it('excepts each instance separately when the scope is one occurrence', async () => {
    const e = event({
      id: 'e1',
      startDate: '2026-08-10',
      endDate: '2026-08-10',
      recurrence: { freq: 'WEEKLY' },
    });
    seed([e]);

    await useCalendar
      .getState()
      .resizeOccurrences(
        [occurrenceOf(e, '2026-08-10'), occurrenceOf(e, '2026-08-17')],
        2,
        'end',
        'occurrence',
      );

    // The series itself is untouched; each selected instance gets an override
    // carrying the same two extra days.
    expect(useCalendar.getState().events[0].endDate).toBe('2026-08-10');
    expect(
      useCalendar
        .getState()
        .overrides.map((o) => [o.occurrenceDate, o.patch.startDate, o.patch.endDate]),
    ).toEqual([
      ['2026-08-10', '2026-08-10', '2026-08-12'],
      ['2026-08-17', '2026-08-17', '2026-08-19'],
    ]);
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
    // Skipping the only instance of a one-off is deleting it, which now means
    // the trash rather than the end — and it is recoverable from there.
    expect(useCalendar.getState().deleted.map((d) => d.id)).toEqual(['e1']);
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

// ------------------------------------------------------------------ versions

/**
 * History is bookkeeping, and bookkeeping that can break the thing it records
 * is worse than none.
 *
 * Two properties carry this whole section. A version is written from the shape
 * that existed *before* the edit — a version recording what you already have is
 * not a version of anything — and a version that fails to write costs you the
 * history, never the edit.
 */
describe('version capture', () => {
  const snapshotOf = (call: RecordedCall) =>
    (call.payload as { snapshot: { event: TempoEvent; overrides: unknown[] } }).snapshot;

  it('records the shape an edit replaced, exceptions included', async () => {
    seed([event({ id: 'e1', title: 'Before', startDate: '2026-08-10' })]);
    useCalendar.setState({
      overrides: [
        { id: 'o1', eventId: 'e1', occurrenceDate: '2026-08-17', cancelled: true, patch: {} },
        { id: 'o2', eventId: 'e2', occurrenceDate: '2026-08-17', cancelled: true, patch: {} },
      ],
    });

    await useCalendar.getState().updateEvent('e1', { title: 'After' });

    const version = lastCallOn('event_versions', 'insert')!;
    expect((version.payload as { reason: string }).reason).toBe('edit');
    // The old title, not the new one.
    expect(snapshotOf(version).event.title).toBe('Before');
    // Only this entry's exceptions, and the per-occurrence edits are exactly
    // what a version of the row alone would have missed.
    expect(snapshotOf(version).overrides).toHaveLength(1);
  });

  it('records a move, a resize, a status change and a delete under their own reasons', async () => {
    const e = event({ id: 'e1', startDate: '2026-08-10', endDate: '2026-08-12' });
    seed([e]);

    await useCalendar.getState().moveOccurrence(occurrenceOf(e, '2026-08-10', '2026-08-12'), 1, 'series');
    await useCalendar
      .getState()
      .resizeOccurrence(occurrenceOf(e, '2026-08-10', '2026-08-12'), 1, 'end', 'series');
    await useCalendar.getState().setStatus(occurrenceOf(e, '2026-08-10'), 'done');
    await useCalendar.getState().deleteEvent('e1');

    expect(
      callsOn('event_versions', 'insert').map((c) => (c.payload as { reason: string }).reason),
    ).toEqual(['move', 'resize', 'status', 'delete']);
  });

  it('records one version per entry a bulk delete takes', async () => {
    seed([event({ id: 'e1' }), event({ id: 'e2' }), event({ id: 'e3' })]);

    await useCalendar.getState().deleteEvents(['e1', 'e2']);

    const written = callsOn('event_versions', 'insert').map(
      (c) => (c.payload as { event_id: string }).event_id,
    );
    expect(written.sort()).toEqual(['e1', 'e2']);
  });

  /**
   * The test that protects everyone who has not run the migration.
   *
   * Without it, a missing `event_versions` table makes every edit in the app
   * appear to fail and roll itself back.
   */
  it('leaves the edit applied when the history write fails', async () => {
    seed([event({ id: 'e1', title: 'Before' })]);
    failing.add('event_versions');

    await useCalendar.getState().updateEvent('e1', { title: 'After' });

    expect(useCalendar.getState().events[0].title).toBe('After');
    expect(useCalendar.getState().error).toBeNull();
  });

  it('writes no version for an edit the store refuses to make', async () => {
    const theirs = event({ source: 'google' });
    seed([theirs]);

    await useCalendar.getState().moveOccurrence(occurrenceOf(theirs, '2026-08-10'), 3, 'series');

    expect(callsOn('event_versions', 'insert')).toHaveLength(0);
  });
});

describe('rolling back to a version', () => {
  const versionRow = (over: Record<string, unknown> = {}) => ({
    id: 'v1',
    owner_id: 'owner-1',
    event_id: 'e1',
    reason: 'edit',
    created_at: '2026-08-01T10:00:00.000Z',
    snapshot: {
      event: event({ id: 'e1', title: 'Before', startDate: '2026-08-10', endDate: '2026-08-10' }),
      overrides: [],
    },
    ...over,
  });

  it('lists an entry’s versions, newest first', async () => {
    seed([event({ id: 'e1' })]);
    stored.event_versions = [
      versionRow({ id: 'v2', created_at: '2026-08-02T10:00:00.000Z' }),
      versionRow({ id: 'v1' }),
    ];

    await useCalendar.getState().loadVersions('e1');

    expect(useCalendar.getState().versions.map((v) => v.id)).toEqual(['v2', 'v1']);
    expect(useCalendar.getState().versionsFor).toBe('e1');
  });

  it('drops a version whose snapshot cannot be read rather than offering it', async () => {
    seed([event({ id: 'e1' })]);
    stored.event_versions = [versionRow({ id: 'v1', snapshot: { event: { id: 'e1' } } })];

    await useCalendar.getState().loadVersions('e1');

    // A version that cannot be rolled back to is a button that does not work.
    expect(useCalendar.getState().versions).toHaveLength(0);
  });

  it('puts the recorded shape back', async () => {
    seed([event({ id: 'e1', title: 'After', startDate: '2026-08-20', endDate: '2026-08-20' })]);
    stored.event_versions = [versionRow()];
    await useCalendar.getState().loadVersions('e1');

    await useCalendar.getState().rollbackTo('v1');

    const back = useCalendar.getState().events[0];
    expect(back.title).toBe('Before');
    expect(back.startDate).toBe('2026-08-10');
  });

  /**
   * The half that a naive "write the snapshot back" gets wrong: an exception
   * created *after* the version has to go, or the series comes back to its old
   * shape still carrying an instance it never had.
   */
  it('removes an exception created after the version it targets', async () => {
    seed([event({ id: 'e1', recurrence: { freq: 'WEEKLY' } })]);
    useCalendar.setState({
      overrides: [
        { id: 'o-new', eventId: 'e1', occurrenceDate: '2026-08-17', cancelled: true, patch: {} },
        { id: 'o-other', eventId: 'e2', occurrenceDate: '2026-08-17', cancelled: true, patch: {} },
      ],
    });
    stored.event_versions = [versionRow()];
    await useCalendar.getState().loadVersions('e1');

    await useCalendar.getState().rollbackTo('v1');

    expect(useCalendar.getState().overrides.map((o) => o.id)).toEqual(['o-other']);
    expect(callsOn('occurrence_overrides', 'delete')).toHaveLength(1);
  });

  it('snapshots the rollback itself, so an undo can be undone', async () => {
    seed([event({ id: 'e1', title: 'After' })]);
    stored.event_versions = [versionRow()];
    await useCalendar.getState().loadVersions('e1');

    await useCalendar.getState().rollbackTo('v1');

    const written = callsOn('event_versions', 'insert');
    expect(written).toHaveLength(1);
    // The shape being left behind, not the one being restored.
    expect(
      (written[0].payload as { snapshot: { event: TempoEvent } }).snapshot.event.title,
    ).toBe('After');
  });

  it('brings a deleted entry back when its version is restored', async () => {
    seed([event({ id: 'e1' })]);
    await useCalendar.getState().deleteEvent('e1');
    stored.event_versions = [versionRow()];
    await useCalendar.getState().loadVersions('e1');

    await useCalendar.getState().rollbackTo('v1');

    // Rolling back to a shape that was alive is a restore. Leaving it in the
    // trash would apply an edit nobody could see.
    expect(useCalendar.getState().events.map((e) => e.id)).toEqual(['e1']);
    expect(useCalendar.getState().deleted).toHaveLength(0);
  });
});

// ----------------------------------------------------------------- live sync

/**
 * The same calendar, open in two places.
 *
 * The store is authoritative about what this device did and has to stay
 * *receptive* about what another one did, which is the whole difficulty: a
 * remote row arrives with no idea what is half-typed over here. The rule these
 * tests pin down is that an incoming row is merged by identity — never
 * appended, never assumed new — so the same change arriving twice cannot
 * produce two entries.
 */
describe('live sync', () => {
  const push = (table: string, payload: unknown) => handlers[table]?.(payload);

  it('subscribes once the owner is known, and stops on disconnect', () => {
    seed([]);

    useCalendar.getState().connect();
    expect(subscribed).toBe(true);

    useCalendar.getState().disconnect();
    expect(subscribed).toBe(false);
  });

  it('adds an entry another device created', () => {
    seed([]);
    useCalendar.getState().connect();

    push('events', { eventType: 'INSERT', new: row({ id: 'remote-1', title: 'From the laptop' }) });

    expect(useCalendar.getState().events.map((e) => e.title)).toEqual(['From the laptop']);
  });

  it('merges a repeat of the same row rather than duplicating it', () => {
    seed([]);
    useCalendar.getState().connect();

    push('events', { eventType: 'INSERT', new: row({ id: 'e1', title: 'Once' }) });
    push('events', { eventType: 'UPDATE', new: row({ id: 'e1', title: 'Twice' }) });

    // The socket redelivers, and an edit arrives as an UPDATE for a row this
    // device may never have seen inserted. Both have to land on one entry.
    expect(useCalendar.getState().events).toHaveLength(1);
    expect(useCalendar.getState().events[0].title).toBe('Twice');
  });

  it('moves an entry to the trash when another device deletes it', () => {
    seed([event({ id: 'e1' })]);
    useCalendar.getState().connect();

    push('events', {
      eventType: 'UPDATE',
      new: row({ id: 'e1', deleted_at: '2026-08-01T12:00:00.000Z' }),
    });

    // A soft delete crosses the wire as an UPDATE, not a DELETE. Treating it as
    // an ordinary edit would leave a deleted entry sitting on the grid.
    expect(useCalendar.getState().events).toHaveLength(0);
    expect(useCalendar.getState().deleted.map((e) => e.id)).toEqual(['e1']);
  });

  it('brings it back when another device restores it', () => {
    seed([event({ id: 'e1', deletedAt: '2026-08-01T12:00:00.000Z' })]);
    useCalendar.setState({ events: [], deleted: [event({ id: 'e1', deletedAt: '2026-08-01T12:00:00.000Z' })] });
    useCalendar.getState().connect();

    push('events', { eventType: 'UPDATE', new: row({ id: 'e1', deleted_at: null }) });

    expect(useCalendar.getState().events.map((e) => e.id)).toEqual(['e1']);
    expect(useCalendar.getState().deleted).toHaveLength(0);
  });

  it('drops an entry another device purged, and its exceptions with it', () => {
    seed([event({ id: 'e1' }), event({ id: 'e2' })]);
    useCalendar.setState({
      overrides: [
        { id: 'o1', eventId: 'e1', occurrenceDate: '2026-08-17', cancelled: true, patch: {} },
        { id: 'o2', eventId: 'e2', occurrenceDate: '2026-08-17', cancelled: true, patch: {} },
      ],
    });
    useCalendar.getState().connect();

    push('events', { eventType: 'DELETE', old: { id: 'e1' } });

    expect(useCalendar.getState().events.map((e) => e.id)).toEqual(['e2']);
    // The server cascaded them; this device has to as well, or the calendar
    // keeps exceptions pointing at a row that no longer exists.
    expect(useCalendar.getState().overrides.map((o) => o.id)).toEqual(['o2']);
  });

  it('merges an exception another device wrote', () => {
    seed([event({ id: 'e1', recurrence: { freq: 'WEEKLY' } })]);
    useCalendar.getState().connect();

    push('occurrence_overrides', {
      eventType: 'INSERT',
      new: {
        id: 'o1',
        owner_id: 'owner-1',
        event_id: 'e1',
        occurrence_date: '2026-08-17',
        cancelled: true,
        patch: {},
        created_at: '',
        updated_at: '',
      },
    });

    expect(useCalendar.getState().overrides).toHaveLength(1);
    expect(useCalendar.getState().overrides[0].cancelled).toBe(true);
  });

  it('ignores traffic once disconnected', () => {
    seed([]);
    useCalendar.getState().connect();
    useCalendar.getState().disconnect();

    push('events', { eventType: 'INSERT', new: row({ id: 'remote-1' }) });

    expect(useCalendar.getState().events).toHaveLength(0);
  });
});

// ------------------------------------------------------------- editing a draft

describe('saving an edited draft', () => {
  /**
   * The form speaks minutes from midnight and a row speaks instants, so an edit
   * that forwarded the draft straight to `updateEvent` wrote a patch with no
   * time in it at all — and succeeded, which is why nobody noticed. These assert
   * the conversion happens, not merely that the write went out.
   */
  it('converts a timed draft to instants rather than dropping the time', async () => {
    const e = event({ id: 'e1', allDay: false, startDate: null, endDate: null });
    seed([e]);

    await useCalendar.getState().updateEventFromDraft('e1', {
      title: 'Design review',
      kind: 'event',
      allDay: false,
      startDate: '2026-08-10',
      endDate: '2026-08-10',
      startMinutes: 16 * 60 + 45,
      endMinutes: 17 * 60 + 45,
    });

    const patch = lastCall('update')?.payload as Record<string, unknown>;
    // 16:45 in America/Toronto is 20:45Z while EDT is in force.
    expect(patch.starts_at).toBe('2026-08-10T20:45:00.000Z');
    expect(patch.ends_at).toBe('2026-08-10T21:45:00.000Z');
    expect(useCalendar.getState().events[0].startsAt).toBe('2026-08-10T20:45:00.000Z');
  });

  it('clears the instants when a draft turns all-day, and vice versa', async () => {
    const e = event({ id: 'e1', allDay: false, startDate: null, endDate: null });
    seed([e]);

    await useCalendar.getState().updateEventFromDraft('e1', {
      title: 'Montreal',
      kind: 'event',
      allDay: true,
      startDate: '2026-08-10',
      endDate: '2026-08-12',
    });

    const patch = lastCall('update')?.payload as Record<string, unknown>;
    expect(patch.starts_at).toBeNull();
    expect(patch.ends_at).toBeNull();
    expect(patch.start_date).toBe('2026-08-10');
    expect(patch.end_date).toBe('2026-08-12');
  });

  it('does not leak the draft-only minute fields into the row', async () => {
    seed([event({ id: 'e1', allDay: false, startDate: null, endDate: null })]);

    await useCalendar.getState().updateEventFromDraft('e1', {
      title: 'Standup',
      kind: 'event',
      allDay: false,
      startDate: '2026-08-10',
      endDate: '2026-08-10',
      startMinutes: 9 * 60,
      endMinutes: 9 * 60 + 30,
    });

    const patch = lastCall('update')?.payload as Record<string, unknown>;
    expect(patch).not.toHaveProperty('startMinutes');
    expect(patch).not.toHaveProperty('endMinutes');
  });
});

// ------------------------------------------------------------------- undo

describe('undo', () => {
  /**
   * The stack is the one mechanism behind every action's inverse, so these test
   * the reconciler through the store rather than the store's own bookkeeping:
   * what matters is that the calendar comes back, whatever moved it.
   */
  it('puts a moved event back', async () => {
    const e = event({ startDate: '2026-08-10', endDate: '2026-08-10' });
    useCalendar.setState({ ownerId: 'owner-1', events: [e], undoStack: [] });

    await useCalendar.getState().moveOccurrence(occurrenceOf(e, '2026-08-10'), 5, 'series');
    expect(useCalendar.getState().events[0].startDate).toBe('2026-08-15');

    await useCalendar.getState().undo();
    expect(useCalendar.getState().events[0].startDate).toBe('2026-08-10');
    expect(useCalendar.getState().undoStack).toHaveLength(0);
  });

  it('puts a resized event back', async () => {
    const e = event({ startDate: '2026-08-10', endDate: '2026-08-12' });
    useCalendar.setState({ ownerId: 'owner-1', events: [e], undoStack: [] });

    await useCalendar
      .getState()
      .resizeOccurrence(occurrenceOf(e, '2026-08-10', '2026-08-12'), 3, 'end', 'series');
    expect(useCalendar.getState().events[0].endDate).toBe('2026-08-15');

    await useCalendar.getState().undo();
    expect(useCalendar.getState().events[0].endDate).toBe('2026-08-12');
  });

  it('unwinds one action at a time, newest first', async () => {
    const e = event({ startDate: '2026-08-10', endDate: '2026-08-10' });
    useCalendar.setState({ ownerId: 'owner-1', events: [e], undoStack: [] });

    await useCalendar.getState().moveOccurrence(occurrenceOf(e, '2026-08-10'), 1, 'series');
    const once = useCalendar.getState().events[0];
    await useCalendar.getState().moveOccurrence(occurrenceOf(once, '2026-08-11'), 1, 'series');
    expect(useCalendar.getState().events[0].startDate).toBe('2026-08-12');

    await useCalendar.getState().undo();
    expect(useCalendar.getState().events[0].startDate).toBe('2026-08-11');
    await useCalendar.getState().undo();
    expect(useCalendar.getState().events[0].startDate).toBe('2026-08-10');
  });

  /** A delete is an update now, so its undo is one too — no special case. */
  it('takes an entry back out of the trash', async () => {
    const e = event({ id: 'e1' });
    useCalendar.setState({ ownerId: 'owner-1', events: [e], deleted: [], undoStack: [] });

    await useCalendar.getState().deleteEvent('e1');
    expect(useCalendar.getState().events).toHaveLength(0);
    expect(useCalendar.getState().deleted).toHaveLength(1);

    await useCalendar.getState().undo();
    expect(useCalendar.getState().events).toHaveLength(1);
    expect(useCalendar.getState().deleted).toHaveLength(0);
  });

  it('removes an entry that undo says was never created', async () => {
    useCalendar.setState({ ownerId: 'owner-1', events: [], undoStack: [] });

    await useCalendar.getState().createEvent({
      title: 'New',
      kind: 'event',
      allDay: true,
      startDate: '2026-08-10',
      endDate: '2026-08-10',
    });
    expect(useCalendar.getState().events).toHaveLength(1);

    await useCalendar.getState().undo();
    expect(useCalendar.getState().events).toHaveLength(0);
  });

  /** A write the server refused has nothing to take back. */
  it('records nothing when the write fails', async () => {
    const e = event({ startDate: '2026-08-10' });
    useCalendar.setState({ ownerId: 'owner-1', events: [e], undoStack: [] });

    shouldFail = true;
    await useCalendar.getState().moveOccurrence(occurrenceOf(e, '2026-08-10'), 5, 'series');
    shouldFail = false;

    expect(useCalendar.getState().undoStack).toHaveLength(0);
    expect(useCalendar.getState().events[0].startDate).toBe('2026-08-10');
  });

  it('keeps the entry when the undo itself fails, so it can be retried', async () => {
    const e = event({ startDate: '2026-08-10' });
    useCalendar.setState({ ownerId: 'owner-1', events: [e], undoStack: [] });
    await useCalendar.getState().moveOccurrence(occurrenceOf(e, '2026-08-10'), 5, 'series');

    shouldFail = true;
    await useCalendar.getState().undo();
    shouldFail = false;

    expect(useCalendar.getState().undoStack).toHaveLength(1);
  });

  it('does nothing on an empty stack', async () => {
    useCalendar.setState({ ownerId: 'owner-1', events: [], undoStack: [] });
    await expect(useCalendar.getState().undo()).resolves.toBeUndefined();
  });

  it('evicts the oldest past the cap', async () => {
    const e = event({ startDate: '2026-08-10' });
    useCalendar.setState({ ownerId: 'owner-1', events: [e], undoStack: [] });

    for (let i = 0; i < 55; i++) {
      const current = useCalendar.getState().events[0];
      await useCalendar
        .getState()
        .moveOccurrence(occurrenceOf(current, current.startDate!), 1, 'series');
    }
    expect(useCalendar.getState().undoStack).toHaveLength(50);
  });
});

describe('actions that changed nothing', () => {
  /**
   * Opening an entry and clicking away is the commonest gesture in the app, and
   * the form commits unconditionally because it cannot tell the difference. So
   * the store has to: an action that moved no row is not an action, and offering
   * to take it back names a change the calendar never made — most visibly right
   * after an undo, where the toast reads as the undo having been reversed.
   */
  it('offers no undo for a draft identical to the entry', async () => {
    const e = event({ title: 'Standup', startDate: '2026-08-10', endDate: '2026-08-10' });
    seed([e]);

    await useCalendar.getState().updateEventFromDraft('e1', {
      title: 'Standup',
      kind: 'event',
      allDay: true,
      startDate: '2026-08-10',
      endDate: '2026-08-10',
      categoryId: null,
      recurrence: null,
      reminders: [],
      anchorDate: null,
      displayTemplate: null,
      notes: null,
    });

    expect(useCalendar.getState().undoStack).toHaveLength(0);
    // Nor a write, nor a version: a no-op edit is not history either.
    expect(callsOn('events', 'update')).toHaveLength(0);
    expect(callsOn('event_versions', 'insert')).toHaveLength(0);
  });

  /**
   * A timed entry's instants are stored, not derived, so this only works if the
   * store holds them in one canonical spelling — the database's `+00:00` and
   * `toISOString`'s `Z` are the same moment and must compare as one.
   */
  it('offers no undo for an unchanged timed entry loaded from the server', async () => {
    // `load()` fills the calendar but does not clear the stack, which is the
    // session's and outlives a reload.
    seed([]);
    stored.events = [
      row({
        all_day: false,
        starts_at: '2026-08-10T13:00:00+00:00',
        ends_at: '2026-08-10T14:00:00+00:00',
        start_date: null,
        end_date: null,
      }),
    ];
    await useCalendar.getState().load();
    recorded.length = 0;

    await useCalendar.getState().updateEventFromDraft('e1', {
      title: 'Thing',
      kind: 'event',
      allDay: false,
      startDate: '2026-08-10',
      endDate: '2026-08-10',
      startMinutes: 9 * 60,
      endMinutes: 10 * 60,
      categoryId: null,
      recurrence: null,
      reminders: [],
      anchorDate: null,
      displayTemplate: null,
      notes: null,
    });

    expect(useCalendar.getState().undoStack).toHaveLength(0);
    expect(callsOn('events', 'update')).toHaveLength(0);
  });

  it('still offers one when a single field moved', async () => {
    const e = event({ title: 'Standup', startDate: '2026-08-10', endDate: '2026-08-10' });
    seed([e]);

    await useCalendar.getState().updateEventFromDraft('e1', {
      title: 'Standup',
      kind: 'event',
      allDay: true,
      startDate: '2026-08-10',
      endDate: '2026-08-10',
      categoryId: null,
      recurrence: null,
      reminders: [],
      anchorDate: null,
      displayTemplate: null,
      notes: 'a thought',
    });

    expect(useCalendar.getState().undoStack).toHaveLength(1);
  });

  /**
   * The guard belongs to `optimistic`, not to any one action, so it holds for
   * every gesture that lands on the same value — here, skipping an instance
   * that is already skipped.
   */
  it('offers no undo for an override that says what the override already said', async () => {
    const e = event({ id: 'e1', recurrence: { freq: 'DAILY', interval: 1 } });
    seed([e]);

    await useCalendar.getState().cancelOccurrence(occurrenceOf(e, '2026-08-10'));
    expect(useCalendar.getState().undoStack).toHaveLength(1);

    const again = useCalendar.getState().overrides[0];
    await useCalendar.getState().cancelOccurrence(occurrenceOf(e, '2026-08-10'));

    expect(useCalendar.getState().overrides[0]).toEqual(again);
    expect(useCalendar.getState().undoStack).toHaveLength(1);
  });
});

describe('undo labels', () => {
  it('labels a move by the gesture, not by the method that wrote it', async () => {
    const e = event({ title: 'Standup', startDate: '2026-08-10' });
    useCalendar.setState({ ownerId: 'owner-1', events: [e], undoStack: [] });

    await useCalendar.getState().moveOccurrence(occurrenceOf(e, '2026-08-10'), 1, 'series');
    expect(useCalendar.getState().undoStack[0].label).toBe('Moved Standup');
  });

  it('labels a bulk delete by its size', async () => {
    const a = event({ id: 'a' });
    const b = event({ id: 'b' });
    useCalendar.setState({ ownerId: 'owner-1', events: [a, b], deleted: [], undoStack: [] });

    await useCalendar.getState().deleteEvents(['a', 'b']);
    expect(useCalendar.getState().undoStack[0].label).toBe('Deleted 2 entries');
  });
});
