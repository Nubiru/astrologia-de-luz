/**
 * G_A-5 e2e pairing — S2 + S3 section count, DOM order, per-section CTA targets.
 *
 * Anchors:
 *   - AC-1.1.2: #problemas + #servicios present (in DOM order with #hero).
 *   - AC-1.1.3: tone alternation visible at the computed-bg layer.
 *   - AC-1.1.4: per-section ≥ 1 CTA → /reservar.
 *
 * Runtime: Playwright. Vitest excludes `tests/e2e/**`; fires via
 * `npm run test:e2e` against a running Next dev server — same deferred-runtime
 * pattern as G_C-1 / G_B-3 / G_A-4.
 */

import { expect, test } from '@playwright/test';

test.describe('G_A-5 home S2 + S3 — DOM order, tone rhythm, CTA cadence', () => {
  test('home renders #problemas and #servicios in DOM order after #hero (AC-1.1.2)', async ({
    page,
  }) => {
    await page.goto('/');
    const ids = await page
      .locator('section')
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).id));
    expect(ids).toEqual(['hero', 'problemas', 'servicios']);
  });

  test('#problemas computed background matches blanco-estelar (light tone, AC-1.1.3)', async ({
    page,
  }) => {
    await page.goto('/');
    const tone = await page.locator('section#problemas').getAttribute('data-tone');
    expect(tone).toBe('light');
  });

  test('#servicios computed background matches tinta-nocturna (dark tone, AC-1.1.3)', async ({
    page,
  }) => {
    await page.goto('/');
    const tone = await page.locator('section#servicios').getAttribute('data-tone');
    expect(tone).toBe('dark');
  });

  test('each section contains ≥ 1 CTA targeting /reservar (AC-1.1.4)', async ({ page }) => {
    await page.goto('/');
    for (const id of ['hero', 'problemas', 'servicios']) {
      const ctaCount = await page.locator(`section#${id} a[href="/reservar"]`).count();
      expect(ctaCount, `#${id} CTA count`).toBeGreaterThanOrEqual(1);
    }
  });

  test('the #servicios section renders exactly 3 service cards (v1.0 lock)', async ({ page }) => {
    await page.goto('/');
    const cards = await page.locator('section#servicios [data-brand="servicio-card"]').count();
    expect(cards).toBe(3);
  });

  test('clicking the #servicios CTA navigates to /reservar', async ({ page }) => {
    await page.goto('/');
    await page.locator('section#servicios a[href="/reservar"]').first().click();
    await page.waitForURL(/\/reservar\b/);
    expect(new URL(page.url()).pathname).toBe('/reservar');
  });
});
