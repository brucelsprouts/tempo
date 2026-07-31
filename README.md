<div align="center">
  <img src="public/logo.svg" width="76" height="76" alt="">
  <h1>Tempo</h1>
  <p><strong>A calendar that doesn't paginate.</strong></p>
</div>

---

Most calendars make you flip between months. The last day of March and the first
day of April are the same distance apart as any other two days, but a paginated
grid puts a page break between them and asks you to hold the seam in your head.

Tempo removes the seam. The calendar is one unbroken vertical scroll of week
rows — months are marked by alternating bands and a label in the gutter, not by
a view you navigate to. Scrolling from this week into next month is the same
gesture as scrolling from Monday to Tuesday.

It is dates and scheduling only. There is no note-taking, no rich text, no
attachments. Everything exports as flat JSON that drops straight into Obsidian
frontmatter, because notes belong wherever you already keep them.

**Single user by design.** One account, one locked door, no tenancy, no sign-up
route. This is a personal tool that happens to be open source — if you run it,
you run your own copy.

## What's interesting in here

**Occurrences are derived, never stored.** A recurring event is exactly one row.
Its instances are computed at render time by arithmetic seek — jumping straight
to the next matching date rather than iterating day by day — and then thrown
away. A birthday spanning eighty years is one row, not eighty.

**Derived titles.** Because expansion happens per occurrence, a title can depend
on *which* occurrence it is. An event carries an `anchor_date` and a
`display_template` evaluated against a closed token set:

```
anchor_date:      1974-06-14
recurrence:       { "freq": "YEARLY" }
display_template: "{title} · {yearsSince}"
```

That single row renders `Mom · 52` in 2026 and `Mom · 53` in 2027. Tokens are
`{title}`, `{yearsSince}`, `{n}`, `{ordinal(x)}`, `{year}` — a closed language,
not an expression evaluator, so there is no `eval` and no injection surface.

**Recurrence rules that survive a diff.** `recurrence` is stored as JSON with RFC
5545 (RRULE) semantics — JSON so it stays readable in a diff and in a frontmatter
block, RRULE semantics so a future Google sync is a rename rather than a
translation. It includes an `onInvalid` flag the spec doesn't: RFC 5545 says skip
a date that doesn't exist, which is right for "the 31st of every month" and wrong
for a leap-day birthday, since that person still has one.

**Timezone-free calendar dates.** Domain logic runs on civil dates — plain
`YYYY-MM-DD` strings with no instant attached — and there are exactly two places
where a conversion to or from a real timestamp happens. A calendar grid that does
date arithmetic in UTC eventually renders someone's birthday on the wrong day.

**Achromatic on purpose.** The interface is monochrome and hairline-ruled.
Category colour is the only hue on screen, so it stays the only thing colour
means. "Today" is marked by inversion and weight rather than an accent, because
an accent would compete with the one signal that carries information.

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind v4 · Zustand · Supabase (Postgres
+ Auth) · dnd-kit · TanStack Virtual · Zod · Vitest

## Running your own

### 1. Supabase project

Create a project at [supabase.com](https://supabase.com). The calendar needs
three tables — `events`, `categories`, and `occurrence_overrides` — each scoped
by an `owner_id` with row-level security restricting rows to `auth.uid()`.
(`integrations` and `google_events_cache` also exist, but only the unbuilt Google
mirror touches them.) The exact column shapes are in
[`src/lib/db/database.types.ts`](src/lib/db/database.types.ts), which is
generated from the live schema.

> Migrations aren't checked in yet — the schema currently lives in the Supabase
> project it was built against. If you're setting this up from scratch, build the
> tables to match the generated types.

### 2. Environment

```bash
cp .env.example .env.local
```

Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
from your project's API settings, and set `NEXT_PUBLIC_TEMPO_TIMEZONE` to your
IANA zone. The Google variables are only needed for the calendar mirror, which
isn't wired up yet.

### 3. Create the one account

Account creation is deliberately not in the app, and there's no sign-up route.
Create the single user by hand:

1. Supabase dashboard → **Authentication → Users → Add user**
2. Enter an email and password, tick **Auto Confirm User**
3. **Authentication → Sign In / Providers** → disable **Allow new users to sign up**

After that `/login` is the only way in, and only that account passes it.

### 4. Run

```bash
npm install
npm run dev
```

## Scripts

```bash
npm run dev      # dev server
npm run build    # production build
npm test         # unit tests — pure domain logic, no database required
npm run lint     # eslint
```

## Layout

```
src/lib/tempo/      pure domain logic — no React, no network, fully tested
  civil.ts          timezone-free calendar dates + the two zone conversions
  types.ts          TempoEvent, Recurrence, Occurrence
  recurrence.ts     occurrence expansion (arithmetic seek, not iteration)
  derive.ts         per-occurrence computed titles ("Mom · 52")
  layout.ts         week-row lane packing
  mappers.ts        row <-> domain, JSON validation, portable export shape

src/lib/store/      in-memory calendar with optimistic writes + rollback
src/lib/supabase/   browser / server / service-role clients
src/components/calendar/
src/proxy.ts        the auth gate (Next 16's replacement for middleware)
```

The `src/lib/tempo/` directory is the part worth reading. It has no React and no
network calls, so the recurrence, derivation, and layout logic can be tested and
lifted out on its own.

## Notes

- **`/preview`** is a development-only design harness running on fixture data. It
  404s outside development, and is only exempt from the auth gate in development.
  Writes there apply optimistically and then roll back, since it has no session —
  that's expected.
- **`/api/export`** returns every event as flat JSON whose keys map 1:1 onto
  Obsidian frontmatter. Recurring events export as their rule, not as expanded
  occurrences — the export is the same size as the database.
- **Google Calendar sync** is designed but not built. See
  [`docs/GOOGLE_SETUP.md`](docs/GOOGLE_SETUP.md).
- **[`docs/DESIGN.md`](docs/DESIGN.md)** is the design record: why the system is
  shaped the way it is, decisions rather than documentation.

## License

Not licensed yet — no `LICENSE` file, which by default means all rights
reserved. Read it, learn from it; ask before reusing it.
