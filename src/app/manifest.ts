import type { MetadataRoute } from 'next';

/**
 * What makes the calendar installable.
 *
 * `display: 'standalone'` is not cosmetic here. iOS refuses to grant
 * notification permission to a page running in Safari at all — push works only
 * from an app that was added to the Home Screen, and it only counts as one if
 * the manifest asks for a standalone window. Dropping to 'browser' would take
 * the notifications with it.
 *
 * Served at `/manifest.webmanifest`, which `proxy.ts` has to let through
 * unauthenticated: the browser fetches it before anyone signs in, and a
 * redirect to /login makes the install prompt disappear with no error anywhere.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Tempo',
    short_name: 'Tempo',
    description: 'A calendar that doesn’t paginate.',
    /**
     * The install's identity, stated rather than inferred.
     *
     * Without it the browser derives one from `start_url`, so the day
     * `start_url` gains a parameter — a launch tracking flag, a default view —
     * the installed app becomes a *different* app: the old icon stops matching
     * anything the manifest describes and an install prompt appears beside the
     * copy already on the Home Screen.
     */
    id: '/',
    lang: 'en',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // Matches `--void`, so the launch screen is the app's own background rather
    // than a white flash resolving into a dark interface.
    background_color: '#08090a',
    theme_color: '#08090a',
    orientation: 'portrait',
    categories: ['productivity'],
    /**
     * One launch already inside the app.
     *
     * A long press on the icon is the phone's own answer to "and what would you
     * like to do", and the honest answer for a calendar is almost always "add
     * something" — which otherwise costs a cold launch, a look at the grid, and
     * a press. `CalendarShell` consumes `?new` on arrival and strips it, so the
     * parameter never survives into the session; `id` above is what keeps that
     * URL from being read as a second app.
     *
     * Android and desktop Chrome honour these. iOS ignores them, which costs
     * nothing — a shortcut list nobody sees is three lines of manifest.
     */
    shortcuts: [
      {
        name: 'New entry',
        short_name: 'New',
        description: 'Open the entry form on today',
        url: '/?new=1',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
    /**
     * A second launch focuses the window that is already open rather than
     * opening another. The shortcut above makes that reachable: without it,
     * "New entry" from the icon while the app is running is a second copy of a
     * single-account calendar, each with its own realtime subscription.
     */
    launch_handler: { client_mode: 'navigate-existing' },
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Separate entry rather than `purpose: 'any maskable'` on one file: a
      // launcher that crops a shared icon would cut the bars that run off the
      // edge, which are the part of the mark that means anything.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
