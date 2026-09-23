'use client';

/**
 * Whether timetable entries are shown in the calendar's ordinary views,
 * remembered across reloads.
 *
 * The same external-store shape as `view-preference.ts`, and for the same
 * reason: the server has no localStorage, so the first paint must be the
 * default and the stored value must arrive *after* hydration.
 * `useSyncExternalStore` takes a separate server snapshot and reconciles the
 * client one itself.
 *
 * Default hidden. A term of lectures is ten entries a week, and the clean
 * calendar is the one that should be on screen without asking.
 */

const KEY = 'tempo.timetable';
const DEFAULT = false;

/** Cached so `getSnapshot` is cheap and returns a stable value per change. */
let current: boolean | null = null;

const listeners = new Set<() => void>();

export function subscribeTimetable(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getTimetableSnapshot(): boolean {
  if (current === null) {
    try {
      current = window.localStorage.getItem(KEY) === 'on';
    } catch {
      current = DEFAULT;
    }
  }
  return current;
}

export function getServerTimetableSnapshot(): boolean {
  return DEFAULT;
}

export function setTimetableVisible(visible: boolean): void {
  if (current === visible) return;
  current = visible;
  try {
    window.localStorage.setItem(KEY, visible ? 'on' : 'off');
  } catch {
    // storage disabled: the choice just doesn't survive a reload
  }
  for (const listener of listeners) listener();
}
