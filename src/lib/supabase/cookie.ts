/**
 * The name of the cookie the session lives in.
 *
 * `@supabase/ssr` derives this from the URL you hand it — `sb-<first label of
 * the hostname>-auth-token` — which is fine only as long as every client in the
 * app is given the same URL. Once the server takes an internal route
 * (`SUPABASE_INTERNAL_URL`, see `server.ts`) that stops being true: the browser
 * writes `sb-supabase-auth-token` from the public hostname while the server
 * looks for `sb-localhost-auth-token`, finds nothing, and treats a perfectly
 * good session as absent.
 *
 * The failure is a quiet one. Signing in succeeds — the token endpoint returns
 * 200 and the cookie is set — and then the very next navigation is bounced back
 * to the login page by middleware that cannot see it. The login form sits on
 * "VERIFYING…" because it never called `setBusy(false)`: it is waiting on a
 * navigation that is looping.
 *
 * So the name is pinned here instead, derived from the *public* URL and passed
 * to every client explicitly. Deriving rather than hardcoding keeps it
 * byte-identical to what the library would have chosen on a deployment that
 * sets no internal URL, so no existing session is invalidated by this change.
 */
export const AUTH_COOKIE_NAME = authCookieName();

function authCookieName(): string {
  try {
    const { hostname } = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    return `sb-${hostname.split('.')[0]}-auth-token`;
  } catch {
    // No URL configured. Any stable name will do — nothing can authenticate in
    // this state anyway, and throwing here would take down the login page too.
    return 'sb-tempo-auth-token';
  }
}
