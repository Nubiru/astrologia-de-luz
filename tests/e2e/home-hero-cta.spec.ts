/**
 * G_A-4 e2e pairing — home Hero renders + CTA navigates to /reservar.
 *
 * Anchors:
 *   - AC-1.1.1: GET / returns 200 with <html lang="es">.
 *   - AC-1.1.2: page contains a #hero section.
 *   - AC-1.1.4: each section ends with a CTA targeting /reservar.
 *   - AC-1.1.6: exactly one <h1> on the page (the hero claim).
 *   - AC-1.1.7: "ASTROLOGIA DE LUZ" wordmark literal renders; "ASTRALUMEN"
 *     never appears.
 *
 * Runtime: Playwright. Vitest excludes `tests/e2e/**` (see vitest.config.ts);
 * this spec fires via `npm run test:e2e` against a running Next dev server
 * — same deferred-runtime pattern as G_B-3's panel-signin specs and G_C-1's
 * install-smoke spec.
 */

import { expect, test } from '@playwright/test';

test.describe('G_A-4 home Hero — renders + CTA navigates', () => {
  test('GET / returns 200 with <html lang="es"> (AC-1.1.1)', async ({ page }) => {
    const response = await page.goto('/');
    expect(response).not.toBeNull();
    expect(response?.status()).toBe(200);

    const htmlLang = await page.locator('html').getAttribute('lang');
    expect(htmlLang).toBe('es');
  });

  test('the page renders a #hero section (AC-1.1.2)', async ({ page }) => {
    await page.goto('/');
    const hero = page.locator('section#hero');
    await expect(hero).toBeVisible();
  });

  test('the page renders EXACTLY ONE <h1> (AC-1.1.6)', async ({ page }) => {
    await page.goto('/');
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBe(1);
  });

  test('the wordmark "ASTROLOGIA DE LUZ" is rendered; "ASTRALUMEN" never (AC-1.1.7)', async ({
    page,
  }) => {
    await page.goto('/');
    const body = await page.locator('body').innerHTML();
    expect(body).toContain('ASTROLOGIA DE LUZ');
    expect(body).not.toMatch(/ASTRALUMEN/i);
  });

  test('the hero CTA links to /reservar and click navigates (AC-1.1.4)', async ({ page }) => {
    await page.goto('/');
    const cta = page.locator('section#hero a[href="/reservar"]');
    await expect(cta).toBeVisible();

    await cta.click();
    await page.waitForURL(/\/reservar\b/);
    expect(new URL(page.url()).pathname).toBe('/reservar');
  });

  test('hero remains accessible with JS disabled (AC-1.1.11 partial — CTA is a real <a>)', async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/');
    const cta = page.locator('section#hero a[href="/reservar"]');
    await expect(cta).toBeAttached();
    await context.close();
  });
});
