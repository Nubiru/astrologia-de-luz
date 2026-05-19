/**
 * G_A-16 pairing — <CrescentRing> SVG primitive + 3-callsite migration
 * (AC-G_A-16.1, AC-G_A-16.2, AC-G_A-16.3, AC-G_A-16.4, AC-G_A-16.5,
 * AC-G_A-16.6).
 *
 * Fails when:
 *   - The component drops aria-hidden, data-brand, or one of the two SVG
 *     shape primitives (<circle> ring + <path> crescent glyph).
 *   - Any size variant (sm/md/lg/xl) stops emitting its expected
 *     h-N w-N pair (Tailwind dimensions baked into SIZE_CLASS).
 *   - The tone prop stops controlling currentColor via TONE_CLASS
 *     (text-dorado-imperial / text-tinta-nocturna).
 *   - Any of the 3 callsites (Hero / CtaFinal / Logo) regresses to the
 *     legacy `<span>☽</span>` ornament shape.
 *
 * Renders via react-dom/server.renderToStaticMarkup — same node-only
 * pattern as G_A-13 and G_A-15 (no jsdom dep).
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { CrescentRing } from '@/components/brand/CrescentRing';
import { Logo } from '@/components/brand/Logo';
import { CtaFinal } from '@/components/sections/CtaFinal';
import { Hero } from '@/components/sections/Hero';

const SIZE_DIMENSIONS = [
  { size: 'sm', h: 'h-8', w: 'w-8' },
  { size: 'md', h: 'h-12', w: 'w-12' },
  { size: 'lg', h: 'h-16', w: 'w-16' },
  { size: 'xl', h: 'h-24', w: 'w-24' },
] as const;

describe('AC-G_A-16.1 + AC-G_A-16.2 — CrescentRing component contract', () => {
  test('renders <span aria-hidden="true" data-brand="crescent-ring"> with one <svg> child', () => {
    const html = renderToStaticMarkup(createElement(CrescentRing, { size: 'md' }));
    expect(html).toMatch(/^<span\b[^>]*\baria-hidden="true"/);
    expect(html).toMatch(/<span[^>]*data-brand="crescent-ring"/);
    expect(html).toContain('<svg');
    expect(html).toContain('</svg>');
  });

  test('SVG contains exactly one <circle> ring and one <path> crescent glyph', () => {
    const html = renderToStaticMarkup(createElement(CrescentRing, { size: 'lg' }));
    const circleMatches = html.match(/<circle\b/g) ?? [];
    const pathMatches = html.match(/<path\b/g) ?? [];
    expect(circleMatches.length).toBe(1);
    expect(pathMatches.length).toBe(1);
  });

  test('defaults tone to gold (text-dorado-imperial) when prop omitted', () => {
    const html = renderToStaticMarkup(createElement(CrescentRing, { size: 'md' }));
    expect(html).toContain('text-dorado-imperial');
    expect(html).not.toContain('text-tinta-nocturna');
  });

  test('tone="ink" tints currentColor to tinta-nocturna', () => {
    const html = renderToStaticMarkup(createElement(CrescentRing, { size: 'md', tone: 'ink' }));
    expect(html).toContain('text-tinta-nocturna');
    expect(html).not.toContain('text-dorado-imperial');
  });

  test.each(SIZE_DIMENSIONS)('size="$size" emits $h $w classes', ({ size, h, w }) => {
    const html = renderToStaticMarkup(createElement(CrescentRing, { size }));
    expect(html).toMatch(new RegExp(`\\b${h}\\b`));
    expect(html).toMatch(new RegExp(`\\b${w}\\b`));
  });
});

describe('AC-G_A-16.3 — Hero ornament migrated to <CrescentRing size="xl" tone="gold" />', () => {
  const html = renderToStaticMarkup(createElement(Hero));

  test('Hero renders exactly one CrescentRing (data-brand="crescent-ring")', () => {
    const matches = html.match(/data-brand="crescent-ring"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  test('Hero CrescentRing is at xl size + gold tone', () => {
    expect(html).toMatch(/data-brand="crescent-ring"[^>]*data-tone="gold"/);
    expect(html).toMatch(/data-brand="crescent-ring"[^>]*data-size="xl"/);
  });

  test('Hero no longer contains the legacy ☽ glyph or hero-ornament span', () => {
    expect(html).not.toContain('☽');
    expect(html).not.toContain('data-brand="hero-ornament"');
  });
});

describe('AC-G_A-16.4 — CtaFinal ornament migrated to <CrescentRing size="md" tone="gold" />', () => {
  const html = renderToStaticMarkup(createElement(CtaFinal));

  test('CtaFinal renders exactly one CrescentRing', () => {
    const matches = html.match(/data-brand="crescent-ring"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  test('CtaFinal CrescentRing is at md size + gold tone', () => {
    expect(html).toMatch(/data-brand="crescent-ring"[^>]*data-tone="gold"/);
    expect(html).toMatch(/data-brand="crescent-ring"[^>]*data-size="md"/);
  });

  test('CtaFinal no longer contains the legacy ☽ glyph or cta-final-ornament span', () => {
    expect(html).not.toContain('☽');
    expect(html).not.toContain('data-brand="cta-final-ornament"');
  });
});

describe('AC-G_A-16.5 — Logo mark migrated to <CrescentRing size={size} tone={isDark ? gold : ink} />', () => {
  test('Logo variant="primary" renders gold-tone CrescentRing (dark-bg context)', () => {
    const html = renderToStaticMarkup(createElement(Logo, { variant: 'primary' }));
    expect(html).toMatch(/data-brand="crescent-ring"[^>]*data-tone="gold"/);
  });

  test('Logo variant="positive" renders ink-tone CrescentRing (light-bg context)', () => {
    const html = renderToStaticMarkup(createElement(Logo, { variant: 'positive' }));
    expect(html).toMatch(/data-brand="crescent-ring"[^>]*data-tone="ink"/);
  });

  test.each(['sm', 'md', 'lg'] as const)(
    'Logo size="%s" propagates to CrescentRing size',
    (size) => {
      const html = renderToStaticMarkup(createElement(Logo, { size }));
      expect(html).toMatch(new RegExp(`data-brand="crescent-ring"[^>]*data-size="${size}"`));
    },
  );

  test('Logo no longer contains the legacy ☽ glyph or logo-mark span', () => {
    const primary = renderToStaticMarkup(createElement(Logo, { variant: 'primary' }));
    const positive = renderToStaticMarkup(createElement(Logo, { variant: 'positive' }));
    expect(primary).not.toContain('☽');
    expect(positive).not.toContain('☽');
    expect(primary).not.toContain('data-brand="logo-mark"');
    expect(positive).not.toContain('data-brand="logo-mark"');
  });
});
