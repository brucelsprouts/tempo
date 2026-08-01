'use client';

/**
 * The browser half of push. Everything here runs on the device.
 *
 * Split from `send.ts` because they share nothing but a mental model: this file
 * cannot import `web-push` (it is Node-only) and must never see the private
 * VAPID key.
 */

/** Where the enable flow can be, from the user's point of view. */
export type PushState =
  | 'unsupported' // no service worker or no Push API at all
  | 'needs-install' // iOS, and the app is still running in Safari
  | 'denied' // permission refused; the browser will not ask again
  | 'off' // can be enabled
  | 'on'; // subscribed

/**
 * The applicationServerKey has to be raw bytes, and VAPID keys are distributed
 * base64url. Not the same alphabet as base64, hence the two replacements.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = window.atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  // Built over an explicit ArrayBuffer so the type is `Uint8Array<ArrayBuffer>`
  // rather than `<ArrayBufferLike>`. `applicationServerKey` wants a BufferSource,
  // which a possibly-shared buffer does not satisfy.
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function isSupported(): boolean {
  return (
    typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
  );
}

/**
 * Whether the app is running as an installed app rather than in a browser tab.
 *
 * Two checks because iOS answers only one of them: `display-mode: standalone`
 * is the standard, and `navigator.standalone` is the non-standard property
 * Safari has carried since long before it supported the media query.
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  // iPadOS reports itself as a Mac, and the touch-point count is the only
  // reliable way to tell one from an actual desktop.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function register(): Promise<ServiceWorkerRegistration> {
  // `updateViaCache: 'none'` so the worker file itself is never served from the
  // HTTP cache. A stale worker is one that cannot be replaced by shipping a new
  // one, which is the single worst failure mode this whole file has.
  return navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
}

export async function currentState(): Promise<PushState> {
  if (!isSupported()) return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  // Checked before permission: on iOS the permission is not merely 'default'
  // in Safari, asking for it throws, so "add it to your Home Screen" is the
  // only honest thing to say and it has to be said first.
  if (isIOS() && !isStandalone()) return 'needs-install';
  if (Notification.permission === 'denied') return 'denied';

  const registration = await navigator.serviceWorker.getRegistration();
  const existing = await registration?.pushManager.getSubscription();
  return existing ? 'on' : 'off';
}

/**
 * Ask, subscribe, and tell the server.
 *
 * Must be called from inside a user gesture. Safari rejects a permission
 * request that isn't, and does it by throwing rather than resolving 'denied'.
 */
export async function enable(): Promise<PushState> {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) throw new Error('NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      // Required, and not merely a formality: the worker must show a
      // notification for every push it receives, or the browser revokes this.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    }));

  await postSubscription(subscription);
  return 'on';
}

export async function disable(): Promise<PushState> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return 'off';

  // Server first. If the browser unsubscribes and the DELETE then fails, the
  // row is left pointing at an endpoint nothing can reach — it would be pruned
  // eventually on a 410, but until then every tick tries to send to it.
  await fetch('/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
  return 'off';
}

/**
 * Re-register this device if the row has gone missing.
 *
 * Called on every launch. iOS quietly drops a push subscription for a PWA that
 * hasn't been opened in a while, and the browser does not announce it — the
 * only symptom is reminders stopping. Re-posting a subscription that is still
 * valid is an upsert on the endpoint, so this is cheap to do unconditionally.
 */
export async function refresh(): Promise<void> {
  if (!isSupported() || Notification.permission !== 'granted') return;

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    await postSubscription(existing);
    return;
  }

  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) return;

  // Permission is already granted, so this resubscribes without prompting.
  const renewed = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  });
  await postSubscription(renewed);
}

async function postSubscription(subscription: PushSubscription): Promise<void> {
  // `toJSON()` rather than the object itself: a PushSubscription's keys live
  // behind getters that don't survive JSON.stringify.
  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(subscription.toJSON()),
  });
}
