'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useCalendar } from '@/lib/store/calendar-store';
import { createClient } from '@/lib/supabase/client';
import { todayIn, type CivilDate } from '@/lib/tempo/civil';
import type { Occurrence } from '@/lib/tempo/types';
import { ContinuousCalendar } from './ContinuousCalendar';
import { DayView } from './DayView';
import { EventForm } from './EventForm';

type Rail =
  | { mode: 'day'; date: CivilDate }
  | { mode: 'edit'; occ: Occurrence }
  | { mode: 'new'; date: CivilDate }
  | null;

export function CalendarApp({ email }: { email: string }) {
  const router = useRouter();
  const load = useCalendar((s) => s.load);
  const status = useCalendar((s) => s.status);
  const error = useCalendar((s) => s.error);
  const dismissError = useCalendar((s) => s.dismissError);
  const timezone = useCalendar((s) => s.timezone);
  const eventCount = useCalendar((s) => s.events.length);

  const [rail, setRail] = useState<Rail>(null);

  useEffect(() => {
    load();
  }, [load]);

  const closeRail = useCallback(() => setRail(null), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (e.key === 'Escape') {
        closeRail();
        return;
      }
      if (typing) return;

      if (e.key === 'n') {
        e.preventDefault();
        setRail({ mode: 'new', date: todayIn(timezone) });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeRail, timezone]);

  async function signOut() {
    await createClient().auth.signOut();
    router.replace('/login');
    router.refresh();
  }

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
                onClose={closeRail}
              />
            )}
            {rail.mode === 'edit' && (
              <EventForm
                key={rail.occ.key}
                mode="edit"
                occurrence={rail.occ}
                onClose={closeRail}
              />
            )}
            {rail.mode === 'new' && (
              <EventForm key={`new-${rail.date}`} mode="new" date={rail.date} onClose={closeRail} />
            )}
          </aside>
        )}
      </div>

      <footer className="flex shrink-0 items-center gap-4 border-t border-hair px-4 py-2">
        <span className="label">
          {status === 'loading' ? 'SYNCING' : status === 'error' ? 'ERROR' : 'ONLINE'}
        </span>
        <span className="label">{eventCount} ENTRIES</span>
        <span className="label">{timezone}</span>
        <span className="label hidden md:inline">
          DBL-CLICK DAY = OPEN · DRAG = MOVE · SHIFT+DROP = WHOLE SERIES · [N] NEW
        </span>

        {error && (
          <button onClick={dismissError} className="label ml-auto text-dim hover:text-ink">
            ! {error.slice(0, 60).toUpperCase()} — DISMISS
          </button>
        )}

        <a
          href="/api/export"
          className={`label hover:text-dim ${error ? '' : 'ml-auto'}`}
          title="Download every event as portable JSON"
        >
          EXPORT
        </a>

        <button onClick={signOut} className="label hover:text-dim">
          {email} · LOCK
        </button>
      </footer>
    </div>
  );
}
