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
 */

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
      } catch (error) {
        // 404: the endpoint never existed. 410 Gone: the browser or the OS
        // retired it — which is exactly what iOS does when a PWA sits unused,
        // and the reason the client re-subscribes on every launch.
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          dead.push(sub.endpoint);
        } else {
          failed += 1;
          console.error('push send failed', status, (error as Error).message);
        }
      }
    }),
  );

  if (dead.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', dead);
  }

  return { sent, pruned: dead.length, failed };
}
