# Tempo — export as ICS

The third build agreed on 2026-09-19. Asked for in the first spec, on
2026-07-31: "an in-app export button that downloads all events as both JSON and
ICS (ICS so it's re-importable into any other calendar)". Designed that day and
never built; only JSON exists.

---

## Decisions already taken (2026-07-31)

- **A pure module**, `src/lib/tempo/ics.ts`: no React, no network, tested like
  the rest of `src/lib/tempo`.
- **Hybrid for derived titles.** ICS gives a repeating event one SUMMARY for
  every occurrence, so "Mom · 52" cannot be a rule. An entry with a display
  template is written as one event per occurrence, each with its resolved title;
  everything else as one event with an RRULE.
- **Stable UIDs**, so importing a newer export updates rather than duplicates.
- **One route, two formats:** `/api/export?format=ics`, beside the JSON default.

## Decisions taken now

- **How far a derived series is written out:** from its start to ten years from
  the day of the export. A backup keeps the history the plain series keep, and a
  century of birthdays per person is thousands of events for no one; exporting
  again next year moves the horizon.
- **Times.** An all-day entry is `VALUE=DATE` with an *exclusive* end — Tempo
  stores the last day, ICS wants the day after, and that off-by-one gets its own
  test. A one-off with a time is written in UTC. A repeating one with a time is
  written in its own zone (`TZID=America/Toronto`), since a UTC rule would put a
  09:00 lecture at 10:00 for half the year. No `VTIMEZONE` block: Google, Apple
  and Outlook resolve IANA zone names themselves, and generating the block
  would be the largest part of this module for none of the calendars it is for.
- **Exceptions.** A skipped date is an `EXDATE`; a moved or renamed date is a
  second event with the same UID and a `RECURRENCE-ID`. Only exceptions that
  still name a real date of their series (`isSeriesDate`) are written — the same
  rule the grid draws by.
- **What else rides along:** the category as `CATEGORIES`, the notes and — for an
  all-day entry that states one — the due time as `DESCRIPTION` ("Due 23:55"),
  since an all-day event in ICS has no time to carry it.
- **Left out:** entries in the trash, entries mirrored from Google, and
  reminders (`VALARM`). Tempo's reminders count back from anchors ICS has no
  words for, and every calendar this would be imported into sets its own
  alerts.
- **Format:** RFC 5545 — CRLF line endings, lines folded at 75 octets without
  splitting a character, text escaped (`\\`, `\;`, `\,`, `\n`).
- **Settings:** a second link, EXPORT ALL AS ICS, beside the JSON one.

## Testing

`ics.test.ts`: an all-day entry's exclusive end; a one-off with a time in UTC;
a weekly series' RRULE with its days, zone and `UNTIL` / `COUNT`; a skipped date
as `EXDATE` and a moved one as a `RECURRENCE-ID` event; a birthday written out
year by year with its age, stopping ten years ahead; escaping and folding; the
trash and Google entries left out; category and due time carried. Then the link
in Settings, against the preview's route.
