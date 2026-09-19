# Due Times and TASK Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an all-day entry's due time on the grid, the day panel and the list, and remove TASK from the app's data model, views and code.

**Architecture:** One pure module, `src/components/calendar/due.ts`, holds every rule for saying when something is due; the bar, the day panel and the list read it. TASK is retired in the order that keeps every commit compiling: rows are read as entries first (`eventFromRow`), then each view drops its task code, then the types lose `assignment` and `status`. A data-only SQL file converts stored rows; nothing in the schema is dropped.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, Zustand, Zod 4, Vitest 4. Spec: `docs/superpowers/specs/2026-09-19-due-times-and-task-retirement-design.md`.

**House rules (from the repo):** comments explain *why*, in full sentences, British spelling. Stage explicit paths only. Commit subjects are imperative sentences (see `git log`), bodies say why, and end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. AGENTS.md: this Next.js differs from training data — nothing here touches Next-specific APIs, but read `node_modules/next/dist/docs/` before any that does.

**Baseline (2026-09-19, branch `calendar-refinements`):** `npx vitest run` → 17 files, 433 tests pass. `npx tsc --noEmit -p .` → exit 0. `npx eslint src` → 15 problems (4 errors, 11 warnings), all pre-existing: `offline/page.tsx` ×2, `YearView.tsx` ×2, `ContinuousCalendar.tsx:792`, `WeekRow.tsx:80`, `calendar-store.ts` ×6, `layout.test.ts:327` ×2, `layout.ts:105`. "No new lint problems" below means that list, no longer.

---

## File map

| File | Change |
|---|---|
| `src/components/calendar/due.ts` | **New.** `barDue`, `dayDue`, `dueMoment`, `dueSortKey`, `dueIn`. |
| `src/components/calendar/due.test.ts` | **New.** |
| `src/lib/tempo/mappers.ts` | Read `assignment` as `event`; drop `status` (two steps). |
| `src/lib/tempo/mappers.test.ts` | **New.** |
| `src/components/calendar/EventBar.tsx` | Due time beside the chip; task branch removed. |
| `src/app/globals.css` | `.bar-when`; task tier rules replaced. |
| `src/components/calendar/TasksPane.tsx` → `EntriesPane.tsx` | Renamed and rewritten without status. |
| `src/components/calendar/DayModal.tsx` | Uses `EntriesPane`. |
| `src/components/calendar/DayView.tsx` | Due label in the all-day strip. |
| `src/components/calendar/ListView.tsx` | DUE column; STATUS, SYNC and TASK gone. |
| `src/components/calendar/EventForm.tsx` | `KINDS_WITH_TASK` and `status` gone. |
| `src/components/calendar/constants.ts` | Task glyphs gone. |
| `src/components/calendar/History.tsx` | Stale glyph comment. |
| `src/lib/tempo/types.ts` | `assignment`, `EventStatus`, `status` gone. |
| `src/lib/tempo/recurrence.ts`, `duplicate.ts`, `layout.ts` | `status` / task height gone. |
| `src/lib/store/calendar-store.ts` | `status`, `setStatus` gone. |
| Test fixtures (8 files) | `status` lines gone; task cases rewritten. |
| `src/app/preview/harness.tsx` | Tasks become entries with due times. |
| `supabase/migrations/20260919_retire_tasks.sql` | **New.** Data only. |
| `src/components/calendar/Settings.tsx` | Key list corrected. |
| `src/components/calendar/CalendarShell.tsx` | `/` from anywhere; `!` banner. |
| `src/components/calendar/ContinuousCalendar.tsx` | Stale `N` comment. |
| `docs/DESIGN.md` | §17. |

---

### Task 1: The due-time rules

**Files:**
- Create: `src/components/calendar/due.ts`
- Test: `src/components/calendar/due.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/calendar/due.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { barDue, dayDue, dueIn, dueMoment, dueSortKey } from './due';

/** Just the fields the rules read. 2026-09-19 is a Saturday. */
function allDay(start: string, end: string, dueMinutes: number | null) {
  return { allDay: true, date: start, endDate: end, startMinutes: null, event: { dueMinutes } };
}

function timed(date: string, startMinutes: number) {
  return { allDay: false, date, endDate: date, startMinutes, event: { dueMinutes: null } };
}

describe('barDue', () => {
  it('states an all-day entry’s due time', () => {
    expect(barDue(allDay('2026-09-21', '2026-09-25', 23 * 60 + 55))).toBe('23:55');
    expect(barDue(allDay('2026-09-21', '2026-09-21', 18 * 60))).toBe('18:00');
  });

  it('says nothing for an entry that states no due time', () => {
    expect(barDue(allDay('2026-09-01', '2026-09-01', null))).toBeNull();
  });

  it('says nothing for an entry with a start time, whose title already leads with it', () => {
    expect(barDue(timed('2026-09-21', 7 * 60))).toBeNull();
  });
});

describe('dayDue', () => {
  // Monday 21 to Friday 25 September, due at 23:55.
  const week = allDay('2026-09-21', '2026-09-25', 23 * 60 + 55);

  it('gives the bare time on the day it is due', () => {
    expect(dayDue(week, '2026-09-25')).toBe('DUE 23:55');
  });

  it('names the weekday from one to six days before', () => {
    expect(dayDue(week, '2026-09-24')).toBe('DUE FRI 23:55');
    expect(dayDue(allDay('2026-09-19', '2026-09-25', 23 * 60 + 55), '2026-09-19')).toBe(
      'DUE FRI 23:55',
    );
  });

  it('dates it from seven days before', () => {
    expect(dayDue(allDay('2026-09-14', '2026-10-03', 18 * 60), '2026-09-26')).toBe(
      'DUE 03 OCT 18:00',
    );
  });

  it('says nothing without a due time, or for an entry with a start time', () => {
    expect(dayDue(allDay('2026-09-01', '2026-09-01', null), '2026-09-01')).toBeNull();
    expect(dayDue(timed('2026-09-21', 7 * 60), '2026-09-21')).toBeNull();
  });
});

describe('dueMoment', () => {
  it('is the last day and the due time for an all-day entry', () => {
    expect(dueMoment(allDay('2026-09-21', '2026-09-25', 1435))).toEqual({
      date: '2026-09-25',
      minutes: 1435,
    });
    expect(dueMoment(allDay('2026-09-01', '2026-09-01', null))).toEqual({
      date: '2026-09-01',
      minutes: null,
    });
  });

  it('is the start for an entry with a time', () => {
    expect(dueMoment(timed('2026-09-21', 420))).toEqual({ date: '2026-09-21', minutes: 420 });
  });
});

describe('dueSortKey', () => {
  it('orders by day, then minute, with a day that states no time at its end', () => {
    const noTimeFri = dueSortKey({ date: '2026-09-25', minutes: null });
    const lateFri = dueSortKey({ date: '2026-09-25', minutes: 1435 });
    const earlyFri = dueSortKey({ date: '2026-09-25', minutes: 420 });
    const thu = dueSortKey({ date: '2026-09-24', minutes: null });
    expect([noTimeFri, lateFri, earlyFri, thu].sort()).toEqual([thu, earlyFri, lateFri, noTimeFri]);
  });

  it('puts nothing ahead after everything', () => {
    expect(dueSortKey(null) > dueSortKey({ date: '2126-12-31', minutes: null })).toBe(true);
  });
});

describe('dueIn', () => {
  it('says today, tomorrow, or how many days', () => {
    expect(dueIn('2026-09-19', '2026-09-19')).toBe('TODAY');
    expect(dueIn('2026-09-20', '2026-09-19')).toBe('TOMORROW');
    expect(dueIn('2026-09-25', '2026-09-19')).toBe('IN 6D');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/calendar/due.test.ts`
Expected: FAIL — `Failed to resolve import "./due"`.

- [ ] **Step 3: Write the module**

Create `src/components/calendar/due.ts`:

