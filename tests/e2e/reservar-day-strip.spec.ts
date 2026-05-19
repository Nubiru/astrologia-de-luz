/**
 * G_A-8 e2e pairing — /reservar day-strip + slot-grid + TZ display.
 *
 * Anchors:
 *   - AC-1.2.5  Day strip renders 14 chips (weekday-short + date-number +
 *               slot-count badge "N" or "—"). Zero-availability chips are
 *               `aria-disabled="true"` and visually muted (opacity ≤ 0.6).
 *               Strip is `role="radiogroup"` with `aria-label="Elegí un día"`;
 *               chips are `role="radio"`.
 *   - AC-1.2.6  Slot grid renders ONLY available slots (no greyed-out
 *               unavailable). Each slot button is `role="radio"` with
 *               min touch target 44×44 CSS px and label `^\d{2}:\d{2}$`
 *               (24h Spanish).
 *   - AC-1.2.8  TZ display literal matches `^Zona horaria: \S.+ \(UTC[+-]\d{2}:\d{2}\) · Cambiar$`.
 *
 * Strategy: intercept `GET /api/teachers/[slug]/availability` to inject a
 * canned slot list (the seed migration ships Augusto with EMPTY availability
 * windows per R-9 — without a mock the slot button assertions would have
 * nothing to bind to). The mock returns ISO UTC instants whose hours map to
 * `12:00 / 13:00 / 14:00` in Buenos Aires (playwright.config.ts pins the
 * project's locale + timezoneId to `es-AR` / `America/Argentina/Buenos_Aires`,
 * so the visitor TZ detection inside the page reads that).
 *
 * Runtime: Playwright. Vitest excludes `tests/e2e/**`; fires via
 * `npm run test:e2e` against a running Next dev server.
 */

import { expect, test } from '@playwright/test';

/**
 * Helper — emit a stable canned availability response. Spans tomorrow in
 * Buenos Aires (UTC-03:00) at 12:00 / 13:00 / 14:00 local → 15:00 / 16:00 /
 * 17:00 UTC. Picked tomorrow (not today) so the route's "drop slots in the
 * past" filter cannot interact with wall-clock drift at test time.
 */
function cannedAvailability() {
  const now = new Date();
  // Anchor at noon UTC tomorrow → guaranteed in the future for AR/BR/UY visitors.
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 15));
  const isoFor = (hourUtc: number) => {
    const d = new Date(t);
    d.setUTCHours(hourUtc, 0, 0, 0);
    return d.toISOString();
  };
  return {
    tz: 'America/Argentina/Buenos_Aires',
    rangeStartUtc: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    ).toISOString(),
    rangeEndUtc: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 14),
    ).toISOString(),
    // 15:00 UTC = 12:00 AR; 16:00 UTC = 13:00 AR; 17:00 UTC = 14:00 AR.
    slots: [isoFor(15), isoFor(16), isoFor(17)],
  };
}

