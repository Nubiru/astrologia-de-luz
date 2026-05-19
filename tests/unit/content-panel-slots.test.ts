/**
 * G_B-10 unit pairing — `CONTENT_PANEL` slot contract (AC-1.3.2 + AC-3.2.1 +
 * AC-3.2.2 + AC-3.3.5 + AC-3.4.3 + AC-3.7.4 + AC-3.7.6 + AC-3.8.1 + AC-3.8.2).
 *
 * Asserts every documented slot exists, every body has content, and every
 * `{placeholder}` is a well-formed camelCase identifier (no stray braces, no
 * shell-style `${...}` escapes that would render literally on Telegram /
 * inside the panel). The spec-verbatim copy contracts (SLA window, cancellation
 * sentence, anti-enum neutral string) are pinned by literal-substring asserts
 * so a future "soft" wording drift surfaces here instead of in production.
 *
 * Fails when:
 *   - A documented slot is renamed, removed, or replaced with `undefined` /
 *     empty string (a referencing page would render "undefined" or a blank).
 *   - `AUTH.checkInboxNeutral` regresses to a wording that leaks
 *     authorisation status (e.g. drops the "Si tu correo está autorizado"
 *     conditional) — anti-enum gate would silently break.
 *   - `LANDING.sla.text` / `RESERVAR.cancellation.text` drift from the
 *     spec-pinned substrings ("24-48 horas" / "24 horas" + "reagendamiento")
 *     without an accompanying spec update.
 *   - A placeholder gets mistyped (`{visitor name}` with a space,
 *     `${visitorName}` shell-style, `{{visitorName}}` mustache-style) — none
 *     of those substitute, the message ships with the literal braces visible.
 *   - The four NOTIFY brandOwnerNewRequest / assignedMaestroNewRequest
 *     placeholders drift away from the AC-3.2.* substitution contract.
 */

import { describe, expect, test } from 'vitest';

import { CONTENT_PANEL } from '@/infrastructure/content/panel';

// A well-formed placeholder is `{` + at-least-one camelCase identifier char +
// `}`. The body of these tests builds a set of placeholders from every slot
// and asserts the set is the disjoint union of "well-formed" placeholders.
const WELL_FORMED_PLACEHOLDER = /^\{[a-zA-Z][a-zA-Z0-9]*\}$/;
const ANY_BRACE_TOKEN = /[{][^{}]*[}]/g;

function extractPlaceholders(s: string): string[] {
  return s.match(ANY_BRACE_TOKEN) ?? [];
}

// Recursively flatten every string value in the slot tree so the placeholder
// well-formed check covers the entire surface in one pass.
function collectStrings(node: unknown, path: string[] = []): { path: string[]; value: string }[] {
  if (typeof node === 'string') return [{ path, value: node }];
  if (node && typeof node === 'object') {
    const out: { path: string[]; value: string }[] = [];
    for (const [k, v] of Object.entries(node)) {
      out.push(...collectStrings(v, [...path, k]));
    }
    return out;
  }
  return [];
}

