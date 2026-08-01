'use client';

import { useEffect } from 'react';
import { isSupported, refresh, register } from '@/lib/push/client';

/**
 * Registers the service worker, once, on launch.
 *
 * Mounted in the root layout rather than the calendar shell so it also runs on
 * `/login` — the worker has to be installed before the manifest's `start_url`
 * is ever opened from the Home Screen, and on a fresh device the first page
 * anyone sees is the login form.
 *
 * Renders nothing. It exists for the effect.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!isSupported()) return;

    let cancelled = false;

    register()
      .then(async () => {
        if (cancelled) return;
        // Repairs a subscription iOS retired while the app sat unused. Without
        // this the notifications simply stop one day and nothing says why.
        await refresh();
      })
      .catch((error) => {
        // Not fatal, and not worth a toast: the calendar works fine without a
        // worker. Most commonly this is a dev server on plain http, where
        // registration is blocked outside localhost.
        console.warn('service worker registration failed', error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
