'use client';

import { useMemo, useState } from 'react';
import { useCalendar } from '@/lib/store/calendar-store';
import { minutesInZone, todayIn } from '@/lib/tempo/civil';
import type { EventKind, EventStatus, TempoEvent } from '@/lib/tempo/types';
import { CATEGORY_PALETTE } from './constants';
import { Button, inputClass, Modal, Section } from './ui';

/**
 * Everything that isn't the calendar.
 *
 * This is a single-account app, so there is no account *management* here — only
 * the two facts worth having somewhere: which identity this session is, and how
 * to end it. Both were sitting in the footer, on screen permanently, which is
 * exactly the wrong place for something you look at twice a year.
 */

/**
 * The keymap, stated once. The shell binds these; this is the reference.
 *
 * Keys are a list rather than a pre-joined string because they render as
 * individual keycaps — `'SHIFT + DROP'` as one chip is a lie about what you
 * press, and splitting a string back apart would have to guess whether a `/`
 * was a separator or the search key.
 */
export const SHORTCUTS: ReadonlyArray<{
  keys: readonly string[];
  /** Printed between the caps. Omitted means they are pressed in sequence. */
  joiner?: string;
  meaning: string;
}> = [
  { keys: ['SPACE'], meaning: 'Centre on today' },
  { keys: ['A'], meaning: 'New entry' },
  { keys: ['S'], meaning: 'Settings' },
  { keys: ['D'], meaning: 'Open the focused day' },
  { keys: ['1', '2', '3'], joiner: '/', meaning: 'Scroll · List · Year' },
  { keys: ['/'], meaning: 'Filter, in list view' },
  { keys: ['ESC'], meaning: 'Unwind one layer' },
  { keys: ['DEL'], meaning: 'Delete the selection' },
  { keys: ['⌘', 'Z'], joiner: '+', meaning: 'Undo, while the toast is up' },
  { keys: ['←', '→'], joiner: '/', meaning: 'Move selection ∓1 day' },
  { keys: ['↑', '↓'], joiner: '/', meaning: 'Move selection ∓7 days' },
  { keys: ['DRAG'], meaning: 'Lasso-select, on empty grid' },
  { keys: ['CLICK'], meaning: 'Empty grid → clear the selection' },
  { keys: ['⌘', 'CLICK'], joiner: '+', meaning: 'Add or remove one bar' },
  { keys: ['DRAG'], meaning: 'A selected bar → move them all' },
  { keys: ['SHIFT', 'DROP'], joiner: '+', meaning: 'Move the whole series instead' },
];

/** Enough of the zone list to be useful without a search field. */
const FALLBACK_ZONES = [
  'UTC',
  'America/Toronto',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Vancouver',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Australia/Sydney',
];

interface Props {
  email: string;
  onClose: () => void;
  onSignOut: () => void;
  /** Absent in the preview harness, where there is no session to end. */
  readOnly?: boolean;
}

