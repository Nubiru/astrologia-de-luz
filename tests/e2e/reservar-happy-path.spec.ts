// G_A-9 e2e pairing — /reservar happy-path submit (AC-1.2.7 / AC-1.2.9).
//
// Strategy: route-mock both the availability endpoint (canned slots so the
// slot grid renders deterministically) AND the sessions POST endpoint
// (canned 201 response so we never insert into a real DB). The mocks let
// the spec lock BROWSER-side rendering of every G_A-9 invariant without
// touching the downstream pool-c stack.
//
// Anchors:
//   - AC-1.2.7  Form fields present + honeypot visually-hidden + min-fill-time
//   - AC-1.2.9  ConfirmationPanel renders with dual-TZ literal + SLA line
//   - AC-1.2.11 Testimonios sit between slot grid + form (<= 2 cards visible)
//   - AC-3.5.1  Honeypot uses position:absolute / left:-9999px / not display:none
//   - AC-3.5.2  _t hidden field exists + carries a numeric ms value
//
// Runtime: Playwright deferred (tests/e2e excluded from vitest).

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

function cannedAvailability() {
  const now = new Date();
  return {
    tz: 'America/Argentina/Buenos_Aires',
    rangeStartUtc: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    ).toISOString(),
    rangeEndUtc: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 14),
    ).toISOString(),
    slots: [ISO_TOMORROW_15_UTC, ISO_TOMORROW_16_UTC],
  };
}

function cannedCreated(slotIso: string) {
  return {
    kind: 'created' as const,
    sessionId: 'test-session-id',
    slotUtcIso: slotIso,
    maestroName: 'Augusto Rocha',
    maestroTimezone: 'America/Argentina/Buenos_Aires',
    visitorTimezone: 'America/Argentina/Buenos_Aires',
  };
}

