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
      <Field label="[00] IDENTITY">
        <input
          type="email"
          required
          autoFocus
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-hair bg-panel px-3 py-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-mute focus:border-hairlit"
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-2 block">{label}</span>
      {children}
    </label>
  );
}

export function LoginForm() {
  return (
    <Suspense fallback={null}>
      <Form />
    </Suspense>
  );
}