export function Settings({ email, onClose, onSignOut, readOnly }: Props) {
  const timezone = useCalendar((s) => s.timezone);
  const setTimezone = useCalendar((s) => s.setTimezone);
  const events = useCalendar((s) => s.events);
  const overrides = useCalendar((s) => s.overrides);

  const [reveal, setReveal] = useState(false);

  const zones = useMemo(() => {
    const supported =
      typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    const all = supported.length > 0 ? supported : FALLBACK_ZONES;
    // Whatever is currently set must be selectable even if the runtime doesn't
    // list it, or the select would silently show the wrong zone.
    return all.includes(timezone) ? all : [timezone, ...all];
  }, [timezone]);

  return (
    <Modal title="SETTINGS" meta="TEMPO · SINGLE ACCOUNT" onClose={onClose}>
      <Section label="ACCOUNT">
        <div className="flex items-center gap-3 border border-hair px-3 py-2.5">
          <span className="label shrink-0">IDENTITY</span>
          <span
            className={`min-w-0 flex-1 truncate text-[12px] text-ink ${reveal ? '' : 'redacted'}`}
          >
            {email || '—'}
          </span>
          <button
            onClick={() => setReveal((v) => !v)}
            className="label shrink-0 hover:text-dim"
            aria-pressed={reveal}
          >
            {reveal ? 'HIDE' : 'SHOW'}
          </button>
        </div>

        <div className="mt-2 flex">
          <Button type="button" className="ml-auto shrink-0" onClick={onSignOut} disabled={readOnly}>
            {readOnly ? 'PREVIEW' : 'SIGN OUT'}
          </Button>
        </div>
      </Section>

      <Section label="TIME" meta={`TODAY IS ${todayIn(timezone)}`}>
        <label className="block">
          <span className="label mb-1.5 block">DISPLAY TIMEZONE</span>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className={inputClass}
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
      </Section>

      <Categories />

      <Section label="DATA" meta={`${events.length} ENTRIES · ${overrides.length} EXCEPTIONS`}>
        <a
          href="/api/export"
          className="inline-block border border-hair px-3 py-2 text-[10px] tracking-[0.14em] text-dim transition-colors hover:border-hairlit hover:text-ink"
        >
          EXPORT ALL AS JSON
        </a>
      </Section>

      <RecentlyDeleted />

      <Section label="KEYS">
        {/* Two pairs per row rather than one long ladder. The list roughly
            doubled when the grid gestures landed, and fifteen full-width rows
            turned the section people read most into the longest scroll in the
            modal. */}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 sm:grid-cols-[auto_1fr_auto_1fr] sm:gap-x-4">
        {/* Keyed on the meaning rather than the caps: DRAG means two different
            things depending on what is under the pointer, so the caps stopped
            being unique the moment the lasso landed. */}
          {SHORTCUTS.map(({ keys, joiner, meaning }) => (
            <div key={meaning} className="contents">
              <dt className="flex items-center gap-1 whitespace-nowrap">
                {keys.map((k, i) => (
                  <span key={k} className="flex items-center gap-1">
                    {i > 0 && joiner && <span className="text-[10px] text-mute">{joiner}</span>}
                    <Keycap>{k}</Keycap>
                  </span>
                ))}
              </dt>
              <dd className="self-center text-[11px] leading-tight text-dim">{meaning}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </Modal>
  );
}

/**
 * A key, drawn as a key.
 *
 * Deliberately not `.label` — that utility is 10px, uppercase, `0.14em`
 * tracking and `--color-mute`, which is the quietest combination in the system
 * and was being spent on the one block of text in the app that people are here
 * to read. Tracking in particular is wrong on a keycap: it makes `ESC` look
 * like three keys.
 */
function Keycap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[18px] items-center justify-center border border-hairlit bg-raised px-1 py-0.5 text-[10px] leading-none tracking-normal text-dim">
      {children}
    </kbd>
  );
}

/**
 * The deletion pool, described as what it is.
 *
 * It is a few minutes of second thoughts, not an archive — there is no
 * `deleted_at` column behind it and nothing here survives a reload. Both the
 * header and the empty state say so outright, because a section called
 * RECENTLY DELETED is otherwise read as a trash can, and finding out it was not
 * one costs you the entry you were counting on it for.
 */
function RecentlyDeleted() {
  const pool = useCalendar((s) => s.recentlyDeleted);
  const restoreDeleted = useCalendar((s) => s.restoreDeleted);
  const purgeDeleted = useCalendar((s) => s.purgeDeleted);
  const timezone = useCalendar((s) => s.timezone);

  return (
    <Section
      label="RECENTLY DELETED"
      meta={pool.length > 0 ? `${pool.length} · THIS SESSION ONLY` : 'THIS SESSION ONLY'}
    >
      {pool.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-mute">
          Nothing deleted yet. Anything you delete lands here until the tab
          closes — a reload empties it. This is an undo, not a backup.
        </p>
      ) : (
        <>
          <ul className="border border-hair">
            {pool.map((entry) => (
              <li
                key={entry.event.id}
                className="flex items-center gap-2 border-b border-hair px-2 py-1.5 last:border-b-0"
              >
                <span className="w-4 shrink-0 text-center text-[11px] text-mute">
                  {glyphFor(entry.event)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-ink">
                  {entry.event.title}
                </span>
                {/* Exceptions are the part of a delete you can't reconstruct by
                    retyping, so the count is worth saying out loud. */}
                {entry.overrides.length > 0 && (
                  <span className="label shrink-0">{entry.overrides.length} EXC</span>
                )}
                <span className="label shrink-0 tabular-nums">{clock(entry.at, timezone)}</span>
                <Button type="button" variant="quiet" onClick={() => restoreDeleted(entry.event.id)}>
                  RESTORE
                </Button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => purgeDeleted()}
            className="label mt-2 border border-hair px-2.5 py-1.5 transition-colors hover:border-hairlit hover:text-dim"
          >
            CLEAR
          </button>
        </>
      )}
    </Section>
  );
}

/**
 * The mark the bar was wearing when it was deleted.
 *
 * A task is drawn by its status everywhere else in the app, so a done one that
 * came back in this list as an empty box would be the only place `[x]` turns
 * into `[ ]` without anyone unticking it.
 */
function glyphFor(e: TempoEvent): string {
  if (e.kind === 'assignment') return e.status ? STATUS_GLYPH[e.status] : '[ ]';
  return KIND_GLYPH[e.kind];
}

const STATUS_GLYPH: Record<EventStatus, string> = { todo: '[ ]', doing: '[~]', done: '[x]' };

const KIND_GLYPH: Record<EventKind, string> = {
  event: '·',
  assignment: '[ ]',
  birthday: '✳',
  milestone: '◆',
};

/**
 * When it went, as a clock reading rather than an age.
 *
 * "4M AGO" would be the friendlier phrasing and is the wrong one here: it is
 * only true at the instant it renders, so it needs either a ticking timer or a
 * clock read during render, and both are a lot of machinery for a line nobody
 * reads twice. A time is still true five minutes later. 24-hour and zero-padded,
 * the same as every other time in the app, in the zone the calendar is set to.
 */
function clock(at: number, timezone: string): string {
  const minutes = minutesInZone(new Date(at), timezone);
  const h = Math.floor(minutes / 60);
  return `${String(h).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Category CRUD.
 *
 * The palette is fixed rather than a free colour input. These eight are tuned
 * to sit on near-black without vibrating and to stay distinguishable as a 2px
 * left border, which is the size they are actually read at; an arbitrary picker
 * gives that up in exchange for a freedom nobody needs. Past eight, colours
 * repeat — a duplicate is a smaller problem than an unreadable one.
 */
function Categories() {
  const categories = useCalendar((s) => s.categories);
  const events = useCalendar((s) => s.events);
  const createCategory = useCalendar((s) => s.createCategory);
  const updateCategory = useCalendar((s) => s.updateCategory);
  const deleteCategory = useCalendar((s) => s.deleteCategory);

  const [draft, setDraft] = useState<{ name: string; color: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of events) {
      if (e.categoryId) counts.set(e.categoryId, (counts.get(e.categoryId) ?? 0) + 1);
    }
    return counts;
  }, [events]);

  /** Next unused palette entry, so a new category doesn't clash by default. */
  function suggestColor(): string {
    const taken = new Set(categories.map((c) => c.color));
    return CATEGORY_PALETTE.find((c) => !taken.has(c)) ?? CATEGORY_PALETTE[0];
  }

  async function commitDraft() {
    if (!draft) return;
    const name = draft.name.trim();
    setDraft(null);
    if (name) await createCategory(name, draft.color);
  }

  return (
    <Section label="CATEGORIES" meta={`${categories.length}`}>
      {categories.length === 0 && !draft ? (
        <span className="label">NONE YET</span>
      ) : (
        <ul className="border border-hair">
          {categories.map((c) => {
            const count = usage.get(c.id) ?? 0;
            return (
              <li key={c.id} className="border-b border-hair last:border-b-0">
                {confirming === c.id ? (
                  <div className="flex items-center gap-3 px-2 py-2">
                    <span className="min-w-0 flex-1 truncate text-[11px] text-dim">
                      Delete “{c.name}” and uncategorise {count}{' '}
                      {count === 1 ? 'entry' : 'entries'}?
                    </span>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={async () => {
                        setConfirming(null);
                        await deleteCategory(c.id);
                      }}
                    >
                      DELETE
                    </Button>
                    <Button type="button" variant="quiet" onClick={() => setConfirming(null)}>
                      KEEP
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-2 py-1.5">
                    <Swatch
                      color={c.color}
                      onPick={(color) => updateCategory(c.id, { color })}
                    />
                    <NameInput
                      value={c.name}
                      onCommit={(name) => updateCategory(c.id, { name })}
                    />
                    <span className="label w-8 shrink-0 text-right tabular-nums">{count}</span>
                    <button
                      type="button"
                      // Nothing is deleted on this click when the category is in
                      // use: the count is the thing you need before deciding,
                      // and it is not on screen until you ask.
                      onClick={() => (count === 0 ? deleteCategory(c.id) : setConfirming(c.id))}
                      aria-label={`Delete ${c.name}`}
                      className="shrink-0 px-1 text-[12px] leading-none text-mute transition-colors hover:text-ink"
                    >
                      ×
                    </button>
                  </div>
                )}
              </li>
            );
          })}

          {draft && (
            <li className="flex items-center gap-2 border-t border-hair px-2 py-1.5">
              <Swatch
                color={draft.color}
                onPick={(color) => setDraft((d) => (d ? { ...d, color } : d))}
              />
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))}
                onBlur={commitDraft}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitDraft();
                  }
                  // Escape has to stop here. The shell's keymap would otherwise
                  // take it and close the whole settings modal, discarding a
                  // half-typed name and three other decisions with it.
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setDraft(null);
                  }
                }}
                placeholder="…"
                className="min-w-0 flex-1 border-none bg-transparent px-1 py-1 text-[11px] text-ink outline-none placeholder:text-mute"
              />
            </li>
          )}
        </ul>
      )}

      {!draft && (
        <button
          type="button"
          onClick={() => setDraft({ name: '', color: suggestColor() })}
          className="label mt-2 border border-hair px-2.5 py-1.5 transition-colors hover:border-hairlit hover:text-dim"
        >
          + ADD
        </button>
      )}
    </Section>
  );
}

/** The colour cell, and the eight-swatch grid it opens. */
function Swatch({ color, onPick }: { color: string; onPick: (color: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change colour"
        aria-expanded={open}
        className="block h-4 w-4 border border-hair transition-colors hover:border-hairlit"
        style={{ background: color }}
      />
      {open && (
        <>
          {/* Catches the dismissing click. A window listener would race the
              button's own onClick and reopen what it just closed. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-5 z-20 grid grid-cols-4 gap-1 border border-hairlit bg-panel p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.7)]">
            {CATEGORY_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onPick(c);
                  setOpen(false);
                }}
                aria-label={c}
                className={`h-4 w-4 border transition-colors ${
                  c === color ? 'border-bright' : 'border-transparent hover:border-hairlit'
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Edits locally, writes on commit. Writing on every keystroke would put one
 * optimistic round-trip per character through the store, and a rollback
 * mid-word would fight the caret.
 */
function NameInput({ value, onCommit }: { value: string; onCommit: (name: string) => void }) {
  const [text, setText] = useState(value);

  function commit() {
    const next = text.trim();
    if (!next) return setText(value); // a category with no name is not a name change
    if (next !== value) onCommit(next);
  }

  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') {
          e.stopPropagation();
          setText(value);
          e.currentTarget.blur();
        }
      }}
      className="min-w-0 flex-1 border-none bg-transparent px-1 py-1 text-[11px] text-ink outline-none transition-colors hover:bg-sunken focus:bg-sunken"
    />
  );
}
