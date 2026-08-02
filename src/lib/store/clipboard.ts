'use client';

/**
 * What ⌘C is holding.
 *
 * In memory and nowhere else — deliberately not the system clipboard. What gets
 * copied is a set of entries in this calendar, which has no meaning in any other
 * application, so serialising it through the OS would buy nothing and cost a
 * real failure surface: an async permission prompt in front of a keystroke, and
 * a paste path that has to defend itself against arbitrary text. It is also not
 * in localStorage, because a clipboard that outlives the tab is one you paste
 * from having forgotten what you put in it.
 *
 * Not an external store either, for the plain reason that nothing renders it:
 * the confirmation for a copy is the toast the shell raises at the time. If a
 * "3 COPIED" indicator ever wants to exist, this grows a `subscribe` and the
 * callers do not change.
 */

import type { Occurrence } from '@/lib/tempo/types';

/**
 * A snapshot, not a set of references.
 *
 * The occurrences are captured as they stood when copied, so deleting or
 * editing an original afterwards leaves the pending paste alone — which is what
 * a clipboard is, and what a list of keys resolved at paste time would not be.
 * They are shallow copies of render artefacts, and each one carries its whole
 * `event`, which is what the paste actually reads.
 */
let held: readonly Occurrence[] = [];

export function setClipboard(occs: readonly Occurrence[]): void {
  held = [...occs];
}

export function getClipboard(): readonly Occurrence[] {
  return held;
}

export function clipboardSize(): number {
  return held.length;
}