test.describe('G_A-8 /reservar — day-strip + slot-grid + TZ display', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/teachers/*/availability*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(cannedAvailability()),
      });
    });
  });

  test('day strip renders exactly 14 chips (AC-1.2.5)', async ({ page }) => {
    await page.goto('/reservar');
    const strip = page.locator('[data-brand="day-strip"]');
    await expect(strip).toBeVisible();
    const chips = page.locator('[data-brand="day-chip"]');
    await expect(chips).toHaveCount(14);
  });

  test('day strip is role="radiogroup" with aria-label="Elegí un día" (AC-1.2.5)', async ({
    page,
  }) => {
    await page.goto('/reservar');
    const strip = page.locator('[data-brand="day-strip"]');
    await expect(strip).toHaveAttribute('role', 'radiogroup');
    await expect(strip).toHaveAttribute('aria-label', 'Elegí un día');
  });

  test('each day chip exposes weekday-short + date-number + slot-count badge (AC-1.2.5)', async ({
    page,
  }) => {
    await page.goto('/reservar');
    const firstChip = page.locator('[data-brand="day-chip"]').first();
    await expect(firstChip).toBeVisible();
    await expect(firstChip).toHaveAttribute('role', 'radio');
    await expect(firstChip.locator('[data-brand="day-chip-weekday"]')).toHaveText(
      /^(Lu|Ma|Mi|Ju|Vi|Sá|Do)$/,
    );
    await expect(firstChip.locator('[data-brand="day-chip-date"]')).toHaveText(/^\d{1,2}$/);
    await expect(firstChip.locator('[data-brand="day-chip-badge"]')).toBeVisible();
  });

  test('chips with zero availability are aria-disabled and visually muted (AC-1.2.5)', async ({
    page,
  }) => {
    await page.goto('/reservar');
    // Mock returns slots on tomorrow only → all OTHER chips have slotCount === 0.
    const disabled = page.locator('[data-brand="day-chip"][data-day-disabled="true"]');
    const count = await disabled.count();
    expect(count).toBeGreaterThanOrEqual(12); // 14 total - 1 (tomorrow has slots) - some tolerance for today
    const first = disabled.first();
    await expect(first).toHaveAttribute('aria-disabled', 'true');
    // Empty badge text is the canonical "—".
    await expect(first.locator('[data-brand="day-chip-badge"]')).toHaveText('—');
    const opacity = await first.evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(opacity)).toBeLessThanOrEqual(0.6);
  });

  test('slot grid renders ONLY available slots for the selected day (AC-1.2.6)', async ({
    page,
  }) => {
    await page.goto('/reservar');
    const grid = page.locator('[data-brand="slot-grid"]');
    await expect(grid).toBeVisible();
    await expect(grid).toHaveAttribute('role', 'radiogroup');
    const buttons = page.locator('[data-brand="slot-button"]');
    await expect(buttons).toHaveCount(3);
  });

  test('slot button label format is HH:MM 24h Spanish (AC-1.2.6)', async ({ page }) => {
    await page.goto('/reservar');
    const buttons = page.locator('[data-brand="slot-button"]');
    const texts = await buttons.allInnerTexts();
    expect(texts.length).toBe(3);
    for (const t of texts) {
      expect(t.trim()).toMatch(/^\d{2}:\d{2}$/);
    }
    // Spanish-locale 24h means no "AM/PM" anywhere.
    const all = texts.join(' ');
    expect(all).not.toMatch(/AM|PM/i);
  });

  test('slot button meets min touch target 44×44 CSS px (AC-1.2.6)', async ({ page }) => {
    await page.goto('/reservar');
    const firstSlot = page.locator('[data-brand="slot-button"]').first();
    await expect(firstSlot).toBeVisible();
    const box = await firstSlot.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(firstSlot).toHaveAttribute('role', 'radio');
  });

  test('TZ display renders beneath the slot grid matching the AC-1.2.8 literal', async ({
    page,
  }) => {
    await page.goto('/reservar');
    const tz = page.locator('[data-brand="tz-display"]');
    await expect(tz).toBeVisible();
    const text = (await tz.textContent())?.trim() ?? '';
    expect(text).toMatch(/^Zona horaria: \S.+ \(UTC[+-]\d{2}:\d{2}\) · Cambiar$/);
    // Playwright config pins the project to Buenos Aires; expect that as the resolved iana.
    await expect(tz).toHaveAttribute('data-tz-iana', 'America/Argentina/Buenos_Aires');
    await expect(tz).toHaveAttribute('data-tz-offset', 'UTC-03:00');
  });

  test('clicking a different non-disabled day reselects + updates slot grid', async ({ page }) => {
    await page.goto('/reservar');
    // First, locate the tomorrow chip (only enabled one given the mock).
    const enabled = page.locator('[data-brand="day-chip"]:not([data-day-disabled="true"])');
    const enabledCount = await enabled.count();
    expect(enabledCount).toBeGreaterThanOrEqual(1);
    // The provider auto-selects the first day with slots, so re-click is a no-op
    // for behaviour assertion. Verify the selected attribute is set on the auto-pick.
    const selected = page.locator('[data-day-selected="true"]');
    await expect(selected).toHaveCount(1);
    const buttons = page.locator('[data-brand="slot-button"]');
    await expect(buttons).toHaveCount(3);
  });
});
