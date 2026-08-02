'use client';

/**
 * How tall an hour is in the day timeline, remembered across reloads.
 *
 * An external store rather than state seeded from an effect, for the same
 * reason `view-preference.ts` is one: the server has no localStorage, so the
 * first paint must be the default and the stored value must arrive after
 * hydration. `useSyncExternalStore` takes a separate server snapshot and
 * reconciles the client one itself, which is the only way to say that without a
 * cascading render.
 */

import type { ZoomMode } from '@/components/calendar/timeline';

const KEY = 'tempo.dayZoom';
const DEFAULT: ZoomMode = 'fit';

function parse(raw: string | null): ZoomMode {
  if (raw === 'fit') return 'fit';
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT;
}

/** Cached so `getSnapshot` is cheap and returns a stable value per change. */
let current: ZoomMode | null = null;

const listeners = new Set<() => void>();

export function subscribeZoom(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getZoomSnapshot(): ZoomMode {
  if (current === null) {
    try {
      current = parse(window.localStorage.getItem(KEY));
    } catch {
      current = DEFAULT;
    }
  }
  return current;
}

export function getServerZoomSnapshot(): ZoomMode {
  return DEFAULT;
}

export function setZoom(mode: ZoomMode): void {
  if (current === mode) return;
  current = mode;
  try {
    window.localStorage.setItem(KEY, String(mode));
  } catch {
    // storage disabled: the choice just doesn't survive a reload
  }
  for (const listener of listeners) listener();
}
