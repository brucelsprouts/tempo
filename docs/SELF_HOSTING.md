# Tempo on the Oracle box

Everything — app and database — runs on one Oracle Cloud ARM instance. Written
down because the next person to touch it will be a fresh Claude session with no
memory of building it.

## Where things are

| | |
|---|---|
| Host | `ubuntu@192.18.158.188` (Ubuntu 24.04, ARM64, 4 OCPU / 24 GB) |
| App | `~/tempo`, built with `npm run build`, run by PM2 as `tempo` on **:3000** |
| Supabase | `~/supabase-tempo`, Docker Compose, gateway on **:8000** |
| App env | `~/tempo/.env.local` (chmod 600) |
| Stack env | `~/supabase-tempo/.env` (chmod 600) |
| Credentials | `~/tempo-credentials.txt` (chmod 600) — Studio and Postgres logins |

Seven containers, not the full eleven: `db`, `rest`, `auth`, `realtime`,
`api-gw`, `studio`, `meta`. Storage, imgproxy, edge-runtime and supavisor are
deliberately not started — Tempo uses none of them, and every container that
does not run is one that cannot break or need patching.

```bash
cd ~/supabase-tempo && sudo docker compose up -d db rest auth realtime api-gw studio meta
```

## The two URLs, which are not the same

This is the thing most likely to confuse someone later.

- **`NEXT_PUBLIC_SUPABASE_URL`** — `https://supabase.brucelsprouts.com`. Baked
  into the browser bundle at build time. The browser can only resolve a public
  name, so this has to be the public one. **Changing it requires a rebuild**,
  not just a restart.
- **`SUPABASE_INTERNAL_URL`** — `http://localhost:8000`. Used by the server
  (SSR client, service-role client, middleware) in preference to the public URL.
  Keeps server-side queries on the box instead of sending them out to DNS and
  back through Cloudflare.

A JWT is verified by signature, not by hostname, so a token minted for the
public origin is equally valid arriving on localhost.

**The trap that comes with this**, and the one to suspect first if signing in
ever breaks: `@supabase/ssr` derives the session cookie's *name* from whatever
URL you hand it (`sb-<first label of the hostname>-auth-token`). Two different
URLs therefore mean two different cookie names, the server finds nothing, and a
valid session reads as no session.

It fails misleadingly. The login returns 200 and sets the cookie, then
middleware bounces the next navigation back to `/login`, and the form sits on
`VERIFYING…` forever — it only clears that on *failure*, so a login that
succeeds into a redirect loop looks identical to one that hung. The logs show a
successful login and nothing else.

`lib/supabase/cookie.ts` pins the name from the public URL and every client
passes it explicitly. **Any new Supabase client must pass
`cookieOptions: { name: AUTH_COOKIE_NAME }` too.**

## How traffic gets in

A Cloudflare Tunnel, **not** open ports. `cloudflared` makes an outbound
connection to Cloudflare, so nothing is exposed inbound, no OCI Security List
rule is needed, and Cloudflare terminates TLS — which matters because service
workers (and therefore push notifications) only run on HTTPS.

| | |
|---|---|
| Tunnel | `tempo`, id `8b1d3876-6c93-4663-adfa-e4dc31f9932b` |
| Config | `/etc/cloudflared/config.yml` |
| Service | `systemctl status cloudflared` |
| `tempo.brucelsprouts.com` | → `localhost:3000` (the app) |
| `supabase.brucelsprouts.com` | → `localhost:8000` (the API gateway) |

Both are CNAMEs to `<tunnel-id>.cfargotunnel.com`, created by
`cloudflared tunnel route dns`. To roll back to Vercel, point
`tempo.brucelsprouts.com` at it again in the Cloudflare dashboard.

## Reminders

`pg_cron` inside the database container calls the dispatcher every minute:

```
http://172.18.0.1:3000/api/push/dispatch
```

`172.18.0.1` is the gateway of the `supabase_default` Docker network — i.e. the
host, from inside a container. Deliberately **not** the public URL: reminders
should not stop because DNS or Cloudflare is briefly unhappy.

That path needs one firewall rule, because Oracle's images `REJECT` everything
not explicitly allowed:

```bash
sudo iptables -I INPUT 1 -s 172.18.0.0/16 -p tcp --dport 3000 -j ACCEPT \
  -m comment --comment "tempo: pg_cron reaches the app"
sudo netfilter-persistent save
```

It does not expose :3000 to the internet — the source is restricted to the
Docker subnet.

Check it is alive:

```bash
sudo docker exec supabase-db psql -U postgres \
  -c 'select status_code, content, created from net._http_response order by created desc limit 3;'
```

A healthy tick is `200 {"scanned":N,"due":0,"sent":0,"claimed":0}`. A
`500 {"error":"TypeError: fetch failed"}` means the app cannot reach Supabase —
check `SUPABASE_INTERNAL_URL` and that the stack is up.

## Standing up a fresh database

