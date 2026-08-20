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

## 8. Three views over one dataset

The scroll answers *what is around this week*. It is bad at two other questions,
so each got a view rather than a compromise:

- **List** — the stored rows as a table, with search, sort and grouping. Rows are
  *events*, not occurrences: a birthday is one entry that happens sixty times,
  and a table repeating it sixty times is a log, not a database. Expansion still
  appears, as a NEXT column, which is the derived fact you actually want when
  scanning the whole set.
- **Year** — twelve months at once, density carried by category colour rather
  than counts, because a number is unreadable at that scale and three coloured
  ticks under a date are not. Year-to-year navigation is a strip, so any year in
  the epoch is one click away.

No view owns data. All three read the same store and the same expander, so
switching is a render, not a reload, and there is no second source of truth.

## 9. One shell, one keymap, shared with the harness

`CalendarShell` owns the chrome, the view choice, and every shortcut. The
preview harness renders *that* shell against fixtures rather than a lookalike —
a harness that renders a different shell cannot catch a shell bug, which is
exactly how the shortcuts came to be advertised in the footer while `T` was
never bound at all.

Two bugs of the same family were fixed with it. The event-bar overlay set
`pointer-events: auto` across the whole week row, so it sat over every day cell
and swallowed the double-click the cells were listening for — the bars now
re-enable themselves individually and the row stays inert. And the day panel had
always passed a clicked hour up as a start time that the caller discarded.

The footer used to carry a legend of these gestures. Discoverability now lives in
settings, next to the keymap it documents, and the affordance for *new entry* is
a `+` that appears on the day under the cursor — where the cursor already is,
rather than in a line of text at the bottom of the screen.

## 10. Settings, because the calendar is not the whole app

Single account means there is no account *management* — only two facts worth
keeping somewhere: which identity this session is, and how to end it. Both were
pinned to the footer, permanently on screen, which is the wrong place for
something you look at twice a year.

The identity is redacted by default and revealed on request. Blurred rather than
bulleted: `-webkit-text-security` isn't in Firefox, and a row of dots loses the
shape of the value. On the login field this is CSS rather than
`type="password"`, which would break `autocomplete` and invite a password
manager to fill the wrong field. The rule is deliberately **unlayered** — it
always sits beside a colour utility of equal specificity, and a layered rule
loses to a later layer however specific it is, so layering it would make the
outcome depend on the order Tailwind happened to emit the two.

Timezone lives in `localStorage`, not in a table: it describes the device you
are reading on, not the calendar — every event already carries its own zone.
It is applied in `load()` rather than read during store construction, because
the server has no `localStorage` and a different first paint is a hydration
error. The view preference is a `useSyncExternalStore` for the same reason,
which is the one API that expresses "server default, client value after
hydration" without a cascading render.

**Scrollbars are hidden — a reversal.** They were styled as thin
instrument-panel rails, on the argument that a scroll position is information
and hiding it is a cost. That argument doesn't survive contact with this app,
which nests scroll containers: the week grid, the list, and every overlay each
own one, so the single tasteful rail turned into four competing vertical lines
down a surface whose only other vertical marks are hairlines that mean
something. Nothing was actually lost by hiding them — the position is already
readable from the header date and the month bands, which are exact rather than
proportional. `overflow` is unchanged; only the widget is gone.

## 11. Auth is one row, not a user system

Supabase Auth with a single account, sign-ups disabled, RLS on every table
keyed to `owner_id`. `src/proxy.ts` gates every route at the network boundary,
so an anonymous visitor never receives a rendered calendar.

The publishable key ships in the bundle and that is fine — RLS, not the key, is
what protects the data. `integrations` (Google refresh tokens) has RLS enabled
and **no policies at all**, making it reachable only by the service role from
server routes.

## 12. Reminders are recomputed, never queued

Occurrences are derived rather than stored, so there is nowhere to put a pending
notification — no row to mark as scheduled, nothing to update when the series
changes underneath it. A queue would immediately be able to disagree with the
calendar it was built from.

So there isn't one. `pg_cron` calls `/api/push/dispatch` every minute, and the
route asks `reminders.ts` what came due since it last looked, expanding the same
rules the grid renders from. That single choice is what makes the obvious bugs
impossible: a deleted event cannot notify, a cancelled occurrence cannot notify,
a rescheduled one notifies off its new time, and none of it needs cleanup.

**The delivery table is a claim, not a log.** `reminder_deliveries` has a unique
constraint on `(event_id, occurrence_date, minutes)`, and the dispatcher inserts
*before* it sends, forwarding only the rows the insert actually returned. Two
overlapping ticks split the work instead of both sending it. Sending first and
recording after would double-notify on any retry.

