/**
 * G_A-3 unit pairing — sitemap.ts + robots.ts content contract.
 *
 * Anchors:
 *   - S-1 §1 routes locked table — public surface is exactly `/` + `/reservar`
 *     for v1.0. Panel routes (`/panel/*`) are auth-gated; excluded from
 *     sitemap + listed under robots' Disallow.
 *   - G-1.9 / AC-1.7.* SEO floor — sitemap.xml + robots.txt must materially
 *     exist when v1.0 ships.
 *
 * The default exports of sitemap.ts and robots.ts read process.env.AUTH_URL.
 * Test surface uses the pure factories (`buildSitemap` / `buildRobots`) — the
 * defaults run-time path is exercised in production by Next at request time.
 *
 * Vitest's default CSS handling no-ops `import './globals.css'` and we mock
 * `@/app/fonts` because robots.ts + sitemap.ts transitively import
 * `app/layout.tsx` for the SITE_ORIGIN_FALLBACK constant — without the mock,
 * layout.tsx's chain pulls `next/font/google` which is build-time-only.
 */

import { describe, expect, test, vi } from 'vitest';

vi.mock('@/app/fonts', () => ({
  brandFontVariables: '__test-font-vars__',
}));

import { ROBOTS_ALLOW, ROBOTS_DISALLOW, buildRobots } from '@/app/robots';
import { SITEMAP_ENTRIES, buildSitemap } from '@/app/sitemap';

const BASE = 'https://astrologiadeluz.test';
const FIXED_DATE = new Date('2026-05-18T10:00:00Z');

describe('G_A-3 sitemap — public v1.0 surface only', () => {
  test('SITEMAP_ENTRIES lists exactly the two v1.0 public routes (/, /reservar)', () => {
    const paths = SITEMAP_ENTRIES.map((e) => e.path);
    expect(paths).toEqual(['/', '/reservar']);
  });

  test('SITEMAP_ENTRIES never includes panel or api routes', () => {
    for (const { path } of SITEMAP_ENTRIES) {
      expect(path).not.toMatch(/^\/panel/);
      expect(path).not.toMatch(/^\/api/);
    }
  });

  test('buildSitemap returns one entry per SITEMAP_ENTRIES with absolute URLs', () => {
    const out = buildSitemap(BASE, FIXED_DATE);
    expect(out).toHaveLength(SITEMAP_ENTRIES.length);
    expect(out.map((e) => e.url)).toEqual([
      'https://astrologiadeluz.test',
      'https://astrologiadeluz.test/reservar',
    ]);
  });

  test('buildSitemap strips trailing slash from the base (idempotent)', () => {
    const out = buildSitemap(`${BASE}//`, FIXED_DATE);
    expect(out[0]?.url).toBe(BASE);
    expect(out[1]?.url).toBe(`${BASE}/reservar`);
  });

  test('home priority = 1.0 (entry point) and /reservar = 0.8 (converting surface)', () => {
    const out = buildSitemap(BASE, FIXED_DATE);
    expect(out[0]?.priority).toBe(1.0);
    expect(out[1]?.priority).toBe(0.8);
  });

  test('every entry exposes lastModified + changeFrequency', () => {
    const out = buildSitemap(BASE, FIXED_DATE);
    for (const entry of out) {
      expect(entry.lastModified).toEqual(FIXED_DATE);
      expect(entry.changeFrequency).toBe('monthly');
    }
  });
});

describe('G_A-3 robots — panel routes blocked, public allowed', () => {
  test('ROBOTS_DISALLOW lists every auth-gated and API surface', () => {
    expect(ROBOTS_DISALLOW).toContain('/panel');
    expect(ROBOTS_DISALLOW).toContain('/panel/');
    expect(ROBOTS_DISALLOW).toContain('/api/');
  });

  test('ROBOTS_ALLOW is rooted at "/" so crawlers index the public surface', () => {
    expect(ROBOTS_ALLOW).toContain('/');
  });

  test('buildRobots returns a single-rule policy with userAgent="*"', () => {
    const out = buildRobots(BASE);
    expect(Array.isArray(out.rules)).toBe(true);
    const rules = out.rules as Array<{ userAgent?: string; allow?: string[]; disallow?: string[] }>;
    expect(rules).toHaveLength(1);
    expect(rules[0]?.userAgent).toBe('*');
  });

  test('buildRobots wires Allow/Disallow from the named constants', () => {
    const out = buildRobots(BASE);
    const rules = out.rules as Array<{ allow?: string[]; disallow?: string[] }>;
    expect(rules[0]?.allow).toEqual([...ROBOTS_ALLOW]);
    expect(rules[0]?.disallow).toEqual([...ROBOTS_DISALLOW]);
  });

  test('buildRobots emits an absolute sitemap URL on the same origin', () => {
    const out = buildRobots(BASE);
    expect(out.sitemap).toBe(`${BASE}/sitemap.xml`);
  });

  test('buildRobots strips trailing slash from the base origin', () => {
    const out = buildRobots(`${BASE}/`);
    expect(out.sitemap).toBe(`${BASE}/sitemap.xml`);
    expect(out.host).toBe(BASE);
  });

  test('buildRobots emits a host = origin (canonical-host hint for crawlers)', () => {
    const out = buildRobots(BASE);
    expect(out.host).toBe(BASE);
  });
});

describe('G_A-3 robots vs sitemap — non-conflicting policy', () => {
  test('no sitemap entry sits under a robots-Disallow prefix', () => {
    for (const { path } of SITEMAP_ENTRIES) {
      for (const banned of ROBOTS_DISALLOW) {
        // Disallow `/panel` is meant to match `/panel`, `/panel/agenda`, etc.
        // A sitemap path under that prefix would be a contradiction.
        expect(
          path.startsWith(banned.replace(/\/+$/, '')),
          `Sitemap path "${path}" must not start with Disallow "${banned}"`,
        ).toBe(false);
      }
    }
  });
});
