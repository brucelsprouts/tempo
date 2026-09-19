# Tempo — the entry popup saves as you go

The second of three builds agreed on 2026-09-19, after
[due times and TASK's retirement](2026-09-19-due-times-and-task-retirement-design.md).

---

## What prompted this

In the user's words: "all entry edits or creations [should] auto save as text or
features are edited so that I don't have to worry about clicking off and losing
progress, basically making the save button cosmetic."

Asked two questions, they chose:

- **Esc just closes.** It keeps what was done, like every other way out; UNDO on
  the toast is how something is taken back. (This replaces the rule from
  2026-08-01 that Esc throws a new entry away.)
- **A repeating entry asks which dates when it closes**, as it does now — but
  closing any way asks, rather than some ways throwing the change away.

## What is actually wrong

- **The phone's only way out of the popup throws the work away.** On a phone the
  modal is the whole screen, so the backdrop is not a target, and the header's
  `×` is `onClose = pop`: everything typed is discarded. The one keep-gesture
  there is the CREATE / SAVE button at the bottom.
- **Nothing is written until the popup closes.** If iOS suspends or reloads the
  installed app while you check something in another app, the form is gone.
- **Esc discards on desktop**, and the header's `ESC` button with it.
- A change to a repeating entry is lost the same way: the which-dates question
  only comes up on the ways out that commit.

## Decisions

### What saves, and when

Every change in the popup is saved as it is made — for a new entry, an existing
one-off, a birthday or a mark. The calendar behind updates straight away; the
database gets the change 400ms after the last edit, straight away when the
popup closes, and straight away when the app is hidden (switching apps on a
phone), since a suspended page never fires a pending timer.

A **repeating** entry other than a birthday cannot be saved until it is known
which dates the change is for, so it keeps today's flow: the form holds the
change and asks THIS DATE / THIS AND LATER / EVERY DATE on close. A birthday
saves as you go — its edits already mean every year.

### Every way out keeps

Click-off, Enter, the bottom button, the header's `×` / `ESC` and the Esc key all
close and keep. The bottom button reads **DONE**. The which-dates question gains
**DISCARD**, the one explicit way to drop a change to a repeating entry; its Esc
still goes BACK to the form.

### A new entry

A new entry is written on its first change. Closing one nobody touched still
creates it, as UNTITLED — the 2026-08-01 rule for clicking off, now true of every
way out. So `A` then Esc leaves an UNTITLED entry, and UNDO on the toast removes
it. Until the first change the grid keeps drawing the draft bar; after it, the
real bar is on the grid and the draft bar goes.

### One popup, one undo, one version

Opening the popup starts an **edit session**: the store remembers how the
calendar stood. Closing it — or anything else that unmounts the form, such as
HISTORY — ends the session: pending writes are flushed, then one undo entry is
recorded for everything the popup did (`Created …` or `Edited …`), and one
version per entry that existed before, holding its shape from before the popup
opened. Opening and closing without a change records nothing.

Writes inside a session go through a small writer that is debounced and
serialised: the latest draft wins, and a write never starts while another is in
flight, so an older draft cannot land after a newer one.

While a session is open, the realtime echo of its own rows is ignored — the
popup is the authority, and an out-of-order echo would otherwise flicker the bar
back a keystroke.

### The header says so

The modal's meta line reads `SAVING…` while a write is waiting or in flight,
`SAVED` once it lands, and `NOT SAVED · WILL RETRY` after a failure. A repeating
entry keeps `REPEATS · CLOSING ASKS WHICH DATES`.

### When a save fails

A failed write inside the session keeps the popup's state and retries with the
next change or on close. If the last write still fails when the session ends,
the calendar is put back to what the server last accepted — or the entry is
removed, if it never reached the server — and the error banner says why, the
same honesty as every other failed write in the app.

## Testing

- The writer, with fake timers: debounced, latest wins, serialised, `flush` runs
  at once and waits for a write in flight.
- The store's session: a new entry is created once and recorded as `Created`; an
  edit records one version with the old shape and one `Edited` undo that puts it
  back; open-and-close records nothing; a failed last write rolls back to what
  the server accepted and sets the error; an echo of a session's row is ignored
  while it is open.
- In `/preview`: type into a new entry and see the bar fill in behind the popup
  and the header go `SAVING…` → `SAVED`; close with `×` / `ESC` / Esc / click-off
  and find it kept; one toast, one UNDO that removes it; a repeating entry asks
  on Esc and DISCARD drops the change.

## Design record

`DESIGN.md` gains a section: the popup saves as you go; every way out keeps; a
repeating entry asks on close; one undo and one version per popup.

## Out of scope

- A local copy of a draft for a repeating entry, surviving a reload.
- Autosave in other surfaces (settings' category names already save on blur).
