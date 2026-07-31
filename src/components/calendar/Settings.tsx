'use client';

import { useMemo, useState } from 'react';
import { useCalendar } from '@/lib/store/calendar-store';
import { todayIn } from '@/lib/tempo/civil';
import { Button, inputClass, Modal, Section } from './ui';

/**
 * Everything that isn't the calendar.
 *
 * This is a single-account app, so there is no account *management* here — only
 * the two facts worth having somewhere: which identity this session is, and how
 * to end it. Both were sitting in the footer, on screen permanently, which is
 * exactly the wrong place for something you look at twice a year.
 */

/** The keymap, stated once. The shell binds these; this is the reference. */
export const SHORTCUTS: ReadonlyArray<[string, string]> = [
  ['N', 'New entry — on the open day, or today'],
  ['T', 'Jump to today'],
  ['1 / 2 / 3', 'Scroll · List · Year'],
  ['/', 'Filter, in list view'],
  [', or ?', 'Settings'],
  ['ESC', 'Close the panel'],
  ['DBL-CLICK', 'Open a day'],
  ['DRAG', 'Move an entry by whole days'],
  ['SHIFT + DROP', 'Move the whole series instead'],
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
  const categories = useCalendar((s) => s.categories);
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

        <div className="mt-2 flex items-center gap-3">
          <p className="text-[10px] leading-relaxed text-mute">
            One account, no registration. Nothing here is shared.
          </p>
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
          <span className="mt-1 block text-[10px] leading-relaxed text-mute">
            Which square an instant lands on, and where today is. Stored on this
            device — each event keeps the zone it was created in.
          </span>
        </label>
      </Section>

      <Section label="CATEGORIES" meta="THE ONLY COLOUR IN THE INTERFACE">
        {categories.length === 0 ? (
          <span className="label">NONE YET</span>
        ) : (
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <span className="h-3 w-[3px]" style={{ background: c.color }} aria-hidden />
                <span className="text-[11px] text-dim">{c.name}</span>
                <span className="label">
                  {events.filter((e) => e.categoryId === c.id).length}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section label="DATA" meta={`${events.length} ENTRIES · ${overrides.length} EXCEPTIONS`}>
        <a
          href="/api/export"
          className="inline-block border border-hair px-3 py-2 text-[10px] tracking-[0.14em] text-dim transition-colors hover:border-hairlit hover:text-ink"
        >
          EXPORT ALL AS JSON
        </a>
        <p className="mt-2 text-[10px] leading-relaxed text-mute">
          Every event and exception, as stored. Recurring entries export as one
          row each — occurrences are derived, never persisted.
        </p>
      </Section>

      <Section label="KEYS">
        <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-2">
          {SHORTCUTS.map(([key, meaning]) => (
            <div key={key} className="contents">
              <dt className="label text-dim">{key}</dt>
              <dd className="text-[11px] leading-tight text-mute">{meaning}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </Modal>
  );
}
