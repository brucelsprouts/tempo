import { describe, expect, it } from 'vitest';
import { canonicalReminders, defaultReminders } from '@/lib/tempo/reminders';
import {
  addRow,
  fitRow,
  remindersFromRows,
  rowContext,
  rowNotes,
  rowsFromReminders,
  type ReminderRow,
} from './reminder-rows';

const TZ = 'America/Toronto';

/** A row with every field filled, so a test states only what it is about. */
function row(over: Partial<ReminderRow>): ReminderRow {
  return { id: 0, when: 'dueDay', days: 1, at: 9 * 60, amount: 1, unit: 'hours', ...over };
}

describe('which rows an entry offers', () => {
  it('reads the context off the type and the all-day switch', () => {
    expect(rowContext('event', true)).toBe('allDay');
    expect(rowContext('milestone', true)).toBe('allDay');
    expect(rowContext('event', false)).toBe('timed');
    expect(rowContext('birthday', true)).toBe('birthday');
  });
});

describe('reading reminders into rows', () => {
  it('reads the three all-day defaults as start day, a day before due, and due day', () => {
    const rows = rowsFromReminders(defaultReminders('event', true, false), 'allDay');
    expect(rows.map((r) => [r.when, r.days, r.at])).toEqual([
      ['startDay', 0, 540],
      ['daysBeforeDue', 1, 540],
      ['dueDay', 0, 540],
    ]);
  });

  it('reads a timed entry’s lead in its largest whole unit', () => {
    const rows = rowsFromReminders(
      [{ minutes: 60 }, { minutes: 30 }, { minutes: 2880 }, { minutes: 20160 }, { minutes: 0 }],
      'timed',
    );
    expect(rows.map((r) => [r.when, r.amount, r.unit])).toEqual([
      ['beforeDue', 1, 'hours'],
      ['beforeDue', 30, 'minutes'],
      ['beforeDue', 2, 'days'],
      ['beforeDue', 2, 'weeks'],
      ['beforeDue', 0, 'minutes'],
    ]);
  });

  it('reads an old all-day reminder as days before the start', () => {
    const [r] = rowsFromReminders([{ minutes: 2340 }], 'allDay');
    expect([r.when, r.days, r.at]).toEqual(['daysBeforeStart', 2, 540]);
  });

  it('reads a birthday’s five to midnight as the day before at 23:55', () => {
    const [r] = rowsFromReminders([{ minutes: 5 }], 'birthday');
    expect([r.when, r.days, r.at]).toEqual(['daysBeforeStart', 1, 23 * 60 + 55]);
  });

  it('reads a due-time lead on an all-day entry', () => {
    const [r] = rowsFromReminders([{ from: 'due', minutes: 90 }], 'allDay');
    expect([r.when, r.amount, r.unit]).toEqual(['beforeDue', 90, 'minutes']);
  });

  it('gives every row its own id', () => {
    const rows = rowsFromReminders(defaultReminders('event', true, false), 'allDay');
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
  });
});

describe('writing rows back', () => {
  it('round-trips every default', () => {
    for (const [kind, allDay, repeats] of [
      ['event', true, false],
      ['event', false, false],
      ['event', true, true],
      ['event', false, true],
      ['birthday', true, true],
    ] as const) {
      const reminders = defaultReminders(kind, allDay, repeats);
      const ctx = rowContext(kind, allDay);
      expect(remindersFromRows(rowsFromReminders(reminders, ctx), ctx)).toEqual(
        canonicalReminders(reminders),
      );
    }
  });

  it('writes a timed lead the way reminders on timed entries have always been stored', () => {
    expect(remindersFromRows([row({ when: 'beforeDue', amount: 30, unit: 'minutes' })], 'timed')).toEqual(
      [{ minutes: 30 }],
    );
  });

  it('writes an all-day lead as counting from the due time', () => {
    expect(remindersFromRows([row({ when: 'beforeDue', amount: 2, unit: 'hours' })], 'allDay')).toEqual([
      { from: 'due', minutes: 120 },
    ]);
  });

  it('writes a day and a time as minutes before that day’s midnight', () => {
    expect(
      remindersFromRows(
        [
          row({ when: 'startDay', at: 8 * 60 }),
          row({ when: 'daysBeforeDue', days: 3, at: 18 * 60 }),
        ],
        'allDay',
      ),
    ).toEqual([{ minutes: -480 }, { from: 'dueDay', minutes: 3 * 1440 - 18 * 60 }]);
  });

  it('comes out in the order a stored list reads back in, so an untouched form is unchanged', () => {
    const rows = [
      row({ id: 1, when: 'dueDay' }),
      row({ id: 2, when: 'startDay' }),
      row({ id: 3, when: 'daysBeforeDue', days: 1 }),
    ];
    expect(remindersFromRows(rows, 'allDay')).toEqual(defaultReminders('event', true, false));
  });

  it('drops a duplicate, and anything the dispatcher would not send', () => {
    expect(
      remindersFromRows(
        [
          row({ id: 1, when: 'dueDay' }),
          row({ id: 2, when: 'dueDay' }),
          row({ id: 3, when: 'beforeDue', amount: 5, unit: 'weeks' }),
        ],
        'allDay',
      ),
    ).toEqual([{ from: 'dueDay', minutes: -540 }]);
  });
});

