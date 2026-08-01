# Tempo — history

One section, **G**, replacing Section E's in-memory pool with durable storage
and adding version history beside it. Depends on
`supabase/migrations/20260801_history.sql` having been run.

---

## What this replaces

Section E shipped a session-scoped `recentlyDeleted` array with an undo toast,
chosen at the time over a migration. That choice has been reversed: the user
asked for versions to "fall back onto", which a pool that dies with the tab
cannot provide, and once a migration is on the table the trash should use it too.

**Most of Section E's store code comes out.** Soft delete makes it unnecessary:
the row never leaves, so there is nothing to capture and nothing to re-insert.
The single hardest part of E — remembering an event's `occurrence_overrides` so
a restored series does not forget which instances were moved — disappears
entirely, because a soft-deleted event's overrides were never deleted either.

Keep the toast. It is the immediate undo and is orthogonal to where the data
lives.

## Two mechanisms, not one

- `events.deleted_at` — an entry you **removed**, restorable whole.
- `event_versions` — an entry you **changed**, restorable to a past shape.

A trash cannot answer "what did this look like last week"; a version log cannot
answer "what did I delete". Neither substitutes for the other, which is why the
migration adds both.

---

## G.1 Soft delete

`deleteEvent` and `deleteEvents` become `update … set deleted_at = now()`.
`restoreDeleted` becomes `set deleted_at = null`. Both keep the existing
`optimistic()` snapshot-and-rollback.

State splits in two:

```ts
events: TempoEvent[];        // live only — the grid must never see a deleted row
deleted: TempoEvent[];       // deleted_at is set, newest first
```

`load()` fetches both in one `select('*')` and partitions client-side rather
than issuing two queries. `TempoEvent` gains `deletedAt: string | null`, mapped
in `mappers.ts` alongside the rest.

Everything that reads `events` — `expandAll`, the year view, the list view —
keeps working untouched, because `events` still means "live".

**Purge** is a real hard delete, offered per entry and for the whole trash. It
is the only `.delete()` left on the table. Deleting more than one asks first,
as the bulk delete already does.

**Retention**: on `load()`, hard-delete anything whose `deleted_at` is older
than 30 days. Cheap, and it keeps the trash from becoming an unbounded second
copy of the calendar.

## G.2 Versions

```ts
interface EventVersion {
  id: string;
  eventId: string;
  /** `{ event, overrides }` — the whole shape, so a rollback is not a diff. */
  snapshot: { event: TempoEvent; overrides: OccurrenceOverride[] };
  reason: 'edit' | 'move' | 'resize' | 'status' | 'delete';
  createdAt: string;
}
```

The snapshot carries the event **and its overrides together**. Versioning the
event row alone would miss every per-occurrence edit, since moving one instance
of a series writes an override and leaves the event untouched — and those are
exactly the edits most worth undoing.

Captured **before** each mutation applies, from the pre-change state, by a
single `snapshot(eventId, reason)` helper. One call site per mutating store
method: `updateEvent`, `updateEventFromDraft`, `moveOccurrence`,
`moveOccurrences`, `resizeOccurrence`, `setOccurrenceTime`, `setStatus`,
`cancelOccurrence`, `deleteEvent`, `deleteEvents`.

`rollbackTo(versionId)` writes the snapshot back: update the event row, then
replace that event's overrides with the snapshot's — delete the current set and
insert the recorded one, so an override created *after* the version is removed
rather than left behind. Rolling back is itself an edit, so it takes a snapshot
first; undoing an undo is therefore possible.

### Capture must fail soft

**A failed version insert must never roll back the user's edit.** It is
bookkeeping, not the thing being asked for. Two reasons this is not optional:
the migration may not have been run yet, in which case every edit in the app
would appear to fail; and a full or unreachable history table must degrade to
"no history" rather than to "the calendar is broken".

So `snapshot()` runs outside `optimistic()`, swallows its own error, and never
sets `state.error`. It may log once per session, no more.

Retention is the database's job — the migration's `prune_event_versions`
trigger keeps the last 10 per event — so the client never prunes.

## G.3 The HISTORY surface

Its own overlay on the shell's stack, `{ kind: 'history' }`, reached from the
top bar and from `H`. **Not** a section in Settings: Section E put the deleted
pool there and it was not found, which is the whole reason this section exists.

Two panes under one header, the same shape as the DAY modal:

- **left — DELETED.** Newest first: kind glyph, title, when, `RESTORE`,
  `PURGE`. A `PURGE ALL` in the pane header. Empty state says the trash holds
  30 days.
- **right — VERSIONS.** Selecting a deleted entry, or arriving from an entry's
  own history button, lists that entry's versions: when, `reason`, a one-line
  summary of what differs from the version after it, and `ROLL BACK`.

The entry form gets a `HISTORY` button opening this overlay focused on that
entry, which is how versions are reached for an entry that was never deleted.

Below 900px the panes collapse to a `SegmentedControl`, as the DAY modal does.

`Modal` already owns the scrim, focus trap and dismissal; this adds no new
overlay machinery.

---

## Testing

- `deleteEvent` sets `deleted_at` and does not issue a `delete`; the event
  leaves `events` and appears in `deleted`.
- A restored event's overrides are intact — the case Section E had to work for
  and this one gets by construction. Assert it anyway: it is the behaviour, not
  the implementation, that matters.
- `snapshot()` failing leaves the mutation applied and `state.error` null. This
  is the test that protects everyone who has not run the migration.
- `rollbackTo` removes an override created after the version it targets.
- Retention purges only rows past 30 days.
- The existing 93 tests must keep passing; several construct events and will
  need `deletedAt` in their fixtures.

## Out of scope

Google sync. Versioning of categories. Any UI for browsing history across
entries at once — every version list is scoped to one entry.