describe('CONTENT_PANEL — every documented slot exists', () => {
  test('AUTH slots (AC-1.3.2 + AC-2.5.2)', () => {
    expect(typeof CONTENT_PANEL.AUTH.headline).toBe('string');
    expect(typeof CONTENT_PANEL.AUTH.emailLabel).toBe('string');
    expect(typeof CONTENT_PANEL.AUTH.emailPlaceholder).toBe('string');
    expect(typeof CONTENT_PANEL.AUTH.submitButton).toBe('string');
    expect(typeof CONTENT_PANEL.AUTH.signOutButton).toBe('string');
    expect(typeof CONTENT_PANEL.AUTH.checkInboxNeutral).toBe('string');
    expect(typeof CONTENT_PANEL.AUTH.verifyRequestSubtitle).toBe('string');
  });

  test('ERRORS slots (AC-3.4.3)', () => {
    expect(typeof CONTENT_PANEL.ERRORS.invalidTransition).toBe('string');
    expect(typeof CONTENT_PANEL.ERRORS.unauthorized).toBe('string');
    expect(typeof CONTENT_PANEL.ERRORS.notFound).toBe('string');
    expect(typeof CONTENT_PANEL.ERRORS.serverError).toBe('string');
  });

  test('STATUS slots (AC-3.7.6)', () => {
    expect(CONTENT_PANEL.STATUS.webhook_ok.color).toBe('verde');
    expect(CONTENT_PANEL.STATUS.webhook_broken.color).toBe('rojo');
    expect(typeof CONTENT_PANEL.STATUS.webhook_ok.label).toBe('string');
    expect(typeof CONTENT_PANEL.STATUS.webhook_broken.label).toBe('string');
    expect(typeof CONTENT_PANEL.STATUS.webhook_ok.tooltipTemplate).toBe('string');
    expect(typeof CONTENT_PANEL.STATUS.webhook_broken.tooltipTemplate).toBe('string');
  });

  test('NOTIFY slots (AC-3.2.1 + AC-3.2.2 + AC-3.3.5 + AC-3.7.4)', () => {
    expect(typeof CONTENT_PANEL.NOTIFY.brandOwnerNewRequest).toBe('string');
    expect(typeof CONTENT_PANEL.NOTIFY.assignedMaestroNewRequest).toBe('string');
    expect(typeof CONTENT_PANEL.NOTIFY.maestroOnboardedSuccess).toBe('string');
    expect(typeof CONTENT_PANEL.NOTIFY.brandOwnerMaestroOnboardedPing).toBe('string');
    expect(typeof CONTENT_PANEL.NOTIFY.reenviar_button).toBe('string');
    expect(typeof CONTENT_PANEL.NOTIFY.reenviar_success_toast).toBe('string');
    expect(typeof CONTENT_PANEL.NOTIFY.reenviar_failed_toast).toBe('string');
  });

  test('LANDING + RESERVAR slots (AC-3.8.1 + AC-3.8.2)', () => {
    expect(typeof CONTENT_PANEL.LANDING.sla.text).toBe('string');
    expect(typeof CONTENT_PANEL.RESERVAR.cancellation.text).toBe('string');
  });
});

describe('CONTENT_PANEL — every string has content', () => {
  // No slot may ship as empty / whitespace-only — every entry below is
  // user-visible somewhere, and an empty entry would render a blank.
  test.each(collectStrings(CONTENT_PANEL))(
    'CONTENT_PANEL.%s is non-empty (length > 0 after trim)',
    (entry) => {
      const { path, value } = entry;
      expect(value.trim().length, `${path.join('.')} is empty`).toBeGreaterThan(0);
    },
  );
});

describe('CONTENT_PANEL — every placeholder is well-formed', () => {
  test.each(collectStrings(CONTENT_PANEL))(
    'CONTENT_PANEL.%s placeholders pass the camelCase brace contract',
    (entry) => {
      const { path, value } = entry;
      const placeholders = extractPlaceholders(value);
      for (const ph of placeholders) {
        expect(
          WELL_FORMED_PLACEHOLDER.test(ph),
          `${path.join('.')} has malformed placeholder ${ph}`,
        ).toBe(true);
      }
    },
  );

  test('no slot contains shell-style ${...} (would render literally on Telegram + email)', () => {
    for (const { path, value } of collectStrings(CONTENT_PANEL)) {
      expect(value, `${path.join('.')} has a shell-style escape`).not.toMatch(/\$\{[^}]*\}/);
    }
  });

  test('no slot has unmatched single brace { or } (printf-safety)', () => {
    for (const { path, value } of collectStrings(CONTENT_PANEL)) {
      // Strip well-formed `{token}` first, then any remaining brace is stray.
      const stripped = value.replace(/\{[a-zA-Z][a-zA-Z0-9]*\}/g, '');
      expect(
        stripped.includes('{') || stripped.includes('}'),
        `${path.join('.')} has an unmatched brace after stripping placeholders`,
      ).toBe(false);
    }
  });
});

describe('AC-1.3.2 — anti-enum copy contract', () => {
  // The neutral string MUST preserve the conditional framing — wording that
  // changes "Si tu correo está autorizado" to "Te enviamos el enlace" would
  // confirm authorisation on the on-list path AND leave the off-list path
  // looking wrong.
  test('AUTH.checkInboxNeutral keeps the "si tu correo está autorizado" conditional', () => {
    const s = CONTENT_PANEL.AUTH.checkInboxNeutral.toLowerCase();
    expect(s).toContain('si tu correo');
    expect(s).toContain('autorizado');
    expect(s).toContain('enlace');
  });

  test('AUTH.checkInboxNeutral does NOT mention specific addresses, domains, or "no autorizado"', () => {
    const s = CONTENT_PANEL.AUTH.checkInboxNeutral.toLowerCase();
    // Negative-evidence: a "no autorizado" variant would leak the off-list
    // signal even when shown to the on-list user.
    expect(s).not.toContain('no autorizado');
    expect(s).not.toContain('no estás autorizado');
    expect(s).not.toContain('correo no encontrado');
    expect(s).not.toMatch(/@[a-z0-9.-]+/);
  });
});

