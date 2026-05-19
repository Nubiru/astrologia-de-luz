/**
 * G_A-10 CI pairing — AC-1.7.6 desktop Lighthouse floor lock.
 *
 * Fails when:
 *   - `lighthouserc.desktop.json` drops or weakens any of the 4 category
 *     thresholds (Perf < 0.90, A11y < 0.95, SEO < 0.95, BP < 0.90).
 *   - The desktop preset config drops `preset: "desktop"` (would silently
 *     grade against mobile and pass an under-spec build).
 *
 * Workflow shape + URL targeting are covered by the mobile pairing; this
 * spec scopes itself to desktop-only deltas to keep failure messages
 * surgically pointed at the broken half.
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
        preset?: string;
        onlyCategories?: readonly string[];
      };
    };
    assert: {
      assertions: Record<string, LighthouseAssertion>;
    };
  };
}

describe('AC-1.7.6 — desktop Lighthouse floor', () => {
  const cfg = JSON.parse(read('lighthouserc.desktop.json')) as LighthouseConfig;
  const assertions = cfg.ci.assert.assertions;

  describe('lighthouserc.desktop.json — category floors', () => {
    test('performance ≥ 0.90 (error level)', () => {
      const a = assertions['categories:performance'];
      expect(a?.[0]).toBe('error');
      expect(a?.[1]?.minScore).toBe(0.9);
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

  describe('lighthouserc.desktop.json — collect settings', () => {
    test('uses the desktop preset', () => {
      expect(cfg.ci.collect.settings.preset).toBe('desktop');
    });

    test('audits only the 4 floor-gated categories', () => {
      const cats = cfg.ci.collect.settings.onlyCategories ?? [];
      expect(new Set(cats)).toEqual(
        new Set(['performance', 'accessibility', 'seo', 'best-practices']),
      );
    });
  });
});
