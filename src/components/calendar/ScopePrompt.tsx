'use client';

import { useEffect, useRef } from 'react';
import type { OccurrencePatch } from '@/lib/tempo/types';
import { Button } from './ui';

/**
 * Which dates a change to a repeating entry is for — Google's three answers,
 * fitted to what Tempo stores.
 *
 * THIS DATE is offered only when the change fits in an exception (`patch` is
 * non-empty). Otherwise it stays on screen, disabled, with the reason under it:
 * a missing button reads as a bug, a disabled one with a sentence as a rule.
 * THIS AND LATER is left out where it would mean EVERY DATE or would renumber a
 * counted title (`canSplit`).
 *
 * Escape goes BACK to the form rather than closing it: the edit is not lost,
 * only the question. Stopped here, so the shell's window listener never sees it
 * — the same mechanism the date picker uses.
 *
 * DISCARD is the one way out of the popup that does not keep what you did.
 * Everything else saves as you go; a repeating entry cannot until it knows
 * which dates, so dropping the change has to be said out loud.
 */
export function ScopePrompt({
  patch,
  canSplit,
  onThisDate,
  onThisAndLater,
  onEveryDate,
  onBack,
  onDiscard,
}: {
  patch: OccurrencePatch | null;
  canSplit: boolean;
  onThisDate: (patch: OccurrencePatch) => void;
  onThisAndLater: () => void;
  onEveryDate: () => void;
  onBack: () => void;
  onDiscard: () => void;
}) {
  const oneDate = patch && Object.keys(patch).length > 0 ? patch : null;

  /**
   * EVERY DATE takes focus, and takes it back if it was lost on the way in.
   *
   * `autoFocus` covers SAVE and Enter. Clicking away is a mousedown on the
   * backdrop, which raises this question inside the press — and once the press
   * is handled the browser moves focus to where it landed, which is <body>.
   * From there Escape reached the shell rather than this group, and the shell's
   * Escape throws the whole form away: exactly the edit this question exists
   * to keep. So once the press is over, focus comes back here.
   */
  const group = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => {
      const el = group.current;
      if (el && !el.contains(document.activeElement)) {
        el.querySelector<HTMLElement>('[data-autofocus]')?.focus();
      }
    });
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div
      ref={group}
      role="group"
      aria-label="Change which dates"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onBack();
        }
      }}
    >
      <div className="label mb-2">CHANGE WHICH DATES?</div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!oneDate} onClick={() => oneDate && onThisDate(oneDate)}>
          THIS DATE
        </Button>
        {canSplit && (
          <Button type="button" onClick={onThisAndLater}>
            THIS AND LATER
          </Button>
        )}
        <Button type="button" variant="primary" autoFocus data-autofocus onClick={onEveryDate}>
          EVERY DATE
        </Button>
        <Button type="button" variant="quiet" onClick={onBack}>
          BACK
        </Button>
        <Button type="button" variant="quiet" onClick={onDiscard}>
          DISCARD
        </Button>
      </div>
      {!oneDate && <p className="label mt-2">ONE DATE CAN ONLY CHANGE ITS TITLE, DATE AND TIME.</p>}
    </div>
  );
}
