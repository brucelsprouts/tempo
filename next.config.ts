import type { NextConfig } from 'next';

/**
 * The app is one account on a public subdomain, so the useful headers are the
 * ones that limit what a stolen or tricked browser can do with it: no framing
 * (clickjacking), no referrer leakage of URLs, and a connect-src that pins the
 * app to its own origin plus Supabase.
 *
 * script-src still allows 'unsafe-inline' because Next's bootstrap is inline
 * and locking it down properly needs per-request nonces threaded through
 * proxy.ts. Worth doing later; noted rather than silently skipped.
 */
/**
 * The origins the browser may reach Supabase on.
 *
 * Derived from the configured URL rather than written down, because a hardcoded
 * `*.supabase.co` is wrong in both directions: it silently forbids a
 * self-hosted instance on any other name — the browser refuses the connection
 * and the login reports "failed to fetch", with the real reason visible only in
 * a console nobody has open — while also permitting every Supabase project that
 * has ever existed, which is far more than this app needs.
 *
 * Pinning to the one configured host is both narrower and portable. The
 * websocket origin has to be listed separately: realtime connects over wss,
 * and `connect-src` matches on scheme.
 */
function supabaseOrigins(): string {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    const { protocol, host } = new URL(configured!);
    const ws = protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${host} ${ws}//${host}`;
  } catch {
    // No URL at build time — a bare `next build` in CI, say. The hosted
    // wildcard keeps that working rather than emitting a policy that blocks
    // everything, and a real deployment always has the variable set.
    return 'https://*.supabase.co wss://*.supabase.co';
  }
}

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigins()}`,
  // Without these two the policy above blocks the PWA outright: `default-src`
  // covers workers and manifests, and a blocked service worker means no
  // install and no push, reported only as a console error nobody is watching.
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig: NextConfig = {
  // The floating dev badge sits on top of the footer status bar.
  devIndicators: false,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
      {
        // The worker must never be served stale. A cached `sw.js` is one that
        // cannot be replaced by deploying a new one — the browser keeps
        // handing back the old file and the fix never ships.
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ];
  },
};

export default nextConfig;
