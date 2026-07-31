'use client';

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
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex border border-hair">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={[
            'flex-1 px-2 py-1.5 text-[10px] tracking-[0.1em] transition-colors',
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
