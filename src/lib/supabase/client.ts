import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/db/database.types';
import { AUTH_COOKIE_NAME } from './cookie';

/**
 * Browser client. Ships the publishable key, which is safe precisely because
 * RLS — not the key — is what protects the data.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    // Pinned rather than derived, so the server looks in the same place even
    // when it reaches Supabase by a different URL. See `cookie.ts`.
    { cookieOptions: { name: AUTH_COOKIE_NAME } },
  );
}
