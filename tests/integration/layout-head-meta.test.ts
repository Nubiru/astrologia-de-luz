/**
 * G_A-3 integration pairing — root layout + <head> metadata contract.
 *
 * Anchors:
 *   - AC-1.1.1: <html lang="es">
 *   - AC-1.1.8: Cinzel / Cormorant Garamond / Jost loaded with display:swap.
 *     G_A-1's `app/fonts.ts` already wires this via next/font/google; this
 *     pairing asserts the layout binds `brandFontVariables` onto the <html>.
 *   - AC-1.7.1: title.default + title.template + description ≤ 155 chars.
 *   - AC-1.7.2: OpenGraph (type=website / siteName / locale=es_ES / og-default.jpg)
 *     + Twitter card (summary_large_image).
 *   - AC-1.7.3: alternates.canonical declared so every page's canonical resolves.
 *
 * Strategy: `app/fonts.ts` calls `Cinzel(...)` / `Cormorant_Garamond(...)` /
 * `Jost(...)` at module-eval — Next's compiler rewrites those at build time,
 * but in vitest's bare-node loader they would try to hit Google's network. We
 * mock `@/app/fonts` so the layout module loads cleanly; the actual fonts.ts
 * wiring is covered by G_A-1's css-tokens pairing. `app/layout.tsx`'s
 * `import './globals.css'` is no-op'd by vitest's default CSS handling.
 */

import { describe, expect, test, vi } from 'vitest';

vi.mock('@/app/fonts', () => ({
  brandFontVariables: '__test-font-vars__',
}));

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import RootLayout, {
  HOME_TITLE_DEFAULT,
  OG_DEFAULT_IMAGE,
  SITE_DESCRIPTION,
  SITE_ORIGIN_FALLBACK,
  TITLE_TEMPLATE,
  buildBaseMetadata,
  metadata,
} from '@/app/layout';

const h = React.createElement;
const SAMPLE_BASE = 'https://example.test';

describe('G_A-3 layout — RootLayout renders <html lang="es">', () => {
  test('emits <html lang="es"> as the root element (AC-1.1.1)', () => {
    const html = renderToStaticMarkup(
      h(RootLayout, null, h('main', { 'data-testid': 'page' }, 'body')),
    );
    expect(html).toMatch(/^<html\b[^>]*\blang="es"/);
  });

  test('binds brandFontVariables to the <html> className (AC-1.1.8)', () => {
    const html = renderToStaticMarkup(h(RootLayout, null, h('div', null, 'x')));
    expect(html).toContain('class="__test-font-vars__"');
  });

  test('renders children inside <body>', () => {
    const html = renderToStaticMarkup(
      h(RootLayout, null, h('main', { 'data-testid': 'inner' }, 'Hola')),
    );
    expect(html).toContain('<body>');
    expect(html).toContain('data-testid="inner"');
    expect(html).toContain('Hola');
  });
});

describe('G_A-3 buildBaseMetadata — pure factory shape', () => {
  const md = buildBaseMetadata(SAMPLE_BASE);

  test('AC-1.7.1: title.default is the spec-verbatim home title', () => {
    expect(HOME_TITLE_DEFAULT).toBe('Astrologia de Luz — Claridad para tus próximos pasos');
    expect(md.title).toMatchObject({ default: HOME_TITLE_DEFAULT });
  });

  test('AC-1.7.1: title.template composes per-page titles', () => {
    expect(TITLE_TEMPLATE).toContain('%s');
    expect(md.title).toMatchObject({ template: TITLE_TEMPLATE });
  });

  test('AC-1.7.1: description present and ≤ 155 chars', () => {
    expect(md.description).toBe(SITE_DESCRIPTION);
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(155);
    expect(SITE_DESCRIPTION.length).toBeGreaterThan(0);
  });

  test('AC-1.7.2: OpenGraph type=website / siteName / locale=es_ES / og-default.jpg', () => {
    expect(md.openGraph).toMatchObject({
      type: 'website',
      siteName: 'Astrologia de Luz',
      locale: 'es_ES',
    });
    const ogImages = md.openGraph?.images as Array<{
      url: string;
      width?: number;
      height?: number;
    }>;
    expect(Array.isArray(ogImages)).toBe(true);
    expect(ogImages[0]?.url).toBe(OG_DEFAULT_IMAGE);
    expect(ogImages[0]?.width).toBe(1200);
    expect(ogImages[0]?.height).toBe(630);
  });

  test('AC-1.7.2: Twitter card = summary_large_image with image set', () => {
    expect(md.twitter).toMatchObject({ card: 'summary_large_image' });
    const twImages = md.twitter?.images as string[];
    expect(twImages).toContain(OG_DEFAULT_IMAGE);
  });

  test('AC-1.7.3: alternates.canonical = "/" (per-page canonicals override)', () => {
    expect(md.alternates).toMatchObject({ canonical: '/' });
  });

  test('metadataBase resolves to the supplied origin (the URL Next composes against)', () => {
    expect(md.metadataBase).toBeInstanceOf(URL);
    expect((md.metadataBase as URL).origin).toBe(SAMPLE_BASE);
  });

  test('robots = index+follow (panel routes get a separate Disallow via robots.ts)', () => {
    expect(md.robots).toMatchObject({ index: true, follow: true });
  });

  test('icon hooks set (favicon + apple-touch-icon)', () => {
    expect(md.icons).toMatchObject({ icon: '/favicon.ico', apple: '/apple-touch-icon.png' });
  });
});

describe('G_A-3 module-level metadata constant', () => {
  test('metadata is built from the documented SITE_ORIGIN fallback when AUTH_URL is unset at module load', () => {
    // The constant was evaluated at module-eval time. Either AUTH_URL was set
    // (and that origin shows up) or the SITE_ORIGIN_FALLBACK kicked in. Either
    // is a valid v1.0 origin; both must produce a real URL with no trailing slash.
    expect(metadata.metadataBase).toBeInstanceOf(URL);
    const origin = (metadata.metadataBase as URL).origin;
    const isAuthUrl = origin === (process.env.AUTH_URL ?? '').replace(/\/+$/, '');
    const isFallback = origin === SITE_ORIGIN_FALLBACK;
    expect(isAuthUrl || isFallback).toBe(true);
  });

  test('fallback constant is the brand domain (HTTPS)', () => {
    expect(SITE_ORIGIN_FALLBACK).toBe('https://astrologiadeluz.com');
  });
});
