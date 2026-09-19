'use client';

import { CalendarShell } from '@/components/calendar/CalendarShell';
import { useCalendar } from '@/lib/store/calendar-store';
import {
  addDays,
  instantFromCivil,
  startOfMonth,
  startOfWeek,
  todayIn,
  type CivilDate,
} from '@/lib/tempo/civil';
import { TEMPLATE_PRESETS } from '@/lib/tempo/derive';
import type { Category, TempoEvent } from '@/lib/tempo/types';

const TZ = 'America/Toronto';

const CATEGORIES: Category[] = [
  { id: 'c1', name: 'personal', color: '#7d9a6d', sortOrder: 0 },
  { id: 'c2', name: 'work', color: '#6d8bb0', sortOrder: 1 },
  { id: 'c3', name: 'school', color: '#b8705c', sortOrder: 2 },
  { id: 'c4', name: 'admin', color: '#8a9096', sortOrder: 3 },
  // Five courses and a club, so all ten presets are on screen at once. The
  // palette's close pairs can only be judged side by side.
  { id: 'c5', name: 'CS4442', color: '#8f6da8', sortOrder: 4 },
  { id: 'c6', name: 'STATS 2244', color: '#5aa39a', sortOrder: 5 },
  { id: 'c7', name: 'PHIL 2700', color: '#b06d8b', sortOrder: 6 },
  { id: 'c8', name: 'ECON 1022', color: '#947a30', sortOrder: 7 },
  { id: 'c9', name: 'MATH 2155', color: '#128e99', sortOrder: 8 },
  { id: 'c10', name: 'chess club', color: '#a8936d', sortOrder: 9 },
];

