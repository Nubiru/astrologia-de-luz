/**
 * G_B-4 e2e pairing — `/panel/*` auth guard + chrome rendering
 * (AC-1.3.4 + AC-3.7.6).
 *
 * Drives Playwright through the real Next.js dev server (Playwright's
 * `webServer` config in `playwright.config.ts` boots `npm run dev` against
 * port 3000). Asserts the two halves of the auth-guard contract — the
 * unauthenticated redirect AND the authenticated chrome render — plus the
 * defence-in-depth pairing with `proxy.ts`'s Edge-side cookie-presence gate.
 *
 * Fails when:
 *   - `/panel/agenda` (or any `/panel/<sub>` route) no longer redirects
 *     unauthenticated visitors to `/panel?next=<path>` (AC-1.3.4 regression).
 *     Either the proxy.ts cookie check OR the layout.tsx auth() short-circuit
 *     is dropped; either failure mode fails this spec.
 *   - The redirect drops the `next=` query param — would land the visitor
 *     on `/panel/agenda` instead of their original path after the magic-link.
 *   - The chrome stops rendering for authed visitors (`<nav>` missing,
 *     sign-out form missing, status dot missing). All three are individually
 *     load-bearing UX surfaces.
 *   - The webhook status dot's `data-color` attribute regresses away from
 *     the `verde` / `rojo` values that map to CONTENT_PANEL.STATUS — the
 *     full status helper is integration-tested in
 *     `tests/integration/webhook-status-dot.test.ts`; this spec only verifies
 *     the DOM surface in a real browser.
 *
 * Runtime: Playwright + Next.js dev server + AUTH_SECRET in env. Deferred
 * from vitest exactly like the G_B-3 pairings — execution lives in
 * `npm run test:e2e`.
 */

import { encode } from '@auth/core/jwt';
import { expect, test } from '@playwright/test';

const SESSION_COOKIE_NAME = 'authjs.session-token';

async function craftSessionCookie(): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  return encode({
    salt: SESSION_COOKIE_NAME,
    secret: process.env.AUTH_SECRET ?? '',
    token: {
      sub: 'e2e-fixture-admin-id',
      email: 'e2e-admin@allowed.test',
      name: 'E2E Admin',
      iat: Math.floor(Date.now() / 1000),
      exp,
      jti: 'e2e-fixture-jti',
    },
    maxAge: 7 * 24 * 60 * 60,
  });
}

test.describe('AC-1.3.4 — unauthenticated `/panel/<sub>` redirects to `/panel?next=<path>`', () => {
  test('unauthed visit to /panel/agenda lands on /panel with next= preserved', async ({ page }) => {
    await page.goto('/panel/agenda', { waitUntil: 'commit' });

    // The redirect chain settles at /panel (the sign-in form).
    await page.waitForURL(/\/panel(\?|$)/, { timeout: 5_000 });

    const finalUrl = new URL(page.url());
    expect(finalUrl.pathname).toBe('/panel');
    // `next` MUST be the encoded original path. Decoding both sides keeps
    // the assertion independent of URL-encoding ambiguity.
    expect(finalUrl.searchParams.get('next')).toBe('/panel/agenda');

    // Confirm the sign-in form is what actually rendered — negative-evidence
    // that the redirect didn't loop or land on an error page.
    await expect(page.locator('input[name="email"]')).toBeVisible();
  });

  test('unauthed visit to /panel/maestros also redirects with next=', async ({ page }) => {
    await page.goto('/panel/maestros', { waitUntil: 'commit' });
    await page.waitForURL(/\/panel(\?|$)/, { timeout: 5_000 });

    const finalUrl = new URL(page.url());
    expect(finalUrl.pathname).toBe('/panel');
    expect(finalUrl.searchParams.get('next')).toBe('/panel/maestros');
  });

  test('unauthed visit to /panel/maestros/some-slug preserves the deep path', async ({ page }) => {
    await page.goto('/panel/maestros/augusto-rocha', { waitUntil: 'commit' });
    await page.waitForURL(/\/panel(\?|$)/, { timeout: 5_000 });

    const finalUrl = new URL(page.url());
    expect(finalUrl.searchParams.get('next')).toBe('/panel/maestros/augusto-rocha');
  });

  test('the /panel sign-in form itself is NOT redirected (exempt from the guard)', async ({
    page,
  }) => {
    await page.goto('/panel', { waitUntil: 'commit' });
    await page.waitForURL('**/panel', { timeout: 5_000 });

    const finalUrl = new URL(page.url());
    expect(finalUrl.pathname).toBe('/panel');
    // No `next` param when the visitor lands here directly.
    expect(finalUrl.searchParams.get('next')).toBeNull();
  });
});

test.describe('AC-1.3.4 + AC-3.7.6 — authed `/panel/<sub>` renders the chrome', () => {
  test('authed visit to /panel/agenda renders nav + sign-out form + status dot', async ({
    page,
    context,
    baseURL,
  }) => {
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

    await page.goto('/panel/agenda');

    // Chrome elements all from app/panel/layout.tsx — each is a separate
    // load-bearing UX surface, so each gets its own assertion.
    await expect(page.locator('header nav[aria-label="Panel"]')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Agenda' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Maestros' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Salir/i })).toBeVisible();
  });

  test('the webhook status dot renders with a verde or rojo data-color', async ({
    page,
    context,
    baseURL,
  }) => {
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

    await page.goto('/panel/agenda');

    const statusDot = page.locator('output[data-color]');
    await expect(statusDot).toBeVisible();
    // Either color is acceptable for a smoke pairing — what matters is the
    // attribute is one of the two CONTENT_PANEL.STATUS slot color literals.
    // The behavioural verde/rojo dispatch is integration-tested in
    // `tests/integration/webhook-status-dot.test.ts`.
    const color = await statusDot.getAttribute('data-color');
    expect(['verde', 'rojo']).toContain(color);
    // The `{checkedAt}` placeholder must have been substituted at render —
    // a leaked literal `{checkedAt}` in the tooltip means the substitution
    // step regressed.
    const tooltip = await statusDot.getAttribute('title');
    expect(tooltip ?? '').not.toContain('{checkedAt}');
  });
});
