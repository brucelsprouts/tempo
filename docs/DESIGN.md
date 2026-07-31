# Tempo — design record

Why the system is shaped the way it is. Decisions, not documentation.

---

## 1. Occurrences are derived, never stored

A recurring event is one row. The occurrences you see are computed at render
time and thrown away. Nothing persists a birthday's 53 instances.

This is what makes derived fields possible at all. A tool that stores an entry
as a single fixed dataset cannot express "Mom · 52" — the age is only true for
one year of a row that spans decades. Because expansion happens per occurrence,
a value that depends on *which* occurrence it is can simply be computed there.

`recurrence` is stored as JSON with RFC 5545 (RRULE) semantics — JSON so it
survives a diff and an Obsidian frontmatter block, RRULE semantics because
that's what Google's API speaks, making the sync boundary a rename rather than a
translation.

## 2. Derived fields are a closed template language

An event carries an `anchor_date` (the origin — a birth date) and a
`display_template` evaluated per occurrence against a fixed token set:

| token | meaning |
|---|---|
| `{title}` | the raw title |
| `{yearsSince}` | whole years from the anchor to this occurrence — the age |
| `{n}` | which occurrence this is |
| `{ordinal(x)}` | `12` → `12th` |
| `{year}` | the occurrence's year |

A birthday is `anchor_date: 1974-06-14`, `recurrence: yearly`,
`display_template: "{title} · {yearsSince}"`. It renders `Mom · 52` in 2026 and
`Mom · 53` in 2027 from one stored row.

Closed rather than a real expression language on purpose: no `eval`, no
injection surface, and the field stays a plain string that another tool can read
later. `kind: 'birthday'` is a UI preset that fills these in — no logic anywhere
branches on it.

**Derived values resolve against the series date, not the displaced one.**
Dragging a birthday celebration to the weekend doesn't change how old someone
is.

## 3. All-day data never becomes a timestamp

Two column pairs, with a check constraint allowing exactly one:

- timed events → `starts_at` / `ends_at` (`timestamptz`)
- all-day events → `start_date` / `end_date` (`date`, end inclusive)

Storing all-day data as an instant is the single most common calendar bug: the
value shifts a day when the viewer changes timezone. A date has no timezone and
must not pretend to. `civil.ts` enforces this in code — all-day values never
become a local `Date`.

The inverse conversion (`instantFromCivil`) exists so that dragging a 09:00
meeting across a DST boundary keeps it at 09:00 rather than silently moving it
an hour.

## 4. Per-occurrence edits are exceptions, not copies

`occurrence_overrides` is keyed by `(event_id, occurrence_date)` where the date
is the one the occurrence *would* have fallen on. That's a stable identity even
after the instance is moved. It carries a patch or a `cancelled` flag.

So dragging one instance of a weekly standup writes one small row and leaves the
series definition untouched. Shift-drop rewrites the series instead.

## 5. The whole calendar lives in memory

One person's events number in the hundreds. The app loads all of them once and
expands locally, so scrolling never waits on a network round-trip — the killer
feature is the one thing that must never feel slow. Writes are optimistic with
snapshot rollback.

Expansion uses an **arithmetic seek**, not iteration: a birthday from 1974 costs
the same to render in 2026 as one from last week. The exception is `count`,
which must count emitted occurrences rather than elapsed periods (a monthly
rule on the 31st skips February), so it walks — bounded by definition.

## 6. The scroll is a virtualised list of week rows

The week is the atomic unit. A month boundary is then just a line *inside* a
row — there is no page to flip because there is no page. Orientation comes from
alternating month bands, a month label on the day the month starts, and a header
readout derived from the actual scroll offset.

**Fixed row height**, which buys three things: the epoch's total height is a
compile-time constant, so the container is correctly sized on the first paint;
landing on today is exact arithmetic rather than a measured scroll that settles
visibly; and scroll offset maps linearly onto dates.

**A large fixed epoch (−5y … +10y) rather than true infinity.** Genuinely
unbounded scroll means prepending rows, which yanks scroll position and needs
anchoring compensation to hide. 780 rows virtualise for free and remove that
whole class of bug.

Expansion windows are quantised into 8-week buckets so scrolling doesn't
re-expand on every row.

## 7. Drag uses pointer-based collision

`@dnd-kit` for drag (day-snapped), custom pointer handlers for resize.

Collision detection **must** be `pointerWithin`. The default resolves the drop
target from the dragged element's rectangle, while the grab date is read from
the pointer — mixing the two offsets every drop by however far along the bar you
happened to grab it. Both ends now measure the same thing. (This was a real bug,
caught by dropping a block on a known date and checking where it landed.)

## 8. Auth is one row, not a user system

Supabase Auth with a single account, sign-ups disabled, RLS on every table
keyed to `owner_id`. `src/proxy.ts` gates every route at the network boundary,
so an anonymous visitor never receives a rendered calendar.

The publishable key ships in the bundle and that is fine — RLS, not the key, is
what protects the data. `integrations` (Google refresh tokens) has RLS enabled
and **no policies at all**, making it reachable only by the service role from
server routes.

---

## Not built

- **Google Calendar sync.** Schema fields and the `integrations` table exist;
  no routes. See `GOOGLE_SETUP.md` for the design and the blocking manual step.
- **Timeline ruler / scrubber** in the left gutter — proposed, not built.
- **Command palette** with natural-language quick add — proposed, not built.
- **Reading Google events into the view** — `google_events_cache` and the
  `readOnly` occurrence flag exist for it; nothing populates them.
