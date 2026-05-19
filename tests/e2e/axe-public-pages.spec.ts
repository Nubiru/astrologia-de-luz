/**
 * G_A-10 e2e deliverable — AC-1.7.4 Axe-core a11y sweep on the 2 public pages.
 *
 * Asserts 0 WCAG 2.1 AA violations on `/` and `/reservar`, the only public
 * surfaces in v1.0 (panel routes are auth-gated and exempted from the launch
 * a11y gate per AC-1.7.4 — they'll get their own sweep when the panel-shell
 * stabilises in v1.0.1).
 *
 * Anchors:
 *   - AC-1.7.4: WCAG 2.1 AA / 0 violations / axe-playwright integration.
 *   - O-6 §6 CRITICAL RULING — gold/silver decorative text MUST be
 *     `aria-hidden` AND paired with a visible text equivalent; axe's
 *     `color-contrast` rule would surface any leak.
 *
 * Runtime: Playwright. Excluded by vitest (`tests/e2e/**`); runs via
 * `npm run test:e2e` against a Next dev/preview server. The Lighthouse a11y
 * floor (AC-1.7.6, ≥ 0.95) is a second gate at the CI workflow layer — this
 * spec catches violations earlier with full WCAG 2.1 AA tag coverage that
 * Lighthouse's audit subset does not exercise.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PUBLIC_PAGES = [
  { path: '/', label: 'home' },
  { path: '/reservar', label: 'reservar' },
] as const;

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

test.describe('AC-1.7.4 — Axe a11y sweep on public pages', () => {
  for (const { path, label } of PUBLIC_PAGES) {
    test(`${label} (${path}) — 0 WCAG 2.1 AA violations`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();

      const summary = results.violations
        .map((v) => `${v.id} (${v.impact}) — ${v.description} [${v.nodes.length} node(s)]`)
        .join('\n');

      expect(results.violations, `\n${summary}`).toEqual([]);
    });
  }
});
