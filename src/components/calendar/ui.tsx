'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Shared form primitives, so every control in the app is the same object. */

/**
 * A panel that hangs off a field and is not clipped by anything.
 *
 * Both pickers used to draw their own: `absolute` under the trigger, with a
 * `fixed inset-0` sibling to catch the dismissing click. Inside the entry form that
 * arrangement fails twice over. The form's field area scrolls, and an `absolute`
 * child of a scroll container is clipped by it — so the calendar came off the bottom
 * of the form with its switches cut away entirely. And the click-catcher is a
 * viewport-sized element parked over the modal, so the first click anywhere went into
 * dismissing the popup rather than into whatever was clicked, which reads as a form
 * that will not let go of you until you pick a date.
 *
 * So: `fixed`, measured from the trigger, which no ancestor's `overflow` can crop —
 * none of them establish a containing block, which is the condition that would break
 * it. And dismissal is a capture-phase `pointerdown` on the document instead of an
 * overlay, so a click on another field both closes this and lands on that field.
 */
export function Popover({
  anchorRef,
  onDismiss,
  width,
  label,
  onKeyDown,
  children,
}: {
  /** The trigger. Clicks inside it are the trigger's own business, not a dismissal. */
  anchorRef: React.RefObject<HTMLElement | null>;
  onDismiss: () => void;
  width: number;
  label: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;

      const EDGE = 8;
      const GAP = 4;
      const wanted = el.scrollHeight;
      const below = window.innerHeight - a.bottom - GAP - EDGE;
      const above = a.top - GAP - EDGE;

      // Below by default, and above only when below cannot hold it *and* above is
      // the roomier side. Flipping on the first pixel of overflow would move the
      // panel across the field for a case that scrolling handles better.
      const flip = wanted > below && above > below;
      const maxHeight = Math.max(160, flip ? above : below);

      setBox({
        left: Math.max(EDGE, Math.min(a.left, window.innerWidth - EDGE - width)),
        top: flip ? Math.max(EDGE, a.top - GAP - Math.min(wanted, maxHeight)) : a.bottom + GAP,
        maxHeight,
      });
    };

    place();
    // Capture, so a scroll in any ancestor counts and not just the window's.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchorRef, width]);

  // Held in a ref so the listener below is registered once rather than torn down and
  // rebuilt on every render of a parent that rebuilds the callback. Written in an
  // effect rather than during render: a ref assigned mid-render is a write that
  // Strict Mode's double invocation and a discarded concurrent render can both make
  // happen more than once, for a value the render itself never reads.
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  });

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      dismiss.current();
    };
    // Capture, and `pointerdown` rather than `click`: the modal behind dismisses on
    // mousedown, and a listener that waited for the click would let that fire first
    // and take the whole form with it.
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [anchorRef]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{
        position: 'fixed',
        width,
        left: box?.left ?? 0,
        top: box?.top ?? 0,
        maxHeight: box?.maxHeight,
        // Laid out before it is placed, because placing it requires measuring it.
        visibility: box ? 'visible' : 'hidden',
      }}
      className="z-50 overflow-y-auto border border-hairlit bg-panel p-2 shadow-[0_8px_24px_rgba(0,0,0,0.7)]"
    >
      {children}
    </div>
  );
}

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

/**
 * A switch, for a setting that reveals or hides other controls.
 *
 * `SegmentedControl` is the app's usual answer to a two-way choice and stays that way
 * for choices *between* things — ALL DAY against TIMED reads as two options because it
 * is two options. This is for the other shape: a row that names a thing and says
 * whether it is on, where the off state has no label of its own because the absence of
 * the fields below it is the label. That is what `END DATE` and `INCLUDE TIME` are, and
 * drawing them as two-cell segmented controls would have invented a word for "no end
 * date" that the form does not otherwise need.
 *
 * Rounded, alone in a square interface, because that is what a switch is — the shape is
 * carrying the affordance, and a rectangular one reads as a very small segmented
 * control, which is the thing it is not.
 */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[16px] w-[28px] shrink-0 rounded-full border transition-colors ${
        checked ? 'border-dim bg-dim' : 'border-hairlit bg-sunken hover:border-dim'
      }`}
    >
      <span
        className={`absolute top-[2px] h-[10px] w-[10px] rounded-full transition-all ${
          checked ? 'left-[15px] bg-void' : 'left-[2px] bg-mute'
        }`}
      />
    </button>
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
  onDismiss,
  size = 'settings',
  children,
}: {
  title: string;
  meta?: string;
  onClose: () => void;
  /**
   * Clicking away, when that has to mean something other than the header's
   * button. The entry form commits a draft on click-off and throws it away on
   * Escape, and the header button is labelled ESC — so it answers to `onClose`
   * with the key, and only the backdrop comes through here. Defaults to
   * `onClose`, which is what every other surface wants.
   */
  onDismiss?: () => void;
  size?: keyof typeof MODAL_WIDTH;
  children: React.ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);

  /**
   * Whatever had focus before this opened, captured by a lazy initialiser.
   *
   * It has to be read during the first render, not in the effect: by the time
   * effects run React has already applied a child's `autoFocus` during commit,
   * so `document.activeElement` is the form field *inside* the modal and
   * "restore on close" would hand focus back to an element that no longer
   * exists. A `useState` initialiser runs at the right moment and, unlike
   * assigning to a ref during render, is a legal thing to do there.
   */
  const [restoreTo] = useState<Element | null>(() =>
    typeof document === 'undefined' ? null : document.activeElement,
  );

  // Focus moves in on open and back out on close. Without the restore, closing
  // an overlay opened from the keyboard drops focus onto <body> and the next
  // Tab starts from the top of the document.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;

    /**
     * A child that asked for focus has already been given it, and overriding
     * that would put the caret on the header's dismiss button.
     *
     * `[data-autofocus]` rather than `[autofocus]`, which is what this looked
     * for and is a selector that cannot match: React applies `autoFocus` by
     * calling `.focus()` at commit and never writes the attribute, so the query
     * always fell through to "first focusable" — the ESC button. It went
     * unnoticed because opening the form from the keyboard leaves focus on
     * `<body>` and React's own commit wins the race; a real mouse click on
     * + NEW loses it, which is exactly the case that was broken. An explicit
     * data attribute is a fact about the DOM either way.
     */
    if (!el.contains(document.activeElement)) {
      const wanted =
        el.querySelector<HTMLElement>('[data-autofocus]') ??
        el.querySelector<HTMLElement>(FOCUSABLE);
      (wanted ?? el).focus();
    }

    return () => {
      if (restoreTo instanceof HTMLElement) restoreTo.focus();
    };
  }, [restoreTo]);

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

  /** Mousedown anywhere on the backdrop dismisses. */
  const backdrop = { onMouseDown: onDismiss ?? onClose, 'aria-hidden': true } as const;

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={trapTab}
    >
      {/* One rect, evenly. The entry modal used to cut a lit band out of this to
          keep the week its draft was landing in undimmed, which meant three
          rects, a measured viewport band reported up from the grid, and one row
          of the calendar looking spotlit for reasons that were not obvious
          unless you already knew what to look for. Dimming everything says the
          same thing — the grid is not what you are talking to — without
          singling out a week. */}
      <div {...backdrop} className="absolute inset-0 bg-void/85" />

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