function base(id: string, title: string, over: Partial<TempoEvent>): TempoEvent {
  return {
    id,
    title,
    notes: null,
    kind: 'event',
    categoryId: null,
    allDay: true,
    startsAt: null,
    endsAt: null,
    startDate: null,
    endDate: null,
    dueMinutes: null,
    timezone: TZ,
    recurrence: null,
    reminders: [],
    anchorDate: null,
    displayTemplate: null,
    notify: false,
    source: 'tempo',
    googleEventId: null,
    deletedAt: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function timed(
  id: string,
  title: string,
  date: CivilDate,
  from: number,
  to: number,
  over: Partial<TempoEvent> = {},
): TempoEvent {
  return base(id, title, {
    allDay: false,
    startsAt: instantFromCivil(date, from, TZ).toISOString(),
    endsAt: instantFromCivil(date, to, TZ).toISOString(),
    ...over,
  });
}

/**
 * Five entries with one title, told apart only by their categories — the case
 * the category chips exist for — plus a multi-day deadline, a club and an entry
 * with no category, whose plain grey bar has to stay distinct from every tint.
 */
function finalsWeek(monday: CivilDate): TempoEvent[] {
  const day = (n: number) => addDays(monday, n);
  return [
    timed('f1', 'Final Exam', day(0), 9 * 60, 12 * 60, { categoryId: 'c6' }),
    timed('f2', 'Final Exam', day(1), 14 * 60, 17 * 60, { categoryId: 'c7' }),
    timed('f3', 'Final Exam', day(2), 9 * 60, 12 * 60, { categoryId: 'c8' }),
    timed('f4', 'Final Exam', day(3), 19 * 60, 22 * 60, { categoryId: 'c5' }),
    timed('f5', 'Final Exam', day(4), 12 * 60, 15 * 60, { categoryId: 'c9' }),
    base('f6', 'Final project', {
      startDate: day(0),
      endDate: day(2),
      dueMinutes: 23 * 60 + 55,
      categoryId: 'c5',
    }),
    timed('f7', 'Chess club', day(1), 18 * 60, 19 * 60, { categoryId: 'c10' }),
    timed('f8', 'Coffee with Jo', day(4), 16 * 60, 17 * 60),
  ];
}

function fixtures(today: CivilDate): TempoEvent[] {
  const monthStart = startOfMonth(today);
  const d = (n: number) => addDays(today, n);

  return [
    base('b1', 'Mom', {
      kind: 'birthday',
      startDate: '1974-06-14',
      endDate: '1974-06-14',
      anchorDate: '1974-06-14',
      displayTemplate: TEMPLATE_PRESETS.birthday,
      recurrence: { freq: 'YEARLY', interval: 1, onInvalid: 'clamp' },
      categoryId: 'c1',
      notify: true,
    }),
    base('b2', 'Sam', {
      kind: 'birthday',
      startDate: '2004-02-29',
      endDate: '2004-02-29',
      anchorDate: '2004-02-29',
      displayTemplate: TEMPLATE_PRESETS.birthday,
      recurrence: { freq: 'YEARLY', interval: 1, onInvalid: 'clamp' },
      categoryId: 'c1',
    }),
    base('a1', 'Wedding', {
      kind: 'milestone',
      startDate: '2014-09-01',
      endDate: '2014-09-01',
      anchorDate: '2014-09-01',
      displayTemplate: TEMPLATE_PRESETS.anniversary,
      recurrence: { freq: 'YEARLY', interval: 1 },
      categoryId: 'c1',
    }),

    // Deliberately straddles a month boundary — the case every paginated
    // calendar hides from you.
    base('t1', 'Montreal', {
      startDate: d(-2),
      endDate: d(5),
      categoryId: 'c1',
    }),

    // Deadlines: one that crosses into next week, one due at a time that is
    // not the usual 23:55, and one already past.
    base('s1', 'CS4442 — final project', {
      startDate: d(1),
      endDate: d(9),
      dueMinutes: 23 * 60 + 55,
      categoryId: 'c3',
      notify: true,
    }),
    base('s2', 'Reading response 04', {
      startDate: d(3),
      endDate: d(3),
      dueMinutes: 18 * 60,
      categoryId: 'c3',
    }),
    base('s3', 'Stats problem set', {
      startDate: d(-3),
      endDate: d(-3),
      dueMinutes: 23 * 60 + 55,
      categoryId: 'c3',
    }),

    base('r1', 'Rent', {
      startDate: monthStart,
      endDate: monthStart,
      recurrence: { freq: 'MONTHLY', interval: 1 },
      categoryId: 'c4',
      notify: true,
    }),

    timed('m1', 'Standup', d(0), 9 * 60, 9 * 60 + 30, {
      recurrence: { freq: 'WEEKLY', interval: 1, byWeekday: [1, 2, 3, 4, 5] },
      categoryId: 'c2',
    }),
    timed('m2', 'Design review', d(2), 14 * 60, 15 * 60 + 30, { categoryId: 'c2' }),
    timed('m3', 'Dentist', d(6), 11 * 60, 12 * 60, { categoryId: 'c4', notify: true }),
    timed('m4', 'Gym', d(1), 18 * 60, 19 * 60 + 15, {
      recurrence: { freq: 'WEEKLY', interval: 1, byWeekday: [2, 4, 6] },
      categoryId: 'c1',
    }),

    base('x1', 'Term starts', {
      kind: 'milestone',
      startDate: d(21),
      endDate: d(21),
      categoryId: 'c3',
    }),

    // A class that repeats, so the form's CHANGE WHICH DATES? question has
    // something to ask about.
    timed('l1', 'Lecture', d(0), 10 * 60, 11 * 60 + 30, {
      recurrence: { freq: 'WEEKLY', interval: 1, byWeekday: [2, 4] },
      categoryId: 'c5',
    }),

    // Finals, two weeks out, Monday to Friday.
    ...finalsWeek(addDays(startOfWeek(today), 15)),
  ];
}

// Seeded at module load rather than in an effect, so the components under test
// are exactly the production ones with no extra render-cycle bookkeeping.
// Writes still hit Supabase and get rolled back — this harness is for layout
// and interaction, not persistence.
useCalendar.setState({
  ownerId: 'preview',
  timezone: TZ,
  events: fixtures(todayIn(TZ)),
  overrides: [],
  categories: CATEGORIES,
  /**
   * Two entries already in the trash, so HISTORY has something to draw.
   *
   * Without them the whole recovery surface renders as an empty state here and
   * the harness cannot catch a bug in the part of it that matters — the rows,
   * their stamps, and the two confirmations. Stamped an hour and a day back so
   * the list exercises both of `stamp()`'s branches: a bare clock reading for
   * today, and a dated one for anything older.
   */
  deleted: [
    base('d1', 'Cancelled dentist', {
      allDay: false,
      startDate: null,
      endDate: null,
      startsAt: instantFromCivil(todayIn(TZ), 11 * 60, TZ).toISOString(),
      endsAt: instantFromCivil(todayIn(TZ), 12 * 60, TZ).toISOString(),
      categoryId: 'c4',
      deletedAt: new Date(Date.now() - 3_600_000).toISOString(),
    }),
    base('d2', 'Old reading response', {
      startDate: todayIn(TZ),
      endDate: todayIn(TZ),
      categoryId: 'c3',
      deletedAt: new Date(Date.now() - 86_400_000).toISOString(),
    }),
  ],
  status: 'ready',
  error: null,
});

/**
 * The production shell against fixture data. Rendering anything else here would
 * mean the harness can't catch a shell bug — which is exactly how the keyboard
 * shortcuts ended up advertised but unbound.
 */
export function PreviewHarness() {
  return (
    <CalendarShell
      email="preview@tempo.local"
      onSignOut={() => {}}
      banner="PREVIEW · FIXTURE DATA · NOT PERSISTED"
    />
  );
}
