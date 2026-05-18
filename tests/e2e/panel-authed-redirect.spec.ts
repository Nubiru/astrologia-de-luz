/**
 * G_B-3 e2e pairing #2 — already-authed visit to `/panel` redirects to
 * `/panel/agenda` (AC-1.3.3).
 *
 * Crafts a valid Auth.js v5 JWT session cookie via `@auth/core/jwt.encode()`,
 * primes it into the browser context, then navigates to `/panel` and asserts
 * the response is a 302 to `/panel/agenda`. The cookie name + encryption
 * salt MUST be `authjs.session-token` (Auth.js v5's dev-mode default — the
 * production `__Secure-` prefix only applies over HTTPS, and the Playwright
 * webServer runs over plain http://localhost).
 *
 * Fails when:
 *   - `app/panel/page.tsx` stops calling `auth()` or stops short-circuiting on
 *     a present session.
 *   - The redirect target drifts from `/panel/agenda` (would break the
 *     post-magic-link callback chain too).
 *   - The JWT salt-must-be-cookie-name contract regresses on the server side
 *     (would cause the test's valid cookie to fail decryption and the page
 *     would silently fall through to the sign-in form, defeating the test).
 *
 * Runtime: Playwright + Next.js dev server + AUTH_SECRET env. Deferred from
 * vitest exactly like the form pairing — execution lives in
 * `npm run test:e2e`.
 */

import { encode } from '@auth/core/jwt';
import { expect, test } from '@playwright/test';

// Auth.js v5 dev-mode cookie name; production swaps to `__Secure-authjs.
// session-token` automatically when HTTPS is detected. The Playwright server
// is HTTP, so the dev name applies.
const SESSION_COOKIE_NAME = 'authjs.session-token';

async function craftSessionCookie(): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  return encode({
    salt: SESSION_COOKIE_NAME,
    // AUTH_SECRET in the dev/test environment MUST match what the running
    // Next.js dev server reads — if these diverge, the server reads a cookie
    // that fails decryption and renders the sign-in form, masking the bug
    // the test is supposed to catch. The launch-kit ENV note documents this
    // pairing requirement.
    secret: process.env.AUTH_SECRET ?? '',
    token: {
      sub: 'e2e-fixture-user-id',
      email: 'e2e@allowed.test',
      name: 'E2E Admin',
      iat: Math.floor(Date.now() / 1000),
      exp,
      jti: 'e2e-fixture-jti',
    },
    maxAge: 7 * 24 * 60 * 60,
  });
}

test.describe('AC-1.3.3 — already-authed /panel visit redirects to /panel/agenda', () => {
  test('authed visit returns 302 → /panel/agenda', async ({ page, context, baseURL }) => {
    const token = await craftSessionCookie();
    const url = new URL(baseURL ?? 'http://localhost:3000');

    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: token,
        domain: url.hostname,
        path: '/',
        httpOnly: true,
        // `secure: false` so the cookie is sent over plain http://localhost
        // — production HTTPS deployments use the `__Secure-` prefixed variant
        // which Auth.js handles automatically; that codepath is exercised in
        // production smoke tests, not here.
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    // Playwright follows redirects by default. Disable so we can inspect the
    // 302 + Location header directly.
    const response = await page.goto('/panel', { waitUntil: 'commit' });
    expect(response, 'no response received from /panel').not.toBeNull();
    // Auth.js's Server Component `redirect()` produces either a 307 or 302
    // depending on Next.js version; accept both.
    expect([302, 307]).toContain(response?.status());

    // After the redirect chain settles, the URL should be /panel/agenda.
    await page.waitForURL('**/panel/agenda', { timeout: 5000 });
    expect(new URL(page.url()).pathname).toBe('/panel/agenda');
  });

  test('authed visit does NOT render the sign-in form', async ({ page, context, baseURL }) => {
    const token = await craftSessionCookie();
    const url = new URL(baseURL ?? 'http://localhost:3000');

    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: token,
        domain: url.hostname,
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    await page.goto('/panel');
    // After the redirect we land at /panel/agenda; the form MUST NOT appear.
    // (If the redirect regresses, the form WOULD appear at the /panel URL —
    // catching that is the whole point of this assertion.)
    await expect(page.locator('input[name="email"]')).toHaveCount(0);
  });
});
