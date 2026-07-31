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

  useEffect(() => {
    load();
  }, [load]);

  const signOut = useCallback(async () => {
    await createClient().auth.signOut();
    router.replace('/login');
    router.refresh();
  }, [router]);

  return <CalendarShell email={email} onSignOut={signOut} />;
}