```ts
import { dayOfWeek, diffDays, parts, type CivilDate } from '@/lib/tempo/civil';
import type { Occurrence, TempoEvent } from '@/lib/tempo/types';
import { MONTHS, WEEKDAYS } from './constants';
import { formatMinutes } from './TimePicker';

/**
 * When an entry is due, said wherever you are looking.
 *
 * An all-day entry's due time was read by the reminders and the form and drawn
 * by nothing, which is how a deadline at 18:00 comes to be remembered as the
 * end of the day. These are the rules every surface that states it shares, so
 * the bar, the day panel and the list cannot disagree about when something is
 * due.
 */

/** The parts of an occurrence these rules read. */
export type Dated = Pick<Occurrence, 'allDay' | 'date' | 'endDate' | 'startMinutes'> & {
  event: Pick<TempoEvent, 'dueMinutes'>;
};

/**
 * The due time a bar wears beside its chip, or null.
 *
 * All-day entries only. One with a start time is due when it starts, and its
 * bar already leads with that time — a second copy on the same bar would say
 * the same thing twice.
 */
export function barDue(occ: Dated): string | null {
  if (!occ.allDay || occ.event.dueMinutes === null) return null;
  return formatMinutes(occ.event.dueMinutes);
}

/**
 * The same, seen from one day of the entry: the day panel's label.
 *
 * On the day it is due the time is enough. Before it, the day has to be said as
 * well, since the panel is showing a different one — by weekday while that is
 * unambiguous, by date once the deadline is a week or more away.
 */
export function dayDue(occ: Dated, day: CivilDate): string | null {
  const time = barDue(occ);
  if (!time) return null;
  const ahead = diffDays(occ.endDate, day);
  if (ahead <= 0) return `DUE ${time}`;
  if (ahead < 7) return `DUE ${WEEKDAYS[dayOfWeek(occ.endDate)]} ${time}`;
  const { month, day: date } = parts(occ.endDate);
  return `DUE ${String(date).padStart(2, '0')} ${MONTHS[month - 1]} ${time}`;
}

/** When an occurrence is due: the day, and the minute when it states one. */
export interface DueMoment {
  date: CivilDate;
  minutes: number | null;
}

/**
 * An all-day entry is due on its last day at its due time; one with a time is
 * due when it starts — the same points the reminders count back from.
 */
export function dueMoment(occ: Dated): DueMoment {
  if (!occ.allDay) return { date: occ.date, minutes: occ.startMinutes };
  return { date: occ.endDate, minutes: occ.event.dueMinutes };
}

/**
 * A string that sorts the way deadlines do: by day, then by minute, with a day
 * that states no time last within it — due some time that day is due when the
 * day ends. `null`, nothing ahead, sorts after everything.
 */
export function dueSortKey(m: DueMoment | null): string {
  if (!m) return '￿';
  return `${m.date} ${String(m.minutes ?? 24 * 60).padStart(4, '0')}`;
}

/** How far off a due date is. Never in the past: the list looks from today. */
export function dueIn(date: CivilDate, today: CivilDate): string {
  const n = diffDays(date, today);
  if (n <= 0) return 'TODAY';
  if (n === 1) return 'TOMORROW';
  return `IN ${n}D`;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/components/calendar/due.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/due.ts src/components/calendar/due.test.ts
git commit -m "Add the rules for saying when an entry is due" -m "An all-day entry's due time is read by the reminders and the form and drawn by nothing. One module for every surface that will state it, so they cannot disagree.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Read a task as an entry

**Files:**
- Modify: `src/lib/tempo/mappers.ts` (`patchSchema` ~L64, `eventSchema` ~L114, `eventFromRow` ~L176)
- Create: `src/lib/tempo/mappers.test.ts`
- Modify: `src/app/preview/harness.tsx` (fixtures `f6`, `s1`–`s3`, `d2`)

- [ ] **Step 1: Write the failing test**

Create `src/lib/tempo/mappers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { EventRow, EventVersionRow } from '@/lib/db/database.types';
import { eventFromRow, parsePatch, versionFromRow } from './mappers';

