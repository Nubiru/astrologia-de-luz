/**
 * G_C-1 pairing — toolchain foundation smoke.
 *
 * Verifies the bootstrap artifacts that gate the entire BUILD phase exist and
 * are internally consistent. These assertions FAIL when:
 *   - A required dependency is missing from package.json (silent install of a
 *     half-stack).
 *   - The .npmrc has been "cleaned up" by a future contributor who didn't read
 *     the citation comment, dropping legacy-peer-deps and breaking npm ci.
 *   - The lib/content barrel cannot resolve all three section files, breaking
 *     `npm run build` for every downstream pool task.
 *
 * The full integration verification (`npm ci` + `npm run build` in a clean CI
 * runner) is asserted at the GitHub Actions / Vercel layer — see
 * S-1 AC-2.3.4 + G_C-1 row in the spec.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

import * as content from '@/infrastructure/content';

const ROOT = resolve(__dirname, '..', '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

const REQUIRED_RUNTIME_DEPS = [
  'next',
  'react',
  'react-dom',
  'next-auth',
  '@auth/drizzle-adapter',
  'drizzle-orm',
  '@libsql/client',
  'resend',
  'zod',
  'date-fns-tz',
];

const REQUIRED_DEV_DEPS = [
  '@biomejs/biome',
  '@playwright/test',
  'drizzle-kit',
  'tailwindcss',
  '@tailwindcss/postcss',
  'typescript',
  'vitest',
];

describe('G_C-1 toolchain foundation', () => {
  describe('.npmrc — R-11 legacy-peer-deps pin (next-auth #13302)', () => {
    const npmrc = read('.npmrc');

    test('contains legacy-peer-deps=true', () => {
      expect(npmrc).toMatch(/^\s*legacy-peer-deps\s*=\s*true\s*$/m);
    });

    test('cites next-auth issue #13302 so the flag is not stripped accidentally', () => {
      expect(npmrc).toContain('13302');
    });
  });

  describe('package.json — locked stack per IDENTITY.md', () => {
    const pkg = JSON.parse(read('package.json')) as {
      name: string;
      type?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    test('package name is the project slug', () => {
      expect(pkg.name).toBe('astrologia-de-luz');
    });

    test('uses ESM module type for Next 16 + React 19', () => {
      expect(pkg.type).toBe('module');
    });

    test.each(REQUIRED_RUNTIME_DEPS)('declares runtime dependency %s', (dep) => {
      expect(pkg.dependencies).toBeDefined();
      expect(pkg.dependencies?.[dep]).toBeTruthy();
    });

    test.each(REQUIRED_DEV_DEPS)('declares dev dependency %s', (dep) => {
      expect(pkg.devDependencies).toBeDefined();
      expect(pkg.devDependencies?.[dep]).toBeTruthy();
    });

    test.each([
      ['dev', 'next dev'],
      ['build', 'next build'],
      ['lint', 'biome'],
      ['typecheck', 'tsc'],
      ['test', 'vitest'],
      ['test:e2e', 'playwright'],
    ])('script %s invokes %s', (name, fragment) => {
      expect(pkg.scripts?.[name]).toBeDefined();
      expect(pkg.scripts?.[name]).toContain(fragment);
    });
  });

  describe('tsconfig.json — strict TS for Next 16', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions?: Record<string, unknown>;
    };

    test('strict mode is enabled', () => {
      expect(ts.compilerOptions?.strict).toBe(true);
    });

    test('@/* path alias maps to ./src/* (post-G_C-35 cleanup-CP — was ./* during waves 1-4)', () => {
      const paths = ts.compilerOptions?.paths as Record<string, string[]> | undefined;
      expect(paths?.['@/*']).toEqual(['./src/*']);
    });

    test('Next.js TS plugin is wired', () => {
      const plugins = ts.compilerOptions?.plugins as Array<{ name: string }> | undefined;
      expect(plugins?.some((p) => p.name === 'next')).toBe(true);
    });
  });

  describe('biome.json — formatter + linter', () => {
    const biome = JSON.parse(read('biome.json')) as {
      formatter?: { enabled?: boolean };
      linter?: { enabled?: boolean };
    };

    test('formatter is enabled', () => {
      expect(biome.formatter?.enabled).toBe(true);
    });

    test('linter is enabled', () => {
      expect(biome.linter?.enabled).toBe(true);
    });
  });

  describe('vitest + playwright config files exist', () => {
    test('vitest.config.ts present at repo root', () => {
      expect(existsSync(resolve(ROOT, 'vitest.config.ts'))).toBe(true);
    });

    test('playwright.config.ts present at repo root', () => {
      expect(existsSync(resolve(ROOT, 'playwright.config.ts'))).toBe(true);
    });
  });

  describe('lib/content barrel resolves all 3 section files (§15.1)', () => {
    test('public scaffold export is reachable through @/lib/content', () => {
      expect((content as Record<string, unknown>).__CONTENT_PUBLIC_SCAFFOLD).toBe(true);
    });

    test('panel scaffold export is reachable through @/lib/content', () => {
      expect((content as Record<string, unknown>).__CONTENT_PANEL_SCAFFOLD).toBe(true);
    });

    test('email scaffold export is reachable through @/lib/content', () => {
      expect((content as Record<string, unknown>).__CONTENT_EMAIL_SCAFFOLD).toBe(true);
    });
  });
});
