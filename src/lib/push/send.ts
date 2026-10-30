import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, PushSubscriptionRow } from '@/lib/db/database.types';

/**
 * Sending, and the pruning that has to happen alongside it.
 *
 * Kept apart from the routes because a push send is never just a send: a
 * subscription the push service has retired answers 404 or 410, and a sender
 * that doesn't delete those accumulates dead rows that fail on every tick
 * forever. The two belong in the same place or the second one gets forgotten.
 *
 * Not every dead subscription says so. Some answer 400 or 401 instead, which
 * could also mean a bad request or a key problem, so one of those is a strike
 * rather than a verdict. `MAX_FAILURES` in a row with nothing delivered between
 * them is the verdict. A wrong call costs little: the client re-subscribes every
 * time the app is opened.
 */

/** Rejections in a row, with no delivery between them, before a device is dropped. */
export const MAX_FAILURES = 5;

/**
 * The answers that count against a device. Not 429 or a 5xx, which are the push
 * service having a bad minute, and not 413, which is about the payload: none of
 * those say anything about the subscription.
 */
const REJECTED = new Set([400, 401, 403]);

/** What the service worker's `push` handler expects to parse. */
export interface PushPayload {
  title: string;
  body: string;
  /** Opened when the notification is tapped. */
  url: string;
  /**
   * Collapse key. iOS replaces a showing notification that shares a tag rather
   * than stacking a second one, so this is what stops a re-delivered reminder
   * appearing twice on the lock screen.
   */
  tag: string;
}

let configured = false;

/**
 * Deferred rather than done at import time, so a missing key surfaces as a
 * failed send in a route that can report it — not as a module that throws
 * during the build, when nothing has asked to send anything yet.
 */
function configure(): void {
  if (configured) return;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error('VAPID keys are not set — run `npx web-push generate-vapid-keys`');
  }

  // The subject identifies you to the push service if delivery goes wrong. It
  // has to be a mailto: or https: URL; Apple rejects the subscription outright
  // if it is neither.
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:tempo@localhost',
    publicKey,
    privateKey,
  );
  configured = true;
}

export interface SendResult {
  sent: number;
  /** Subscriptions deleted because the push service said they were gone. */
  pruned: number;
  failed: number;
}

/**
 * Deliver one payload to every subscription given.
 *
 * Failures are counted rather than thrown. One dead phone must not stop the
 * reminder reaching the other one, and the dispatcher has already recorded the
 * delivery by the time this runs — throwing here would mean a reminder marked
 * sent that no device ever got.
 */
export async function sendToAll(
  supabase: SupabaseClient<Database>,
  subscriptions: PushSubscriptionRow[],
  payload: PushPayload,
): Promise<SendResult> {
  configure();

  const body = JSON.stringify(payload);
  const dead: string[] = [];
  /** New `failure_count` per subscription id, for the ones whose count changes. */
  const counts = new Map<string, number>();
  let sent = 0;
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          // Apple drops a push with no urgency set surprisingly often; a
          // reminder is time-critical by definition, so say so.
          { urgency: 'high', TTL: 60 * 60 },
        );
        sent += 1;
        if (sub.failure_count > 0) counts.set(sub.id, 0);
      } catch (error) {
        // 404: the endpoint never existed. 410 Gone: the browser or the OS
        // retired it — which is exactly what iOS does when a PWA sits unused,
        // and the reason the client re-subscribes on every launch.
        const { statusCode: status, body: reason } = error as { statusCode?: number; body?: string };
        if (status === 404 || status === 410) {
          dead.push(sub.endpoint);
          return;
        }
        failed += 1;
        // The host and not the endpoint: the rest of that URL is the credential
        // for pushing to this device, and it has no business in a log file.
        console.error(
          'push send failed',
          status,
          sub.id,
          new URL(sub.endpoint).host,
          (reason || (error as Error).message).slice(0, 200),
        );
        if (status === undefined || !REJECTED.has(status)) return;
        const strikes = sub.failure_count + 1;
        if (strikes >= MAX_FAILURES) dead.push(sub.endpoint);
        else counts.set(sub.id, strikes);
      }
    }),
  );

  if (dead.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', dead);
  }
  await Promise.all(
    [...counts].map(([id, failure_count]) =>
      supabase.from('push_subscriptions').update({ failure_count }).eq('id', id),
    ),
  );

  return { sent, pruned: dead.length, failed };
}
