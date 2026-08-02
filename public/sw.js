/**
 * Tempo's service worker.
 *
 * Hand-written, and staying that way. `next-pwa` and Serwist both want webpack
 * configuration, and this project builds with Turbopack — and what a generated
 * worker would add is aggressive precaching of the whole build, which is the
 * opposite of what a calendar wants. Stale JavaScript against a live database
 * is how you get a grid that renders yesterday's schema.
 *
 * So: no offline calendar, deliberately. The data is one account's live rows
 * and showing a cached copy without saying so would be worse than showing
 * nothing. What this does is make the app launch from the Home Screen, survive
 * a dead connection with an honest page instead of Safari's error, and receive
 * push.
 */

// Bump to invalidate everything below. The activate handler deletes any cache
// whose name doesn't match, so a rename is the whole cache-busting mechanism.
const VERSION = 'tempo-v2';
const OFFLINE_URL = '/offline';

// Only the things that must be there when there is no network. Not the app
// bundle: those are hashed and handled opportunistically further down.
const SHELL = [OFFLINE_URL, '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      // Don't sit in "waiting" behind the previous worker. A calendar has no
      // unsaved-state problem that a deferred activation would protect.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Anything that isn't a plain GET is a write. Never cache, never replay:
  // serving a cached POST would mean silently repeating an edit.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Supabase and the API are always live or nothing. A cached calendar read is
  // exactly the lie this worker is trying not to tell.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: try the network, fall back to the offline page. This is the
  // only reason the worker improves anything about being offline.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Built output is content-hashed, so a hit can never be stale — the filename
  // changes when the contents do. Cache on first use rather than precaching a
  // manifest this worker would have to be kept in step with.
  //
  // That invariant is the *response's* claim, not the path's, so it is read off
  // `immutable` rather than assumed from `/_next/static/`. Turbopack's dev
  // chunks are served from the same prefix under names derived from the module
  // path — `src_0u324_x._.js` is rewritten in place on every edit — so a
  // path-only rule pins the first build of a file forever and the dev server
  // becomes unable to ship you a change. Dev sends `no-cache, must-revalidate`;
  // this now believes it.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            const immutable = response.headers.get('cache-control')?.includes('immutable');
            if (response.ok && immutable) {
              const copy = response.clone();
              caches.open(VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});

/**
 * A reminder arriving.
 *
 * `showNotification` is not optional. The subscription was made with
 * `userVisibleOnly: true`, so a push that resolves without showing anything is
 * a broken promise to the browser — Chrome posts its own "this site was
 * updated in the background" notice, and iOS revokes the subscription after
 * a few offences. The catch below exists so a malformed payload still shows
 * something rather than silently costing us the registration.
 */
self.addEventListener('push', (event) => {
  let payload = { title: 'Tempo', body: 'You have something coming up.', url: '/', tag: 'tempo' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Keep the default. A notification saying too little beats none at all.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: payload.tag,
      // Replace a notification sharing this tag rather than stacking a second
      // one, but still buzz — a silent replacement of a reminder you haven't
      // read yet is a reminder you never got.
      renotify: true,
      data: { url: payload.url },
    }),
  );
});

/**
 * Tapping one.
 *
 * Focus an open window if there is one, rather than opening a second copy —
 * an installed PWA that spawns a duplicate on every notification is a mess to
 * get out of. `navigate` moves the existing client to the date the reminder
 * was about.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          return 'navigate' in client ? client.navigate(target).then((c) => c.focus()) : client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
