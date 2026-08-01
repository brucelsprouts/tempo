'use client';

import { useEffect } from 'react';
import type { DeletedEntry } from '@/lib/store/calendar-store';
import { Button } from './ui';

/**
 * The one thing on screen that is not a layer.
 *
 * No scrim, no focus trap, and no place in the overlay stack — Escape dismisses
 * it on the way past rather than being spent on it, which the shell decides, as
 * it decides every other key. All this owns is the clock.
 */

/** Long enough to notice and reach for, short enough not to become furniture. */
const LIFETIME_MS = 8000;

/**
 * How far the toast floats above the footer.
 *
 * Not taste. The grid keeps its own bulk-delete confirmation strip 16px off the
 * same edge and it stands 51px tall, and the two can be up at once — confirm a
 * bulk delete while an earlier one's toast is still counting down and a toast at
 * the strip's height would put the older UNDO underneath the newer DELETE. So:
 * clear of that band, plus a hairline of air.
 */
const LIFT_PX = 76;

interface Props {
  /** Everything a single delete took; one UNDO puts all of it back. */
  entries: DeletedEntry[];
  onUndo: () => void;
  onDismiss: () => void;
}

export function Toast({ entries, onUndo, onDismiss }: Props) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, LIFETIME_MS);
    return () => window.clearTimeout(timer);
  }, [onDismiss]);

  if (entries.length === 0) return null;

  return (
    <div
      // Spans the width to centre its child, so it must not eat the clicks
      // passing through to the grid underneath. The card opts back in.
      className="pointer-events-none absolute inset-x-0 bottom-full z-40 flex justify-center px-4"
      style={{ paddingBottom: LIFT_PX }}
    >
      <div
        role="status"
        aria-live="polite"
        // Bounded, or a long title stretches the card the width of the window
        // and `truncate` on the label never has anything to truncate against.
        className="pointer-events-auto flex max-w-[420px] items-center gap-3 border border-hairlit bg-panel px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.7)]"
      >
        <span className="min-w-0 truncate text-[11px] text-dim">
          {entries.length === 1 ? (
            <>
              Deleted “<span className="text-ink">{entries[0].event.title}</span>”
            </>
          ) : (
            `Deleted ${entries.length} entries`
          )}
        </span>
        <Button type="button" variant="primary" onClick={onUndo}>
          UNDO
        </Button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 px-1 text-[12px] leading-none text-mute transition-colors hover:text-ink"
        >
          ×
        </button>
      </div>
    </div>
  );
}
