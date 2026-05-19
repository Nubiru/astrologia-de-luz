/**
 * G_A-10 CI pairing — AC-1.7.6 mobile Lighthouse floor lock.
 *
 * Fails when:
 *   - `lighthouserc.mobile.json` drops or weakens any of the 4 category
 *     thresholds (Perf < 0.85, A11y < 0.95, SEO < 0.95, BP < 0.90).
 *   - The Lighthouse workflow stops including the `mobile` matrix preset.
 *   - The workflow stops targeting `/` and `/reservar` (the only AC-1.7.6
 *     scoped pages).
 *   - The mobile preset config drops the `emulatedFormFactor: mobile` setting
 *     (would silently grade against desktop and pass an under-spec build).
 *
 * Static-walk regression signal for the launch gate. The actual Lighthouse
 * audit runs in GitHub Actions per `.github/workflows/lighthouse.yml`; this
 * pairing locks the thresholds + workflow shape at qa:fast time so drift
 * surfaces at task close rather than during a SHIP attempt.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

type LighthouseAssertion = readonly ['error' | 'warn', { minScore: number }];

interface LighthouseConfig {
  ci: {
    collect: {
      settings: {
        emulatedFormFactor?: string;
        throttlingMethod?: string;
        onlyCategories?: readonly string[];
      };
    };
    assert: {
      assertions: Record<string, LighthouseAssertion>;
    };
  };
}

describe('AC-1.7.6 — mobile Lighthouse floor', () => {
  const cfg = JSON.parse(read('lighthouserc.mobile.json')) as LighthouseConfig;
  const assertions = cfg.ci.assert.assertions;

  describe('lighthouserc.mobile.json — category floors', () => {
    test('performance ≥ 0.85 (error level)', () => {
      const a = assertions['categories:performance'];
      expect(a?.[0]).toBe('error');
      expect(a?.[1]?.minScore).toBe(0.85);
    });

    test('accessibility ≥ 0.95 (error level)', () => {
      const a = assertions['categories:accessibility'];
      expect(a?.[0]).toBe('error');
      expect(a?.[1]?.minScore).toBe(0.95);
    });

    test('seo ≥ 0.95 (error level)', () => {
      const a = assertions['categories:seo'];
      expect(a?.[0]).toBe('error');
      expect(a?.[1]?.minScore).toBe(0.95);
    });

    test('best-practices ≥ 0.90 (error level)', () => {
      const a = assertions['categories:best-practices'];
      expect(a?.[0]).toBe('error');
      expect(a?.[1]?.minScore).toBe(0.9);
    });
  });

  describe('lighthouserc.mobile.json — collect settings', () => {
    test('emulates a mobile form factor', () => {
      expect(cfg.ci.collect.settings.emulatedFormFactor).toBe('mobile');
    });

    test('audits only the 4 floor-gated categories', () => {
      const cats = cfg.ci.collect.settings.onlyCategories ?? [];
      expect(new Set(cats)).toEqual(
        new Set(['performance', 'accessibility', 'seo', 'best-practices']),
      );
    });
  });

  describe('.github/workflows/lighthouse.yml — workflow shape', () => {
    const wf = read('.github/workflows/lighthouse.yml');

    test('includes the mobile matrix preset', () => {
      expect(wf).toMatch(/preset:\s*\[\s*mobile\s*,\s*desktop\s*\]/);
    });

    test('routes each preset to its own lighthouserc.<preset>.json', () => {
      expect(wf).toContain('./lighthouserc.${{ matrix.preset }}.json');
    });

    test('targets / and /reservar on the production URL', () => {
      expect(wf).toContain('https://astrologia-de-luz.vercel.app/');
      expect(wf).toContain('https://astrologia-de-luz.vercel.app/reservar');
    });
  });
});
