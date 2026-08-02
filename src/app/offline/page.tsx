'use client';

import { useEffect, useState } from 'react';
import { CalendarApp } from '@/components/calendar/CalendarApp';

export default function OfflinePage() {
  const [email, setEmail] = useState<string | null>(null);
  const [showCached, setShowCached] = useState(false);

  useEffect(() => {
    const lastEmail = window.localStorage.getItem('tempo-last-user-email');
    if (lastEmail) setEmail(lastEmail);
  }, []);

  if (showCached && email) {
    return <CalendarApp email={email} />;
  }

  return (
    <main className="flex h-full items-center justify-center bg-void px-6">
      <div className="w-full max-w-[380px]">
        <div className="mb-10 flex items-baseline justify-between border-b border-hair pb-3">
          <h1 className="text-[15px] tracking-[0.32em] text-bright">TEMPO</h1>
          <span className="label">{'// OFFLINE'}</span>
        </div>

        <p className="text-[13px] leading-relaxed text-dim">
          No connection detected. You can either try reconnecting or view a read-only copy of your last synced calendar.
        </p>

        <div className="mt-8 flex gap-4">
          <a
            href="/"
            className="label border border-hair px-3 py-2 transition-colors hover:border-hairlit hover:text-bright"
          >
            TRY RECONNECTING
          </a>

          {email && (
            <button
              onClick={() => setShowCached(true)}
              className="label border border-hair px-3 py-2 transition-colors hover:border-hairlit hover:text-bright"
            >
              VIEW CACHED CALENDAR
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
