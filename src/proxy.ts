import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * The single locked door.
 *
 * This runs before every page and route, so an anonymous visitor to the public
 * subdomain is redirected at the network boundary and never receives a rendered
 * calendar — no flash of data, no client-side gate to defeat. It also refreshes
 * the Supabase session cookie on each request, which is why it must return the
 * response object the client mutated rather than a fresh one.
 */

const PUBLIC_PREFIXES = [
  '/login',
  '/auth',
  '/api/auth',
  // Design harness for the calendar grid, running on fixture data. The page
  // itself also returns notFound() outside development, so this is guarded on
  // both sides and cannot become a hole in production.
  ...(process.env.NODE_ENV === 'development' ? ['/preview'] : []),
];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() revalidates against the auth server; getSession() would trust a
  // cookie the client could have forged.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
