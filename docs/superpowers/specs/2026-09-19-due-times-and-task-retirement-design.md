# Tempo — due times you can see, and the last of TASK

The first of three builds agreed on 2026-09-19. The other two — autosave in the
entry popup, and ICS export — have their own specs and follow this one.

---

## What prompted this

Asked what they would change, the user picked, in their words:

- **Due times on entries**, "if there's an end time", without making bars
  taller: "maybe the time could fit right next to the category? … sometimes too
  much text and clutter is bad."
- **Finish removing TASK**, which the form dropped on 2026-09-10 ("I'm only using
  event") while the rest of the app kept it.
- The small fixes offered with it: an out-of-date key list, `/` only working in
  the list, and a coloured emoji in a monochrome interface.

The fear behind the first one is on record from 2026-09-17: they once had a
final at 07:00 and believed it was 19:00, and are retaking the course.

## What is actually wrong

Established by reading the code and driving `/preview`.

- **An all-day entry's due time is invisible.** `dueMinutes` is read by the
  reminder engine and the form and by nothing that draws: `EventBar` shows a
  time only for timed entries, the day panel says `ALL DAY`, and the list has no
  column for it. The deadline-reminders spec left this out on purpose ("It is
  only an entry property, not a bar decoration").
- **TASK is retired from the form and nowhere else.** The list has a STATUS
  column and a STATUS grouping that every new entry fills with `—`; old tasks
  still draw `[ ]` / `[~]` boxes at 84px; the day panel is `TasksPane`, sorts by
  status and advances it on click; the list tags rows `SYNC` for a Google mirror
  that was never built.
- **The key list in Settings is stale.** `⌘Z` says "while the toast is up",
  which stopped being true; copy, paste, duplicate and the timeline's zoom keys
  are bound and not listed.
- **`/` focuses the filter only when the list is already showing.**
- **The offline banner starts with ⚠️**, which renders as a yellow glyph on iOS
  — the one hue on screen that is not a category's.

## Decisions

### A. A bar says when it is due

An all-day entry with a due time shows it on its bottom line, after the
category chip: `[PSYCHOL 2020A] DUE 23:55`. The bottom line already exists on
every event bar, so nothing gets taller.

- **When it shows:** whenever `dueMinutes` is set, including 23:55. An entry
  with no due time — rent — shows nothing.
- **Where it shows:** only on the part of the bar in the week the entry is due
  (the segment that does not continue after). The time belongs to the last day.
- **Width tiers**, the ones the bar already has:
  - over 90px of content: `DUE 23:55`;
  - 50–90px: the word goes and the time stays, at the 9px the start time uses
    at that width — `23:55`;
  - under 50px (a one-day bar on a phone): hidden with the chip. There is no
    line to spare, and the day panel says it.
- **No category:** the time sits alone on the bottom line.
- **Unchanged:** entries with a start time (their `09:00` already leads the
  title), birthdays and marks (one line each; a mark's due time stays in its
  popup).
- **Colour:** the soft ink the start time already uses, tabular figures.

### B. The day panel says it too

A shared rule, `dayDue(occurrence, day)`, gives the label for an all-day entry
with a due time on a given day:

- on the day it is due: `DUE 23:55`;
- one to six days before it: `DUE FRI 23:55`;
- seven or more days before it: `DUE 03 OCT 23:55`.

It replaces `ALL DAY` in the entries list and follows the chip in the timeline's
all-day strip. An entry with no due time keeps `ALL DAY` in the list and nothing
extra in the strip.

The entries list stops being a task list: it is ordered birthdays and marks
first, then all-day entries by when they are due, then timed entries by start —
by consequence, as before, without a status to rank on. `TasksPane` becomes
`EntriesPane`.

### C. The list gets a DUE column

`NEXT` and `STATUS` become one column, **DUE**: the due moment of the first
occurrence that has not finished before today — date, time if there is one, and
how far off (`25 SEP 26 · 23:55 · IN 6D`). An all-day entry is due on its last
day at its due time; one with a start time is due when it starts, which is
what the reminders already assume. A multi-day assignment therefore shows its
deadline rather than `IN PROGRESS`, and sorting by DUE is "what is due next". No
time sorts as the end of that day. Nothing ahead is `PAST`, sorted last.

- GROUP is FLAT / TYPE / CATEGORY.
- The phone's card list shows the same DUE line.
- The `SYNC` tag goes.

### D. TASK is retired from the data and the code

- **Rows.** `supabase/migrations/20260919_retire_tasks.sql` turns every
  `assignment` into an `event` and clears `status`, on events and on the
  exceptions that carry one. It is safe to run late or never: `eventFromRow`
  reads `assignment` as `event` and ignores `status`, so an unconverted row
  behaves as an entry and is written back as one the next time it is saved.
- **Types.** `EventKind` loses `assignment`; `EventStatus` and every `status`
  field go from `TempoEvent`, `Occurrence`, `OccurrencePatch` and `EventDraft`,
  with `setStatus`. The database columns and enums stay — nothing destructive.
- **History.** Old version snapshots still parse: the snapshot schema accepts
  `assignment` and `status` and maps them the same way, so rolling back to a
  task's old shape restores it as an entry. `status` stays a readable version
  reason for rows already written.
- **Drawing.** The 84px task height, the status glyphs, `KINDS_WITH_TASK` and
  the task branch of `EventBar` go. A formerly-done task is an ordinary entry.
- **Export.** The JSON export drops `status`.
- **Preview.** The harness's tasks become entries, some with due times, so A–C
  can be checked on screen.

### E. Small fixes

- **Keys.** `⌘Z` is "undo the last change"; add `⌘C` / `⌘V` (copy the
  selection, paste on the day under the pointer), `⌘D` (duplicate), and `+ − 0`
  (zoom the day timeline).
- **`/`** from any view switches to the list and focuses the filter.
- **Offline banner:** `⚠️` becomes `!`, the mark the footer's error line already
  uses.
- Two stale comments: the grid's "the `N` key" (it is `A`), and the export's
  `due_time` "only when it is not the default 23:55" (it is whenever set).

## Testing

- `due.ts` (new, pure): the bar label, `dayDue` on the due day, earlier in the
  week, further ahead, with no due time and for a timed entry; the list's due
  moment and its sort key.
- `mappers`: an `assignment` row reads as an `event` with no status; an old task
  snapshot parses and rolls back as an entry.
- Existing suites lose their task cases (`layout`, `calendar-store`'s status
  test, `reminders`' task-defaults test).
- In `/preview`: `DUE 23:55` beside a chip on a desktop bar, `23:55` at medium
  width, nothing on a phone's one-day bar; the day panel's labels; the DUE column
  and its sort; `/` from the scroll view; no `[ ]` anywhere.

## Design record

`DESIGN.md` gains a short section: a due time is drawn where it is due, beside
the category it belongs to, and TASK is gone from the data model as well as the
form.

## Out of scope

- A due time on marks and birthdays.
- Dropping the `status` column or the `assignment` enum value from the database.
- Anything the other two builds cover.
