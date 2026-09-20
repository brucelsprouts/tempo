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

## Known rough edges

- **Node 20.** `@supabase/supabase-js` warns it will drop support. Upgrade to
  22 when convenient; the warning is not yet an error.
- **VAPID keys were regenerated** for this deployment, so push subscriptions
  made against the old Vercel deployment are dead. Toggle notifications off and
  on once per device. To avoid that instead, copy the three `VAPID_*` values
  from the old Vercel project into `.env.local` and rebuild.
- **`reminders_backup_20260917`** existed in the hosted database and was not
  migrated. It was a one-off backup taken during an earlier migration.
- Nothing backs this up yet. That was deferred deliberately; `npm run backup`
  works against it once `SUPABASE_SERVICE_ROLE_KEY` and
  `NEXT_PUBLIC_SUPABASE_URL` in a local `.env.local` point here.
