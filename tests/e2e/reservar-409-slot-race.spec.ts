/**
 * G_A-9 e2e pairing — /reservar 409 slot-race (AC-3.6.1).
 *
 * Mocks `/api/sessions` to return a 409 `{kind:"slot_taken", availableSlots:[…]}`
 * on the first submit, then asserts the AC-3.6.1 client-side contract:
 *   1. The slot grid re-renders using the fresh `availableSlots[]`.
 *   2. The originally-selected slot button is gone (it's no longer in
 *      `availableSlots`).
 *   3. A toast surfaces with the server's Spanish error message + a
 *      "pick another slot" suffix.
 *   4. Visitor's form-field input survives byte-equal (no re-typing).
 */

import { expect, test } from '@playwright/test';

const ISO_TOMORROW_15_UTC = (() => {
  const now = new Date();
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 15));
  return t.toISOString();
})();
const ISO_TOMORROW_16_UTC = (() => {
  const now = new Date();
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 16));
  return t.toISOString();
})();
const ISO_TOMORROW_17_UTC = (() => {
  const now = new Date();
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 17));
  return t.toISOString();
})();

function cannedAvailability(slots: ReadonlyArray<string>) {
  const now = new Date();
  return {
    tz: 'America/Argentina/Buenos_Aires',
    rangeStartUtc: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    ).toISOString(),
    rangeEndUtc: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 14),
    ).toISOString(),
    slots,
  };
}

test.describe('G_A-9 /reservar — 409 slot-race', () => {
  test('409 → toast surfaces + taken slot removed + visitor input preserved (AC-3.6.1)', async ({
    page,
  }) => {
    await page.route('**/api/teachers/*/availability*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          cannedAvailability([ISO_TOMORROW_15_UTC, ISO_TOMORROW_16_UTC, ISO_TOMORROW_17_UTC]),
        ),
      });
    });
    await page.route('**/api/sessions', async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          kind: 'slot_taken',
          error: 'Ese horario ya no está disponible.',
          // Fresh server list — the originally-selected slot (15Z) is gone.
          availableSlots: [ISO_TOMORROW_16_UTC, ISO_TOMORROW_17_UTC],
        }),
      });
    });

    await page.goto('/reservar');

    // Initially 3 slots → auto-pick the first → submit aimed at 15Z.
    await expect(page.locator('[data-brand="slot-button"]')).toHaveCount(3, { timeout: 5000 });
    const selectedSlot = page.locator('[data-slot-selected="true"]');
    await expect(selectedSlot).toHaveCount(1);
    const originallySelectedIso = await selectedSlot.getAttribute('data-slot-iso');
    expect(originallySelectedIso).toBeTruthy();

    // Fill the form with realistic visitor data.
    const NAME = 'María José Sánchez-Cruz';
    const EMAIL = 'maria-jose@example.test';
    const CONTACT = '+54 9 11 5555 1234';
    const INTENT = 'Estoy en un cambio profesional y me gustaría mirar el momento con perspectiva.';
    await page.locator('[data-brand="form-field-visitorName"]').fill(NAME);
    await page.locator('[data-brand="form-field-visitorEmail"]').fill(EMAIL);
    await page.locator('[data-brand="form-field-contactPref"]').selectOption('whatsapp');
    await page.locator('[data-brand="form-field-contactValue"]').fill(CONTACT);
    await page.locator('[data-brand="form-field-visitorIntent"]').fill(INTENT);
    await page.locator('[data-brand="form-field-acceptsPending"]').check();

    await page.locator('[data-brand="reservar-submit"]').click();

    // Toast appears with the slot-taken message.
    const toast = page.locator('[data-brand="slot-taken-toast"]');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText('Ese horario ya no está disponible.');
    await expect(toast).toHaveAttribute('role', 'alert');
    // Toast carries the iso of the slot that was just taken.
    if (originallySelectedIso) {
      await expect(toast).toHaveAttribute('data-toast-taken-iso', originallySelectedIso);
    }

    // Slot grid re-renders with fresh slots from the server.
    await expect(page.locator('[data-brand="slot-button"]')).toHaveCount(2);
    // The originally-selected slot button is gone.
    if (originallySelectedIso) {
      await expect(
        page.locator(`[data-brand="slot-button"][data-slot-iso="${originallySelectedIso}"]`),
      ).toHaveCount(0);
    }

    // No slot is selected anymore — visitor must pick a new one.
    await expect(page.locator('[data-slot-selected="true"]')).toHaveCount(0);

    // Form-field values are preserved byte-equal.
    await expect(page.locator('[data-brand="form-field-visitorName"]')).toHaveValue(NAME);
    await expect(page.locator('[data-brand="form-field-visitorEmail"]')).toHaveValue(EMAIL);
    await expect(page.locator('[data-brand="form-field-contactPref"]')).toHaveValue('whatsapp');
    await expect(page.locator('[data-brand="form-field-contactValue"]')).toHaveValue(CONTACT);
    await expect(page.locator('[data-brand="form-field-visitorIntent"]')).toHaveValue(INTENT);
    await expect(page.locator('[data-brand="form-field-acceptsPending"]')).toBeChecked();

    // Submit is disabled again (no slot selected).
    await expect(page.locator('[data-brand="reservar-submit"]')).toBeDisabled();
  });
});
