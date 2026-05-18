/**
 * G_A-7 e2e pairing — /reservar 1-maestro seed → 3 visible steps (no picker).
 *
 * Anchors:
 *   - AC-1.2.1: `<h1>` matches /Reservar tu sesión/; single scrollable surface
 *     (no `[role="tabpanel"]`).
 *   - AC-1.2.2 / AC-1.2.4: with EXACTLY 1 active maestro the surface renders
 *     3 visible steps (Día / Horario / Tus datos) — the maestro picker step
 *     is OMITTED ENTIRELY (no `[data-step="picker"]` in DOM). Hero names
 *     the single maestro once via `subWithMaestroTemplate`.
 *
 * Runtime: Playwright. Vitest excludes `tests/e2e/**`; fires via
 * `npm run test:e2e` against a running Next dev server with the default
 * seed (Augusto-only — set by G_C-2c's seed migration). Deferred-runtime
 * pattern (G_C-1 / G_B-3 / G_A-4 / G_A-5 / G_A-6).
 */

import { expect, test } from '@playwright/test';

test.describe('G_A-7 /reservar — 1 active maestro renders 3 steps + omits picker', () => {
  test('GET /reservar returns 200 with <html lang="es"> (AC-1.2.1)', async ({ page }) => {
    const response = await page.goto('/reservar');
    expect(response?.status()).toBe(200);
    const htmlLang = await page.locator('html').getAttribute('lang');
    expect(htmlLang).toBe('es');
  });

  test('<h1> textContent matches "Reservar tu sesión" (AC-1.2.1)', async ({ page }) => {
    await page.goto('/reservar');
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBe(1);
    const h1Text = await page.locator('h1').textContent();
    expect(h1Text).toMatch(/Reservar tu sesión/);
  });

  test('no [role="tabpanel"] anywhere — single scrollable surface (AC-1.2.1)', async ({ page }) => {
    await page.goto('/reservar');
    const tabpanels = await page.locator('[role="tabpanel"]').count();
    expect(tabpanels).toBe(0);
  });

  test('picker step is OMITTED ENTIRELY (no [data-step="picker"]) — AC-1.2.4', async ({ page }) => {
    await page.goto('/reservar');
    const pickerCount = await page.locator('[data-step="picker"]').count();
    expect(pickerCount).toBe(0);
  });

  test('exactly 3 visible steps in DOM order: dia → horario → form (AC-1.2.2)', async ({
    page,
  }) => {
    await page.goto('/reservar');
    const stepIds = await page
      .locator('[data-step]')
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.step));
    expect(stepIds).toEqual(['dia', 'horario', 'form']);
  });

  test('step eyebrows number sequentially as Paso 1 / 2 / 3', async ({ page }) => {
    await page.goto('/reservar');
    const stepNumbers = await page
      .locator('[data-step]')
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.stepNumber));
    expect(stepNumbers).toEqual(['1', '2', '3']);
  });

  test('hero sub names the single maestro once via subWithMaestroTemplate (AC-1.2.4)', async ({
    page,
  }) => {
    await page.goto('/reservar');
    const sub = page.locator('[data-brand="reservar-sub"]');
    await expect(sub).toBeVisible();
    const text = await sub.textContent();
    expect(text).toMatch(/Reservar con\s+\S+/);
    const slug = await sub.getAttribute('data-single-maestro');
    expect(slug).toBeTruthy();
  });
});
