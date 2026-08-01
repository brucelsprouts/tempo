import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

/**
 * Where a device registers itself, and deregisters.
 *
 * Session-authenticated like any other route: the browser holds the cookie, and
 * RLS on `push_subscriptions` means even a forged `owner_id` writes nothing.
 */

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'malformed subscription' }, { status: 400 });
  }

  const { endpoint, keys } = parsed.data;

  // Upsert on the endpoint rather than insert. iOS hands back the *same*
  // endpoint when a PWA re-subscribes after the OS retired the registration,
  // so an insert would collide on every launch and a delete-then-insert would
  // leave a window with no subscription at all.
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      owner_id: user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: request.headers.get('user-agent')?.slice(0, 256) ?? null,
      last_seen_at: new Date().toISOString(),
      failure_count: 0,
    },
    { onConflict: 'endpoint' },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const endpoint = z.string().url().safeParse((body as { endpoint?: unknown })?.endpoint);
  if (!endpoint.success) {
    return NextResponse.json({ error: 'malformed endpoint' }, { status: 400 });
  }

  // Scoped to the owner as well as the endpoint. RLS enforces this anyway;
  // stating it means the query is still correct if a policy is ever loosened.
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint.data)
    .eq('owner_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
