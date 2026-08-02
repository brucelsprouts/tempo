'use client';

import {
  Fragment,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
  type Ref,
} from 'react';
import { groupOverrides, useCalendar } from '@/lib/store/calendar-store';
import { getClipboard, setClipboard } from '@/lib/store/clipboard';
import { addDays, diffDays, parts, todayIn, type CivilDate } from '@/lib/tempo/civil';
import { expandAll, expandEvent, eventSpan } from '@/lib/tempo/recurrence';
import type { Occurrence, Recurrence, TempoEvent } from '@/lib/tempo/types';
import { DEFAULT_CATEGORY_COLOR, MONTHS, WEEKDAYS } from './constants';
import { inputClass, SegmentedControl } from './ui';

/**
 * The dataset behind the grid.
 *
 * Rows are stored *events*, not occurrences: a birthday is one entry that
 * happens 60 times, and a table that repeated it 60 times would be a log rather
 * than a database. The expansion still shows up, as a NEXT column — which is
 * the one derived fact you actually want when scanning the whole set.
 */

/** How far ahead to look for each row's next occurrence. Covers a yearly rule. */
const HORIZON_DAYS = 400;

type SortKey = 'title' | 'kind' | 'repeat' | 'start' | 'next' | 'category' | 'status';
type GroupKey = 'none' | 'kind' | 'category' | 'status';

const GROUPS = [
  { value: 'none', label: 'FLAT' },
  { value: 'kind', label: 'TYPE' },
  { value: 'category', label: 'CATEGORY' },
  { value: 'status', label: 'STATUS' },
] as const;

const KIND_LABEL: Record<string, string> = {
  event: 'EVENT',
  assignment: 'TASK',
  birthday: 'BIRTHDAY',
  milestone: 'MARK',
};

const STATUS_GLYPH = { todo: '[ ]', doing: '[~]', done: '[x]' } as const;

interface Row {
  event: TempoEvent;
  /** What the editor opens on. Null only if the event has no resolvable span. */
  occ: Occurrence | null;
  start: CivilDate;
  end: CivilDate;
  next: CivilDate | null;
  repeat: string;
  categoryName: string;
  color: string;
  haystack: string;
}

export function describeRecurrence(r: Recurrence | null): string {
  if (!r) return 'ONCE';
  const n = Math.max(1, r.interval ?? 1);
  const unit = { DAILY: 'DAY', WEEKLY: 'WEEK', MONTHLY: 'MONTH', YEARLY: 'YEAR' }[r.freq];
  const every = n === 1 ? `EVERY ${unit}` : `EVERY ${n} ${unit}S`;
  const days = r.byWeekday?.length
    ? ` ${[...r.byWeekday].sort((a, b) => a - b).map((d) => WEEKDAYS[d]).join('/')}`
    : '';
  const bound = r.until ? ` → ${r.until}` : r.count ? ` ×${r.count}` : '';
  return every + days + bound;
}

/** `2026-07-31` → `31 JUL 26`, which stays one column wide at every date. */
function shortDate(d: CivilDate): string {
  const { year, month, day } = parts(d);
  return `${String(day).padStart(2, '0')} ${MONTHS[month - 1]} ${String(year).slice(2)}`;
}

function relative(d: CivilDate, today: CivilDate): string {
  const n = diffDays(d, today);
  if (n === 0) return 'TODAY';
  if (n === 1) return 'TOMORROW';
  if (n > 0) return `IN ${n}D`;
  // The search window starts today, so a start date in the past can only be a
  // multi-day entry that is currently running — not something overdue.
  return 'IN PROGRESS';
}

/** Stable identity for "nothing is selected", so clearing twice re-renders once. */
const NOTHING: ReadonlySet<string> = new Set();

/**
 * What the table answers to, for the shell that owns the keymap.
 *
 * The same shape `CalendarHandle` exposes, so the shell can route one chord to
 * whichever view is up without knowing which one that is.
 */
