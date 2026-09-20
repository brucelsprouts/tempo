import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/db/database.types';
import { AUTH_COOKIE_NAME } from './cookie';

/**
 * Where the server reaches Supabase.
 *
 * The browser has to use the public URL, because that is the only name it can
 * resolve. The server usually should not: when both are hosted on one machine,
 * `NEXT_PUBLIC_SUPABASE_URL` sends every server-side query out to DNS, through
 * whatever proxy terminates TLS, and back to a port on localhost — paying two
 * network hops and taking a dependency on the public hostname for work that
 * never needed to leave the box. A reminder that cannot be dispatched because
 * DNS is briefly unhappy is a reminder lost for no reason.
 *
 * So `SUPABASE_INTERNAL_URL` overrides it server-side when set. The JWT is
 * verified by signature rather than by host, so a token minted for the public
 * origin is just as valid arriving here.
 *
 * Unset — as on a platform where the app and the database are genuinely apart —
 * this is exactly the old behaviour.
 */
const SERVER_URL =
  process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    SERVER_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      // Must match the browser's, which SERVER_URL would otherwise change.
      cookieOptions: { name: AUTH_COOKIE_NAME },
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Middleware already refreshed the session, so this is safe to drop.
          }
        },
      },
    },
  );
}

/**
 * Service-role client. Bypasses RLS entirely — only for server routes that must
 * touch `integrations` (Google refresh tokens), which deliberately has no
 * policies. Never import this into anything that renders.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');

  return createServerClient<Database>(SERVER_URL, key, {
    cookieOptions: { name: AUTH_COOKIE_NAME },
    cookies: { getAll: () => [], setAll: () => {} },
  });
}
