# Tempo — scheduled backups, and a copy off the box

Agreed on 2026-09-20. `SELF_HOSTING.md` ends with "Nothing backs this up yet.
That was deferred deliberately" — this closes that. The script itself already
exists (`scripts/backup.mts`, `scripts/retention.mts`, added in d5b1b7f); what
is missing is that nothing runs it, and that its output never leaves the machine
it is protecting.

---

## Shape

Two halves that do not know about each other, joined by a directory.

**Oracle takes the backup and owns retention.** It runs nightly whether or not
anyone is awake, reads over `localhost:8000`, writes into
`~/tempo-backups/YYYY-MM/`, and thins the old ones.

**Windows pulls and never deletes.** A daily scheduled task lists what is on the
box, subtracts what is already on the Desktop, and fetches the remainder. It has
no opinion about retention — it is strictly additive.

The property that buys: the box stays bounded at roughly 115 MB, the Desktop
grows slowly into a deep archive that is always a superset of the server's, and
nothing automated ever deletes a file on a personal machine. The question "is it
allowed to delete backups?" stops needing an answer on the side where it would
have been nervous-making.

## Changes to `backup.mts`

- **Honour `SUPABASE_INTERNAL_URL`**, the way `server.ts:25` and `proxy.ts:42`
  already do. Today the script reads only `NEXT_PUBLIC_SUPABASE_URL`, so run on
  the box it would leave the machine, go out to DNS and Cloudflare, and come
  back to `localhost:8000` — and it would fail on a night when Cloudflare is
  unhappy, for no reason at all. A backup should not depend on more of the world
  than the thing it is backing up.
- **Write into monthly subfolders.** `listBackups()` walks one level of
  subdirectories and returns `2026-09/tempo-….json`. `unstamp()` stays strict on
  the basename, so the tested safety property is unchanged: anything this script
  did not write is unparseable, therefore invisible to the prune, therefore never
  deleted.
- **Guard the empty backup.** If `events` returns zero rows while the newest
  existing backup has rows, abort non-zero without writing *or* pruning. This is
  the one failure the current script cannot see — a service key or RLS problem
  that yields a valid-looking empty file, which then becomes newest-of-day and
  displaces the good one taken the same day.

## Changes to `retention.mts`

One new tier on the tail. Everything under two years already matched or beat
what was asked for, so it stands.

```
< 7 days     every run          (you still remember what you changed)
< 90 days    newest per day
< 730 days   newest per month
>= 730 days  newest per YEAR    ← new; never dropped
```

The floor of three stays. Growth past year two is about 1 MB a year, so a
never-dropped yearly tail costs nothing worth counting.

## New — `scripts/pull-backups.mts`

Runs on Windows. Lists `tempo-backups/*/*.json` over SSH, subtracts what is
already on the Desktop, copies the remainder, recreating the `YYYY-MM/` folders
locally. On a normal night that is one file.

The diff is a pure function — `(remote[], local[]) => toFetch[]` — testable
without a network, the same split that made `retention.mts` testable.

Two details that keep it from ever being a nuisance:

- **`ConnectTimeout` on the SSH call.** Without one, an unreachable box or a
  captive-portalled network leaves `ssh` waiting for minutes. A hung background
  process is the only way a job this small becomes something you notice.
- **A canary.** If the newest backup on the box is more than two days old, print
  a loud warning. A backup system that fails silently is the exact failure the
  whole exercise exists to prevent, and the Desktop is the surface that actually
  gets looked at.

## Scheduling

| Where | What |
|---|---|
| Oracle | systemd timer, `OnCalendar=*-*-* 03:00:00 America/Toronto`, `Persistent=true` |
| Windows | Task Scheduler, 03:30 local, *run as soon as possible after a missed start*, **hidden** |

**Why 03:00 and not 23:59.** End-of-day is the intuitive slot and it is the
wrong one here. `survivors()` buckets by UTC calendar day and month on purpose
(`retention.mts:65`: a folder should not thin differently depending on where you
were sitting when you ran it), and the monthly subfolder comes from that same
UTC timestamp. Eastern is UTC-5/-4, so 23:59 local is 03:59 UTC *the next day* —
every backup filed under tomorrow, and a backup taken Sept 30 at 23:59 landing
in `2026-10/`. 23:59 is also the one minute of the day where a few seconds of
delay changes the date a file is filed under: one day gets two, the day before
gets none.

03:00 local is 07:00 or 08:00 UTC — same date, about seven hours of clearance on
either side, and it survives DST without approaching an edge. So the job fires in
local time and the buckets stay UTC, and the two agree year-round. Any local hour
from midnight to roughly 19:00 would do; 03:00 sits in the middle of that range.

The "end of day" framing does not really apply either: this is a snapshot of an
entire calendar, future events included, not a daily rollup. And 03:00 catches
late-night edits sooner — edited at 01:00, backed up two hours later rather than
nearly a full day later.

**The timezone is pinned on the job, not on the box.** `pg_cron` calls the
reminder dispatcher every minute off the system clock; changing the host's
timezone to get a 3am local run would perturb that for no reason. systemd 255 on
24.04 takes the zone suffix in `OnCalendar` directly. `Persistent=true` so a run
straddled by a reboot still fires, and journal logging comes free.

## Paths

| | |
|---|---|
| Oracle | `~/tempo-backups/YYYY-MM/tempo-<ISO>Z.json` |
| Oracle log | `~/tempo-backup.log` — outside the backup dir, so the prune never sees it |
| Desktop | `C:\Users\bruce\Desktop\stuff\tempo-backups\YYYY-MM\` |

## Testing

`retention.test.ts` extends for the yearly tier and its never-dropped tail, and
for the monthly-folder path — including that a stray file inside a subfolder is
still unparseable, since that is what stops the prune touching anything it did
not write. The empty-backup guard gets a test. `pull-backups` gets tests for the
diff: nothing to fetch, one new file, a month of catch-up, and a local folder
that does not exist yet. All pure, no network, consistent with how
`retention.mts` was split out in the first place.

## Left out

**Restore stays manual**, as the closing comment in `backup.mts` argues. A
restore overwrites a live calendar and the right move depends on what went
wrong; the procedure is written down there and that is the right place for it.

**No pruning on the Desktop**, per the shape above.

**No notification on failure beyond the canary.** Tempo can send push, but
wiring backup health into it would mean the reminder path carrying a second job,
and a warning on the machine you use every day is enough for a personal
calendar.

## Docs

Replace the "Nothing backs this up yet" note at the bottom of `SELF_HOSTING.md`
with how it is wired, where the files land on both ends, the timer's name, and a
pointer to the restore procedure.