export interface ListHandle {
  /** Reports whether there was a selection to clear. */
  unwind: () => boolean;
  /** Reports how many entries it took, so the shell can say so. */
  copySelection: () => number;
  duplicateSelection: () => boolean;
  pasteClipboard: () => boolean;
}

interface Props {
  onOpen: (occ: Occurrence) => void;
  onNew: () => void;
  searchRef?: Ref<HTMLInputElement>;
  ref?: Ref<ListHandle>;
}

export function ListView({ onOpen, onNew, searchRef, ref }: Props) {
  const events = useCalendar((s) => s.events);
  const overrides = useCalendar((s) => s.overrides);
  const categories = useCalendar((s) => s.categories);
  const timezone = useCalendar((s) => s.timezone);

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'next', dir: 1 });
  const [group, setGroup] = useState<GroupKey>('none');

  const today = useMemo(() => todayIn(timezone), [timezone]);

  const rows = useMemo<Row[]>(() => {
    const byEvent = groupOverrides(overrides);

    // One expansion pass for the whole table: the first occurrence each event
    // still has ahead of it.
    const nextByEvent = new Map<string, CivilDate>();
    for (const occ of expandAll(events, byEvent, today, addDays(today, HORIZON_DAYS))) {
      if (!nextByEvent.has(occ.eventId)) nextByEvent.set(occ.eventId, occ.date);
    }

    return events.map((event) => {
      const span = eventSpan(event);
      const overridesFor = byEvent.get(event.id) ?? [];
      // Prefer something upcoming to edit; fall back to the series head so a
      // fully-past entry is still openable.
      const occ =
        (span
          ? expandEvent(event, overridesFor, today, addDays(today, HORIZON_DAYS))[0] ??
            expandEvent(event, overridesFor, span.start, span.end)[0]
          : undefined) ?? null;
      const category = categories.find((c) => c.id === event.categoryId);

      return {
        event,
        occ,
        start: span?.start ?? '—',
        end: span?.end ?? '—',
        next: nextByEvent.get(event.id) ?? null,
        repeat: describeRecurrence(event.recurrence),
        categoryName: category?.name ?? '—',
        color: category?.color ?? DEFAULT_CATEGORY_COLOR,
        haystack: [event.title, event.notes ?? '', category?.name ?? '', event.kind]
          .join(' ')
          .toLowerCase(),
      };
    });
  }, [events, overrides, categories, today]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q ? rows.filter((r) => r.haystack.includes(q)) : rows;

    const value = (r: Row): string => {
      switch (sort.key) {
        case 'title':
          return r.event.title.toLowerCase();
        case 'kind':
          return r.event.kind;
        case 'repeat':
          return r.repeat;
        case 'start':
          return r.start;
        // Rows with nothing ahead sort to the end in either direction rather
        // than pretending to be the year 0.
        case 'next':
          return r.next ?? '￿';
        case 'category':
          return r.categoryName;
        case 'status':
          return r.event.status ?? '￿';
      }
    };

    return [...matched].sort((a, b) => {
      const d = value(a).localeCompare(value(b));
      return (d !== 0 ? d : a.event.title.localeCompare(b.event.title)) * sort.dir;
    });
  }, [rows, query, sort]);

  const sections = useMemo(() => {
    if (group === 'none') return [{ label: null as string | null, rows: filtered }];

    const key = (r: Row) => {
      if (group === 'kind') return KIND_LABEL[r.event.kind] ?? r.event.kind.toUpperCase();
      if (group === 'category') return r.categoryName.toUpperCase();
      return (r.event.status ?? 'NONE').toUpperCase();
    };

    const map = new Map<string, Row[]>();
    for (const r of filtered) {
      const k = key(r);
      const list = map.get(k);
      if (list) list.push(r);
      else map.set(k, [r]);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, rs]) => ({ label, rows: rs }));
  }, [filtered, group]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  }

  // ------------------------------------------------------------- selection

  /**
   * The rows as one list, in the order they are drawn.
   *
   * A shift-click means "everything between these two", and *between* is a fact
   * about what you can see — the sort and the grouping both reorder the table,
   * so a range resolved against the underlying events would light up rows the
   * gesture never crossed.
   */
  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  /**
   * Rows a selection can hold. A Google-sourced entry refuses every edit a
   * selection can apply, so it never enters one — the same rule the grid
   * applies to its bars, and the reason the checkbox on such a row is dead.
   */
  const selectable = useMemo(
    () => flat.filter((r) => r.occ !== null && !r.occ.readOnly),
    [flat],
  );

  const [selection, setSelection] = useState<ReadonlySet<string>>(NOTHING);
  /** Where the last plain toggle landed, which is what a shift-click ranges from. */
  const [anchor, setAnchor] = useState<string | null>(null);

  const selectedRows = useMemo(
    () => selectable.filter((r) => selection.has(r.event.id)),
    [selectable, selection],
  );

  const clear = useCallback(() => {
    setSelection(NOTHING);
    setAnchor(null);
  }, []);

  const toggle = useCallback((id: string) => {
    setSelection((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next.size === 0 ? NOTHING : next;
    });
    setAnchor(id);
  }, []);

  /**
   * Everything between the anchor and this row, replacing what was lit.
   *
   * Explorer's rule rather than an additive one: shift-click *is* the range, so
   * dragging the far end of a selection around narrows it as well as widens it.
   * The anchor deliberately does not move — that is what makes the second, third
   * and fourth shift-click all measure from the same place.
   */
  const extendTo = useCallback(
    (id: string) => {
      const order = selectable.map((r) => r.event.id);
      const from = anchor === null ? -1 : order.indexOf(anchor);
      const to = order.indexOf(id);
      if (to === -1) return;
      // No anchor yet — the first shift-click has nothing to measure from, so
      // it behaves as a plain toggle and becomes the anchor for the next one.
      if (from === -1) {
        toggle(id);
        return;
      }
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      setSelection(new Set(order.slice(lo, hi + 1)));
    },
    [selectable, anchor, toggle],
  );

  /** Every row the filter is currently showing, or none of them. */
  const toggleAll = useCallback(() => {
    setSelection((s) =>
      s.size >= selectable.length && selectable.length > 0
        ? NOTHING
        : new Set(selectable.map((r) => r.event.id)),
    );
    setAnchor(null);
  }, [selectable]);

  const allLit = selectable.length > 0 && selectedRows.length === selectable.length;
  const someLit = selectedRows.length > 0 && !allLit;

  function handleRowClick(r: Row, e: React.MouseEvent) {
    if (e.metaKey || e.ctrlKey) {
      if (r.occ && !r.occ.readOnly) toggle(r.event.id);
      return;
    }
    if (e.shiftKey) {
      if (r.occ && !r.occ.readOnly) extendTo(r.event.id);
      return;
    }
    // Unmodified, a click still means "open this", which is what the table did
    // before it could select anything and what a row without a checkbox in
    // reach still has to do.
    if (r.occ) onOpen(r.occ);
  }

  // ------------------------------------------------- copy, paste, duplicate

  const duplicateOccurrences = useCalendar((s) => s.duplicateOccurrences);

  /**
   * The occurrences behind the lit rows.
   *
   * The table is a list of *events* and the store speaks occurrences, so this is
   * the translation between them: each row's own `occ`, which is the instance
   * the row already opens on.
   */
  const selectedOccurrences = useMemo(
    () => selectedRows.flatMap((r) => (r.occ ? [r.occ] : [])),
    [selectedRows],
  );

  useImperativeHandle(
    ref,
    () => ({
      unwind: () => {
        if (selection.size === 0) return false;
        clear();
        return true;
      },
      copySelection: () => {
        setClipboard(selectedOccurrences);
        return selectedOccurrences.length;
      },
      duplicateSelection: () => {
        if (selectedOccurrences.length === 0) return false;
        void duplicateOccurrences(selectedOccurrences, null).then((copies) =>
          setSelection(copies.length > 0 ? new Set(copies.map((e) => e.id)) : NOTHING),
        );
        return true;
      },
      /**
       * A paste here lands in place, not on a date.
       *
       * The table has no day under the cursor to land on — a row's position in
       * it is a sort order, not a date — so pasting shifts nothing and simply
       * makes the copies. Which also means ⌘C in the table and ⌘V on the grid
       * do place entries somewhere, because there the pointer has an answer.
       */
      pasteClipboard: () => {
        const held = getClipboard();
        if (held.length === 0) return false;
        void duplicateOccurrences([...held], null).then((copies) =>
          setSelection(copies.length > 0 ? new Set(copies.map((e) => e.id)) : NOTHING),
        );
        return true;
      },
    }),
    [selection, clear, selectedOccurrences, duplicateOccurrences],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-hair px-4 py-2.5">
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="FILTER…  [/]"
          className={`${inputClass} w-[220px] py-1.5`}
          aria-label="Filter entries"
        />

        <div className="flex items-center gap-2">
          <span className="label">GROUP</span>
          <SegmentedControl value={group} options={GROUPS} onChange={setGroup} grow={false} />
        </div>

        <span className="label">
          {filtered.length} / {rows.length} ENTRIES
        </span>

        {/* Only while there is one. A permanent readout of zero would be a
            label for a state the table is in almost all of the time. */}
        {selectedRows.length > 0 && (
          <button
            onClick={clear}
            className="label border border-hairlit px-2 py-1 text-dim transition-colors hover:text-ink"
          >
            {selectedRows.length} SELECTED · CLEAR [ESC]
          </button>
        )}

        <button
          onClick={onNew}
          className="label ml-auto border border-hair px-2.5 py-1.5 transition-colors hover:border-hairlit hover:text-ink"
        >
          + NEW [A]
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[860px] border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="border-b border-hairlit">
              <th className="w-[44px] px-3 py-2 text-left font-normal">
                <Check
                  state={allLit ? 'on' : someLit ? 'some' : 'off'}
                  onClick={toggleAll}
                  label={allLit ? 'Clear selection' : 'Select all entries'}
                  disabled={selectable.length === 0}
                />
              </th>
              <HeadCell label="TITLE" col="title" sort={sort} onSort={toggleSort} wide />
              <HeadCell label="TYPE" col="kind" sort={sort} onSort={toggleSort} />
              <HeadCell label="REPEATS" col="repeat" sort={sort} onSort={toggleSort} />
              <HeadCell label="SPAN" col="start" sort={sort} onSort={toggleSort} />
              <HeadCell label="NEXT" col="next" sort={sort} onSort={toggleSort} />
              <HeadCell label="CATEGORY" col="category" sort={sort} onSort={toggleSort} />
              <HeadCell label="STATUS" col="status" sort={sort} onSort={toggleSort} />
            </tr>
          </thead>

          <tbody>
            {sections.map((section) => (
              <Fragment key={section.label ?? '·'}>
                {section.label && (
                  <tr>
                    <td colSpan={8} className="border-y border-hair bg-sunken px-3 py-1.5">
                      <span className="label text-dim">{section.label}</span>
                      <span className="label ml-2">{section.rows.length}</span>
                    </td>
                  </tr>
                )}

                {section.rows.map((r) => {
                  const past = r.next === null;
                  const lit = selection.has(r.event.id);
                  const locked = !r.occ || r.occ.readOnly;
                  return (
                    <tr
                      key={r.event.id}
                      onClick={(e) => handleRowClick(r, e)}
                      // A shift-click is a range here, and the browser's own
                      // reading of it — extend the text selection — would paint
                      // half the table blue on the way.
                      onMouseDown={(e) => {
                        if (e.shiftKey) e.preventDefault();
                      }}
                      aria-selected={lit}
                      className={`cursor-pointer border-b border-hair transition-colors ${
                        lit ? 'bg-raised' : 'hover:bg-raised'
                      }`}
                    >
                      <td className="px-3 py-2">
                        <Check
                          state={lit ? 'on' : 'off'}
                          disabled={locked}
                          label={`Select ${r.event.title}`}
                          // The checkbox selects and never opens, so the press
                          // must not reach the row's own handler.
                          onClick={(e) => {
                            e.stopPropagation();
                            if (e.shiftKey) extendTo(r.event.id);
                            else toggle(r.event.id);
                          }}
                        />
                      </td>
                      <td className="max-w-0 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-[2px] shrink-0"
                            style={{ background: r.color }}
                            aria-hidden
                          />
                          <span
                            className={`truncate ${r.event.status === 'done' ? 'text-mute line-through' : 'text-ink'}`}
                          >
                            {r.event.title}
                          </span>
                          {r.event.notify && <span className="label shrink-0">SYNC</span>}
                        </div>
                      </td>
                      <td className="label px-3 py-2 whitespace-nowrap">
                        {KIND_LABEL[r.event.kind] ?? r.event.kind}
                      </td>
                      <td className="label px-3 py-2 whitespace-nowrap">{r.repeat}</td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums text-dim">
                        {r.start === '—' ? (
                          <span className="label">—</span>
                        ) : (
                          <>
                            {shortDate(r.start)}
                            {r.end !== r.start && (
                              <span className="text-mute"> → {shortDate(r.end)}</span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                        {r.next ? (
                          <>
                            <span className={past ? 'text-mute' : 'text-ink'}>
                              {shortDate(r.next)}
                            </span>
                            <span className="label ml-2">{relative(r.next, today)}</span>
                          </>
                        ) : (
                          <span className="label">PAST</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-dim">{r.categoryName}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-dim">
                        {r.event.status ? (
                          <>
                            <span className="text-mute">{STATUS_GLYPH[r.event.status]}</span>{' '}
                            {r.event.status.toUpperCase()}
                          </>
                        ) : (
                          <span className="label">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-16 text-center">
                  <span className="label">
                    {rows.length === 0 ? 'NO ENTRIES YET · PRESS [A]' : 'NOTHING MATCHES'}
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * A checkbox in the notation the table already speaks.
 *
 * `[ ]` and `[x]` are not a stylisation here — they are the same glyphs the
 * STATUS column prints, so a row reads in one alphabet rather than mixing a
 * drawn control into a table made of text. `[~]` is the header's partial state,
 * borrowed from `doing` for the same reason: it already means "some of this".
 *
 * A button rather than an `<input>`, because the indeterminate state of a real
 * checkbox is only reachable through a DOM property and cannot be expressed in
 * JSX at all.
 */
function Check({
  state,
  onClick,
  label,
  disabled,
}: {
  state: 'on' | 'off' | 'some';
  onClick: (e: React.MouseEvent) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'some' ? 'mixed' : state === 'on'}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      // `whitespace-nowrap`, because the glyph is three characters wide and a
      // column sized to the content would otherwise break `[ ]` across two
      // lines at the space in the middle of it.
      className={`tap whitespace-nowrap text-[11px] tabular-nums transition-colors disabled:opacity-25 ${
        state === 'off' ? 'text-mute hover:text-dim' : 'text-ink'
      }`}
    >
      {state === 'on' ? '[x]' : state === 'some' ? '[~]' : '[ ]'}
    </button>
  );
}

function HeadCell({
  label,
  col,
  sort,
  onSort,
  wide,
}: {
  label: string;
  col: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
  wide?: boolean;
}) {
  const active = sort.key === col;
  return (
    <th className={`px-3 py-2 text-left font-normal ${wide ? 'w-[34%]' : ''}`}>
      <button
        onClick={() => onSort(col)}
        className={`label transition-colors hover:text-dim ${active ? 'text-dim' : ''}`}
      >
        {label}
        <span className="ml-1 inline-block w-2">{active ? (sort.dir === 1 ? '↑' : '↓') : ''}</span>
      </button>
    </th>
  );
}
