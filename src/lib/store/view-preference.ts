'use client';

/**
 * Which view the app opens on, remembered across reloads.
 *
 * Deliberately an external store rather than state seeded from an effect: the
 * server has no localStorage, so the first paint must be the default and the
 * stored value must arrive *after* hydration. `useSyncExternalStore` is the one
 * API that expresses that without a cascading render — it takes a separate
 * server snapshot and reconciles the client one itself.
 */

export type View = 'scroll' | 'list' | 'year';

const KEY = 'tempo.view';
const DEFAULT: View = 'scroll';

function isView(v: unknown): v is View {
  return v === 'scroll' || v === 'list' || v === 'year';
}

/** Cached so `getSnapshot` is cheap and returns a stable value per change. */
let current: View | null = null;

const listeners = new Set<() => void>();

export function subscribeView(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getViewSnapshot(): View {
  if (current === null) {
    try {
      const stored = window.localStorage.getItem(KEY);
      current = isView(stored) ? stored : DEFAULT;
    } catch {
      current = DEFAULT;
    }
  }
  return current;
}

export function getServerViewSnapshot(): View {
  return DEFAULT;
}

export function setViewPreference(view: View): void {
  if (current === view) return;
  current = view;
  try {
    window.localStorage.setItem(KEY, view);
  } catch {
    // storage disabled: the choice just doesn't survive a reload
  }
  for (const listener of listeners) listener();
}
