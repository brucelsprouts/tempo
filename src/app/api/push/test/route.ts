import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendToAll } from '@/lib/push/send';

/**
 * Prove the whole chain works, on demand.
 *
 * Worth a route of its own because the failure modes are silent and slow: a
 * wrong VAPID key, a subscription iOS retired weeks ago, notifications switched
 * off at the OS level. Without this you find out by not being reminded about
 * something, which is exactly the moment you can't afford to.
 */
export const runtime = 'nodejs';

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('owner_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!subs || subs.length === 0) {
    return NextResponse.json({ error: 'no subscribed devices' }, { status: 409 });
  }

  try {
    const result = await sendToAll(supabase, subs, {
      title: 'Tempo',
      body: 'Notifications are working.',
      url: '/',
      tag: 'tempo-test',
    });
    return NextResponse.json(result);
  } catch (e) {
    // Almost always the VAPID keys being absent or mismatched, which is a
    // configuration answer rather than a runtime one — say so plainly.
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
