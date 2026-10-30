'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect } from 'react';
import { useCalendar } from '@/lib/store/calendar-store';
import { useGrades } from '@/lib/store/grade-store';
import { createClient } from '@/lib/supabase/client';
import { CalendarShell } from './CalendarShell';

/** Session and data loading. Everything you can see lives in `CalendarShell`. */
export function CalendarApp({ email }: { email: string }) {
  const router = useRouter();
  const load = useCalendar((s) => s.load);
  const refresh = useCalendar((s) => s.refresh);
  const connect = useCalendar((s) => s.connect);
  const disconnect = useCalendar((s) => s.disconnect);
  const loadGrades = useGrades((s) => s.load);
  const flushGrades = useGrades((s) => s.flush);

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
      if (!live) return;
      connect();
      // After the calendar, which is what the screen is waiting on; grades are
      // two small tables and the course tabs want their numbers on arrival.
      void loadGrades();
    });
    return () => {
      live = false;
      disconnect();
    };
  }, [load, connect, disconnect, loadGrades]);

  /**
   * Catch up when the app comes back.
   *
   * The channel only reports what happens while its socket is open, and a
   * backgrounded phone app's socket is frozen — so edits from another device
   * never arrive, and nothing says they were missed. Same cause, same remedy
   * as `useToday`: look again when the page is visible, focused or online.
   * `refresh()` ignores the extras when these fire together.
   *
   * Grades have no channel, so this is their only way to hear about another
   * device. Hidden is when their waiting writes go, since a phone suspends a
   * hidden page before a pending timer fires.
   */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
        void loadGrades();
      } else {
        void flushGrades();
      }
    };
    const onResume = () => {
      void refresh();
      void loadGrades();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onResume);
    window.addEventListener('online', onResume);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onResume);
      window.removeEventListener('online', onResume);
    };
  }, [refresh, loadGrades, flushGrades]);

  const signOut = useCallback(async () => {
    await createClient().auth.signOut();
    router.replace('/login');
    router.refresh();
  }, [router]);

  return <CalendarShell email={email} onSignOut={signOut} />;
}
