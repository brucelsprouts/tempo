import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { eventFromRow, overrideFromRow } from '@/lib/tempo/mappers';
import {
  dueReminders,
  reminderText,
  MIN_LEAD_MINUTES,
  type DueReminder,
} from '@/lib/tempo/reminders';
import { sendToAll } from '@/lib/push/send';
import type { OccurrenceOverride } from '@/lib/tempo/types';

/**
 * The heartbeat.
 *
 * pg_cron calls this every minute. It works out which reminders came due since
 * the last tick, claims them, and sends them. Nothing anywhere holds a queue of
 * pending notifications, because occurrences are derived rather than stored —
 * there would be nothing to hang one off, and a queue would immediately be able
 * to disagree with the calendar it was built from.
 *
 * Not cookie-authenticated: the caller is a cron job inside Postgres, not a
 * browser. `CRON_SECRET` is the entire gate, which is why `proxy.ts` lets this
 * path through and why the comparison below is constant-time.
 */
export const runtime = 'nodejs';

/**
 * How far back a tick will look.
 *
 * Longer than the one-minute cadence on purpose: if the ticker stops for half
 * an hour, the reminders it missed still arrive — late, but they arrive. The
 * hour is where "late" stops being useful and starts being a lie, so anything
 * older than that is dropped rather than delivered.
 *
 * It costs nothing to overlap, because a reminder is claimed by a unique
 * insert. Sixty ticks can cover the same minute and only one send happens.
 */
const CATCHUP_MINUTES = 60;

/**
 * The columns a reminder is computed from, and nothing else.
 *
 * This query ran as `select('*')`, once a minute, forever — 43,200 pulls of
 * every event that holds a reminder, every month. Egress is the one free-tier
 * limit a one-person calendar can plausibly reach, and this is the query that
 * walks it there; `notes` alone can outweigh the rest of the row.
 *
 * Nothing below reads the rest: the expansion needs the schedule, the title and
 * the template, `reminderText` needs the kind and the due time, and the claim
 * needs the owner.
 */
const REMINDER_COLUMNS =
  'id,owner_id,title,kind,all_day,starts_at,ends_at,start_date,end_date,due_minutes,timezone,recurrence,reminders,anchor_date,display_template,notify' as const;

/**
 * Stand-ins for the columns the select above deliberately does not fetch.
 *
 * `eventFromRow` maps a whole row and three of the fields it fills are not
 * nullable, so the alternative to padding here is a second mapper free to drift
 * from the one the app uses. The expansion does copy two of these onto each
 * occurrence — `categoryId`, and `source` by way of `readOnly` — but both are
 * for rendering, and nothing on the path to a notification looks at either.
 *
 * If that stops being true, the column belongs in the select, not here.
 */
const UNFETCHED = {
  notes: null,
  category_id: null,
  source: 'tempo',
  google_event_id: null,
  google_calendar_id: null,
  google_sync_hash: null,
  google_synced_at: null,
  // Retired: nothing sets it and nothing reads it. See 20260919_retire_tasks.sql.
  status: null,
  // Filtered on in the query, so a row that comes back is always live.
  deleted_at: null,
  created_at: '1970-01-01T00:00:00.000Z',
  updated_at: '1970-01-01T00:00:00.000Z',
} as const;

/**
 * How far into the past an event can sit and still owe you a notification.
 *
 * A reminder fires at most `-MIN_LEAD_MINUTES` after the point it counts from
 * (the floor is one day *after*), a tick looks `CATCHUP_MINUTES` back, and a
 * bare date is compared without a zone, which a far-eastern offset can shift by
 * most of a day. Doubling the sum leaves all three covered several times over.
 *
 * The point is what it excludes: a calendar accumulates finished events forever,
 * and none of them can ever fire again. Without this the per-minute scan grows
 * for as long as you use the app.
 */
