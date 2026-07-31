# TEMPO

A continuous calendar. Dates and scheduling only — notes stay in Obsidian.

The point of it is that time doesn't paginate. The grid is one unbroken scroll of
week rows, so the last day of a month and the first day of the next are adjacent
rows on the same surface, not two views you flip between.

Single user by design: one account, one locked door, no tenancy.

---

## Setup

### 1. Environment

`.env.local` is already populated with the Supabase project URL and publishable
key. The remaining values are only needed for the Google mirror, which isn't
wired up yet.

### 2. Create the one account

Account creation is deliberately not in the app — there is no sign-up route, and
there never will be. Create the single user once, by hand:

1. Supabase dashboard → **Authentication → Users → Add user**
2. Enter your email and a password, and tick **Auto Confirm User**
3. Then **Authentication → Sign In / Providers** → disable **Allow new users to
   sign up**

After that, `/login` is the only way in and only your account can pass it.

### 3. Run

```bash
npm run dev
```

---

## Scripts

```bash
npm run dev      # dev server
npm run build    # production build
npm test         # 51 unit tests, no database required
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

## Notes

- **`/preview`** is a development-only design harness running on fixture data.
  It 404s outside development and is only exempt from the auth gate in
  development. Writes there apply optimistically and then roll back, since it
  has no session — that's expected.
- **`/api/export`** returns every event as flat JSON whose keys map 1:1 onto
  Obsidian frontmatter. Recurring events export as their rule, not as expanded
  occurrences.
- Google Calendar sync is designed but not built. See `docs/GOOGLE_SETUP.md`.