test.describe('G_A-9 /reservar — happy-path submit', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/teachers/*/availability*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(cannedAvailability()),
      });
    });
  });

  test('form section renders all required fields + acceptsPending checkbox (AC-1.2.7)', async ({
    page,
  }) => {
    await page.goto('/reservar');
    await expect(page.locator('[data-brand="reservar-form"]')).toBeVisible();
    await expect(page.locator('[data-brand="form-field-visitorName"]')).toBeVisible();
    await expect(page.locator('[data-brand="form-field-visitorEmail"]')).toBeVisible();
    await expect(page.locator('[data-brand="form-field-contactPref"]')).toBeVisible();
    await expect(page.locator('[data-brand="form-field-contactValue"]')).toBeVisible();
    await expect(page.locator('[data-brand="form-field-visitorIntent"]')).toBeVisible();
    await expect(page.locator('[data-brand="form-field-acceptsPending"]')).toBeVisible();
    // Submit button starts disabled (no slot selected immediately + acceptsPending false).
    const submit = page.locator('[data-brand="reservar-submit"]');
    await expect(submit).toBeVisible();
  });

  test('honeypot field is visually-hidden via position:absolute (NOT display:none) (AC-3.5.1)', async ({
    page,
  }) => {
    await page.goto('/reservar');
    const honeypot = page.locator('[data-brand="honeypot"]');
    await expect(honeypot).toHaveCount(1);
    // The element must NOT be display:none. The wrapping container uses
    // position:absolute + left:-9999px per the AC literal.
    const wrapperDisplay = await honeypot.evaluate((el) => {
      const wrapper = el.parentElement as HTMLElement;
      return getComputedStyle(wrapper).display;
    });
    expect(wrapperDisplay).not.toBe('none');
    const wrapperPosition = await honeypot.evaluate((el) => {
      const wrapper = el.parentElement as HTMLElement;
      return getComputedStyle(wrapper).position;
    });
    expect(wrapperPosition).toBe('absolute');
    // tabindex=-1 + autocomplete=off on the input itself.
    await expect(honeypot).toHaveAttribute('tabindex', '-1');
    await expect(honeypot).toHaveAttribute('autocomplete', 'off');
  });

  test('min-fill-time hidden field is present and starts non-negative (AC-3.5.2)', async ({
    page,
  }) => {
    await page.goto('/reservar');
    const tField = page.locator('[data-brand="min-fill-time"]');
    await expect(tField).toHaveCount(1);
    const raw = await tField.inputValue();
    const parsed = Number(raw);
    expect(Number.isFinite(parsed)).toBe(true);
    expect(parsed).toBeGreaterThanOrEqual(0);
  });

  test('testimonios section sits between slot grid + form with at most 2 cards (AC-1.2.11)', async ({
    page,
  }) => {
    await page.goto('/reservar');
    const block = page.locator('[data-brand="reservar-testimonios"]');
    await expect(block).toBeVisible();
    const cards = page.locator('[data-brand="reservar-testimonio-card"]');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(2);
    // DOM order: slot-grid → testimonios → form
    const positions = await page.evaluate(() => {
      const order = [
        '[data-brand="slot-grid"]',
        '[data-brand="reservar-testimonios"]',
        '[data-brand="reservar-form"]',
      ];
      return order.map((sel) => {
        const el = document.querySelector(sel);
        return el ? Array.from(document.querySelectorAll('*')).indexOf(el) : -1;
      });
    });
    expect(positions[0]).toBeGreaterThan(-1);
    expect(positions[1]).toBeGreaterThan(positions[0] ?? -1);
    expect(positions[2]).toBeGreaterThan(positions[1] ?? -1);
  });

  test('fine-print cancellation policy renders below submit (AC-3.8.2)', async ({ page }) => {
    await page.goto('/reservar');
    const finePrint = page.locator('[data-brand="reservar-fine-print"]');
    await expect(finePrint).toBeVisible();
    await expect(finePrint).toContainText(/24 horas/);
    await expect(finePrint).toContainText(/eagendamiento/i);
  });

  test('happy-path submit → 201 → ConfirmationPanel with dual-TZ literal + SLA (AC-1.2.9)', async ({
    page,
  }) => {
    type Captured = { url: string; body: unknown };
    const capturedBox: { value: Captured | null } = { value: null };
    await page.route('**/api/sessions', async (route) => {
      const req = route.request();
      capturedBox.value = { url: req.url(), body: req.postDataJSON() };
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(cannedCreated(ISO_TOMORROW_15_UTC)),
      });
    });

    await page.goto('/reservar');

    // Wait for the slot grid to hydrate + auto-pick the first available slot.
    await expect(page.locator('[data-slot-selected="true"]')).toHaveCount(1, { timeout: 5000 });

    // Fill the form.
    await page.locator('[data-brand="form-field-visitorName"]').fill('Lucía Martínez');
    await page.locator('[data-brand="form-field-visitorEmail"]').fill('lucia@example.test');
    await page.locator('[data-brand="form-field-contactPref"]').selectOption('email');
    await page.locator('[data-brand="form-field-contactValue"]').fill('lucia@example.test');
    await page.locator('[data-brand="form-field-visitorIntent"]').fill('Una pregunta breve.');
    await page.locator('[data-brand="form-field-acceptsPending"]').check();

    const submit = page.locator('[data-brand="reservar-submit"]');
    await expect(submit).toBeEnabled();
    await submit.click();

    // ConfirmationPanel replaces the form section. The container is <output>,
    // which carries implicit role="status" — assert via accessible role lookup
    // rather than an explicit attribute.
    const confirmation = page.locator('[data-brand="reservar-confirmation"]');
    await expect(confirmation).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('status')).toBeVisible();

    // Dual-TZ line structure — anchored to the punctuation in the AC literal.
    const line = page.locator('[data-brand="confirmation-line"]');
    await expect(line).toBeVisible();
    await expect(line).toContainText('Tu solicitud:');
    await expect(line).toContainText('(tu hora ·');
    await expect(line).toContainText('(hora de Augusto Rocha,');
    const text = (await line.textContent())?.trim() ?? '';
    expect(text).toMatch(
      /^Tu solicitud: \d{1,2} de [a-záéíóú]+, \d{2}:\d{2} \(tu hora · [\w/_+-]+\) · \d{2}:\d{2} \(hora de [^,]+, [\w/_+-]+\)\.$/i,
    );

    // SLA line uses CONTENT_PANEL.LANDING.sla.text — must include "24-48 horas".
    const sla = page.locator('[data-brand="confirmation-sla"]');
    await expect(sla).toBeVisible();
    await expect(sla).toContainText(/24-48 horas/);

    // Server received the body with the expected hidden + visible fields.
    expect(capturedBox.value).not.toBeNull();
    if (!capturedBox.value) throw new Error('route mock did not capture the request');
    const body = capturedBox.value.body as Record<string, unknown>;
    expect(body.teacherSlug).toBeTruthy();
    expect(body.slotUtcIso).toBe(ISO_TOMORROW_15_UTC);
    expect(body.visitorName).toBe('Lucía Martínez');
    expect(body.contactPref).toBe('email');
    expect(body.acceptsPending).toBe(true);
    expect(body.companyName).toBe('');
    expect(typeof body._t).toBe('number');
    expect(body._t as number).toBeGreaterThanOrEqual(0);
  });
});
