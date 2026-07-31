# Google Calendar mirror — design and setup

Not built yet. This is the plan and the one step only you can do.

The goal is reminders without running notification infrastructure: Tempo writes
flagged events into Google Calendar, and Google's own alerts handle the phone,
watch and email.

---

## The manual step (blocking)

Creating OAuth credentials requires your Google account, so it isn't something
that can be automated for you:

1. [Google Cloud Console](https://console.cloud.google.com/) → create a project
   (e.g. `tempo`)
2. **APIs & Services → Library** → enable **Google Calendar API**
3. **APIs & Services → OAuth consent screen**
   - User type: **External**, publishing status **Testing**
   - Add your own Google account under **Test users** — that's all that's
     needed for a single-user app, and it avoids app verification entirely
4. **Credentials → Create credentials → OAuth client ID**
   - Type: **Web application**
   - Authorised redirect URIs:
     - `http://localhost:3000/api/google/callback`
     - `https://<your-subdomain>/api/google/callback`
5. Copy the client ID and secret into `.env.local`

Also fill in `SUPABASE_SERVICE_ROLE_KEY` (Supabase dashboard → Project Settings
→ API). Refresh tokens are written with the service role because the
`integrations` table has no RLS policies.

**Scope:** `https://www.googleapis.com/auth/calendar` — needed to create a
dedicated calendar and write to it.

---

## Design

### A dedicated calendar, not your primary

The mirror writes into a calendar named `Tempo`, created on first connect and
recorded in `integrations.calendar_id`. Isolation means the whole mirror can be
toggled or deleted without collateral damage, and reading your other calendars
back in later can exclude it without echoing.

### One-directional to start

App → Google only. Google events would otherwise need conflict resolution, which
is a large amount of complexity for a problem you don't have yet.

### Ordinary recurring events push their rule

A weekly standup becomes one Google event carrying its RRULE. Google expands it
natively and fires a reminder per occurrence. This is why recurrence is stored
in RRULE-compatible shape — serialising is a rename.

### Derived titles are the hard part

Google cannot compute `{yearsSince}`. Pushed as a series, a birthday would read
"Mom" on your watch instead of "Mom · 52".

So events with a `display_template` are handled differently: the mirror
**materialises the next ~3 years of occurrences as individual Google events with
rendered titles**, refreshed by a nightly job that also extends the horizon and
repairs drift. Slightly more API calls, in exchange for the age actually
appearing in the notification — which is the entire point of the feature.

### Sync trigger

Enqueue on write, plus a nightly Vercel Cron reconciliation pass. The nightly
pass is what makes it robust: a missed webhook self-heals within a day.

`google_sync_hash` stores a hash of the fields that affect the mirrored copy, so
reconciliation can skip events that haven't meaningfully changed.

### All-day end dates

Google's all-day `end.date` is **exclusive**; Tempo's `end_date` is inclusive.
One `+1` conversion, confined to the sync layer.

---

## Routes to build

```
GET  /api/google/connect    → redirect to Google consent (access_type=offline)
GET  /api/google/callback   → exchange code, create the Tempo calendar, store tokens
POST /api/google/sync       → reconcile flagged events (also the cron target)
GET  /api/google/status     → connection state for the UI
```

## Extending to two-way later

Store `etag` and `updated` per mirrored event. Register a Google push
notification channel (`watch`) pointing at a webhook, and pull incremental
changes with `syncToken`. Resolve with last-write-wins plus a review queue for
genuine divergence — where both sides changed since the last sync, surface it
rather than silently picking a winner.