describe('fitting a row to the entry it is on', () => {
  it('puts a start-day row on the one day a timed entry has', () => {
    expect(fitRow(row({ when: 'startDay' }), 'timed').when).toBe('dueDay');
    expect(fitRow(row({ when: 'daysBeforeStart' }), 'timed').when).toBe('daysBeforeDue');
  });

  it('turns a birthday’s lead into the day and time it lands on', () => {
    const r = fitRow(row({ when: 'beforeDue', amount: 5, unit: 'minutes' }), 'birthday');
    expect([r.when, r.days, r.at]).toEqual(['daysBeforeStart', 1, 23 * 60 + 55]);
  });

  it('leaves an all-day row alone', () => {
    const r = row({ when: 'daysBeforeStart', days: 2 });
    expect(fitRow(r, 'allDay')).toBe(r);
  });
});

describe('adding a row', () => {
  it('adds an hour before on an entry that has none', () => {
    const [added] = addRow([], 'timed');
    expect([added.when, added.amount, added.unit]).toEqual(['beforeDue', 1, 'hours']);
  });

  it('adds something not already there, with an id of its own', () => {
    const rows = rowsFromReminders(defaultReminders('event', false, false), 'timed');
    const next = addRow(rows, 'timed');
    const added = next[next.length - 1];

    expect(next).toHaveLength(rows.length + 1);
    expect(rows.some((r) => r.id === added.id)).toBe(false);
    expect(new Set(remindersFromRows(next, 'timed')).size).toBe(next.length);
  });
});

describe('what a row says under itself', () => {
  const oneDay = {
    allDay: true,
    startDate: '2026-07-15',
    endDate: '2026-07-15',
    startMinutes: 540,
    endMinutes: 600,
  };

  it('says when two rows land on one moment, on the one not sent', () => {
    const rows = rowsFromReminders(defaultReminders('event', true, false), 'allDay');
    const notes = rowNotes(rows, 'allDay', oneDay, null, TZ);

    expect(notes.get(rows[0].id)).toEqual({ text: 'SAME MOMENT AS ANOTHER — SENT ONCE.', warn: false });
    expect(notes.get(rows[1].id)).toBeUndefined();
    expect(notes.get(rows[2].id)).toBeUndefined();
  });

  it('says nothing about it once the entry is stretched', () => {
    const rows = rowsFromReminders(defaultReminders('event', true, false), 'allDay');
    const notes = rowNotes(rows, 'allDay', { ...oneDay, endDate: '2026-07-17' }, null, TZ);

    expect(notes.size).toBe(0);
  });

  it('says when a reminder would land after the deadline', () => {
    const rows = [row({ id: 7, when: 'dueDay', at: 9 * 60 })];
    const notes = rowNotes(rows, 'allDay', oneDay, 7 * 60, TZ);

    expect(notes.get(7)).toEqual({ text: 'AFTER IT’S DUE — SENT AN HOUR BEFORE.', warn: true });
  });

  it('says it the timed way on an entry with a time', () => {
    const rows = [row({ id: 7, when: 'dueDay', at: 9 * 60 })];
    const notes = rowNotes(rows, 'timed', { ...oneDay, allDay: false, startMinutes: 7 * 60 }, null, TZ);

    expect(notes.get(7)?.text).toBe('AFTER IT STARTS — SENT AN HOUR BEFORE.');
  });

  it('says when a row is out of range, or a copy of another', () => {
    const rows = [
      row({ id: 1, when: 'beforeDue', amount: 5, unit: 'weeks' }),
      row({ id: 2, when: 'daysBeforeDue', days: 30 }),
      row({ id: 3, when: 'dueDay' }),
      row({ id: 4, when: 'dueDay' }),
    ];
    const notes = rowNotes(rows, 'allDay', { ...oneDay, endDate: '2026-09-15' }, null, TZ);

    expect(notes.get(1)?.text).toBe('UP TO 4 WEEKS BEFORE.');
    expect(notes.get(2)?.text).toBe('UP TO 28 DAYS BEFORE.');
    expect(notes.get(3)).toBeUndefined();
    expect(notes.get(4)?.text).toBe('SAME AS ANOTHER REMINDER.');
  });
});
