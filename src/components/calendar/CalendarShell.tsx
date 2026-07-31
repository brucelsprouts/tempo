'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useCalendar } from '@/lib/store/calendar-store';
import {
  getServerViewSnapshot,
  getViewSnapshot,
  setViewPreference,
  subscribeView,
} from '@/lib/store/view-preference';
import { parts, todayIn, type CivilDate } from '@/lib/tempo/civil';
import type { Occurrence } from '@/lib/tempo/types';
import { ContinuousCalendar, type CalendarHandle } from './ContinuousCalendar';
import { DayView } from './DayView';
import { EventForm } from './EventForm';
import { ListView } from './ListView';
import { Settings } from './Settings';
import { YearView } from './YearView';

/**
 * The app chrome: one top bar, one keymap, one place that decides what a view
 * is. The views themselves know nothing about each other and read the same
 * store, so switching between them is a render, not a reload.
 *
 * Shared with the preview harness deliberately — a harness that renders a
 * different shell is a harness that can't catch a shell bug, which is how the
 * keyboard shortcuts came to be advertised in the footer without being bound.
 */

const VIEWS = [
  { value: 'scroll', label: 'SCROLL', key: '1' },
  { value: 'list', label: 'LIST', key: '2' },
  { value: 'year', label: 'YEAR', key: '3' },
] as const;

type Rail =
  | { mode: 'day'; date: CivilDate }
  | { mode: 'edit'; occ: Occurrence }
  | { mode: 'new'; date: CivilDate; startMinutes?: number }
  | null;

interface Props {
  email: string;
  onSignOut: () => void;
  /** Preview harness: no session to end, and a banner saying so. */
  banner?: string;
}