describe('AC-3.8.1 + AC-3.8.2 — admin-controlled landing copy contracts', () => {
  test('LANDING.sla.text contains the spec-pinned "24-48 horas" SLA window', () => {
    expect(CONTENT_PANEL.LANDING.sla.text).toContain('24-48 horas');
  });

  test('RESERVAR.cancellation.text contains "24 horas" + the reagendamiento clause', () => {
    const s = CONTENT_PANEL.RESERVAR.cancellation.text.toLowerCase();
    expect(s).toContain('24 horas');
    expect(s).toMatch(/reagendamiento|reagendar/);
  });
});

describe('AC-3.2.* — Telegram message placeholder contracts', () => {
  test('NOTIFY.brandOwnerNewRequest substitutes visitor + maestro + slot + contact + intent', () => {
    const placeholders = new Set(
      extractPlaceholders(CONTENT_PANEL.NOTIFY.brandOwnerNewRequest).map((p) => p.slice(1, -1)),
    );
    expect(placeholders).toContain('visitorName');
    expect(placeholders).toContain('maestroName');
    // Brand-owner gets the slot in their OWN tz (AC-3.2.1).
    expect(placeholders).toContain('slotBrandOwnerLocal');
    expect(placeholders).toContain('contactChannel');
    expect(placeholders).toContain('contactValue');
    expect(placeholders).toContain('visitorIntent');
  });

  test('NOTIFY.assignedMaestroNewRequest substitutes visitor + slot-in-maestro-tz + contact + intent', () => {
    const placeholders = new Set(
      extractPlaceholders(CONTENT_PANEL.NOTIFY.assignedMaestroNewRequest).map((p) =>
        p.slice(1, -1),
      ),
    );
    expect(placeholders).toContain('visitorName');
    // Assigned maestro gets the slot in THEIR tz (AC-3.2.2).
    expect(placeholders).toContain('slotMaestroLocal');
    expect(placeholders).toContain('contactChannel');
    expect(placeholders).toContain('contactValue');
    expect(placeholders).toContain('visitorIntent');
    // The message goes TO the maestro — must NOT redundantly name them in
    // their own message.
    expect(placeholders).not.toContain('maestroName');
  });

  test('NOTIFY.maestroOnboardedSuccess substitutes maestroName (AC-3.7.4)', () => {
    expect(CONTENT_PANEL.NOTIFY.maestroOnboardedSuccess).toContain('{maestroName}');
  });

  test('NOTIFY.brandOwnerMaestroOnboardedPing substitutes maestroName (AC-3.7.4)', () => {
    expect(CONTENT_PANEL.NOTIFY.brandOwnerMaestroOnboardedPing).toContain('{maestroName}');
  });
});

describe('AC-3.4.3 — invalidTransition error placeholder contract', () => {
  test('ERRORS.invalidTransition substitutes {from} and {to}', () => {
    expect(CONTENT_PANEL.ERRORS.invalidTransition).toContain('{from}');
    expect(CONTENT_PANEL.ERRORS.invalidTransition).toContain('{to}');
  });
});

describe('AC-3.7.6 — webhook status tooltip placeholder contract', () => {
  test('STATUS.webhook_ok + webhook_broken tooltips substitute {checkedAt}', () => {
    expect(CONTENT_PANEL.STATUS.webhook_ok.tooltipTemplate).toContain('{checkedAt}');
    expect(CONTENT_PANEL.STATUS.webhook_broken.tooltipTemplate).toContain('{checkedAt}');
  });
});

describe('CONTENT_PANEL barrel — surface integration', () => {
  test('the per-pool barrel `@/lib/content` re-exports CONTENT_PANEL via @/lib/content/panel', async () => {
    // Defensive: G_C-1's install-smoke pairing asserts the barrel exists
    // through the scaffold sentinel. This pairing adds a direct check that
    // the CONTENT_PANEL named export round-trips through the barrel surface
    // a consumer would actually use.
    const barrel = await import('@/infrastructure/content');
    expect(barrel).toHaveProperty('CONTENT_PANEL');
    expect((barrel as { CONTENT_PANEL: unknown }).CONTENT_PANEL).toBe(CONTENT_PANEL);
  });
});
