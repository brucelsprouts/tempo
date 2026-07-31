'use client';

import { useEffect, useRef } from 'react';

/** Shared form primitives, so every control in the app is the same object. */

export const inputClass =
  'w-full border border-hair bg-panel px-2.5 py-2 text-[12px] text-ink outline-none transition-colors placeholder:text-mute focus:border-hairlit';

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] leading-relaxed text-mute">{hint}</span>}
    </label>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  grow = true,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  /** Off for toolbars, where the control should be as wide as its labels. */
  grow?: boolean;
}) {
  return (
    <div className="flex border border-hair">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={[
            grow ? 'flex-1' : '',
            'px-2 py-1.5 text-[10px] tracking-[0.1em] transition-colors',
            o.value === value
              ? 'bg-raised text-bright'
              : 'text-mute hover:bg-sunken hover:text-dim',
          ].join(' ')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Button({
  children,
  variant = 'default',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'quiet' }) {
  const styles = {
    primary: 'border-hairlit bg-raised text-ink hover:border-dim hover:text-bright',
    default: 'border-hair text-dim hover:border-hairlit hover:text-ink',
    quiet: 'border-transparent text-mute hover:text-dim',
  }[variant];

  return (
    <button
      {...rest}
      className={`border px-3 py-2 text-[10px] tracking-[0.14em] transition-colors disabled:opacity-40 ${styles} ${rest.className ?? ''}`}
    >
      {children}
    </button>
  );
}

export function PanelHeader({
  title,
  meta,
  onClose,
}: {
  title: string;
  meta?: string;
  onClose: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-hair px-4 py-3">
      <div className="min-w-0">
        <div className="truncate text-[12px] tracking-[0.12em] text-ink">{title}</div>
        {meta && <div className="label mt-1">{meta}</div>}
      </div>
      <button
        onClick={onClose}
        className="label ml-3 shrink-0 px-1 hover:text-dim"
        aria-label="Close panel"
      >
        ESC
      </button>
    </div>
  );
}

/** Widths, per surface. The grid behind is never resized to make room. */
const MODAL_WIDTH = {
  entry: 640,
  day: 880,
  settings: 600,
} as const;

/**
 * A horizontal band of the viewport, in CSS pixels, that the scrim must not
 * cover. See `Modal`.
 */
export interface ScrimCutout {
  top: number;
  bottom: number;
}

/**
 * Centred overlay, and the only one in the app.
 *
 * Escape is deliberately not bound here — the shell owns one keymap, so there
 * is a single place that decides what Escape unwinds and in what order. A modal
 * that closed itself would be a second opinion.
 *
 * The overlay is centred rather than docked to an edge on purpose. A rail that
 * opens beside the grid moves the calendar sideways every time, and pinning it
 * open only trades that for a permanently narrower, permanently off-centre
 * grid. Nothing here changes the layout of what is behind it.
 */
export function Modal({
  title,
  meta,
  onClose,
  size = 'settings',
  cutout,
  children,
}: {
  title: string;
  meta?: string;
  onClose: () => void;
  size?: keyof typeof MODAL_WIDTH;
  /**
   * Leaves this band of the viewport undimmed.
   *
   * The entry form draws a ghost bar on the calendar showing where the draft
   * will land, which a solid scrim would dim along with everything else —
   * defeating the one thing that tells you where you are. So the scrim is cut
   * into two rects with a gap instead. `Modal` knows nothing about calendars;
   * it just takes a band.
   */
  cutout?: ScrimCutout | null;
  children: React.ReactNode;
}) {
  const restoreTo = useRef<Element | null>(null);
  const frame = useRef<HTMLDivElement>(null);

  // Focus moves in on open and back out on close. Without the restore, closing
  // an overlay opened from the keyboard drops focus onto <body> and the next
  // Tab starts from the top of the document.
  useEffect(() => {
    restoreTo.current = document.activeElement;
    const first = frame.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? frame.current)?.focus();
    return () => {
      if (restoreTo.current instanceof HTMLElement) restoreTo.current.focus();
    };
  }, []);

  function trapTab(e: React.KeyboardEvent) {
    if (e.key !== 'Tab' || !frame.current) return;
    const stops = [...frame.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      // The selector can't express this: `button:not([disabled])` matches a
      // button that has opted out with `tabindex="-1"`, and the date picker
      // renders 42 of those for its day cells. Including them puts the trap's
      // "last stop" on an element Tab will never reach, so it never wraps.
      (el) => el.tabIndex >= 0,
    );
    if (stops.length === 0) return;
    const edge = e.shiftKey ? stops[0] : stops[stops.length - 1];
    if (document.activeElement !== edge) return;
    e.preventDefault();
    (e.shiftKey ? stops[stops.length - 1] : stops[0]).focus();
  }

  /** Mousedown anywhere on the backdrop dismisses, cut or not. */
  const backdrop = { onMouseDown: onClose, 'aria-hidden': true } as const;

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={trapTab}
    >
      {cutout ? (
        <>
          <div
            {...backdrop}
            className="absolute inset-x-0 top-0 bg-void/85"
            style={{ height: Math.max(0, cutout.top) }}
          />
          {/* The lit band. Still dismisses, just isn't dimmed. */}
          <div
            {...backdrop}
            className="absolute inset-x-0"
            style={{ top: cutout.top, height: Math.max(0, cutout.bottom - cutout.top) }}
          />
          <div {...backdrop} className="absolute inset-x-0 bottom-0 bg-void/85" style={{ top: cutout.bottom }} />
        </>
      ) : (
        <div {...backdrop} className="absolute inset-0 bg-void/85" />
      )}

      {/* Inert wrapper: it spans the viewport for centring, so it must not eat
          the backdrop clicks passing underneath it. The frame opts back in. */}
      <div className="pointer-events-none absolute inset-0 flex items-start justify-center px-6 py-[7vh]">
        <div
          ref={frame}
          tabIndex={-1}
          style={{ maxWidth: MODAL_WIDTH[size] }}
          className="pointer-events-auto flex max-h-full w-full flex-col border border-hairlit bg-panel shadow-[0_24px_80px_rgba(0,0,0,0.75)] outline-none"
        >
          <PanelHeader title={title} meta={meta} onClose={onClose} />
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      </div>
    </div>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A titled block inside a panel or modal. */
export function Section({
  label,
  meta,
  children,
}: {
  label: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-hair px-4 py-4 last:border-b-0">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="label text-dim">{label}</h2>
        {meta && <span className="label">{meta}</span>}
      </div>
      {children}
    </section>
  );
}
