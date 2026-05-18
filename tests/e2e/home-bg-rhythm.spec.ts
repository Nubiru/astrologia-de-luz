/**
 * G_A-6 e2e pairing — home page alternating dark/light background rhythm.
 *
 * Anchors:
 *   - AC-1.1.3: background alternates dark → light → dark → light → dark →
 *     light → dark → footer-dark, computed as ink (`#1A1A22`) for dark and
 *     blanco-estelar (`#FDFCFA`) for light.
 *
 * Runtime: Playwright. Computed-style assertions require a real browser, so
 * this spec lives in `tests/e2e/**` and runs via `npm run test:e2e` — same
 * deferred-runtime pattern as G_A-5's home-s2-s3-ctas spec.
 */

import { expect, test } from '@playwright/test';

const EXPECTED_TONES: ReadonlyArray<{ id: string; tone: 'dark' | 'light' }> = [
  { id: 'hero', tone: 'dark' },
  { id: 'problemas', tone: 'light' },
  { id: 'servicios', tone: 'dark' },
  { id: 'sobre', tone: 'light' },
  { id: 'testimonios', tone: 'dark' },
  { id: 'faq', tone: 'light' },
  { id: 'cta-final', tone: 'dark' },
];

// IDENTITY.md palette — Tailwind 4 resolves --color-tinta-nocturna / --color-
// blanco-estelar to these literals at build time. Playwright reads the
// computed background-color in `rgb(...)` form; the helpers below
// normalize both sides for the comparison.
const INK = { r: 0x1a, g: 0x1a, b: 0x22 };
const BLANCO_ESTELAR = { r: 0xfd, g: 0xfc, b: 0xfa };

function rgbToTuple(s: string): { r: number; g: number; b: number } | null {
  const m = s.match(/rgb\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

test.describe('G_A-6 background-color alternation — AC-1.1.3', () => {
  test('each section declares the expected data-tone attribute', async ({ page }) => {
    await page.goto('/');
    for (const { id, tone } of EXPECTED_TONES) {
      const attr = await page.locator(`section#${id}`).getAttribute('data-tone');
      expect(attr, `#${id} data-tone`).toBe(tone);
    }
  });

  test('each section has the computed background matching its declared tone', async ({ page }) => {
    await page.goto('/');
    for (const { id, tone } of EXPECTED_TONES) {
      const bg = await page
        .locator(`section#${id}`)
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      const parsed = rgbToTuple(bg);
      expect(parsed, `#${id} background-color unparseable: ${bg}`).not.toBeNull();
      const expected = tone === 'dark' ? INK : BLANCO_ESTELAR;
      expect(parsed).toEqual(expected);
    }
  });

  test('adjacent sections never share a tone (alternation guard)', async ({ page }) => {
    await page.goto('/');
    const tones = await page
      .locator('section')
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).getAttribute('data-tone')));
    for (let i = 1; i < tones.length; i++) {
      expect(tones[i], `tone[${i}]="${tones[i]}" matches previous "${tones[i - 1]}"`).not.toBe(
        tones[i - 1],
      );
    }
  });

  test('footer closes the rhythm on dark (matches the documented dark-light-dark cadence)', async ({
    page,
  }) => {
    await page.goto('/');
    const bg = await page.locator('footer').evaluate((el) => getComputedStyle(el).backgroundColor);
    const parsed = rgbToTuple(bg);
    expect(parsed).toEqual(INK);
  });
});
