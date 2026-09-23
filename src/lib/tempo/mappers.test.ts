import { describe, expect, it } from 'vitest';
import type { EventRow, EventVersionRow } from '@/lib/db/database.types';
import { eventFromRow, eventToRow, parsePatch, toPortable, versionFromRow } from './mappers';

function row(over: Partial<EventRow> = {}): EventRow {
  return {
    id: 'e1',
    owner_id: 'u1',
    title: 'Reading response',
    notes: null,
    kind: 'event',
    category_id: null,
    all_day: true,
    starts_at: null,
    ends_at: null,
    start_date: '2026-09-21',
    end_date: '2026-09-21',
    due_minutes: null,
    timezone: 'America/Toronto',
    recurrence: null,
    reminders: null,
    anchor_date: null,
    display_template: null,
    status: null,
    notify: false,
    timetable: false,
    source: 'tempo',
    google_calendar_id: null,
    google_event_id: null,
    google_sync_hash: null,
    google_synced_at: null,
    deleted_at: null,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

describe('a row written as a task', () => {
  it('reads as an entry, with no status', () => {
    const e = eventFromRow(row({ kind: 'assignment', status: 'doing' }));
    expect(e.kind).toBe('event');
    expect(e).not.toHaveProperty('status');
  });

  it('leaves the other kinds alone', () => {
    expect(eventFromRow(row({ kind: 'birthday' })).kind).toBe('birthday');
    expect(eventFromRow(row({ kind: 'milestone' })).kind).toBe('milestone');
  });
});

describe('an exception written with a status', () => {
  it('keeps what it moved and drops the status', () => {
    expect(parsePatch({ startDate: '2026-09-22', status: 'done' })).toEqual({
      startDate: '2026-09-22',
    });
  });
});

describe('a version of a task', () => {
  it('still parses, as an entry', () => {
    const event = { ...eventFromRow(row()), kind: 'assignment', status: 'todo' };
    const version: EventVersionRow = {
      id: 'v1',
      owner_id: 'u1',
      event_id: 'e1',
      reason: 'status',
      snapshot: { event, overrides: [] } as never,
      created_at: '',
    };
    const parsed = versionFromRow(version);
    expect(parsed?.snapshot.event.kind).toBe('event');
    expect(parsed?.snapshot.event).not.toHaveProperty('status');
    expect(parsed?.reason).toBe('status');
  });
});

describe('the timetable flag', () => {
  it('reads as false on a row written before the column existed', () => {
    // `add column ... default false` backfills, but a client can be newer than
    // the database it is pointed at, and then the key is simply absent.
    const bare = row();
    delete (bare as Partial<EventRow>).timetable;
    expect(eventFromRow(bare).timetable).toBe(false);
  });

  it('reads as true when the row says so', () => {
    expect(eventFromRow(row({ timetable: true })).timetable).toBe(true);
  });

  it('is carried back to the row', () => {
    expect(eventToRow({ timetable: true }).timetable).toBe(true);
    expect(eventToRow({ timetable: false }).timetable).toBe(false);
  });

  it('is left alone by a patch that does not mention it', () => {
    expect('timetable' in eventToRow({ title: 'Renamed' })).toBe(false);
  });

  it('is exported only when it is true', () => {
    // The export is read inside a frontmatter block, so a key that is false on
    // every ordinary entry is noise in every ordinary entry.
    const plain = eventFromRow(row());
    expect('timetable' in toPortable(plain)).toBe(false);

    const lecture = eventFromRow(row({ timetable: true }));
    expect(toPortable(lecture).timetable).toBe(true);
  });
});