Run `supabase/migrations/00000000_base_schema.sql` **first**, then the dated
migrations in order. Everything dated is a patch that `ALTER`s tables the base
schema creates; before that file existed there was nothing in the repo that
created them at all.

## Common jobs

```bash
pm2 restart tempo          # after an env change
pm2 logs tempo --lines 50  # app logs
cd ~/tempo && git pull && npm run build && pm2 restart tempo   # deploy
cd ~/supabase-tempo && sudo docker compose ps                  # stack health
```

## Backups

A systemd timer takes one nightly and the desktop copies it down. Neither half
knows about the other; they meet in a directory.

| | |
|---|---|
| On the box | `~/tempo-backups/YYYY-MM/tempo-<ISO>Z.json` — ~650 KB each |
| Timer | `tempo-backup.timer`, 03:00 `America/Toronto`, `Persistent=true` |
| Log | `~/tempo-backup.log` |
| Units | copied into the repo at `deploy/`, if one ever needs rebuilding |
| On the desktop | `C:\Users\bruce\Desktop\stuff\tempo-backups\YYYY-MM\` — the archive, never pruned |
| Hand-run backups | `…\stuff\tempo-backups-manual\` — a *different* folder, and deliberately so |
| Pull | Task Scheduler, "Tempo backup pull", 03:30 daily, catches up after the PC has been off |
| Key | the desktop reaches the box via `~/.ssh/config` (`Host 192.18.158.188` → `C:\Keys\new-key`) |

**Retention runs on the box only.** Under a week keeps every run; under three
months the newest of each day; under two years the newest of each month; beyond
that the newest of each year, kept for good. The desktop never deletes a
backup, so its archive is always a superset of the server's — which is also why
the box stays bounded while the desktop grows slowly.

**`npm run backup` writes to `tempo-backups-manual`, not the archive,** and that
separation is load-bearing rather than tidiness. The backup script prunes after
it writes; the archive's whole promise is that nothing deletes from it. If the
default pointed at the archive, one hand-run would quietly collapse years of
kept history down to the retention ladder. Pass `TEMPO_BACKUP_DIR` to override,
but never point it at the archive.

**The timezone is pinned on the timer, not the box.** The host stays `Etc/UTC`
because `pg_cron` drives the reminder dispatcher off the system clock. 03:00
Eastern resolves to 07:00 UTC — the same calendar day, which matters because
retention buckets by UTC. A late-evening slot would not: 23:59 local is 03:59
UTC *tomorrow*, filing every backup under the following day and putting the last
one in September into `2026-10/`.

**The backup reads `http://localhost:8000`**, not the public URL, so it does not
depend on DNS or Cloudflare being happy. It records the *public* URL in the
file's `project` field, since `localhost:8000` identifies nothing once the file
is on another machine.

**If `BACKUPS-MAY-HAVE-STOPPED.txt` appears** in the desktop folder, the newest
backup on the box is over two days old:

```bash
systemctl status tempo-backup.timer
journalctl -u tempo-backup.service -n 50
```

The file deletes itself once backups are arriving again.

**The pull task runs `S4U`**, so it is silent — no console window, ever. That
is structural rather than a setting: S4U runs the task in session 0, which has
no desktop to draw a window on. Note that the `-Hidden` task *setting* does not
do this; it only hides the task from the Task Scheduler library listing.

Setting `S4U` needs elevation, because that logon type depends on the "log on
as a batch job" right. If the task is ever recreated from scratch it will come
back as `Interactive` and start flashing a window again — this restores it, from
an **elevated** PowerShell:

```powershell
$p = New-ScheduledTaskPrincipal -UserId "BRUCELSPROUTS\bruce" -LogonType S4U -RunLevel Limited
Set-ScheduledTask -TaskName "Tempo backup pull" -Principal $p
```

S4U can still read `C:\Keys\new-key` and `~/.ssh/config`, because both are
local files rather than anything needing network credentials — which is the
thing to check first if a silent task ever starts failing to connect.

**To restore**, see the comment at the bottom of `scripts/backup.mts`. It is
deliberately not automated: a restore overwrites a live calendar and the right
move depends on what went wrong.

## Known rough edges

- ~~**Node 20.**~~ Upgraded to **22.23.2** on 2026-09-20 (NodeSource), which
  both silenced the `@supabase/supabase-js` warning and was a hard requirement
  for the backup timer: Node only strips types from `.mts` natively from 22.6,
  so on 20 `npm run backup` died with `ERR_UNKNOWN_FILE_EXTENSION`.
- **VAPID keys were regenerated** for this deployment, so push subscriptions
  made against the old Vercel deployment are dead. Toggle notifications off and
  on once per device. To avoid that instead, copy the three `VAPID_*` values
  from the old Vercel project into `.env.local` and rebuild.
- **`reminders_backup_20260917`** existed in the hosted database and was not
  migrated. It was a one-off backup taken during an earlier migration.
- **`VERCEL_OIDC_TOKEN` and the empty `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`**
  are left over in the local `.env.local` from the Vercel deployment. Harmless,
  but nothing reads them here any more.
