/**
 * G_A-1 pairing — brand-shell tokens smoke.
 *
 * Verifies the foundation pieces that anchor every later pool-a page:
 *   - The 8 palette HEX values from IDENTITY.md "Brand visual system" are
 *     declared as Tailwind 4 @theme tokens in src/app/globals.css.
 *   - The 3 brand fonts (Cinzel / Cormorant Garamond / Jost) are loaded
 *     through next/font/google with display: 'swap' (AC-1.1.8 no FOIT > 100ms).
 *   - The prefers-reduced-motion @media wrapper is present and neutralizes
 *     animation + transition durations (AC-1.7.5).
 *   - tailwind.config.ts content paths cover app/** + lib/**.
 *
 * Assertions are static-text reads — they FAIL when a token is removed, a
 * palette hex drifts, a font loader loses display: 'swap', or the reduced-
 * motion block is gutted.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

// IDENTITY.md "Brand visual system" — 8 palette colors; hex MUST match exactly.
const PALETTE = [
  { name: 'dorado-imperial', hex: '#C9A96E' },
  { name: 'dorado-palido', hex: '#E2C98A' },
  { name: 'plata-luna', hex: '#B8BCC8' },
  { name: 'plata-eterea', hex: '#D6DAE6' },
  { name: 'blanco-estelar', hex: '#FDFCFA' },
  { name: 'tinta-nocturna', hex: '#1A1A22' },
  { name: 'tinta-media', hex: '#2E2E3A' },
  { name: 'tinta-suave', hex: '#5A5A6E' },
] as const;

// IDENTITY.md "Fonts (Google Fonts)" — 3 families loaded via next/font/google.
const FONTS = [
  { loader: 'Cinzel', cssVar: '--font-cinzel' },
  { loader: 'Cormorant_Garamond', cssVar: '--font-cormorant' },
  { loader: 'Jost', cssVar: '--font-jost' },
] as const;

describe('G_A-1 brand-shell tokens', () => {
  describe('src/app/globals.css — Tailwind 4 entry point', () => {
    const css = read('src/app/globals.css');

    test('imports the Tailwind 4 CSS engine', () => {
      expect(css).toMatch(/@import\s+["']tailwindcss["']/);
    });

    test('declares a @theme block (Tailwind 4 token namespace)', () => {
      expect(css).toMatch(/@theme\s*\{/);
    });
  });

  describe('src/app/globals.css — palette @theme tokens (IDENTITY.md)', () => {
    const css = read('src/app/globals.css');

    test.each(PALETTE)('--color-$name resolves to $hex', ({ name, hex }) => {
      const re = new RegExp(`--color-${name}\\s*:\\s*${hex}\\s*;`, 'i');
      expect(css).toMatch(re);
    });

    test('exactly 8 palette tokens declared (no silent additions, no missing)', () => {
      const colorTokens = css.match(/--color-[a-z-]+\s*:\s*#[0-9A-Fa-f]{3,8}\s*;/g) || [];
      expect(colorTokens).toHaveLength(PALETTE.length);
    });
  });

  describe('src/app/globals.css — font CSS variable wiring', () => {
    const css = read('src/app/globals.css');

    test.each(FONTS)('font alias references $cssVar', ({ cssVar }) => {
      expect(css).toContain(cssVar);
    });

    test('declares semantic font roles: display, editorial, body', () => {
      expect(css).toMatch(/--font-display\s*:/);
      expect(css).toMatch(/--font-editorial\s*:/);
      expect(css).toMatch(/--font-body\s*:/);
    });
  });

  describe('src/app/globals.css — prefers-reduced-motion @media wrapper (AC-1.7.5)', () => {
    const css = read('src/app/globals.css');

    test('declares @media (prefers-reduced-motion: reduce) block', () => {
      expect(css).toMatch(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/);
    });

    test('short-circuits animation + transition durations inside the block', () => {
      const idx = css.search(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/);
      expect(idx).toBeGreaterThan(-1);
      const after = css.slice(idx);
      expect(after).toMatch(/animation-duration\s*:\s*0\.01ms/);
      expect(after).toMatch(/transition-duration\s*:\s*0\.01ms/);
      expect(after).toMatch(/scroll-behavior\s*:\s*auto/);
    });
  });

  describe('src/app/fonts.ts — next/font/google loaders (AC-1.1.8)', () => {
    const fonts = read('src/app/fonts.ts');

    test('imports from next/font/google', () => {
      expect(fonts).toMatch(/from\s+['"]next\/font\/google['"]/);
    });

    test.each(FONTS)('imports the $loader loader', ({ loader }) => {
      const re = new RegExp(`\\b${loader}\\b`);
      expect(fonts).toMatch(re);
    });

    test.each(FONTS)('binds $loader to CSS variable $cssVar', ({ cssVar }) => {
      const re = new RegExp(`variable\\s*:\\s*['"]${cssVar.replace(/-/g, '\\-')}['"]`);
      expect(fonts).toMatch(re);
    });

    test('every font loader uses font-display swap (no FOIT > 100ms)', () => {
      const callCount = (fonts.match(/\b(Cinzel|Cormorant_Garamond|Jost)\s*\(/g) || []).length;
      const swapCount = (fonts.match(/display\s*:\s*['"]swap['"]/g) || []).length;
      expect(callCount).toBe(FONTS.length);
      expect(swapCount).toBe(FONTS.length);
    });
  });

  describe('tailwind.config.ts — content scan paths', () => {
    test('file exists at repo root', () => {
      expect(existsSync(resolve(ROOT, 'tailwind.config.ts'))).toBe(true);
    });

    test('content array covers app/** + lib/**', () => {
      const tw = read('tailwind.config.ts');
      expect(tw).toMatch(/\.\/app\/\*\*\/\*\.\{ts,tsx\}/);
      expect(tw).toMatch(/\.\/lib\/\*\*\/\*\.\{ts,tsx\}/);
    });
  });
});
