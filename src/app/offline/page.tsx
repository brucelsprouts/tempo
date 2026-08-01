/**
 * What the Home Screen app shows with no connection.
 *
 * Deliberately not a cached calendar. Every row lives in one Supabase database
 * and a stale copy of a schedule is worse than an honest blank — the failure
 * this page is preventing is turning up to something that moved. So it says
 * what it knows and what it doesn't, and offers the one action that helps.
 *
 * Statically rendered, which is what makes it cacheable by the service worker
 * at install time and therefore available at the moment it's needed.
 */
export const dynamic = 'force-static';

export default function OfflinePage() {
  return (
    <main className="flex h-full items-center justify-center bg-void px-6">
      <div className="w-full max-w-[380px]">
        <div className="mb-10 flex items-baseline justify-between border-b border-hair pb-3">
          <h1 className="text-[15px] tracking-[0.32em] text-bright">TEMPO</h1>
          <span className="label">{'// OFFLINE'}</span>
        </div>

        <p className="text-[13px] leading-relaxed text-dim">
          No connection, so there is nothing to show. The calendar is not stored
          on this device — what you would be looking at is a guess about where
          things are, and a guess is how you miss one.
        </p>

        <p className="label mt-8 leading-relaxed">
          Reminders already sent still arrive. They come from the server, not
          from this app.
        </p>

        {/* A plain anchor rather than `next/link`, deliberately. A client-side
            navigation is handled by a router that was loaded from cache on a
            page that only exists because the network failed; a full document
            request is what actually re-runs the service worker's fetch and
            gets the real app back. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="label mt-8 inline-block border border-hair px-3 py-2 transition-colors hover:border-hairlit hover:text-dim"
        >
          TRY AGAIN
        </a>
      </div>
    </main>
  );
}
