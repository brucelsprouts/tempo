'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useCalendar } from '@/lib/store/calendar-store';
import { getZoomSnapshot, setZoom } from '@/lib/store/day-zoom';
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
import { EventForm, type DraftPreview, type EntryFormHandle } from './EventForm';
import { History } from './History';
import { ListView, type ListHandle } from './ListView';
import { Settings } from './Settings';
import { Toast } from './Toast';
import { zoomIn, zoomOut } from './timeline';
import { YearView } from './YearView';
import { Modal } from './ui';

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
  | { kind: 'settings' }
  /** `focus` opens the version list on one entry, which is how a form reaches it. */
  | { kind: 'history'; focus?: string };

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
  const undoStack = useCalendar((s) => s.undoStack);
  const undo = useCalendar((s) => s.undo);
  const isOffline = useCalendar((s) => s.isOffline);
  const cachedAt = useCalendar((s) => s.cachedAt);

  const view = useSyncExternalStore(subscribeView, getViewSnapshot, getServerViewSnapshot);
  const today = todayIn(timezone);

  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [focusedDay, setFocusedDay] = useState<CivilDate>(today);
  const [year, setYear] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftPreview | null>(null);
  const [toast, setToast] = useState<{ at: number; label: string; undoable: boolean } | null>(null);
  /** The action already announced, so a shrinking stack doesn't re-announce. */
  const announced = useRef<number | null>(null);

  const activeYear = year ?? parts(today).year;
  const top = overlays[overlays.length - 1] ?? null;

  const calendarRef = useRef<CalendarHandle>(null);
  const listRef = useRef<ListHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** The live entry form, when one is open. See `dismissEntry`. */
  const formRef = useRef<EntryFormHandle>(null);

  const push = (o: Overlay) => setOverlays((s) => [...s, o]);
  const pop = () => setOverlays((s) => s.slice(0, -1));
  /** Same layer, different contents — the day modal's ‹ › steppers. */
  const replaceTop = (o: Overlay) => setOverlays((s) => [...s.slice(0, -1), o]);

  /**
   * Clicking away from the entry form keeps what you typed.
   *
   * The two ways out of the form mean opposite things, which is the whole of
   * this feature: clicking off is "yes, that one" and Escape is "no, forget
   * it". Escape stays on `pop` and never comes through here. A brand-new entry
   * with nothing typed into it still commits — under `UNTITLED`, which the
   * draft bar has been calling it the whole time.
   */
  function dismissEntry() {
    if (formRef.current) formRef.current.commit();
    else pop();
  }

  function newEntry(seed?: Partial<EntrySeed>) {
    const start = seed?.start ?? focusedDay;
    // Dropped here rather than left to the form's first report, which lands an
    // effect later — one frame with the *previous* draft's bar still drawn.
    setDraft(null);
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
   * The draft bar only exists while a *new* entry is being written. On an edit
   * the real bar is already on the calendar, and a second copy of it beside
   * itself would be a second answer to "where is this".
   *
   * Derived at render rather than cleared in an effect. An effect that nulled
   * the state would render one frame with the stale bar still up before
   * correcting itself, and it is a write during render's own commit for a value
   * that was never independent of `drafting` in the first place.
   */
  const drafting = top?.kind === 'entry' && top.mode === 'new';
  const liveDraft = drafting ? draft : null;

  /**
   * Stable identity, and a no-op when nothing the bar draws has moved.
   *
   * The form reports itself from an effect. Handed a fresh arrow each render it
   * would re-run every render, and storing a fresh object each time would
   * re-render the shell — which hands down another fresh arrow. The
   * `useCallback` breaks the first half of that loop and returning the previous
   * object unchanged lets React bail out of the second.
   */
  const handleDraftChange = useCallback((next: DraftPreview) => {
    setDraft((d) =>
      d && d.start === next.start && d.end === next.end && d.title === next.title ? d : next,
    );
  }, []);

  /**
   * The toast follows the stack, not the action.
   *
   * Several surfaces mutate the calendar — the grid, the timeline, the form,
   * the tasks pane — and none of them report back up here. The stack is the one
   * place all of them land, so this watches for an action newer than the last
   * announced rather than asking to be told.
   *
   * The first pass only records where the stack stood, which is nothing on a
   * fresh tab and is the right no-op if that ever stops being true.
   */
  useEffect(() => {
    const newest = undoStack[0]?.at ?? null;
    if (announced.current === null) {
      announced.current = newest ?? 0;
      return;
    }
    if (newest === null || newest <= announced.current) return;
    announced.current = newest;
    setToast({ at: newest, label: undoStack[0].label, undoable: true });
  }, [undoStack]);

  const dismissToast = useCallback(() => setToast(null), []);

  /**
   * Undo says what it undid.
   *
   * Cmd-Z is no longer gated on a visible toast, so it can fire with nothing on
   * screen — and a keypress that changes the calendar and says nothing is worse
   * than no keypress at all. The confirmation carries no UNDO of its own:
   * pressing it again is what "again" means.
   */
  const runUndo = useCallback(async () => {
    const before = useCalendar.getState().undoStack;
    const entry = before[0];
    if (!entry) return;

    await undo();

    // The stack shrinking is what "it worked" means. `state.error` may still be
    // holding a message from some earlier failure nobody has dismissed, and a
    // failed undo deliberately leaves its entry in place to be retried.
    const after = useCalendar.getState().undoStack;
    if (after.length >= before.length) return;

    announced.current = after[0]?.at ?? 0;
    setToast({ at: Date.now(), label: `Undid: ${entry.label}`, undoable: false });
  }, [undo]);

  /**
   * The keymap reads current state, so it is rebuilt every render — but the
   * listener must not be, or a fast key press during a re-subscribe is simply
   * dropped. The window subscription is therefore permanent and indirects
   * through a ref that always holds this render's handler.
   */
  /**
   * Whichever view currently owns a selection.
   *
   * The grid and the table both keep their own, and both answer to the same
   * four calls — so one chord can be bound once here rather than twice, and the
   * shell never has to grow a copy of what is selected. Null while an overlay
   * is up: a modal is a layer over the selection, not beside it, and ⌘D with a
   * form open must not quietly duplicate whatever is lit behind it.
   */
  type SelectionSurface = Pick<
    CalendarHandle,
    'unwind' | 'copySelection' | 'duplicateSelection' | 'pasteClipboard'
  >;

  function selectionSurface(): SelectionSurface | null {
    if (overlays.length > 0) return null;
    if (view === 'list') return listRef.current;
    if (view === 'scroll') return calendarRef.current;
    return null;
  }

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
      // The toast is not a layer, so it goes on the way past and the press is
      // still spent on whatever is — closing a modal and clearing a toast on one
      // Escape is right, and making the toast eat a press would not be.
      setToast(null);
      if (overlays.length > 0) {
        pop();
      } else if (!selectionSurface()?.unwind() && typing) {
        // The grid's own layer sits under the stack: the selection. Blurring is
        // last because it is not a layer — in the scroll view there is nothing
        // to be typing into.
        target.blur();
      }
      return;
    }

    /**
     * The timeline's scale, while the day is the top layer.
     *
     * Here rather than in `DayView` because the shell is the one place that
     * decides what a key means — a second window listener would race this one.
     */
    if (top?.kind === 'day' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoom(zoomIn(getZoomSnapshot(), 0));
        return;
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setZoom(zoomOut(getZoomSnapshot(), 0));
        return;
      }
      if (e.key === '0') {
        e.preventDefault();
        setZoom('fit');
        return;
      }
    }

    /**
     * The one chord the app claims, and now whenever there is anything to take
     * back rather than only while a toast happens to be up. The undo you reach
     * for eight seconds late is the same undo.
     *
     * Not in a text field, where it still means "undo my typing", and not with
     * Shift, which is redo and stays the browser's.
     */
    if (
      (e.metaKey || e.ctrlKey) &&
      !e.altKey &&
      !e.shiftKey &&
      (e.key === 'z' || e.key === 'Z') &&
      undoStack.length > 0 &&
      !typing
    ) {
      e.preventDefault();
      void runUndo();
      return;
    }

    /**
     * Copy, paste, duplicate — over whichever view has a selection.
     *
     * Every one of them yields rather than swallows: each call reports whether
     * it had anything to act on, and a chord that found nothing falls through
     * to the browser. So ⌘V on an empty clipboard still pastes into whatever
     * has focus, and ⌘D with nothing lit still bookmarks the page — which is
     * the behaviour someone who has not selected anything is expecting.
     *
     * Shift is excluded deliberately: ⌘⇧C is the inspector and ⌘⇧V is
     * paste-as-plain-text, and neither is ours to take.
     */
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && !typing) {
      const surface = selectionSurface();
      const key = e.key.toLowerCase();

      if (surface && key === 'c') {
        /**
         * Real text beats the selection.
         *
         * Someone who has dragged across an entry's title and pressed ⌘C is
         * copying that text, and handing them a clipboard of calendar entries
         * instead would be taking a gesture the browser already answers well.
         */
        if (!window.getSelection()?.toString()) {
          const n = surface.copySelection();
          if (n > 0) {
            e.preventDefault();
            setToast({
              at: Date.now(),
              label: n === 1 ? 'Copied 1 entry' : `Copied ${n} entries`,
              undoable: false,
            });
            return;
          }
        }
      }

      if (surface && key === 'v' && surface.pasteClipboard()) {
        e.preventDefault();
        return;
      }

      if (surface && key === 'd' && surface.duplicateSelection()) {
        e.preventDefault();
        return;
      }
    }

    // Never shadow a browser or OS chord.
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

    /**
     * What a selection answers to.
     *
     * Bound ahead of everything below and only while the grid actually has
     * something lit, so an unselected calendar keeps the browser's own arrow
     * scrolling and Backspace keeps meaning nothing. `calendarRef` is null in
     * the other two views, which is what scopes these to the grid.
     */
    if (overlays.length === 0) {
      const grid = calendarRef.current;
      const acted =
        e.key === 'Delete' || e.key === 'Backspace'
          ? grid?.deleteSelection()
          : e.key === 'ArrowLeft'
            ? grid?.moveSelection(-1)
            : e.key === 'ArrowRight'
              ? grid?.moveSelection(1)
              : e.key === 'ArrowUp'
                ? grid?.moveSelection(-7)
                : e.key === 'ArrowDown'
                  ? grid?.moveSelection(7)
                  : false;
      if (acted) {
        e.preventDefault();
        return;
      }
    }

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
      /**
       * W A S D, and nothing outside it.
       *
       * Every action key the app claims sits under one resting left hand —
       * new entry, settings, day, history — which is the shape a hand already
       * takes on this keyboard whether it got there from gaming or from home
       * row. It is deliberately not mnemonic: A is not "add" and W is not
       * anything, because the alternative was N, H and comma scattered across
       * three rows, and a letter you have to aim for is slower than a position
       * you already hold. Only D and S happen to say what they do.
       *
       * The arrows stay separate and keep meaning "move the selection" — WASD
       * as movement *and* as commands would be one key doing two jobs.
       */
      case 'a':
      case 'A':
        e.preventDefault();
        newEntry();
        break;
      case 'w':
      case 'W':
        e.preventDefault();
        push({ kind: 'history' });
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
    <div className="safe-shell flex h-full flex-col">
      {isOffline && cachedAt && (
        <div className="bg-raised border-b border-hair px-3 py-1.5 text-center text-[10px] tracking-[0.2em] text-dim select-none shrink-0">
          ⚠️ OFFLINE · VIEWING CACHED CALENDAR (AS OF {new Date(cachedAt).toLocaleString().toUpperCase()})
        </div>
      )}
      {/*
        Two rows on a phone, one everywhere else.

        The row is brand · views · actions, and on a 393px screen those three
        want about 480px between them — so the last group in the row was simply
        off the edge, and SETTINGS was the last button in it. Wrapping is what
        puts it back on screen; `w-full` below `sm` is what makes the wrap
        deterministic rather than a thing that depends on how wide a font
        happened to render, and the three buttons split that row evenly because
        a row of its own is the one place they can afford to be thumb-sized.
      */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-hair px-3 py-2 sm:px-4">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 64 64" className="h-4 w-4 shrink-0" aria-hidden="true">
            <defs>
              <clipPath id="tile">
                <rect width="64" height="64" rx="13" />
              </clipPath>
            </defs>
            <g clipPath="url(#tile)">
              <rect width="64" height="64" fill="#08090a" />
              <rect width="64" height="14" fill="#2a2d33" />
              <g fill="#ffffff">
                <rect x="28" y="25" width="36" height="9" />
                <rect y="42" width="36" height="9" />
              </g>
            </g>
          </svg>
          <span className="text-[12px] tracking-[0.3em] text-bright">TEMPO</span>
        </div>
        <span className="hidden text-hair sm:inline">│</span>

        <nav className="flex border border-hair" aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              onClick={() => setViewPreference(v.value)}
              aria-current={view === v.value}
              className={[
                'tap flex items-center gap-1.5 px-2.5 py-1 text-[10px] tracking-[0.12em] transition-colors',
                view === v.value
                  ? 'bg-raised text-bright'
                  : 'text-mute hover:bg-sunken hover:text-dim',
              ].join(' ')}
            >
              {v.label}
              {/* The keyboard's half of the label, and only where there is one.
                  On a phone it is a number beside a word that does nothing. */}
              <span className="hidden text-[9px] text-mute sm:inline">{v.key}</span>
            </button>
          ))}
        </nav>

        {banner && <span className="label ml-1 hidden lg:inline">{banner}</span>}

        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <button
            onClick={() => newEntry()}
            disabled={isOffline}
            className={`tap label flex-1 border border-hair px-2.5 py-1.5 transition-colors sm:flex-none ${
              isOffline ? 'opacity-50 cursor-default' : 'hover:border-hairlit hover:text-ink'
            }`}
          >
            + NEW
          </button>
          {/* Beside SETTINGS rather than inside it. The recovery pool lived in
              settings once and was not found, which is the whole reason this
              has a door of its own. */}
          <button
            onClick={() => push({ kind: 'history' })}
            className="tap label flex-1 border border-hair px-2.5 py-1.5 transition-colors hover:border-hairlit hover:text-ink sm:flex-none"
          >
            HISTORY
          </button>
          <button
            onClick={() => push({ kind: 'settings' })}
            className="tap label flex-1 border border-hair px-2.5 py-1.5 transition-colors hover:border-hairlit hover:text-ink sm:flex-none"
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
            draft={liveDraft}
          />
        )}

        {view === 'list' && (
          <ListView
            ref={listRef}
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

      {/* The toast is anchored to the footer rather than to the viewport, so
          "above the footer" is a fact about the layout instead of a measurement
          that has to be kept in step with it. Keyed on the batch, so a second
          delete replaces the first and restarts its clock rather than stacking a
          second UNDO over the older one. */}
      <div className="relative shrink-0">
        {toast && (
          <Toast
            key={toast.at}
            label={toast.label}
            onUndo={toast.undoable ? runUndo : undefined}
            onDismiss={dismissToast}
          />
        )}

        <footer className="chrome-tight flex items-center gap-4 border-t border-hair px-3 py-2 sm:px-4">
          <span className="label">
            {isOffline ? 'OFFLINE' : (status === 'loading' ? 'SYNCING' : status === 'error' ? 'ERROR' : 'ONLINE')}
          </span>
          <span className="label">{eventCount} ENTRIES</span>

          {error && (
            <button onClick={dismissError} className="label ml-auto text-dim hover:text-ink">
              ! {error.slice(0, 60).toUpperCase()} — DISMISS
            </button>
          )}
        </footer>
      </div>

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
          onDismiss={dismissEntry}
        >
          {top.mode === 'new' ? (
            <EventForm
              key={`new-${top.seed.start}-${top.seed.end}-${top.seed.startMinutes ?? 'allday'}`}
              ref={formRef}
              mode="new"
              seed={top.seed}
              onClose={pop}
              onDraftChange={handleDraftChange}
            />
          ) : (
            <EventForm
              key={top.occurrence.key}
              ref={formRef}
              mode="edit"
              occurrence={top.occurrence}
              onClose={pop}
              onHistory={() => push({ kind: 'history', focus: top.occurrence.eventId })}
            />
          )}
        </Modal>
      )}

      {top?.kind === 'history' && <History focus={top.focus} onClose={pop} />}

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
