'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

function Form() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The identity is the same one every time, so showing it in the clear only
  // ever leaks it — to a shoulder, a screen share, or a screenshot. Blurred by
  // CSS rather than by `type="password"`, which would break `autocomplete`
  // and invite a password manager to fill the wrong field.
  const [showEmail, setShowEmail] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message.toUpperCase());
      setBusy(false);
      return;
    }
    // refresh() so the server components re-render with the new session cookie
    router.replace(params.get('next') || '/');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field
        label="[00] IDENTITY"
        action={
          <button
            type="button"
            onClick={() => setShowEmail((v) => !v)}
            className="label hover:text-dim"
            aria-pressed={showEmail}
          >
            {showEmail ? 'HIDE' : 'SHOW'}
          </button>
        }
      >
        <input
          type="email"
          required
          autoFocus
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`w-full border border-hair bg-panel px-3 py-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-mute focus:border-hairlit ${
            showEmail || email === '' ? '' : 'redacted'
          }`}
          placeholder="you@example.com"
        />
      </Field>

      <Field label="[01] KEY">
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-hair bg-panel px-3 py-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-mute focus:border-hairlit"
          placeholder="••••••••"
        />
      </Field>

      <button
        type="submit"
        disabled={busy}
        className="w-full border border-hairlit bg-raised py-2.5 text-[11px] tracking-[0.2em] text-ink transition-colors hover:border-dim hover:text-bright disabled:opacity-40"
      >
        {busy ? 'VERIFYING…' : 'UNLOCK'}
      </button>

      {error && (
        <p className="border-l-2 border-dim bg-panel px-3 py-2 text-[10px] leading-relaxed tracking-[0.1em] text-dim">
          {error}
        </p>
      )}
    </form>
  );
}

function Field({
  label,
  children,
  action,
}: {
  label: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  // The action sits outside the <label> on purpose: nested inside, a click on
  // it would also be a click on the field it is meant to be independent of.
  return (
    <div className="relative">
      <label className="block">
        <span className="label mb-2 block pr-14">{label}</span>
        {children}
      </label>
      {action && <div className="absolute right-0 top-0 leading-none">{action}</div>}
    </div>
  );
}

export function LoginForm() {
  return (
    <Suspense fallback={null}>
      <Form />
    </Suspense>
  );
}
