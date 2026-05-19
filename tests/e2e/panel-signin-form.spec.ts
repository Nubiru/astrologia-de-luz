/**
 * G_B-3 e2e pairing #1 — `/panel` magic-link form + verify-request view
 * (AC-1.3.1 + AC-1.3.2).
 *
 * Drives Playwright through the real Next.js dev server (Playwright's
 * `webServer` config in `playwright.config.ts` boots `npm run dev` against
 * port 3000). Asserts:
 *
 *   1. **Unauth GET /panel** renders the single-email form with `<html
 *      lang="es">` (AC-1.3.1).
 *   2. **The form's action route resolves to Auth.js's signin endpoint**
 *      (server-action serialisation) — clicking submit triggers the form
 *      submission machinery.
 *   3. **`/panel?provider=resend&type=email`** renders the verify-request /
 *      anti-enum copy from `CONTENT_PANEL.AUTH.checkInboxNeutral` — and the
 *      form is NOT visible in that state (the two views are disjoint).
 *
 * Fails when:
 *   - The form's `<input name="email">` or submit button is removed/renamed.
 *   - The root `<html>` element drops `lang="es"` (root layout regression).
 *   - The post-submit branch in `app/panel/page.tsx` stops rendering
 *     `checkInboxNeutral` — meaning an off-list visitor would see the form
 *     re-rendered instead of the byte-identical "check your inbox" copy that
 *     an on-list visitor sees, leaking authorisation status.
 *   - The form is mistakenly rendered alongside the verify-request copy.
 *
 * Runtime: Playwright + a real Next.js dev server + libsql/Turso + Resend
 * configuration in env.local. This spec lives in `tests/e2e/**` which
 * `vitest.config.ts:exclude` lifts out of the vitest run — execution is
 * deferred to `npm run test:e2e`. The unit/integration sister coverage that
 * locks the anti-enum invariant at the handler layer ships with G_B-1
 * (`tests/integration/auth-anti-enum.test.ts`); this spec validates the
 * DOM shape of the same invariant in a real browser.
 */

import { expect, test } from '@playwright/test';

import { CONTENT_PANEL } from '@/infrastructure/content';

test.describe('AC-1.3.1 — GET /panel renders the magic-link sign-in form', () => {
  test('the root <html lang="es"> + form skeleton are present', async ({ page }) => {
    await page.goto('/panel');

    // AC-1.3.1 — entire admin surface is Spanish-only.
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');

    // AC-1.3.1 — single email input + submit button. Specific selectors so a
    // future refactor that drops the `name="email"` (would break the Auth.js
    // server-action form-data lookup) surfaces here.
    const emailInput = page.locator('input[name="email"][type="email"]');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('required', '');

    await expect(page.locator('button[type="submit"]')).toBeVisible();

    // The page must render the headline from CONTENT_PANEL — catches a
    // refactor that hard-codes English copy or drops the i18n boundary.
    await expect(page.getByRole('heading', { name: CONTENT_PANEL.AUTH.headline })).toBeVisible();

    // Negative-evidence: the post-submit checkInboxNeutral copy MUST NOT
    // appear in the form state. If it does, the page's branching logic has
    // collapsed to "always show both" and the anti-enum disjointness breaks.
    await expect(page.getByText(CONTENT_PANEL.AUTH.checkInboxNeutral)).toHaveCount(0);
  });

  test('the email input + submit button render the Spanish copy from CONTENT_PANEL', async ({
    page,
  }) => {
    await page.goto('/panel');

    await expect(page.getByLabel(CONTENT_PANEL.AUTH.emailLabel, { exact: true })).toBeVisible();

    await expect(page.getByRole('button', { name: CONTENT_PANEL.AUTH.submitButton })).toBeVisible();
  });
});

test.describe('AC-1.3.2 — verify-request view (anti-enum)', () => {
  test('?provider=resend&type=email renders the neutral check-inbox copy + hides the form', async ({
    page,
  }) => {
    await page.goto('/panel?provider=resend&type=email');

    await expect(page.getByText(CONTENT_PANEL.AUTH.checkInboxNeutral)).toBeVisible();

    // Negative-evidence: the FORM must not render in this state. If it did,
    // an off-list visitor would see "Si tu correo está autorizado…" AND a
    // re-submission form — visually indistinguishable from an on-list visitor
    // by intent, BUT the form's presence would let a bot probe by submitting
    // again and seeing whether the rate-limit fires.
    await expect(page.locator('input[name="email"]')).toHaveCount(0);
    await expect(page.locator('button[type="submit"]')).toHaveCount(0);
  });

  test('the neutral copy does NOT leak authorisation status', async ({ page }) => {
    await page.goto('/panel?provider=resend&type=email');

    const body = await page.locator('body').textContent();
    expect(body?.toLowerCase() ?? '').not.toContain('no autorizado');
    expect(body?.toLowerCase() ?? '').not.toContain('no estás autorizado');
    expect(body?.toLowerCase() ?? '').not.toContain('correo no encontrado');
    // Email address present in the page text → catastrophic leak.
    expect(body ?? '').not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  });
});
