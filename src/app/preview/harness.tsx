'use client';

import { useState } from 'react';
import { ContinuousCalendar } from '@/components/calendar/ContinuousCalendar';
import { DayView } from '@/components/calendar/DayView';
import { EventForm } from '@/components/calendar/EventForm';
import { useCalendar } from '@/lib/store/calendar-store';
import { addDays, instantFromCivil, startOfMonth, todayIn, type CivilDate } from '@/lib/tempo/civil';
import { TEMPLATE_PRESETS } from '@/lib/tempo/derive';
import type { Category, Occurrence, TempoEvent } from '@/lib/tempo/types';

const TZ = 'America/Toronto';

const CATEGORIES: Category[] = [
  { id: 'c1', name: 'personal', color: '#7d9a6d', sortOrder: 0 },
  { id: 'c2', name: 'work', color: '#6d8bb0', sortOrder: 1 },
  { id: 'c3', name: 'school', color: '#b8705c', sortOrder: 2 },
  { id: 'c4', name: 'admin', color: '#8a9096', sortOrder: 3 },
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

    base('s1', 'CS4442 — final project', {
      kind: 'assignment',
      status: 'doing',
      startDate: d(1),
      endDate: d(9),
      categoryId: 'c3',
      notify: true,
    }),
    base('s2', 'Reading response 04', {
      kind: 'assignment',
      status: 'todo',
      startDate: d(3),
      endDate: d(3),
      categoryId: 'c3',
    }),
    base('s3', 'Stats problem set', {
      kind: 'assignment',
      status: 'done',
      startDate: d(-3),
      endDate: d(-3),
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
  ];
}

type Rail =
  | { mode: 'day'; date: CivilDate }
  | { mode: 'edit'; occ: Occurrence }
  | { mode: 'new'; date: CivilDate }
  | null;

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
  status: 'ready',
  error: null,
});

export function PreviewHarness() {
  const [rail, setRail] = useState<Rail>(null);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <ContinuousCalendar
            onOpenOccurrence={(occ) => setRail({ mode: 'edit', occ })}
            onOpenDay={(date) => setRail({ mode: 'day', date })}
            selectedDay={rail?.mode === 'day' ? rail.date : null}
          />
        </div>
        {rail && (
          <aside className="w-[360px] shrink-0 border-l border-hairlit bg-panel">
            {rail.mode === 'day' && (
              <DayView
                date={rail.date}
                onOpen={(occ) => setRail({ mode: 'edit', occ })}
                onNew={(date) => setRail({ mode: 'new', date })}
                onClose={() => setRail(null)}
              />
            )}
            {rail.mode === 'edit' && (
              <EventForm key={rail.occ.key} mode="edit" occurrence={rail.occ} onClose={() => setRail(null)} />
            )}
            {rail.mode === 'new' && (
              <EventForm key={rail.date} mode="new" date={rail.date} onClose={() => setRail(null)} />
            )}
          </aside>
        )}
      </div>
      <footer className="flex shrink-0 items-center gap-4 border-t border-hair px-4 py-2">
        <span className="label">PREVIEW · FIXTURE DATA · NOT PERSISTED</span>
        <span className="label ml-auto">
          DRAG = MOVE · SHIFT+DROP = SERIES · DBL-CLICK DAY = OPEN
        </span>
      </footer>
    </div>
  );
}
