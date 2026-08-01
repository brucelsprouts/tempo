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