That in turn makes the tick cadence a performance question rather than a
correctness one, which is what buys the **60-minute catch-up window**: if the
ticker dies for half an hour the reminders it missed still arrive, late. Past an
hour they are dropped, because a reminder that arrives after the thing it was
about is worse than no reminder.

The identity is the **series date**, not the displaced one — the same key
overrides use. Keyed on where an occurrence actually sits, dragging it would
make its reminder eligible all over again.

**Offsets are durations, in minutes, matching Google's `{ method, minutes }`.**
The cost is the RFC 5545 wart that a lead time spanning a DST transition lands
an hour off; `reminders.test.ts` asserts that rather than hiding it. Negative
offsets are the one divergence — an all-day entry has no time of day, so "09:00
on the morning of" can only be said as -540.

## 13. The PWA installs; it does not pretend to work offline

The service worker caches the app shell and an offline page, and deliberately
caches no calendar data. A stale schedule is worse than a blank one: the failure
being prevented is turning up to something that moved.

It is hand-written for the same reason. `next-pwa` and Serwist both want webpack
config against a Turbopack build, and what they would add is precaching of the
whole bundle — stale JavaScript against a live database.

Almost everything awkward here is iOS being iOS: push requires the app to be on
the Home Screen and the manifest to say `standalone`; permission must be asked
inside a real tap, and asking in Safari *throws* rather than returning a refusal;
and the subscription is silently retired when the app sits unused, so the client
re-subscribes on every launch. `Notifications.tsx` has four states because those
are four genuinely different situations, and a single toggle would misreport
three of them.

The manifest and `sw.js` are public prefixes in `proxy.ts`. Both are fetched
with no session, often before anyone signs in, and the matcher only exempts
paths ending in an image extension — so without that the install prompt simply
never appears and nothing reports why.

The manifest states an `id` rather than letting one be derived from `start_url`,
because there is now a second launch URL: `/?new=1`, the Home Screen icon's "New
entry" shortcut, which `CalendarShell` consumes and strips on arrival. Without a
declared `id` a second start URL is a second *app*, and the installed copy stops
matching the manifest that describes it.

## 14. A finger picks a day; a cursor points at one

The grid's affordances were all built for a cursor, and the interesting thing is
that only one of them failed *visibly*. The hover `+` on each day cell is
removed on a coarse pointer — there is no hover to reveal it by — so on a phone
the gesture for "add something to this day" did not exist. `+ NEW` in the footer
still worked, but it lands on `focusedDay`, which nothing on a touch screen could
move: the only thing that set it was opening the day modal.

So a tap on a day cell now *picks* it and a tap on the day already picked opens
it, which splits what used to be one gesture into the cheap half and the
expensive one. The cheap half is the common case — pick the day, press `+ NEW`,
which is at the bottom of the screen under a thumb and now carries the date it
will use.

Three things follow from that, and they are the whole of the change:

- **The picked day had to become visible.** It was `bg-sunken` against a
  `#07080a` month band — three points of lightness, and *darker* than its
  neighbours on odd months. It is an inset ring now, brighter on touch, since
  there the ring is the only confirmation that the tap landed.
- **`+ NEW` had to say what it would do.** A button whose target is set by
  tapping something else has to state the target, or the tap has no visible
  consequence at all.
- **The day modal needed a `+ NEW` of its own.** Its only way to create was
  tapping an hour row, which says a time as well as a date — so a task or a
  birthday could not be added from the surface that shows them.

Desktop is deliberately untouched. A single click on the grid there is already
spoken for — it clears the lasso selection — so it keeps the double-click and the
hover `+`, and the pick ring is drawn one step quieter.

The rest of the touch work is the same idea applied where a control was built at
cursor precision: `ESC` in a panel header was a 29×10px word naming a key the
device does not have (it is a `×` in a 38px box on touch, and still `ESC` where
there is a keyboard); the list view's eight-column table was an 860px sideways
scroll on a 375px screen (it is a card list below `sm`, without the checkboxes,
since everything a selection does there is a chord); and the year view resolved
to one month per row, which turned "what shape did this year have" into a 2100px
scroll.

---

## Not built

- **Google Calendar sync.** Schema fields and the `integrations` table exist;
  no routes. See `GOOGLE_SETUP.md` for the design and the blocking manual step.
- **Timeline ruler / scrubber** in the left gutter — proposed, not built.
- **Command palette** with natural-language quick add — proposed, not built.
- **Reading Google events into the view** — `google_events_cache` and the
  `readOnly` occurrence flag exist for it; nothing populates them.
