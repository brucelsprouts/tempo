import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { CalendarApp } from '@/components/calendar/CalendarApp';

export default async function Home() {
  // The proxy already gates this route; re-checking here means a
  // misconfigured matcher can't turn into a data leak.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return <CalendarApp email={user.email ?? ''} />;
}
