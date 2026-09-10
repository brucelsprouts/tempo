import { create } from 'zustand';

/**
 * Which entry the pointer is on, and which entries a drag is carrying.
 *
 * Per entry, not per bar. An entry that crosses a week boundary is drawn as two
 * `EventBar`s — it has to be, each row owns its own bars — and CSS `:hover` and
 * dnd-kit's `isDragging` both answer for one element, so the half you were not
 * pointing at sat there unlit, as if it were a different entry. Every bar reads
 * this instead, through a selector on its own key, so a change re-renders the
 * bars it concerns and nothing else.
 *
 * Its own store rather than a field on the calendar's: it changes at pointer
 * speed and nothing is ever saved from it.
 */
interface EntryFocus {
  hovered: string | null;
  carried: ReadonlySet<string>;
  hover: (key: string) => void;
  /** Clears only if `key` is still the one hovered. */
  unhover: (key: string) => void;
  carry: (keys: Iterable<string>) => void;
  drop: () => void;
}

const NONE: ReadonlySet<string> = new Set();

export const useEntryFocus = create<EntryFocus>()((set) => ({
  hovered: null,
  carried: NONE,
  // Nothing lights mid-drag: the pointer crosses other bars on its way to the
  // drop, and a ring following it would read as a second selection.
  hover: (key) => set((s) => (s.carried.size > 0 || s.hovered === key ? s : { hovered: key })),
  unhover: (key) => set((s) => (s.hovered === key ? { hovered: null } : s)),
  carry: (keys) => set({ carried: new Set(keys), hovered: null }),
  drop: () => set((s) => (s.carried.size === 0 ? s : { carried: NONE })),
}));