const REACHABLE_DAYS = Math.ceil(
  (2 * (-MIN_LEAD_MINUTES + CATCHUP_MINUTES)) / 1440,
) + 1;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not set' }, { status: 500 });
  }
  if (!authorised(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();
  const after = new Date(now.getTime() - CATCHUP_MINUTES * 60_000);

  const cutoff = new Date(now.getTime() - REACHABLE_DAYS * 1440 * 60_000);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const { data: eventRows, error: eventsError } = await supabase
    .from('events')
    .select(REMINDER_COLUMNS)
    .is('deleted_at', null)
    .not('reminders', 'is', null)
    // A series is always kept: its rule may still be producing occurrences, and
    // deciding otherwise means evaluating UNTIL and COUNT in PostgREST. A
    // one-off is kept only while it is still within reach, by whichever of its
    // four schedule columns it actually uses — an OR, so a null column simply
    // does not vote.
    .or(
      [
        'recurrence.not.is.null',
        `ends_at.gte.${cutoff.toISOString()}`,
        `starts_at.gte.${cutoff.toISOString()}`,
        `end_date.gte.${cutoffDate}`,
        `start_date.gte.${cutoffDate}`,
      ].join(','),
    );

  if (eventsError) {
    return NextResponse.json({ error: eventsError.message }, { status: 500 });
  }

  // Narrowed after mapping rather than in the query. "Is not the empty array"
  // is an awkward thing to say about jsonb through PostgREST, and this is one
  // person's calendar — a few hundred rows — so the filter is free here and
  // uses the same parse the app does, including its treatment of malformed
  // values as silence.
  const events = (eventRows ?? [])
    .map((row) => eventFromRow({ ...UNFETCHED, ...row }))
    .filter((e) => e.reminders.length > 0);
  if (events.length === 0) {
    return NextResponse.json({ scanned: 0, due: 0, sent: 0, claimed: 0 });
  }

  // Only the exceptions belonging to those events. A cancelled occurrence must
  // not notify, and a moved one must notify off its new time, so expansion
  // here has to see exactly what the calendar sees.
  const { data: overrideRows, error: overridesError } = await supabase
    .from('occurrence_overrides')
    .select('*')
    .in(
      'event_id',
      events.map((e) => e.id),
    );

  if (overridesError) {
    return NextResponse.json({ error: overridesError.message }, { status: 500 });
  }

  const overridesByEvent = new Map<string, OccurrenceOverride[]>();
  for (const row of overrideRows ?? []) {
    const o = overrideFromRow(row);
    const list = overridesByEvent.get(o.eventId);
    if (list) list.push(o);
    else overridesByEvent.set(o.eventId, [o]);
  }

  const due = dueReminders(events, overridesByEvent, after, now);
  if (due.length === 0) {
    return NextResponse.json({ scanned: events.length, due: 0, sent: 0, claimed: 0 });
  }

  // The claim, and the whole of the concurrency design.
  //
  // Insert first, and let the unique constraint decide who owns each reminder.
  // `ignoreDuplicates` turns a collision into a row that simply isn't returned,
  // so `claimed` is exactly the set this tick won — two overlapping ticks split
  // the work rather than both sending it. Sending first and recording after
  // would double-notify on any retry.
  const { data: claimedRows, error: claimError } = await supabase
    .from('reminder_deliveries')
    .upsert(
      due.map((d) => ({
        owner_id: eventOwner(eventRows ?? [], d.event.id),
        event_id: d.event.id,
        occurrence_date: d.seriesDate,
        anchor: d.anchor,
        minutes: d.minutes,
        fire_at: d.fireAt.toISOString(),
      })),
      { onConflict: 'event_id,occurrence_date,anchor,minutes', ignoreDuplicates: true },
    )
    .select();

  if (claimError) {
    return NextResponse.json({ error: claimError.message }, { status: 500 });
  }

  const claimed = new Set(
    (claimedRows ?? []).map((r) => `${r.event_id}:${r.occurrence_date}:${r.anchor}:${r.minutes}`),
  );
  const toSend = due.filter((d) => claimed.has(deliveryKey(d)));

  if (toSend.length === 0) {
    return NextResponse.json({ scanned: events.length, due: due.length, sent: 0, claimed: 0 });
  }

  const { data: subs, error: subsError } = await supabase.from('push_subscriptions').select('*');
  if (subsError) {
    return NextResponse.json({ error: subsError.message }, { status: 500 });
  }

  // No devices is not an error and does not un-claim anything. The reminder's
  // moment has passed either way, and leaving it unclaimed would mean that
  // subscribing a phone later replays every reminder still inside the catch-up
  // window — a burst of notifications about things that already happened.
  let sent = 0;
  let pruned = 0;
  for (const d of toSend) {
    const { title, body } = reminderText(d);
    const result = await sendToAll(supabase, subs ?? [], {
      title,
      body,
      url: `/?d=${d.occurrence.date}`,
      // One tag per reminder, so two leads on the same occurrence are two
      // notifications but a redelivered one replaces itself.
      tag: deliveryKey(d),
    });
    sent += result.sent;
    pruned += result.pruned;
  }

  return NextResponse.json({
    scanned: events.length,
    due: due.length,
    claimed: toSend.length,
    sent,
    pruned,
  });
}

/** A reminder's claim, spelled the way the delivery table's unique key reads. */
function deliveryKey(d: DueReminder): string {
  return `${d.event.id}:${d.seriesDate}:${d.anchor}:${d.minutes}`;
}

/** The owner of an event, from the rows already fetched. */
function eventOwner(rows: { id: string; owner_id: string }[], id: string): string {
  return rows.find((r) => r.id === id)!.owner_id;
}

/**
 * Constant-time bearer comparison.
 *
 * `===` on a secret leaks its length and, in principle, its prefix through
 * timing. This route is reachable unauthenticated by anyone who finds the URL,
 * so it is the one comparison in the app worth doing properly.
 */
function authorised(header: string | null, secret: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  // timingSafeEqual throws on a length mismatch, which would itself be a leak.
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}
