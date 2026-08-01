'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect } from 'react';
import { useCalendar } from '@/lib/store/calendar-store';
import { createClient } from '@/lib/supabase/client';
import { CalendarShell } from './CalendarShell';

/** Session and data loading. Everything you can see lives in `CalendarShell`. */
export function CalendarApp({ email }: { email: string }) {
  const router = useRouter();
  const load = useCalendar((s) => s.load);
  const connect = useCalendar((s) => s.connect);
  const disconnect = useCalendar((s) => s.disconnect);

  /**
   * Read once, then listen.
   *
   * In that order and not in parallel: the subscription is filtered on the
   * owner, which is not known until the load has resolved. Guarded against a
   * load that finishes after this effect has already been torn down — in
   * development Strict Mode mounts, unmounts and remounts, and a `connect()`
   * arriving after the unmount would leave a channel nothing ever closes.
   */
  useEffect(() => {
    let live = true;
    void load().then(() => {
      if (live) connect();
    });
    return () => {
      live = false;
      disconnect();
    };
  }, [load, connect, disconnect]);

  const signOut = useCallback(async () => {
    await createClient().auth.signOut();
    router.replace('/login');
    router.refresh();
  }, [router]);

  return <CalendarShell email={email} onSignOut={signOut} />;
}