export function CalendarShell({ email, onSignOut, banner }: Props) {
  const status = useCalendar((s) => s.status);
  const error = useCalendar((s) => s.error);
  const dismissError = useCalendar((s) => s.dismissError);
  const timezone = useCalendar((s) => s.timezone);
  const eventCount = useCalendar((s) => s.events.length);

  const view = useSyncExternalStore(subscribeView, getViewSnapshot, getServerViewSnapshot);
  const [rail, setRail] = useState<Rail>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const today = todayIn(timezone);
  const [year, setYear] = useState<number | null>(null);
  const activeYear = year ?? parts(today).year;

  const calendarRef = useRef<CalendarHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  function closeRail() {
    setRail(null);
  }

  /** Whichever day is currently in focus, which is what [N] should target. */
  function focusedDay(): CivilDate {
    if (rail?.mode === 'day') return rail.date;
    if (rail?.mode === 'new') return rail.date;
    if (rail?.mode === 'edit') return rail.occ.date;
    return todayIn(timezone);
  }

  function newEntry(date?: CivilDate, startMinutes?: number) {
    setRail({ mode: 'new', date: date ?? focusedDay(), startMinutes });
  }

  function goToday() {
    if (view === 'scroll') calendarRef.current?.jumpToToday();
    if (view === 'year') setYear(parts(todayIn(timezone)).year);
  }

  /**
   * The keymap reads current state, so it is rebuilt every render — but the
   * listener must not be, or a fast key press during a re-subscribe is simply
   * dropped. The window subscription is therefore permanent and indirects
   * through a ref that always holds this render's handler.
   */
  function onKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    const typing =
      !!target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable);

    // Escape unwinds one layer at a time, and works while typing — that is the
    // whole point of it.
    if (e.key === 'Escape') {
      if (settingsOpen) setSettingsOpen(false);
      else if (typing) target.blur();
      else if (rail) closeRail();
      return;
    }

    // Never shadow a browser or OS chord.
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key) {
      case 'n':
      case 'N':
        e.preventDefault();
        newEntry();
        break;
      case 't':
      case 'T':
        e.preventDefault();
        goToday();
        break;
      case '1':
        setViewPreference('scroll');
        break;
      case '2':
        setViewPreference('list');
        break;
      case '3':
        setViewPreference('year');
        break;
      case '/':
        if (view === 'list') {
          e.preventDefault();
          searchRef.current?.focus();
        }
        break;
      case ',':
      case '?':
        e.preventDefault();
        setSettingsOpen(true);
        break;
    }
  }

  const keymapRef = useRef(onKey);
  useEffect(() => {
    keymapRef.current = onKey;
  });

  useEffect(() => {
    const listener = (e: KeyboardEvent) => keymapRef.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-hair px-4 py-2">
        <span className="text-[12px] tracking-[0.3em] text-bright">TEMPO</span>
        <span className="text-hair">│</span>

        <nav className="flex border border-hair" aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              onClick={() => setViewPreference(v.value)}
              aria-current={view === v.value}
              className={[
                'flex items-center gap-1.5 px-2.5 py-1 text-[10px] tracking-[0.12em] transition-colors',
                view === v.value
                  ? 'bg-raised text-bright'
                  : 'text-mute hover:bg-sunken hover:text-dim',
              ].join(' ')}
            >
              {v.label}
              <span className="text-[9px] text-mute">{v.key}</span>
            </button>
          ))}
        </nav>

        {banner && <span className="label ml-1 hidden lg:inline">{banner}</span>}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => newEntry()}
            className="label border border-hair px-2.5 py-1.5 transition-colors hover:border-hairlit hover:text-ink"
          >
            + NEW
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="label border border-hair px-2.5 py-1.5 transition-colors hover:border-hairlit hover:text-ink"
          >
            SETTINGS
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {view === 'scroll' && (
            <ContinuousCalendar
              ref={calendarRef}
              onOpenOccurrence={(occ) => setRail({ mode: 'edit', occ })}
              onOpenDay={(date) => setRail({ mode: 'day', date })}
              onNewOnDay={(date) => newEntry(date)}
              selectedDay={rail?.mode === 'day' ? rail.date : null}
            />
          )}

          {view === 'list' && (
            <ListView
              searchRef={searchRef}
              onOpen={(occ) => setRail({ mode: 'edit', occ })}
              onNew={() => newEntry()}
            />
          )}

          {view === 'year' && (
            <YearView
              year={activeYear}
              onYear={setYear}
              onOpenDay={(date) => setRail({ mode: 'day', date })}
              selectedDay={rail?.mode === 'day' ? rail.date : null}
            />
          )}
        </div>

        {rail && (
          <aside className="w-[360px] shrink-0 border-l border-hairlit bg-panel">
            {rail.mode === 'day' && (
              <DayView
                date={rail.date}
                onOpen={(occ) => setRail({ mode: 'edit', occ })}
                onNew={(date, startMinutes) => newEntry(date, startMinutes)}
                onClose={closeRail}
              />
            )}
            {rail.mode === 'edit' && (
              <EventForm key={rail.occ.key} mode="edit" occurrence={rail.occ} onClose={closeRail} />
            )}
            {rail.mode === 'new' && (
              <EventForm
                key={`new-${rail.date}-${rail.startMinutes ?? 'allday'}`}
                mode="new"
                date={rail.date}
                startMinutes={rail.startMinutes}
                onClose={closeRail}
              />
            )}
          </aside>
        )}
      </div>

      <footer className="flex shrink-0 items-center gap-4 border-t border-hair px-4 py-2">
        <span className="label">
          {status === 'loading' ? 'SYNCING' : status === 'error' ? 'ERROR' : 'ONLINE'}
        </span>
        <span className="label">{eventCount} ENTRIES</span>

        {error && (
          <button onClick={dismissError} className="label ml-auto text-dim hover:text-ink">
            ! {error.slice(0, 60).toUpperCase()} — DISMISS
          </button>
        )}
      </footer>

      {settingsOpen && (
        <Settings
          email={email}
          onClose={() => setSettingsOpen(false)}
          onSignOut={onSignOut}
          readOnly={Boolean(banner)}
        />
      )}
    </div>
  );
}
