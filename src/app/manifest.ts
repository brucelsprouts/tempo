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
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // Matches `--void`, so the launch screen is the app's own background rather
    // than a white flash resolving into a dark interface.
    background_color: '#08090a',
    theme_color: '#08090a',
    orientation: 'portrait',
    categories: ['productivity'],
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
