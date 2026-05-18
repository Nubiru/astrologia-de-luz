/**
 * Next 16 proxy — Edge-side first gate for `/panel/*` + `/api/auth/*`.
 *
 * Spec anchors: S-1 AC-1.3.4 + AC-2.4.5 + AC-2.4.6.
 *
 * Two jobs, in order:
 *
 *   1. **Cookie-presence gate for `/panel/<path>`** (sub-routes only — `/panel`
 *      itself is the sign-in form and stays reachable unauthenticated). If
 *      the visitor has no Auth.js session cookie, redirect to
 *      `/panel?next=<original-path>` per AC-1.3.4 so the magic-link callback
 *      can resume the visitor where they were going.
 *
 *   2. **Forward an `x-pathname` request header** on every matched request so
 *      downstream Server Components (notably `app/panel/layout.tsx`) can
 *      branch on the URL without an extra fetch. Next.js does NOT expose the
 *      current pathname to a Server Layout out of the box; the canonical
 *      workaround is a middleware/proxy header. The layout reads it via
 *      `headers().get('x-pathname')`.
 *
 * The full JWT-signature verification still happens server-side in `auth.ts`
 * via `auth()` (the layout's defense-in-depth check). This proxy stays Edge-
 * bundle-safe — no `@/auth` import, no @libsql/client dependency.
 *
 * Cookie names tracked here mirror Auth.js v5 defaults for the JWT session
 * strategy (D-018):
 *   - dev / HTTP:  `authjs.session-token`
 *   - prod / HTTPS: `__Secure-authjs.session-token`
 */

import { type NextRequest, NextResponse } from 'next/server';

const PANEL_SIGNIN_PATH = '/panel';
const PANEL_PROTECTED_PREFIX = '/panel/';

const SESSION_COOKIE_NAMES = ['authjs.session-token', '__Secure-authjs.session-token'];

/**
 * `NextResponse.next({ request: { headers } })` is the canonical Next.js
 * pattern for FORWARDING a custom header to downstream Server Components —
 * mutating `response.headers` alone only sets headers on the OUTGOING client
 * response and is invisible to the SSR layer. Centralising the pass-through
 * shape here keeps the two call-sites (Auth.js routes + Panel routes) honest.
 */
function passThroughWithPathname(req: NextRequest): NextResponse {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-pathname', req.nextUrl.pathname);
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export default function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // Auth.js's own endpoints stay untouched — they MUST be reachable
  // unauthenticated (csrf / signin / callback / verify-request).
  if (pathname.startsWith('/api/auth/')) {
    return passThroughWithPathname(req);
  }

  // The sign-in form lives at `/panel` (no trailing path). Hand it through
  // so an unauthenticated visitor can actually reach the form to request a
  // magic link.
  if (pathname === PANEL_SIGNIN_PATH) {
    return passThroughWithPathname(req);
  }

  // Every panel page below `/panel/...` requires a session cookie.
  if (pathname.startsWith(PANEL_PROTECTED_PREFIX)) {
    const hasSessionCookie = SESSION_COOKIE_NAMES.some((name) => req.cookies.has(name));
    if (!hasSessionCookie) {
      const signInUrl = new URL(PANEL_SIGNIN_PATH, req.url);
      // AC-1.3.4 — preserve the original path so the magic-link callback's
      // post-auth `redirectTo` can land the visitor on the page they were
      // trying to reach instead of the agenda default.
      signInUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(signInUrl);
    }
  }

  return passThroughWithPathname(req);
}

// Per-route matcher — Next only runs this proxy on paths that pre-match here,
// so the body above can stay focused. `/panel/:path*` covers every panel
// surface; `/api/auth/:path*` lets Auth.js routes through without forcing a
// no-op for unmatched static assets.
export const config = {
  matcher: ['/panel/:path*', '/api/auth/:path*'],
};
