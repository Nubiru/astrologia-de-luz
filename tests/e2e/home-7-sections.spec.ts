/**
 * G_A-6 e2e pairing — full 7-section home flow presence + DOM order.
 *
 * Anchors:
 *   - AC-1.1.2: page contains exactly these sections in this order:
 *     #hero, #problemas, #servicios, #sobre, #testimonios, #faq, #cta-final + <footer>.
 *   - AC-1.1.4: per-section CTA cadence (≥ 1 for S1/S2/S3/S5/S7; 0 OK for S6).
 *   - AC-1.1.11: FAQ uses native <details>/<summary> — works with JS disabled.
 *
 * Runtime: Playwright. Vitest excludes `tests/e2e/**`; fires via
 * `npm run test:e2e` against a running Next dev server — deferred-runtime
 * pattern (G_C-1 / G_B-3 / G_A-4 / G_A-5).
 */

import { expect, test } from '@playwright/test';

const SECTION_IDS = [
  'hero',
  'problemas',
  'servicios',
  'sobre',
  'testimonios',
  'faq',
  'cta-final',
] as const;

test.describe('G_A-6 home 7-section flow', () => {
  test('home renders all 7 sections in spec-locked DOM order (AC-1.1.2)', async ({ page }) => {
    await page.goto('/');
    const ids = await page
      .locator('section')
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).id));
    expect(ids).toEqual([...SECTION_IDS]);
  });

  test('each non-FAQ section contains ≥ 1 CTA → /reservar (AC-1.1.4)', async ({ page }) => {
    await page.goto('/');
    for (const id of SECTION_IDS) {
      if (id === 'faq') continue;
      const ctaCount = await page.locator(`section#${id} a[href="/reservar"]`).count();
      expect(ctaCount, `#${id} CTA count`).toBeGreaterThanOrEqual(1);
    }
  });

  test('#faq has ZERO /reservar CTAs (AC-1.1.4 "FAQ softens")', async ({ page }) => {
    await page.goto('/');
    const ctaCount = await page.locator('section#faq a[href="/reservar"]').count();
    expect(ctaCount).toBe(0);
  });

  test('#faq uses native <details>/<summary> elements (AC-1.1.11)', async ({ page }) => {
    await page.goto('/');
    const detailsCount = await page.locator('section#faq details').count();
    expect(detailsCount).toBeGreaterThanOrEqual(5);
    const summaryCount = await page.locator('section#faq details summary').count();
    expect(summaryCount).toBe(detailsCount);
  });

  test('FAQ entries work without JavaScript (native <details> toggle)', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/');
    const firstSummary = page.locator('section#faq details summary').first();
    await expect(firstSummary).toBeVisible();
    await context.close();
  });

  test('#sobre renders EXACTLY ONE teacher card (AC-1.1.9)', async ({ page }) => {
    await page.goto('/');
    const cards = await page.locator('section#sobre [data-brand="teacher-card"]').count();
    expect(cards).toBe(1);
  });

  test('#cta-final renders the closing CTA → /reservar', async ({ page }) => {
    await page.goto('/');
    const cta = page.locator('section#cta-final a[href="/reservar"]');
    await expect(cta).toBeVisible();
    await cta.click();
    await page.waitForURL(/\/reservar\b/);
    expect(new URL(page.url()).pathname).toBe('/reservar');
  });
});