function row(over: Partial<EventRow> = {}): EventRow {
  return {
    id: 'e1',
    owner_id: 'u1',
    title: 'Reading response',
    notes: null,
    kind: 'event',
    category_id: null,
    all_day: true,
    starts_at: null,
    ends_at: null,
    start_date: '2026-09-21',
    end_date: '2026-09-21',
    due_minutes: null,
    timezone: 'America/Toronto',
    recurrence: null,
    reminders: null,
    anchor_date: null,
    display_template: null,
    status: null,
    notify: false,
    source: 'tempo',
    google_calendar_id: null,
    google_event_id: null,
    google_sync_hash: null,
    google_synced_at: null,
    deleted_at: null,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

describe('a row written as a task', () => {
  it('reads as an entry, with no status', () => {
    const e = eventFromRow(row({ kind: 'assignment', status: 'doing' }));
    expect(e.kind).toBe('event');
    expect(e.status).toBeNull();
  });

  it('leaves the other kinds alone', () => {
    expect(eventFromRow(row({ kind: 'birthday' })).kind).toBe('birthday');
    expect(eventFromRow(row({ kind: 'milestone' })).kind).toBe('milestone');
  });
});

describe('an exception written with a status', () => {
  it('keeps what it moved and drops the status', () => {
    expect(parsePatch({ startDate: '2026-09-22', status: 'done' })).toEqual({
      startDate: '2026-09-22',
    });
  });
});

describe('a version of a task', () => {
  it('still parses, as an entry', () => {
    const event = { ...eventFromRow(row()), kind: 'assignment', status: 'todo' };
    const version: EventVersionRow = {
      id: 'v1',
      owner_id: 'u1',
      event_id: 'e1',
      reason: 'status',
      snapshot: { event, overrides: [] } as never,
      created_at: '',
    };
    const parsed = versionFromRow(version);
    expect(parsed?.snapshot.event.kind).toBe('event');
    expect(parsed?.snapshot.event.status).toBeNull();
    expect(parsed?.reason).toBe('status');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/tempo/mappers.test.ts`
Expected: FAIL — `expected 'assignment' to be 'event'` (and the patch and snapshot cases).

- [ ] **Step 3: Read tasks as entries**

In `src/lib/tempo/mappers.ts`, in `patchSchema`, delete the line:

```ts
  status: z.enum(['todo', 'doing', 'done']).optional(),
```

and put this comment above `const patchSchema`:

```ts
/**
 * An exception's patch. A `status` key — one date of a repeating task ticked
 * off — is dropped by the parse rather than refused: TASK is retired, and the
 * rest of what the exception says still stands.
 */
```

In `eventSchema`, replace

```ts
  kind: z.enum(['event', 'assignment', 'milestone', 'birthday']),
```

with

```ts
  // A snapshot of a task is a snapshot of an entry now, so rolling back to one
  // restores an entry. See `eventFromRow`.
  kind: z
    .enum(['event', 'assignment', 'milestone', 'birthday'])
    .transform((k) => (k === 'assignment' ? 'event' : k)),
```

and replace

```ts
  status: z.enum(['todo', 'doing', 'done']).nullable(),
```

with

```ts
  status: z
    .enum(['todo', 'doing', 'done'])
    .nullable()
    .transform(() => null),
```

In `eventFromRow`, replace

```ts
    kind: row.kind,
```

with

```ts
    // TASK is retired. A row still written as one is an entry with a status
    // nobody sets any more, so it reads as an entry and is written back as one
    // the next time it is saved; `20260919_retire_tasks.sql` converts the rest.
    kind: row.kind === 'assignment' ? 'event' : row.kind,
```

and replace

```ts
    status: row.status,
```

with

```ts
    status: null,
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/lib/tempo/mappers.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Turn the harness's tasks into entries**

In `src/app/preview/harness.tsx`, in `finalsWeek`'s doc comment replace `plus a multi-day task,` with `plus a multi-day deadline,`. Then replace the five task fixtures.

Replace

```ts
    base('f6', 'Final project', {
      kind: 'assignment',
      status: 'doing',
      startDate: day(0),
      endDate: day(2),
      categoryId: 'c5',
    }),
```

with

```ts
    base('f6', 'Final project', {
      startDate: day(0),
      endDate: day(2),
      dueMinutes: 23 * 60 + 55,
      categoryId: 'c5',
    }),
```

Replace

```ts
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
```

with

```ts
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
```

Replace

```ts
    base('d2', 'Old reading response', {
      kind: 'assignment',
      status: 'todo',
      startDate: todayIn(TZ),
```

with

```ts
    base('d2', 'Old reading response', {
      startDate: todayIn(TZ),
```

- [ ] **Step 6: Check nothing else moved**

Run: `npx vitest run` → Expected: 19 files, 449 tests pass (433 + 12 + 4).
Run: `npx tsc --noEmit -p .` → Expected: exit 0, no output.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tempo/mappers.ts src/lib/tempo/mappers.test.ts src/app/preview/harness.tsx
git commit -m "Read a task as an entry" -m "TASK left the form on 2026-09-10 but rows written as tasks still drew status boxes. Reading them as entries first lets every view drop its task code without a task ever reaching it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: A bar says when it is due

**Files:**
- Modify: `src/components/calendar/EventBar.tsx`
- Modify: `src/app/globals.css` (bar rules ~L492–L592)

- [ ] **Step 1: Import the rule and drop the status glyphs**

In `EventBar.tsx`, add after `import { CategoryChip } from './CategoryChip';`:

```ts
import { barDue } from './due';
```

Delete the line:

```ts
const STATUS_GLYPH = { todo: '[ ]', doing: '[~]', done: '[x]' } as const;
```

- [ ] **Step 2: Replace the task flags with the due time**

Replace

```ts
  const time = occ.allDay ? null : timeLabel(occ.startMinutes);
  const glyph = occ.kind === 'assignment' && occ.status ? STATUS_GLYPH[occ.status] : null;
  const done = occ.status === 'done';

  const task = occ.kind === 'assignment';
  const tick = occ.kind === 'milestone';
```

with

```ts
  const time = occ.allDay ? null : timeLabel(occ.startMinutes);
  /**
   * When it is due, on the part of the bar in the week it is due. The time
   * belongs to the last day, so a bar that carries on into next week leaves it
   * to the row it ends in.
   */
  const due = continuesAfter ? null : barDue(occ);

  const tick = occ.kind === 'milestone';
```

In the bar's `className` array, delete the line:

```ts
        done ? 'opacity-45' : '',
```

In the `bar-body` class list, replace

```ts
          // Events alone give up a title line to the chip in the middle width
          // tier; see `.bar-event` in globals.css.
          oneLine || task ? '' : 'bar-event',
```

with

```ts
          // Two-line bars give up a title line to the chip in the middle width
          // tier; see `.bar-event` in globals.css.
          oneLine ? '' : 'bar-event',
```

- [ ] **Step 3: Put the due time beside the chip**

Replace the whole second branch of `{oneLine ? (…) : (…)}` — from `<>` after `) : (` down to its closing `</>` — which currently begins

```tsx
          <>
            {/* The title, with what precedes it: the time on an event, the
                status box on a task.
```

and ends

```tsx
              {category && (
                <div className="bar-chips flex min-w-0">
                  <CategoryChip category={category} />
                </div>
              )}
            </div>
          </>
```

with

```tsx
          <>
            {/* The title, with the time an entry starts at before it. Under
                90px of content `.bar-line` turns the column and the time moves
                above the title. The title is its own flex column, so a second
                line hangs under itself rather than under the time. */}
            <div className="bar-line flex gap-1.5">
              {time && (
                <span className="bar-time shrink-0 tabular-nums" style={{ color: colors.soft }}>
                  {time}
                </span>
              )}
              <span className="bar-title bar-clamp">{occ.title}</span>
            </div>

            {/* The bottom line: the chip, then when it is due. Beside the chip
                rather than under it, so a deadline costs the bar no height —
                the line was already there. The chip gives way first: it
                truncates and the time never does, because a clipped time is a
                wrong time. */}
            {(category || due) && (
              <div className="bar-chips flex min-w-0 items-start gap-1.5">
                <CategoryChip category={category} className="min-w-0" />
                {due && (
                  <span className="bar-when shrink-0 tabular-nums" style={{ color: colors.soft }}>
                    <span className="bar-due">DUE </span>
                    {due}
                  </span>
                )}
              </div>
            )}
          </>
```

- [ ] **Step 4: Type the due time in CSS**

In `src/app/globals.css`, directly after the `.bar-chip { … }` rule (ends with `vertical-align: top;` and `}`), add:

```css
  /* When an all-day entry is due, beside its chip. On the chip's line and at
     its line height, so it costs the bar nothing; typed here rather than in
     utilities, like the chip, so the width tiers below can resize it. */
  .bar-when {
    font-size: 11px;
    line-height: 15px;
    white-space: nowrap;
  }
```

Inside `@container (max-width: 90px)`, replace

```css
    /* A task's second line, same problem. The status glyph and the word DUE are
       the two things that lose: `[x]` is three characters of a bar that fits
       about four, and a due date on a bar drawn inside its own day column is
       being said twice — the column is the date. A finished task still reads as
       one, by the strike-through and the dimming it already wears. */
    .bar-meta {
      font-size: 9px;
    }
    .bar-glyph,
    .bar-due {
      display: none;
    }
    /* An event gives its second title line to the chip: at this width, which
       course it is matters more than the end of its title. Tasks have the
       height to keep both. */
```

with

```css
    /* The due time keeps its figures and loses its word: `23:55` is five
       characters that have to fit whole, at the size the start time takes
       here, and DUE is what its place beside the chip already says. */
    .bar-when {
      font-size: 9px;
    }
    .bar-due {
      display: none;
    }
    /* An event gives its second title line to the chip: at this width, which
       course it is matters more than the end of its title. */
```

(`.bar-chips` is already hidden under 50px, which takes the due time with it.)

- [ ] **Step 5: Check it compiles and lints**

Run: `npx tsc --noEmit -p .` → Expected: exit 0.
Run: `npx eslint src/components/calendar/EventBar.tsx` → Expected: no output.

- [ ] **Step 6: See it**

Start the `tempo` server with the preview tool (`.claude/launch.json`), open `http://localhost:3000/preview` at 1280×800, press Space, and run in the page:

```js
[...document.querySelectorAll('.bar-when')].map((el) => el.closest('.tempo-bar').getAttribute('title') + ' → ' + el.textContent)
```

Expected: includes `Reading response 04 → DUE 18:00`, `CS4442 — final project → DUE 23:55` (once, in the week it ends), and nothing for `Montreal` or `Rent`.

- [ ] **Step 7: Commit**

```bash
git add src/components/calendar/EventBar.tsx src/app/globals.css
git commit -m "Show an all-day entry's due time beside its category chip" -m "The time goes on the line the chip already has, so a bar gets no taller, and only on the week the entry is due. Under 90px it drops the word; under 50px it goes with the chip and the day panel says it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The day panel says when things are due

**Files:**
- Rename + rewrite: `src/components/calendar/TasksPane.tsx` → `src/components/calendar/EntriesPane.tsx`
- Modify: `src/components/calendar/DayModal.tsx`
- Modify: `src/components/calendar/DayView.tsx` (all-day strip ~L264–L285)

- [ ] **Step 1: Rename the pane**

Run: `git mv src/components/calendar/TasksPane.tsx src/components/calendar/EntriesPane.tsx`

- [ ] **Step 2: Rewrite it without status**

Replace the whole of `src/components/calendar/EntriesPane.tsx` with:

```tsx
'use client';

import { useMemo } from 'react';
import { useCalendar } from '@/lib/store/calendar-store';
import type { CivilDate } from '@/lib/tempo/civil';
import type { Occurrence } from '@/lib/tempo/types';
import { DEFAULT_CATEGORY_COLOR, KIND_GLYPH } from './constants';
import { CategoryChip } from './CategoryChip';
import { dayDue, dueMoment, dueSortKey } from './due';
import { formatMinutes } from './TimePicker';

/**
 * Everything on a day, ranked by how much it is asking of you.
 *
 * The timeline beside this answers "when"; this answers "what". They are
 * different questions — something due Friday has no hour and would sit at
 * midnight on a 24-hour column, which is exactly where you would not look for
 * it. So the order is by consequence rather than by clock: the day's markers,
 * then what is due, soonest deadline first, then what happens at a time.
 */

/** Birthdays and marks, then all-day entries, then entries with a time. */
function rank(occ: Occurrence): number {
  if (occ.kind !== 'event') return 0;
  return occ.allDay ? 1 : 2;
}

interface Props {
  /** The day on show, which a deadline on another day is said relative to. */
  date: CivilDate;
  occurrences: Occurrence[];
  onOpen: (occ: Occurrence) => void;
}

export function EntriesPane({ date, occurrences, onOpen }: Props) {
  const categories = useCalendar((s) => s.categories);

  const ordered = useMemo(
    () =>
      [...occurrences].sort(
        (a, b) =>
          rank(a) - rank(b) ||
          dueSortKey(dueMoment(a)).localeCompare(dueSortKey(dueMoment(b))) ||
          a.title.localeCompare(b.title),
      ),
    [occurrences],
  );

  const categoryFor = (id: string | null) => categories.find((c) => c.id === id) ?? null;

  if (ordered.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="label">NOTHING DUE</span>
      </div>
    );
  }

  return (
    <ul className="h-full overflow-y-auto">
      {ordered.map((occ) => (
        <li key={occ.key} className="border-b border-hair last:border-b-0">
          <button
            type="button"
            onClick={() => onOpen(occ)}
            className="flex w-full items-start gap-2 px-3 py-2 text-left"
          >
            <span
              className="mt-px w-4 shrink-0 text-center text-[11px] leading-tight"
              style={{ color: categoryFor(occ.categoryId)?.color ?? DEFAULT_CATEGORY_COLOR }}
              aria-hidden
            >
              {KIND_GLYPH[occ.kind]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] leading-tight text-ink">{occ.title}</span>
              <span className="mt-1 flex min-w-0 items-center gap-2">
                <span className="label shrink-0">{when(occ, date)}</span>
                <CategoryChip category={categoryFor(occ.categoryId)} className="min-w-0" />
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A time, a deadline, or the plain fact that it takes the day. */
function when(occ: Occurrence, date: CivilDate): string {
  if (occ.allDay) return dayDue(occ, date) ?? 'ALL DAY';
  const start = occ.startMinutes === null ? '—' : formatMinutes(occ.startMinutes);
  return occ.endMinutes === null ? start : `${start}–${formatMinutes(occ.endMinutes)}`;
}
```

- [ ] **Step 3: Point the day modal at it**

In `src/components/calendar/DayModal.tsx`:

Replace `import { TasksPane } from './TasksPane';` with `import { EntriesPane } from './EntriesPane';`.

Replace `const [pane, setPane] = useState<'day' | 'tasks'>('day');` with `const [pane, setPane] = useState<'day' | 'entries'>('day');`.

In the comment above the `+ NEW` button, replace

```
          modal there was no way to add a birthday, a task or anything else that
          simply belongs to the day. The tasks pane, which is where those live,
          had no way to add one to the list it was showing.
```

with

```
          modal there was no way to add a birthday, a deadline or anything else
          that simply belongs to the day. The entries pane, which is where those
          live, had no way to add one to the list it was showing.
```

Replace `{ value: 'tasks', label: 'ENTRIES' },` with `{ value: 'entries', label: 'ENTRIES' },`.

Replace

```tsx
        {(wide || pane === 'tasks') && (
          <div className={PANE_H}>
            <TasksPane occurrences={occurrences} onOpen={onOpen} />
          </div>
        )}
```

with

```tsx
        {(wide || pane === 'entries') && (
          <div className={PANE_H}>
            <EntriesPane date={date} occurrences={occurrences} onOpen={onOpen} />
          </div>
        )}
```

- [ ] **Step 4: Say it in the timeline's all-day strip**

In `src/components/calendar/DayView.tsx`, add after `import { barColors } from './tint';`:

```ts
import { dayDue } from './due';
```

Replace

```tsx
          {bars.map((occ) => {
            const category = categoryFor(occ.categoryId);
            const colors = barColors(category?.color ?? null);
```

with

```tsx
          {bars.map((occ) => {
            const category = categoryFor(occ.categoryId);
            const colors = barColors(category?.color ?? null);
            const due = dayDue(occ, date);
```

and replace

```tsx
                <span className="min-w-0 flex-1 truncate">{occ.title}</span>
                <CategoryChip category={category} className="max-w-[45%] shrink-0" />
              </button>
```

with

```tsx
                <span className="min-w-0 flex-1 truncate">{occ.title}</span>
                <CategoryChip category={category} className="max-w-[45%] shrink-0" />
                {due && (
                  <span className="shrink-0 tabular-nums" style={{ color: colors.soft }}>
                    {due}
                  </span>
                )}
              </button>
```

- [ ] **Step 5: Check it compiles and lints**

Run: `npx tsc --noEmit -p .` → Expected: exit 0.
Run: `npx eslint src/components/calendar/EntriesPane.tsx src/components/calendar/DayModal.tsx src/components/calendar/DayView.tsx` → Expected: no output.

- [ ] **Step 6: See it**

In `/preview`, open the day the reading response is due (three days from today; double-click its cell, or pick it and press D). The entries pane reads `DUE 18:00` for `Reading response 04`; the all-day strip shows `DUE 18:00` after its chip; on the day after today the final project reads `DUE <weekday or date> 23:55`.

- [ ] **Step 7: Commit**

```bash
git add src/components/calendar/EntriesPane.tsx src/components/calendar/DayModal.tsx src/components/calendar/DayView.tsx
git commit -m "Say when an entry is due in the day panel, and stop ranking it as a task" -m "The entries pane said ALL DAY for a deadline and sorted by a status nothing sets. It now gives the due time, relative to the day on show, and orders markers, then deadlines, then timed entries.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The list's DUE column

**Files:**
- Modify: `src/components/calendar/ListView.tsx`

- [ ] **Step 1: Imports and the header comment**

Replace `import { addDays, diffDays, parts, todayIn, type CivilDate } from '@/lib/tempo/civil';` with:

```ts
import { addDays, parts, todayIn, type CivilDate } from '@/lib/tempo/civil';
```

Add after `import { DEFAULT_CATEGORY_COLOR, MONTHS, WEEKDAYS } from './constants';`:

```ts
import { dueIn, dueMoment, dueSortKey, type DueMoment } from './due';
import { formatMinutes } from './TimePicker';
```

In the file's header comment replace `The expansion still shows up, as a NEXT column —` with `The expansion still shows up, as a DUE column —`, and replace `which is the one derived fact you actually want when scanning the whole set.` with `which is the one derived fact you actually want when scanning the whole set: what is due next, and when.`

- [ ] **Step 2: Sorts, groups, labels**

Replace

```ts
type SortKey = 'title' | 'kind' | 'repeat' | 'start' | 'next' | 'category' | 'status';
type GroupKey = 'none' | 'kind' | 'category' | 'status';

const GROUPS = [
  { value: 'none', label: 'FLAT' },
  { value: 'kind', label: 'TYPE' },
  { value: 'category', label: 'CATEGORY' },
  { value: 'status', label: 'STATUS' },
] as const;

const KIND_LABEL: Record<string, string> = {
  event: 'ENTRY',
  assignment: 'TASK',
  birthday: 'BIRTHDAY',
  milestone: 'MARK',
};

const STATUS_GLYPH = { todo: '[ ]', doing: '[~]', done: '[x]' } as const;
```

with

```ts
type SortKey = 'title' | 'kind' | 'repeat' | 'start' | 'due' | 'category';
type GroupKey = 'none' | 'kind' | 'category';

const GROUPS = [
  { value: 'none', label: 'FLAT' },
  { value: 'kind', label: 'TYPE' },
  { value: 'category', label: 'CATEGORY' },
] as const;

const KIND_LABEL: Record<string, string> = {
  event: 'ENTRY',
  birthday: 'BIRTHDAY',
  milestone: 'MARK',
};
```

In `interface Row`, replace `  next: CivilDate | null;` with:

```ts
  /**
   * When the first occurrence still to finish is due: its last day and due
   * time, or its start for an entry with a time. Null when there is none.
   */
  due: DueMoment | null;
```

Replace the whole `relative` function

```ts
function relative(d: CivilDate, today: CivilDate): string {
  const n = diffDays(d, today);
  if (n === 0) return 'TODAY';
  if (n === 1) return 'TOMORROW';
  if (n > 0) return `IN ${n}D`;
  // The search window starts today, so a start date in the past can only be a
  // multi-day entry that is currently running — not something overdue.
  return 'IN PROGRESS';
}
```

with

```ts
/**
 * The DUE cell as one line, for the phone's cards: `25 SEP 26 · 23:55 · IN 6D`.
 *
 * Counted to the deadline rather than to the start, so a multi-day entry that
 * is under way says how long is left instead of IN PROGRESS.
 */
function dueLine(due: DueMoment, today: CivilDate): string {
  return [
    shortDate(due.date),
    due.minutes === null ? null : formatMinutes(due.minutes),
    dueIn(due.date, today),
  ]
    .filter(Boolean)
    .join(' · ');
}
```

- [ ] **Step 3: Compute DUE instead of NEXT**

Replace `const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'next', dir: 1 });` with:

```ts
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'due', dir: 1 });
```

Replace

```ts
    // One expansion pass for the whole table: the first occurrence each event
    // still has ahead of it.
    const nextByEvent = new Map<string, CivilDate>();
    for (const occ of expandAll(events, byEvent, today, addDays(today, HORIZON_DAYS))) {
      if (!nextByEvent.has(occ.eventId)) nextByEvent.set(occ.eventId, occ.date);
    }
```

with

```ts
    // One expansion pass for the whole table: the first occurrence each event
    // still has ahead of it — including one that began before today and has
    // not ended, since that one is still due.
    const nextByEvent = new Map<string, Occurrence>();
    for (const occ of expandAll(events, byEvent, today, addDays(today, HORIZON_DAYS))) {
      if (!nextByEvent.has(occ.eventId)) nextByEvent.set(occ.eventId, occ);
    }
```

Replace `        next: nextByEvent.get(event.id) ?? null,` with:

```ts
        due: nextByEvent.has(event.id) ? dueMoment(nextByEvent.get(event.id)!) : null,
```

In the sort's `value`, replace

```ts
        // Rows with nothing ahead sort to the end in either direction rather
        // than pretending to be the year 0.
        case 'next':
          return r.next ?? '￿';
        case 'category':
          return r.categoryName;
        case 'status':
          return r.event.status ?? '￿';
```

with

```ts
        // Rows with nothing ahead sort after everything rather than
        // pretending to be the year 0.
        case 'due':
          return dueSortKey(r.due);
        case 'category':
          return r.categoryName;
```

In `sections`, replace

```ts
    const key = (r: Row) => {
      if (group === 'kind') return KIND_LABEL[r.event.kind] ?? r.event.kind.toUpperCase();
      if (group === 'category') return r.categoryName.toUpperCase();
      return (r.event.status ?? 'NONE').toUpperCase();
    };
```

with

```ts
    const key = (r: Row) =>
      group === 'kind'
        ? (KIND_LABEL[r.event.kind] ?? r.event.kind.toUpperCase())
        : r.categoryName.toUpperCase();
```

- [ ] **Step 4: The phone's cards**

Replace

```tsx
                      <span
                        className={`block truncate text-[12px] leading-tight ${
                          r.event.status === 'done' ? 'text-mute line-through' : 'text-ink'
                        }`}
                      >
                        {r.event.title}
                      </span>
                      {/* One line of metadata, in the order it gets read: when,
                          then what. `flex-wrap` because a repeating task with a
                          status has four things to say and a 343px row fits
                          three of them. */}
                      <span className="label mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span className="tabular-nums text-dim">
                          {r.next ? `${shortDate(r.next)} · ${relative(r.next, today)}` : 'PAST'}
                        </span>
                        <span>{KIND_LABEL[r.event.kind] ?? r.event.kind}</span>
                        {r.repeat !== 'ONCE' && <span>{r.repeat}</span>}
                        {r.event.status && (
                          <span>
                            {STATUS_GLYPH[r.event.status]} {r.event.status.toUpperCase()}
                          </span>
                        )}
                      </span>
```

with

```tsx
                      <span className="block truncate text-[12px] leading-tight text-ink">
                        {r.event.title}
                      </span>
                      {/* One line of metadata, in the order it gets read: when
                          it is due, then what it is. `flex-wrap` because a
                          repeating entry due at a stated time has more to say
                          than a 343px row fits. */}
                      <span className="label mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span className="tabular-nums text-dim">
                          {r.due ? dueLine(r.due, today) : 'PAST'}
                        </span>
                        <span>{KIND_LABEL[r.event.kind] ?? r.event.kind}</span>
                        {r.repeat !== 'ONCE' && <span>{r.repeat}</span>}
                      </span>
```

- [ ] **Step 5: The table**

Replace

```tsx
              <HeadCell label="NEXT" col="next" sort={sort} onSort={toggleSort} />
              <HeadCell label="CATEGORY" col="category" sort={sort} onSort={toggleSort} />
              <HeadCell label="STATUS" col="status" sort={sort} onSort={toggleSort} />
```

with

```tsx
              <HeadCell label="DUE" col="due" sort={sort} onSort={toggleSort} />
              <HeadCell label="CATEGORY" col="category" sort={sort} onSort={toggleSort} />
```

Replace both occurrences of `colSpan={8}` with `colSpan={7}`.

Delete the line `                  const past = r.next === null;`.

Replace

```tsx
                          <span
                            className={`truncate ${r.event.status === 'done' ? 'text-mute line-through' : 'text-ink'}`}
                          >
                            {r.event.title}
                          </span>
                          {r.event.notify && <span className="label shrink-0">SYNC</span>}
```

with

```tsx
                          <span className="truncate text-ink">{r.event.title}</span>
```

Replace

```tsx
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
```

with

```tsx
                        {r.due ? (
                          <>
                            <span className="text-ink">{shortDate(r.due.date)}</span>
                            {r.due.minutes !== null && (
                              <span className="ml-2 text-dim">{formatMinutes(r.due.minutes)}</span>
                            )}
                            <span className="label ml-2">{dueIn(r.due.date, today)}</span>
                          </>
                        ) : (
                          <span className="label">PAST</span>
                        )}
```

Delete the STATUS cell:

```tsx
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
```

- [ ] **Step 6: The checkbox's comment**

In the doc comment above `function Check`, replace

```
 * `[ ]` and `[x]` are not a stylisation here — they are the same glyphs the
 * STATUS column prints, so a row reads in one alphabet rather than mixing a
 * drawn control into a table made of text. `[~]` is the header's partial state,
 * borrowed from `doing` for the same reason: it already means "some of this".
```

with

```
 * `[ ]` and `[x]` are not a stylisation here — the table is made of text, and a
 * checkbox written in it reads in the same alphabet rather than as a drawn
 * control dropped into it. `[~]` is the header's partial state: some of this.
```

- [ ] **Step 7: Check it compiles and lints**

Run: `npx tsc --noEmit -p .` → Expected: exit 0.
Run: `npx eslint src/components/calendar/ListView.tsx` → Expected: no output.

- [ ] **Step 8: See it**

In `/preview` press `2`. The table's columns are TITLE, TYPE, REPEATS, SPAN, DUE, CATEGORY; the first rows by DUE are today's; `CS4442 — final project` reads its last day with `23:55` and `IN 9D`; GROUP offers FLAT / TYPE / CATEGORY. At 375×812 the cards' second line starts with the same DUE text.

- [ ] **Step 9: Commit**

```bash
git add src/components/calendar/ListView.tsx
git commit -m "Replace the list's NEXT and STATUS columns with DUE" -m "A multi-day assignment is worked on from its first day and judged by its last, so the list sorts by when things are due, with the time, and a running one says how long is left rather than IN PROGRESS. STATUS and the SYNC tag described things nothing sets.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Drop TASK from the form and the glyphs

**Files:**
- Modify: `src/components/calendar/EventForm.tsx` (~L87–L113, ~L392–L396, ~L496)
- Modify: `src/components/calendar/constants.ts` (~L196–L221)
- Modify: `src/components/calendar/History.tsx` (~L221–L224)

- [ ] **Step 1: The form**

In `EventForm.tsx`, replace

```tsx
/**
 * What an entry can be: an entry, a birthday, or a mark.
 *
 * ENTRY rather than EVENT — the word the rest of the app already uses (`+ NEW`,
 * `13 ENTRIES`). TASK is gone from the choices: this calendar is kept with
 * entries, and a task was an entry with a status nobody set.
 */
```

with

```tsx
/**
 * What an entry can be: an entry, a birthday, or a mark.
 *
 * ENTRY rather than EVENT — the word the rest of the app already uses (`+ NEW`,
 * `13 ENTRIES`). There is no TASK: this calendar is kept with entries, a task
 * was an entry with a status nobody set, and a row still written as one reads
 * as an entry (`eventFromRow`).
 */
```

Delete the whole `KINDS_WITH_TASK` constant and its doc comment (from `/**` above `* TASK, for the one case that still needs it` through `] as const satisfies readonly { value: EventKind; label: string }[];` below `KINDS[2],`).

Replace `              options={existing?.kind === 'assignment' ? KINDS_WITH_TASK : KINDS}` with:

```tsx
              options={KINDS}
```

In `draftFor`, delete

```tsx
      // A task keeps the status it has: `draftFields` fills a missing one with
      // `todo`, so leaving it out reset `doing` every time a task was saved from
      // here. Anything that is not a task has none — including a task just
      // turned into an ENTRY.
      status: kind === 'assignment' ? (existing?.status ?? null) : null,
```

- [ ] **Step 2: The glyphs**

In `constants.ts`, replace `import type { EventKind, EventStatus, TempoEvent } from '@/lib/tempo/types';` with:

```ts
import type { EventKind, TempoEvent } from '@/lib/tempo/types';
```

Replace

```ts
 * one, would be two entries as far as anyone reading is concerned. A task is
 * drawn by its status everywhere, so a done one must not come back as an empty
 * box without anyone unticking it.
 */
export function glyphFor(e: Pick<TempoEvent, 'kind' | 'status'>): string {
  if (e.kind === 'assignment') return e.status ? STATUS_GLYPH[e.status] : '[ ]';
  return KIND_GLYPH[e.kind];
}

export const STATUS_GLYPH: Record<EventStatus, string> = {
  todo: '[ ]',
  doing: '[~]',
  done: '[x]',
};
```

with

```ts
 * one, would be two entries as far as anyone reading is concerned.
 */
export function glyphFor(e: Pick<TempoEvent, 'kind'>): string {
  return KIND_GLYPH[e.kind];
}
```

(Leave `KIND_GLYPH`'s `assignment` line until Task 7 — the type still requires it.)

- [ ] **Step 3: History's comment**

In `History.tsx`, replace

```tsx
                  {/* `w-5` and no wrapping: the task glyphs are three
                      characters (`[ ]`, `[x]`), which overflow a 16px column
                      and break across two lines — so a deleted task rendered
                      as a bracket stacked on a bracket. */}
```

with

```tsx
                  {/* `w-5` and no wrapping: one column for every kind's mark,
                      so the titles beside them line up. */}
```

- [ ] **Step 4: Check it compiles, lints and passes**

Run: `npx tsc --noEmit -p .` → Expected: exit 0.
Run: `npx eslint src/components/calendar/EventForm.tsx src/components/calendar/constants.ts src/components/calendar/History.tsx` → Expected: no output.
Run: `npx vitest run` → Expected: 449 pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/EventForm.tsx src/components/calendar/constants.ts src/components/calendar/History.tsx
git commit -m "Drop TASK from the entry form and the glyphs" -m "The form kept a TASK cell for rows written as tasks, and the glyphs drew their status. Those rows read as entries now.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Remove TASK from the data model

**Files:**
- Modify: `src/lib/tempo/types.ts`, `src/lib/tempo/mappers.ts`, `src/lib/tempo/mappers.test.ts`, `src/lib/tempo/recurrence.ts` (~L365), `src/lib/tempo/duplicate.ts` (~L118), `src/lib/tempo/layout.ts` (~L19–L39, ~L96–L100), `src/lib/store/calendar-store.ts`, `src/components/calendar/constants.ts`, `src/app/preview/harness.tsx`
- Tests: `src/lib/tempo/layout.test.ts`, `src/lib/store/calendar-store.test.ts`, `src/lib/tempo/reminders.test.ts`, `src/components/calendar/resize.test.ts`, `src/components/calendar/scope.test.ts`, `src/components/calendar/timeline.test.ts`, `src/lib/tempo/split.test.ts`, `src/lib/tempo/tempo.test.ts`

- [ ] **Step 1: Make the mapper tests say what the types will**

In `src/lib/tempo/mappers.test.ts` replace `    expect(e.status).toBeNull();` with:

```ts
    expect(e).not.toHaveProperty('status');
```

and replace `    expect(parsed?.snapshot.event.status).toBeNull();` with:

```ts
    expect(parsed?.snapshot.event).not.toHaveProperty('status');
```

Run: `npx vitest run src/lib/tempo/mappers.test.ts`
Expected: FAIL — `expected { …, status: null } to not have property "status"` (2 tests).

- [ ] **Step 2: The types**

In `src/lib/tempo/types.ts`, replace

```ts
export type EventKind = 'event' | 'assignment' | 'milestone' | 'birthday';
export type EventStatus = 'todo' | 'doing' | 'done';
```

with

```ts
/**
 * What an entry is. `assignment` — TASK — is retired: the database still
 * accepts it, and `eventFromRow` reads it as `event`.
 */
export type EventKind = 'event' | 'milestone' | 'birthday';
```

Delete `  status: EventStatus | null;` from `TempoEvent` (above `notify: boolean;`), `  status?: EventStatus;` from `OccurrencePatch`, and `  status: EventStatus | null;` from `Occurrence` (above `categoryId`).

Replace

```ts
/** What produced a version. Ordered roughly by how much it changed. */
export type VersionReason = 'edit' | 'move' | 'resize' | 'status' | 'delete';
```

with

```ts
/**
 * What produced a version. Ordered roughly by how much it changed.
 *
 * `status` is no longer written; versions recorded by TASK's status control
 * still carry it, and still have to be readable.
 */
export type VersionReason = 'edit' | 'move' | 'resize' | 'status' | 'delete';
```

- [ ] **Step 3: The mappers**

In `mappers.ts`, in `eventSchema` delete

```ts
  status: z
    .enum(['todo', 'doing', 'done'])
    .nullable()
    .transform(() => null),
```

and add above `notify: z.boolean(),`:

```ts
  // No `status`: a snapshot of a task still carries one, and the parse drops it.
```

In `eventFromRow` delete `    status: null,`. In `eventToRow` delete `  if (e.status !== undefined) row.status = e.status;`. In `PortableEvent` delete `  status?: string;`. In `toPortable` delete `  if (e.status) out.status = e.status;`.

In `PortableEvent`, replace `  /** All-day entries only, \`HH:MM\`, and only when it is not the default 23:55. */` with:

```ts
  /** All-day entries only, `HH:MM`, whenever one is stated. */
```

Run: `npx vitest run src/lib/tempo/mappers.test.ts`
Expected: PASS, 4 tests. (`tsc` still fails until the steps below.)

- [ ] **Step 4: Expansion, duplication, layout**

In `src/lib/tempo/recurrence.ts` delete `    status: patch.status ?? event.status,`.

In `src/lib/tempo/duplicate.ts` delete `    status: ev.status,`.

In `src/lib/tempo/layout.ts`, replace

```ts
/**
 * Height carries importance — and, at these sizes, room.
 *
 * A task is still the loudest thing a day can contain and has to look like it
 * across seven columns without being read; colour cannot do that job, it is
 * spoken for by category. Events and tasks doubled so a title can wrap to a
 * second line and the category chip gets a line of its own: 28px held one
 * truncated line, which is how five entries called "Final Exam" became five
 * identical grey bars.
 *
```

with

```ts
/**
 * Height carries room.
 *
 * Entries doubled so a title can wrap to a second line and the category chip —
 * with, beside it, when the entry is due — gets a line of its own: 28px held one
 * truncated line, which is how five entries called "Final Exam" became five
 * identical grey bars. A task stood taller again, at 84px, until TASK was
 * retired.
 *
```

and replace

```ts
  birthday: 34,
  assignment: 84,
};
```

with

```ts
  birthday: 34,
};
```

In `layoutWeek`'s doc comment replace `longer a uniform height — three tasks and four events both fill the row, and` with `longer a uniform height — a mark, a birthday and an entry are three heights, and`.

- [ ] **Step 5: The store**

In `src/lib/store/calendar-store.ts`: delete `  EventStatus,` from the `@/lib/tempo/types` import; delete `  status?: EventStatus | null;` from `EventDraft`; delete `  setStatus: (occ: Occurrence, status: EventStatus) => Promise<void>;` from `CalendarState`; delete the implementation

```ts
    setStatus: async (occ, status) => {
      if (occ.event.source === 'google') return;
      captureVersion(occ.eventId, 'status');
      const label = `Marked ${occ.title} ${status}`;
      if (occ.event.recurrence) {
        await patchOccurrence(occ, { status }, false, (merged) => ({
          label,
          touched: touchedOverrides([merged.id]),
        }));
        return;
      }
      await writeEvent(occ.eventId, { status }, { label, touched: touchedEvents([occ.eventId]) });
    },

```

and in `draftFields` delete `    status: draft.status ?? (draft.kind === 'assignment' ? 'todo' : null),`.

- [ ] **Step 6: The last glyph and the harness**

In `constants.ts`, delete `  assignment: '[ ]',` from `KIND_GLYPH`. In `src/app/preview/harness.tsx`, delete `    status: null,` from `base()`.

- [ ] **Step 7: The test fixtures**

Delete the `status` line from each fixture:
- `src/components/calendar/resize.test.ts:29` — `    status: null,`
- `src/components/calendar/scope.test.ts:24` — `    status: null,` and `:49` — `    status: e.status,`
- `src/components/calendar/timeline.test.ts:40` — `    status: null,`
- `src/lib/tempo/split.test.ts:24` — `    status: null,`
- `src/lib/tempo/tempo.test.ts:37` — `    status: null,`
- `src/lib/tempo/reminders.test.ts:38` — `    status: null,`
- `src/lib/tempo/layout.test.ts:29` — `    status: null,`
- `src/lib/store/calendar-store.test.ts:123` — `    status: null,` (the `event()` builder) and `:192` — `    status: e.status,` (`occurrenceOf`). **Keep** `:151`: `row()` is a database row, which still has the column.

In `src/lib/tempo/reminders.test.ts` replace

```ts
  it('treats marks and tasks as entries', () => {
    const entry = { allDay: true, repeats: false, dueMinutes: DUE_AT_NIGHT };
    expect(defaultReminders('milestone', entry)).toEqual(defaultReminders('event', entry));
    expect(defaultReminders('assignment', entry)).toEqual(defaultReminders('event', entry));
  });
```

with

```ts
  it('treats marks as entries', () => {
    const entry = { allDay: true, repeats: false, dueMinutes: DUE_AT_NIGHT };
    expect(defaultReminders('milestone', entry)).toEqual(defaultReminders('event', entry));
  });
```

In `src/lib/store/calendar-store.test.ts` replace

```ts
  it('records a move, a resize, a status change and a delete under their own reasons', async () => {
    const e = event({ id: 'e1', startDate: '2026-08-10', endDate: '2026-08-12' });
    seed([e]);

    await useCalendar.getState().moveOccurrence(occurrenceOf(e, '2026-08-10', '2026-08-12'), 1, 'series');
    await useCalendar
      .getState()
      .resizeOccurrence(occurrenceOf(e, '2026-08-10', '2026-08-12'), 1, 'end', 'series');
    await useCalendar.getState().setStatus(occurrenceOf(e, '2026-08-10'), 'done');
    await useCalendar.getState().deleteEvent('e1');

    expect(
      callsOn('event_versions', 'insert').map((c) => (c.payload as { reason: string }).reason),
    ).toEqual(['move', 'resize', 'status', 'delete']);
  });
```

with

```ts
  it('records a move, a resize and a delete under their own reasons', async () => {
    const e = event({ id: 'e1', startDate: '2026-08-10', endDate: '2026-08-12' });
    seed([e]);

    await useCalendar.getState().moveOccurrence(occurrenceOf(e, '2026-08-10', '2026-08-12'), 1, 'series');
    await useCalendar
      .getState()
      .resizeOccurrence(occurrenceOf(e, '2026-08-10', '2026-08-12'), 1, 'end', 'series');
    await useCalendar.getState().deleteEvent('e1');

    expect(
      callsOn('event_versions', 'insert').map((c) => (c.payload as { reason: string }).reason),
    ).toEqual(['move', 'resize', 'delete']);
  });
```

- [ ] **Step 8: Rewrite the layout tests that used tasks**

In `src/lib/tempo/layout.test.ts`, replace the `kinded` helper

```ts
  const kinded = (key: string, kind: EventKind, date = '2026-07-29'): Occurrence => ({
    ...occ(key, date),
    kind,
    status: kind === 'assignment' ? 'todo' : null,
  });
```

with

```ts
  const kinded = (key: string, kind: EventKind, date = '2026-07-29'): Occurrence => ({
    ...occ(key, date),
    kind,
  });
```

Replace the test `'stacks three tasks — 0, 88, 176, last bottom at 260'` (the whole `it(…)` block) with:

```ts
  it('stacks three birthdays — 0, 38, 76, last bottom at 110', () => {
    const { segments, laneTops } = layoutWeek(
      WEEK_START,
      Array.from({ length: 3 }, (_, i) => kinded(`b${i}`, 'birthday')),
      BUDGET,
    );
    expect(laneTops.slice(0, 3)).toEqual([0, 38, 76]);
    expect(76 + KIND_HEIGHT.birthday).toBe(110);
    expect(drawn(segments)).toBe(3);
  });
```

Replace the test `'draws all four events/tasks and sets contentHeight to 292'` with:

```ts
  it('draws two birthdays and two events and sets contentHeight to 192', () => {
    const { segments, overflow, contentHeight } = layoutWeek(
      WEEK_START,
      [
        kinded('b0', 'birthday'),
        kinded('b1', 'birthday'),
        kinded('e0', 'event'),
        kinded('e1', 'event'),
      ],
      BUDGET,
    );
    // Four bars on one day is 34 + 34 + 56 + 56 of bar and three 4px gaps, so
    // the last lane ends at 192.
    expect(drawn(segments)).toBe(4);
    expect(segments.filter((s) => s.hidden)).toHaveLength(0);
    expect(overflow[3]).toBe(0);
    expect(contentHeight).toBe(192);
  });
```

Replace the test `'keeps a bar at its own height, not its lane’s'` with:

```ts
  it('keeps a bar at its own height, not its lane’s', () => {
    // A short bar sharing a lane with an entry must not be stretched to match.
    const { segments } = layoutWeek(
      WEEK_START,
      [kinded('entry', 'event', '2026-07-26'), kinded('mark', 'milestone', '2026-07-30')],
      BUDGET,
    );
    const mark = segments.find((s) => s.occurrence.key === 'mark')!;
    const entry = segments.find((s) => s.occurrence.key === 'entry')!;
    expect(mark.lane).toBe(entry.lane); // same lane — they don't overlap
    expect(mark.height).toBe(KIND_HEIGHT.milestone);
    expect(entry.height).toBe(KIND_HEIGHT.event);
    expect(mark.top).toBe(entry.top);
  });
```

Replace the test `'sizes a lane by its tallest occupant'` with:

```ts
  it('sizes a lane by its tallest occupant', () => {
    const { segments, laneHeights, laneTops } = layoutWeek(
      WEEK_START,
      [
        kinded('birthday', 'birthday', '2026-07-26'),
        // Shares the birthday's column, so it is forced into a different lane
        // rather than packing in beside it.
        kinded('other', 'event', '2026-07-26'),
        // Clear of both, so it joins whichever lane has room. It is the short
        // bar that must not shrink its lane below the birthday's height.
        kinded('mark', 'milestone', '2026-07-30'),
      ],
      BUDGET,
    );

    const birthday = segments.find((s) => s.occurrence.key === 'birthday')!;
    const other = segments.find((s) => s.occurrence.key === 'other')!;
    const mark = segments.find((s) => s.occurrence.key === 'mark')!;

    expect(laneHeights[other.lane]).toBe(KIND_HEIGHT.event);

    // The mark packs in beside the birthday, and their shared lane keeps the
    // taller one's height — a 20px bar must not shrink the lane under a 34px
    // one, or the bar below would overlap it.
    expect(mark.lane).toBe(birthday.lane);
    expect(laneHeights[birthday.lane]).toBe(KIND_HEIGHT.birthday);

    // Tops are cumulative: every lane begins one gap below the previous lane's
    // full height, whatever mix of kinds produced it.
    for (let i = 1; i < laneTops.length; i++) {
      expect(laneTops[i]).toBe(laneTops[i - 1] + laneHeights[i - 1] + LANE_GAP);
    }
  });
```

- [ ] **Step 9: Check everything**

Run: `npx tsc --noEmit -p .` → Expected: exit 0. If it names a file, it is a `status` or `assignment` reference this task missed — remove it the same way.
Run: `npx vitest run` → Expected: 19 files, 449 tests pass (the task cases were rewritten, not removed).
Run: `grep -rn "assignment\|EventStatus\|setStatus\|STATUS_GLYPH" src --include=*.ts --include=*.tsx | grep -v "src/lib/db/"` → Expected: only `mappers.ts` (the `assignment` it reads), `mappers.test.ts`, `types.ts`'s comment, and `reminders.ts` / `reminders.test.ts` prose ("an assignment").
Run: `npx eslint src` → Expected: the baseline 15, no new ones.

- [ ] **Step 10: Commit**

```bash
git add src/lib/tempo/types.ts src/lib/tempo/mappers.ts src/lib/tempo/mappers.test.ts src/lib/tempo/recurrence.ts src/lib/tempo/duplicate.ts src/lib/tempo/layout.ts src/lib/store/calendar-store.ts src/components/calendar/constants.ts src/app/preview/harness.tsx src/lib/tempo/layout.test.ts src/lib/store/calendar-store.test.ts src/lib/tempo/reminders.test.ts src/components/calendar/resize.test.ts src/components/calendar/scope.test.ts src/components/calendar/timeline.test.ts src/lib/tempo/split.test.ts src/lib/tempo/tempo.test.ts
git commit -m "Remove TASK from the data model" -m "A task was an entry with a status nobody sets. The kind, the status field and setStatus go from the types and the store; the database keeps both columns, unused, and a snapshot of an old task still parses as an entry.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Convert the stored rows

**Files:**
- Create: `supabase/migrations/20260919_retire_tasks.sql`

- [ ] **Step 1: Write the SQL**

Create `supabase/migrations/20260919_retire_tasks.sql`:

```sql
-- Tempo — TASK retired from the data
--
-- Run this once in the Supabase SQL editor, whenever is convenient. Idempotent:
-- running it twice is harmless.
--
-- Nothing waits for it. The app already reads a task as an entry and ignores its
-- status, and writes one back as an entry the next time it is saved; this only
-- makes the rows say what the app already shows.
--
-- Nothing is dropped. The `assignment` kind and the `status` column stay in the
-- schema, unused, so an older client — or a version rolled back to — still fits.

update public.events
set kind = 'event', updated_at = now()
where kind = 'assignment';

update public.events
set status = null, updated_at = now()
where status is not null;

-- An exception can carry a status of its own: one date of a repeating task,
-- ticked off. The key goes; everything else the exception says stays.
update public.occurrence_overrides
set patch = patch - 'status'
where patch ? 'status';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260919_retire_tasks.sql
git commit -m "Add the data-only migration that turns stored tasks into entries" -m "Optional and safe to run late: the app already reads tasks as entries. Nothing in the schema is dropped.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The small fixes

**Files:**
- Modify: `src/components/calendar/Settings.tsx` (`SHORTCUTS`)
- Modify: `src/components/calendar/CalendarShell.tsx` (`/` case, offline banner)
- Modify: `src/components/calendar/ContinuousCalendar.tsx` (~L776 comment)

- [ ] **Step 1: The key list**

In `Settings.tsx`, replace

```ts
  { keys: ['/'], meaning: 'Filter, in list view' },
  { keys: ['ESC'], meaning: 'Unwind one layer' },
  { keys: ['DEL'], meaning: 'Delete the selection' },
  { keys: ['⌘', 'Z'], joiner: '+', meaning: 'Undo, while the toast is up' },
```

with

```ts
  { keys: ['/'], meaning: 'Filter the list' },
  { keys: ['ESC'], meaning: 'Unwind one layer' },
  { keys: ['DEL'], meaning: 'Delete the selection' },
  { keys: ['⌘', 'Z'], joiner: '+', meaning: 'Undo the last change' },
  { keys: ['⌘', 'C'], joiner: '+', meaning: 'Copy the selection' },
  { keys: ['⌘', 'V'], joiner: '+', meaning: 'Paste on the day under the pointer' },
  { keys: ['⌘', 'D'], joiner: '+', meaning: 'Duplicate the selection' },
  { keys: ['+', '−', '0'], joiner: '/', meaning: 'Day timeline: zoom in · out · fit' },
```

- [ ] **Step 2: `/` from any view**

In `CalendarShell.tsx`, after `const formRef = useRef<EntryFormHandle>(null);` add:

```ts
  /**
   * `/` pressed outside the list. The list has to mount before its filter
   * exists, so the focus waits for the render that shows it — see the effect
   * below — rather than guessing at a frame.
   */
  const filterWanted = useRef(false);

  useEffect(() => {
    if (view !== 'list' || !filterWanted.current) return;
    filterWanted.current = false;
    searchRef.current?.focus();
  }, [view]);
```

Replace

```ts
      case '/':
        if (view === 'list') {
          e.preventDefault();
          searchRef.current?.focus();
        }
        break;
```

with

```ts
      // The filter, from anywhere: the list is where searching happens, so
      // asking for it from another view is asking to go there.
      case '/':
        e.preventDefault();
        if (view === 'list') {
          searchRef.current?.focus();
        } else {
          filterWanted.current = true;
          setViewPreference('list');
        }
        break;
```

- [ ] **Step 3: The banner**

In `CalendarShell.tsx`, replace `          ⚠️ OFFLINE · VIEWING CACHED CALENDAR (AS OF {new Date(cachedAt).toLocaleString().toUpperCase()})` with:

```tsx
          ! OFFLINE · VIEWING CACHED CALENDAR (AS OF {new Date(cachedAt).toLocaleString().toUpperCase()})
```

- [ ] **Step 4: The stale comment**

In `ContinuousCalendar.tsx`, replace `      // creates nothing — it drops the selection. Creating is the day header's` / `      // \`+\`, the \`N\` key and \`+ NEW\`, and nothing else; whitespace that made` with the same two lines reading `` `+`, the `A` key and `+ NEW` ``:

```ts
      // Below the slop the gesture was a click, and a click on empty grid
      // creates nothing — it drops the selection. Creating is the day header's
      // `+`, the `A` key and `+ NEW`, and nothing else; whitespace that made
      // entries would fight the lasso for the same press.
```

- [ ] **Step 5: Check**

Run: `npx tsc --noEmit -p .` → Expected: exit 0.
Run: `npx eslint src/components/calendar/Settings.tsx src/components/calendar/CalendarShell.tsx` → Expected: no output.
In `/preview`, from the scroll view press `/`: the list shows and the FILTER field has focus (`document.activeElement.getAttribute('aria-label') === 'Filter entries'`). Press `S`: the KEYS section lists `⌘ + C`.

- [ ] **Step 6: Commit**

```bash
git add src/components/calendar/Settings.tsx src/components/calendar/CalendarShell.tsx src/components/calendar/ContinuousCalendar.tsx
git commit -m "Correct the key list, let / find the filter from any view, drop the emoji" -m "Settings still said undo only worked while the toast was up and left out copy, paste, duplicate and the day zoom. The offline banner's warning emoji was the one hue on screen that was not a category's.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: The design record

**Files:**
- Modify: `docs/DESIGN.md` (after §16, before `## Not built`)

- [ ] **Step 1: Write §17**

Insert before the `---` that precedes `## Not built`:

```markdown
## 17. A deadline is drawn where it is due

An all-day entry's due time was read by the reminders and the form and drawn by
nothing, so an assignment due at 18:00 looked exactly like one due whenever —
which is how a 07:00 final comes to be remembered as 19:00. It is drawn now
beside the category chip, on the bar's bottom line: that line was already there,
so a deadline costs a bar no height, and a time beside the course reads as that
course's deadline. Only on the part of the bar in the week it is due, because the
time belongs to the last day; and not on a phone's one-day bar, where the chip
has already given up its line — the day panel says it there.

The day panel and the list say it from the same rules (`due.ts`). The list's NEXT
became DUE: a multi-day assignment is worked on from its first day and judged by
its last, so what is due next is the order worth sorting by, and IN PROGRESS was
the answer to a different question.

TASK is gone from the data model as well as the form. A task was an entry with a
status nobody set; a row still written as one reads as an entry and is written
back as one the next time it is saved. The kind and the column stay in the
database, unused — nothing destructive to reach a tidier schema.
```

- [ ] **Step 2: Check the README says nothing about tasks**

Run: `grep -n -i "task" README.md` → Expected: no hits that describe a TASK entry type. (Fix any that do in the same commit.)

- [ ] **Step 3: Commit**

```bash
git add docs/DESIGN.md
git commit -m "Record why deadlines are drawn beside the chip and TASK left the data" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Verify the whole build

- [ ] **Step 1: Suites**

Run: `npx vitest run` → Expected: 19 files, 449 tests pass.
Run: `npx tsc --noEmit -p .` → Expected: exit 0.
Run: `npx eslint src` → Expected: the baseline 15 problems and no others.

- [ ] **Step 2: On screen, desktop (1280×800)**

In `/preview`, press Space. Check with `read_page` / JS:
- `document.body.innerText` contains no `[~]` or `[ ]` outside the list's selection column.
- `.bar-when` texts as in Task 3, Step 6.
- Open the day `Reading response 04` is due: entries pane `DUE 18:00`, all-day strip `DUE 18:00`.
- `2`: DUE column as in Task 5, Step 8.
- Screenshot the scroll view showing a `DUE` label beside a chip.

- [ ] **Step 3: On screen, tablet (768×1024) and phone (375×812)**

- Tablet: a one-day entry with a due time shows `23:55`/`18:00` without the word (`getComputedStyle(document.querySelector('.bar-due')).display === 'none'` on that bar).
- Phone: one-day bars show no `.bar-when` (`offsetParent === null`); the multi-day final project shows `DUE 23:55`.
- Reset the viewport to desktop.

- [ ] **Step 4: Stop the preview server.**
