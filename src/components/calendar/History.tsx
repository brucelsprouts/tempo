'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useCalendar } from '@/lib/store/calendar-store';
import { todayIn } from '@/lib/tempo/civil';
import type { EventVersion, TempoEvent } from '@/lib/tempo/types';
import { MONTHS, glyphFor, stamp } from './constants';
import { Button, Modal, SegmentedControl } from './ui';

/**
 * What the calendar used to look like, in two answers.
 *
 * They are separate mechanisms on purpose and the panel keeps them side by
 * side rather than merging them into one feed. A trash cannot answer "what did
 * this look like last Tuesday" and a version log cannot answer "what did I
 * delete" — so a single list would have to pretend one of those questions was
 * the other, and the one it dropped is the one you would come here for.
 *
 * Not a section in Settings. The deleted pool lived there once and was not
 * found, which is most of why this surface exists at all.
 */

interface Props {
  /** The entry to open the version list on, when arriving from a form. */
  focus?: string;
  onClose: () => void;
}

export function History({ focus, onClose }: Props) {
  const deleted = useCalendar((s) => s.deleted);
  const events = useCalendar((s) => s.events);
  const timezone = useCalendar((s) => s.timezone);
  const loadVersions = useCalendar((s) => s.loadVersions);

  const [selected, setSelected] = useState<string | null>(focus ?? null);
  const wide = useWide();
  const [pane, setPane] = useState<'deleted' | 'versions'>(focus ? 'versions' : 'deleted');

  // The list belongs to whichever entry is selected, and the store holds one
  // list at a time — so asking for it is an effect of the selection rather than
  // something every click site has to remember to do.
  useEffect(() => {
    if (selected) void loadVersions(selected);
  }, [selected, loadVersions]);

  const subject =
    selected === null
      ? null
      : (events.find((e) => e.id === selected) ?? deleted.find((e) => e.id === selected) ?? null);

  function choose(id: string) {
    setSelected(id);
    setPane('versions');
  }

  return (
    <Modal
      size="day"
      title="HISTORY"
      meta={`${deleted.length} IN TRASH · KEPT ${TRASH_DAYS} DAYS`}
      onClose={onClose}
    >
      {!wide && (
        <div className="border-b border-hair px-3 py-2">
          <SegmentedControl
            value={pane}
            options={[
              { value: 'deleted', label: 'DELETED' },
              { value: 'versions', label: 'VERSIONS' },
            ]}
            onChange={setPane}
            grow={false}
          />
        </div>
      )}

      <div className={wide ? 'grid grid-cols-2 divide-x divide-hair' : ''}>
        {(wide || pane === 'deleted') && (
          <div className="h-[52vh] min-h-0 overflow-y-auto">
            <DeletedPane selected={selected} onSelect={choose} timezone={timezone} />
          </div>
        )}
        {(wide || pane === 'versions') && (
          <div className="h-[52vh] min-h-0 overflow-y-auto">
            <VersionsPane subject={subject} selected={selected} timezone={timezone} />
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Stated in the header, and enforced by the store on load. Kept in step by hand. */
const TRASH_DAYS = 30;

// ---------------------------------------------------------------- the trash

function DeletedPane({
  selected,
  onSelect,
  timezone,
}: {
  selected: string | null;
  onSelect: (id: string) => void;
  timezone: string;
}) {
  const deleted = useCalendar((s) => s.deleted);
  const restoreDeleted = useCalendar((s) => s.restoreDeleted);
  const purgeDeleted = useCalendar((s) => s.purgeDeleted);
  const today = todayIn(timezone);

  /**
   * Both actions ask first, and the question is not the same question.
   *
   * Purge is the only irreversible thing left in the app, so its confirmation
   * is doing real work. Restore's is doing something smaller: putting an entry
   * back changes what the calendar shows on a date you are probably not looking
   * at, and the click that does it sits directly above the one that destroys
   * the entry forever. The pause is worth more as a way of separating those two
   * buttons than as a guard on restoring itself, which you can always undo by
   * deleting again.
   *
   * One piece of state for both, keyed by entry, so two confirmations can never
   * be open at once — a row asking "delete forever?" while another asks "put
   * this back?" is two questions competing for the same Enter key.
   *
   * Held in state rather than `window.confirm` so the question looks like the
   * rest of the interface, and so it cannot block the event loop.
   */
  const [confirming, setConfirming] = useState<{
    action: 'purge' | 'restore';
    id: string | 'all';
  } | null>(null);

  const asking = (action: 'purge' | 'restore', id: string) =>
    confirming?.action === action && confirming.id === id;

  return (
    <div>
      <PaneHeader label="DELETED">
        {deleted.length > 0 &&
          (asking('purge', 'all') ? (
            <span className="flex items-center gap-1.5">
              <span className="label text-dim">FOREVER?</span>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setConfirming(null);
                  void purgeDeleted();
                }}
              >
                PURGE {deleted.length}
              </Button>
              <Button type="button" variant="quiet" onClick={() => setConfirming(null)}>
                KEEP
              </Button>
            </span>
          ) : asking('restore', 'all') ? (
            <span className="flex items-center gap-1.5">
              <span className="label text-dim">ALL OF IT?</span>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setConfirming(null);
                  void restoreDeleted();
                }}
              >
                RESTORE {deleted.length}
              </Button>
              <Button type="button" variant="quiet" onClick={() => setConfirming(null)}>
                CANCEL
              </Button>
            </span>
          ) : (
            // Restore first, purge second, and the destructive one last in
            // reading order — the two sit a few pixels apart and only one of
            // them can be taken back.
            <span className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="quiet"
                onClick={() => setConfirming({ action: 'restore', id: 'all' })}
              >
                RESTORE ALL
              </Button>
              <Button
                type="button"
                variant="quiet"
                onClick={() => setConfirming({ action: 'purge', id: 'all' })}
              >
                PURGE ALL
              </Button>
            </span>
          ))}
      </PaneHeader>

      {deleted.length === 0 ? (
        <Empty>
          Nothing deleted. Anything you remove lands here for {TRASH_DAYS} days, with its
          exceptions intact, and can be put back whole.
        </Empty>
      ) : (
        <ul>
          {deleted.map((entry) => (
            <li
              key={entry.id}
              className={`border-b border-hair last:border-b-0 ${
                selected === entry.id ? 'bg-sunken' : ''
              }`}
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  onClick={() => onSelect(entry.id)}
                  // The row is the way into the version list, so the whole of
                  // it is the target rather than a separate chevron.
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  {/* `w-5` and no wrapping: the task glyphs are three
                      characters (`[ ]`, `[x]`), which overflow a 16px column
                      and break across two lines — so a deleted task rendered
                      as a bracket stacked on a bracket. */}
                  <span className="w-5 shrink-0 whitespace-nowrap text-center text-[11px] text-mute">
                    {glyphFor(entry)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-ink">
                    {entry.title}
                  </span>
                  <span className="label shrink-0">{when(entry)}</span>
                </button>

                <span className="label shrink-0 tabular-nums">
                  {entry.deletedAt ? stamp(entry.deletedAt, timezone, today) : ''}
                </span>
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => setConfirming({ action: 'restore', id: entry.id })}
                >
                  RESTORE
                </Button>
              </div>

              {/* One strip, three states. Only ever one question per row: asking
                  both at once would put two primary buttons a few pixels apart,
                  one of which is permanent. */}
              {asking('restore', entry.id) ? (
                <div className="flex items-center gap-1.5 px-3 pb-2">
                  <span className="label text-dim">PUT IT BACK?</span>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => {
                      setConfirming(null);
                      void restoreDeleted(entry.id);
                    }}
                  >
                    RESTORE
                  </Button>
                  <Button type="button" variant="quiet" onClick={() => setConfirming(null)}>
                    CANCEL
                  </Button>
                </div>
              ) : asking('purge', entry.id) ? (
                <div className="flex items-center gap-1.5 px-3 pb-2">
                  <span className="label text-dim">DELETE FOREVER?</span>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => {
                      setConfirming(null);
                      void purgeDeleted(entry.id);
                    }}
                  >
                    PURGE
                  </Button>
                  <Button type="button" variant="quiet" onClick={() => setConfirming(null)}>
                    KEEP
                  </Button>
                </div>
              ) : (
                <div className="px-3 pb-2">
                  <button
                    type="button"
                    onClick={() => setConfirming({ action: 'purge', id: entry.id })}
                    className="label hover:text-dim"
                  >
                    PURGE
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// -------------------------------------------------------------- the versions

function VersionsPane({
  subject,
  selected,
  timezone,
}: {
  subject: TempoEvent | null;
  selected: string | null;
  timezone: string;
}) {
  const versions = useCalendar((s) => s.versions);
  const versionsFor = useCalendar((s) => s.versionsFor);
  const rollbackTo = useCalendar((s) => s.rollbackTo);
  const today = todayIn(timezone);

  if (!selected) {
    return (
      <div>
        <PaneHeader label="VERSIONS" />
        <Empty>
          Pick an entry to see how it has changed. Every edit records the shape it replaced:
          all of today&rsquo;s, then one a day for a month, then one a month for a year.
        </Empty>
      </div>
    );
  }

  // The store holds one entry's list at a time, so a selection whose fetch has
  // not landed yet would otherwise render the *previous* entry's versions under
  // this entry's name — which is the one wrong thing this panel could say.
  const settled = versionsFor === selected;

  return (
    <div>
      <PaneHeader label="VERSIONS" meta={subject ? subject.title : undefined} />

      {!settled ? (
        <Empty>Reading…</Empty>
      ) : versions.length === 0 ? (
        <Empty>
          No recorded versions. History starts at the next edit — nothing before this feature
          existed was written down.
        </Empty>
      ) : (
        <ul>
          {versions.map((v, i) => (
            <li key={v.id} className="border-b border-hair px-3 py-2 last:border-b-0">
              <div className="flex items-center gap-2">
                <span className="label shrink-0 tabular-nums">{stamp(v.createdAt, timezone, today)}</span>
                <span className="label shrink-0 text-dim">{v.reason.toUpperCase()}</span>
                <Button
                  type="button"
                  variant="quiet"
                  className="ml-auto shrink-0"
                  onClick={() => void rollbackTo(v.id)}
                >
                  ROLL BACK
                </Button>
              </div>
              <p className="mt-1 text-[11px] leading-tight text-mute">
                {/* Compared against the version *after* it — the shape that
                    replaced this one — because that is the change this row
                    records. The newest version is compared against what is on
                    the calendar right now. */}
                {describe(v, i === 0 ? subject : versions[i - 1].snapshot.event)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What changed, in one line.
 *
 * Deliberately shallow: the fields people actually recognise an entry by. A
 * full structural diff would be more complete and less readable, and the row
 * exists to let you find the version you want, not to be the record itself —
 * the snapshot is that.
 */
function describe(version: EventVersion, next: TempoEvent | null): string {
  const was = version.snapshot.event;
  if (!next) return `${was.title} · ${when(was)}`;

  const changes: string[] = [];
  if (was.title !== next.title) changes.push(`title “${was.title}”`);
  if (when(was) !== when(next)) changes.push(`when ${when(was)}`);
  if (was.status !== next.status) changes.push(`status ${was.status ?? 'none'}`);
  if (was.notes !== next.notes) changes.push('notes');
  if (countOf(version) !== null) changes.push(`${countOf(version)} exceptions`);

  return changes.length === 0 ? 'No visible difference' : `Was: ${changes.join(' · ')}`;
}

/** Exception count, but only when there is one worth mentioning. */
function countOf(version: EventVersion): number | null {
  const n = version.snapshot.overrides.length;
  return n > 0 ? n : null;
}

/** An entry's span, short enough to sit at the end of a row. */
function when(e: Pick<TempoEvent, 'allDay' | 'startDate' | 'endDate' | 'startsAt'>): string {
  const iso = e.allDay ? e.startDate : e.startsAt?.slice(0, 10);
  if (!iso) return '—';
  const [, month, day] = iso.split('-');
  const label = `${MONTHS[Number(month) - 1]} ${day}`;
  return e.allDay && e.endDate && e.endDate !== e.startDate
    ? `${label}–${e.endDate.slice(8)}`
    : label;
}

// ------------------------------------------------------------------ furniture

function PaneHeader({
  label,
  meta,
  children,
}: {
  label: string;
  meta?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-hair px-3 py-2">
      <span className="label text-dim">{label}</span>
      {meta && <span className="label min-w-0 truncate">{meta}</span>}
      <span className="ml-auto shrink-0">{children}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-3 text-[11px] leading-relaxed text-mute">{children}</p>;
}

/**
 * Two panes or one, decided once — the same rule the day modal uses, and for
 * the same reason: rendering both and hiding one with `lg:hidden` mounts two
 * scroll containers, and the hidden one has no height to scroll.
 */
function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(min-width: 1024px)');
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia('(min-width: 1024px)').matches,
    () => true,
  );
}
