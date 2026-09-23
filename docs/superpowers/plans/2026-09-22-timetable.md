# Timetable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mark an entry as `timetable` so it drops out of scroll/list/year, and add a
fourth WEEK view — a dated, pageable Mon–Sun grid — where it can be seen.

**Architecture:** One boolean column threaded through the mappers and the store. A
localStorage-backed visibility preference in the `view-preference.ts` mould, read by a
`useVisibleEvents()` hook that four views swap in for `s.events`. A new `WeekView`
reusing the pure helpers in `timeline.ts` for seven columns instead of one.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Zustand, Supabase, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-22-timetable-design.md`

---

### Task 1: The column and the domain field

**Files:**
- Create: `supabase/migrations/20260922_timetable.sql`
- Modify: `src/lib/tempo/types.ts` (TempoEvent)
- Modify: `src/lib/db/database.types.ts` (events Row/Insert/Update)

- [ ] **Step 1: Write the migration**, additive and idempotent:
  `alter table public.events add column if not exists timetable boolean not null default false;`
- [ ] **Step 2: Add `timetable: boolean` to `TempoEvent`**, documented as a view
  concern that stops at the view.
- [ ] **Step 3: Add `timetable: boolean` to the generated row types** (Row, Insert?,
  Update?). Hand-edited because the live schema has not been migrated yet.
- [ ] **Step 4: Run `npx tsc --noEmit`.** Expected: errors in `mappers.ts` and
  `calendar-store.ts` for the missing field. That is Task 2's list.

### Task 2: Through the mappers

**Files:**
- Modify: `src/lib/tempo/mappers.ts`
- Test: `src/lib/tempo/mappers.test.ts`

- [ ] **Step 1: Write the failing tests** — a row without the column reads as `false`;
  a row with `true` reads as `true`; `eventToRow` carries it; `toPortable` omits the
  key when false and emits `timetable: true` when true.
- [ ] **Step 2: Run `npx vitest run src/lib/tempo/mappers.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement** — `timetable: z.boolean().default(false)` in the snapshot
  schema (defaulted for the same reason `reminders` is: older snapshots have no such
  key), `timetable: row.timetable ?? false` in `eventFromRow`, the `!== undefined`
  line in `eventToRow`, and `if (e.timetable) out.timetable = true;` in `toPortable`
  plus `timetable?: boolean` on `PortableEvent`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 3: Through the store

**Files:**
- Modify: `src/lib/store/calendar-store.ts` (`EventDraft`, `draftFields`)

- [ ] **Step 1: Add `timetable?: boolean` to `EventDraft`.**
- [ ] **Step 2: Add `timetable: draft.timetable ?? false` to `draftFields`** — beside
  `reminders`, because like it this is the form's to state.
- [ ] **Step 3: Run `npx tsc --noEmit`.** Expected: clean.
- [ ] **Step 4: Commit.**

### Task 4: The visibility preference

**Files:**
- Create: `src/lib/store/timetable-visibility.ts`
- Create: `src/lib/store/visible-events.ts`
- Test: `src/lib/store/visible-events.test.ts`

- [ ] **Step 1: Write the failing test** for the pure filter `filterVisible(events, show)`:
  a timetable entry dropped when hidden, kept when shown; an ordinary entry kept either
  way; an empty list surviving both; and the same array identity returned when showing,
  so `useMemo` downstream does not thrash.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Write `timetable-visibility.ts`** as a copy of `view-preference.ts`'s
  shape — `useSyncExternalStore` triple, key `tempo.timetable`, default `false`.
- [ ] **Step 4: Write `visible-events.ts`** — the pure `filterVisible` plus a
  `useVisibleEvents()` hook that memoises it over the store's `events`.
- [ ] **Step 5: Run the tests.** Expected: PASS.
- [ ] **Step 6: Commit.**

### Task 5: Hide them in the three existing views

**Files:**
- Modify: `src/components/calendar/ContinuousCalendar.tsx:234`
- Modify: `src/components/calendar/ListView.tsx:126`
- Modify: `src/components/calendar/YearView.tsx:42`
- Modify: `src/components/calendar/DayModal.tsx:59`

- [ ] **Step 1: Swap `useCalendar((s) => s.events)` for `useVisibleEvents()`** in each.
  `History.tsx` and `Settings.tsx` are deliberately left alone — a hidden entry that
  was deleted still has to be recoverable, and the counts have to be true.
- [ ] **Step 2: Run `npx tsc --noEmit` and `npm test`.** Expected: clean, all pass.
- [ ] **Step 3: Commit.**

### Task 6: The toggle in the form

**Files:**
- Modify: `src/components/calendar/EventForm.tsx`

- [ ] **Step 1: Add `timetable` state** seeded from `existing?.timetable ?? false`.
- [ ] **Step 2: Add it to the returned draft** in `draftFor`.
- [ ] **Step 3: Render an `[08] TIMETABLE` field** after `[05] CATEGORY` using the
  existing `Toggle` primitive, with a line of help saying what it does.
- [ ] **Step 4: Run `npx tsc --noEmit`.** Expected: clean.
- [ ] **Step 5: Commit.**

### Task 7: The week's range

**Files:**
- Create: `src/components/calendar/week.ts`
- Test: `src/components/calendar/week.test.ts`

- [ ] **Step 1: Write the failing test** for `weekDays(date)` → seven `CivilDate`s
  starting Sunday: mid-week, on a Sunday, on a Saturday, across a month boundary, and
  across a year boundary.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** over the existing `startOfWeek` and `addDays` in `civil.ts`.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 8: The WEEK view

**Files:**
- Create: `src/components/calendar/WeekView.tsx`

- [ ] **Step 1: Build the component** — an all-day band over seven columns sharing one
  hour gutter, reusing `daySegment`, `placeSegments`, `resolveHourHeight`, `labelEvery`
  and the zoom store. Reads the *unfiltered* `s.events`, so it always shows the whole
  week. Click an entry to open it; click empty space to seed a new one at that day and
  time. No drag — see the spec's "Left out".
- [ ] **Step 2: Run `npx tsc --noEmit`.** Expected: clean.
- [ ] **Step 3: Commit.**

### Task 9: Wire it into the shell

**Files:**
- Modify: `src/lib/store/view-preference.ts` (`View`, `isView`)
- Modify: `src/components/calendar/CalendarShell.tsx` (VIEWS, keymap, header, render)

- [ ] **Step 1: Add `'week'` to `View` and `isView`.**
- [ ] **Step 2: Add `{ value: 'week', label: 'WEEK', key: '4' }` to `VIEWS`** and
  `case '4': setViewPreference('week')` to the keymap. `4` is free; arrows are already
  bound to entry movement.
- [ ] **Step 3: Render `<WeekView>` when `view === 'week'`**, with `[` and `]` stepping
  weeks and a control back to this one.
- [ ] **Step 4: Add the `TIMETABLE` button** beside the view switcher, lit when on,
  rendered only when `view !== 'week'`.
- [ ] **Step 5: Run `npx tsc --noEmit`, `npm run lint`, `npm test`.** Expected: clean.
- [ ] **Step 6: Commit.**

### Task 10: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the timetable flag and the WEEK view**, and note that
  `20260922_timetable.sql` has to be run.
- [ ] **Step 2: Commit.**
