'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
import { DayModal } from './DayModal';
import { EventForm } from './EventForm';
import { ListView } from './ListView';
import { Settings } from './Settings';
import { YearView } from './YearView';
import { Modal, type ScrimCutout } from './ui';

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

/** What a new entry is pre-filled with. A span, because a drag can select one. */
export interface EntrySeed {
  start: CivilDate;
  end: CivilDate;
  /** Set when the entry was started from an hour row, which also means "timed". */
  startMinutes?: number;
}

/**
 * Overlays are a stack, not a slot.
 *
 * The stack is what makes "Escape unwinds one layer" literal rather than a
 * rule someone has to remember to honour: opening the form from inside the day
 * modal pushes, and dismissing it pops back to the day rather than to nothing.
 * Nothing pushes a third layer today, but a slot would have had to invent a
 * "where do I go back to" field the moment anything did.
 */
type Overlay =
  | { kind: 'day'; date: CivilDate }
  | { kind: 'entry'; mode: 'new'; seed: EntrySeed }
  | { kind: 'entry'; mode: 'edit'; occurrence: Occurrence }
  | { kind: 'settings' };

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
  const today = todayIn(timezone);

  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [focusedDay, setFocusedDay] = useState<CivilDate>(today);
  const [year, setYear] = useState<number | null>(null);
  const [ghost, setGhost] = useState<{ start: CivilDate; end: CivilDate } | null>(null);
  const [band, setBand] = useState<ScrimCutout | null>(null);

  const activeYear = year ?? parts(today).year;
  const top = overlays[overlays.length - 1] ?? null;

  const calendarRef = useRef<CalendarHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const push = (o: Overlay) => setOverlays((s) => [...s, o]);
  const pop = () => setOverlays((s) => s.slice(0, -1));
  /** Same layer, different contents — the day modal's ‹ › steppers. */
  const replaceTop = (o: Overlay) => setOverlays((s) => [...s.slice(0, -1), o]);

  function newEntry(seed?: Partial<EntrySeed>) {
    const start = seed?.start ?? focusedDay;
    // Dropped here rather than left to the form's first report, which lands an
    // effect later — one frame with the *previous* draft's ghost still drawn.
    setGhost(null);
    push({
      kind: 'entry',
      mode: 'new',
      seed: { start, end: seed?.end ?? start, startMinutes: seed?.startMinutes },
    });
  }

  function openDay(date: CivilDate) {
    setFocusedDay(date);
    push({ kind: 'day', date });
  }

  function goToday() {
    setFocusedDay(today);
    if (view === 'scroll') calendarRef.current?.jumpToToday();
    if (view === 'year') setYear(parts(today).year);
  }

  /**
   * The ghost only exists while a *new* entry is being drafted. On an edit the
   * real bar is already on the calendar, and a dashed copy of it beside itself
   * would be a second answer to "where is this".
   *
   * Derived at render rather than cleared in an effect. An effect that nulled
   * the state would render one frame with the stale ghost still up before
   * correcting itself, and it is a write during render's own commit for a value
   * that was never independent of `drafting` in the first place.
   */
  const drafting = top?.kind === 'entry' && top.mode === 'new';
  const liveGhost = drafting ? ghost : null;

  /**
   * Stable identity, and a no-op when the dates haven't moved.
   *
   * The form reports its dates from an effect. Handed a fresh arrow each render
   * it would re-run every render, and storing a fresh `{start, end}` object each
   * time would re-render the shell — which hands down another fresh arrow. The
   * `useCallback` breaks the first half of that loop and returning the previous
   * object unchanged lets React bail out of the second.
   */
  const handleDraftDates = useCallback((start: CivilDate, end: CivilDate) => {
    setGhost((g) => (g && g.start === start && g.end === end ? g : { start, end }));
  }, []);

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

    /**
     * Escape unwinds exactly one layer, and this is the only place that decides
     * which. An open date picker never gets this far — it stops the event in
     * its own React handler, which is what keeps "picker before modal" from
     * depending on the order two window listeners happened to be registered in.
     *
     * Unwinding beats blurring even mid-typing. Escape in a form field that
     * only blurred would mean two different things depending on where the caret
     * was, and the second press would then close a modal you thought you had
     * already dismissed.
     */
    if (e.key === 'Escape') {
      if (overlays.length > 0) pop();
      else if (typing) target.blur();
      return;
    }

    // Never shadow a browser or OS chord.
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

    /**
     * Space re-centres on today.
     *
     * It has to be spelled out separately because Space is not an inert key the
     * way a letter is: on a focused button or checkbox the browser reads it as
     * "activate", and stealing it would mean the SETTINGS button in the header
     * scrolled the calendar instead of opening settings. So it only counts when
     * nothing that answers to Space holds focus.
     */
    if (e.key === ' ' || e.key === 'Spacebar') {
      const el = document.activeElement;
      const activates =
        el instanceof HTMLElement &&
        (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button');
      if (activates) return;
      e.preventDefault();
      goToday();
      return;
    }

    switch (e.key) {
      case 'n':
      case 'N':
        e.preventDefault();
        newEntry();
        break;
      case 'd':
      case 'D':
        e.preventDefault();
        openDay(focusedDay);
        break;
      case 's':
      case 'S':
        e.preventDefault();
        push({ kind: 'settings' });
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
        push({ kind: 'settings' });
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
            onClick={() => push({ kind: 'settings' })}
            className="label border border-hair px-2.5 py-1.5 transition-colors hover:border-hairlit hover:text-ink"
          >
            SETTINGS
          </button>
        </div>
      </header>

      {/* One child, full width, in every state. Overlays are drawn on top of
          this rather than beside it, so nothing here ever resizes. */}
      <div className="min-h-0 min-w-0 flex-1">
        {view === 'scroll' && (
          <ContinuousCalendar
            ref={calendarRef}
            onOpenOccurrence={(occ) => push({ kind: 'entry', mode: 'edit', occurrence: occ })}
            onOpenDay={openDay}
            onNewOnDay={(date) => newEntry({ start: date })}
            selectedDay={focusedDay}
            ghost={liveGhost}
            onGhostBand={setBand}
          />
        )}

        {view === 'list' && (
          <ListView
            searchRef={searchRef}
            onOpen={(occ) => push({ kind: 'entry', mode: 'edit', occurrence: occ })}
            onNew={() => newEntry()}
          />
        )}

        {view === 'year' && (
          <YearView
            year={activeYear}
            onYear={setYear}
            onOpenDay={openDay}
            selectedDay={focusedDay}
          />
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

      {/* Only the top of the stack renders. Two live overlays would mean two
          scrims, and the one underneath would darken the one above it. */}
      {top?.kind === 'day' && (
        <DayModal
          date={top.date}
          onDate={(d) => {
            setFocusedDay(d);
            replaceTop({ kind: 'day', date: d });
          }}
          onOpen={(occ) => push({ kind: 'entry', mode: 'edit', occurrence: occ })}
          onNew={(date, startMinutes) => newEntry({ start: date, startMinutes })}
          onClose={pop}
        />
      )}

      {top?.kind === 'entry' && (
        <Modal
          size="entry"
          title={top.mode === 'new' ? 'NEW ENTRY' : 'EDIT'}
          meta={
            top.mode === 'edit' && top.occurrence.event.recurrence
              ? 'EDITS APPLY TO THE WHOLE SERIES'
              : undefined
          }
          onClose={pop}
          cutout={view === 'scroll' ? band : null}
        >
          {top.mode === 'new' ? (
            <EventForm
              key={`new-${top.seed.start}-${top.seed.end}-${top.seed.startMinutes ?? 'allday'}`}
              mode="new"
              seed={top.seed}
              onClose={pop}
              onDraftDatesChange={handleDraftDates}
            />
          ) : (
            <EventForm
              key={top.occurrence.key}
              mode="edit"
              occurrence={top.occurrence}
              onClose={pop}
            />
          )}
        </Modal>
      )}

      {top?.kind === 'settings' && (
        <Settings
          email={email}
          onClose={pop}
          onSignOut={onSignOut}
          readOnly={Boolean(banner)}
        />
      )}
    </div>
  );
}
