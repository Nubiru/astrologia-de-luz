/**
 * G_A-2 unit pairing — shared brand components render contract.
 *
 * Anchors:
 *   - S-1 §15 G_A-2 row: "Logo + Button (light/dark) + SectionWrapper + Footer".
 *   - AC-1.1.7: wordmark string is "ASTROLOGIA DE LUZ"; "ASTRALUMEN" never appears.
 *   - AC-1.1.3: section bg alternates dark/light via @theme palette tokens.
 *   - O-6 §6 CRITICAL RULING: gold/silver decoration-only on light; ink-bg + white text
 *     for buttons on light; decorative glyphs aria-hidden; touch targets ≥ 44×44.
 *
 * Strategy: render each component to a static HTML string via react-dom/server, then
 * assert structural invariants against the markup. Vitest runs in node env, so we
 * call React.createElement programmatically — no JSX in the test file.
 */

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { Button } from '@/components/brand/Button';
import { Footer } from '@/components/brand/Footer';
import { LOGO_WORDMARK, Logo } from '@/components/brand/Logo';
import { SectionWrapper } from '@/components/brand/SectionWrapper';

const h = React.createElement;

describe('G_A-2 Logo', () => {
  test('renders both variants without throwing', () => {
    const primary = renderToStaticMarkup(h(Logo, { variant: 'primary' }));
    const positive = renderToStaticMarkup(h(Logo, { variant: 'positive' }));
    expect(primary).toContain('data-brand="logo"');
    expect(positive).toContain('data-brand="logo"');
    expect(primary).toContain('data-variant="primary"');
    expect(positive).toContain('data-variant="positive"');
  });

  test('wordmark is "ASTROLOGIA DE LUZ" (AC-1.1.7) and never "ASTRALUMEN"', () => {
    const html = renderToStaticMarkup(h(Logo, { variant: 'positive' }));
    expect(html).toContain(LOGO_WORDMARK);
    expect(html).toBe(html.replace(/ASTRALUMEN/g, '__BLOCKED__'));
    expect(html).not.toContain('ASTRALUMEN');
  });

  test('decorative ring + glyph are aria-hidden (O-6 §6 decoration-only)', () => {
    const html = renderToStaticMarkup(h(Logo, { variant: 'positive' }));
    // Post-G_A-16: the legacy <span data-brand="logo-mark">☽</span> ornament
    // was migrated to <CrescentRing>, which wraps an SVG glyph in a
    // <span aria-hidden="true" data-brand="crescent-ring">. Same decoration-only
    // contract — only the carrier renamed.
    const markMatch = html.match(/<span[^>]*data-brand="crescent-ring"[^>]*>/);
    expect(markMatch).not.toBeNull();
    expect(markMatch?.[0]).toContain('aria-hidden="true"');
    // The crescent moon is now SVG-vector (resolution-independent) — assert
    // the SVG opener is present and the Unicode ☽ glyph is GONE from the
    // rendered output (per AC-G_A-16.6 no-residual-glyph).
    expect(html).toContain('<svg');
    expect(html).not.toContain('☽');
  });

  test('wordmark is NOT aria-hidden — it is the visible-text equivalent (O-6 §6)', () => {
    const html = renderToStaticMarkup(h(Logo, { variant: 'positive' }));
    const wordmarkMatch = html.match(/<span[^>]*data-brand="logo-wordmark"[^>]*>[^<]*<\/span>/);
    expect(wordmarkMatch).not.toBeNull();
    expect(wordmarkMatch?.[0]).not.toContain('aria-hidden');
  });

  test('primary variant tints decoration in dorado-imperial (gold-on-dark passes AAA)', () => {
    const html = renderToStaticMarkup(h(Logo, { variant: 'primary' }));
    // Post-G_A-16: CrescentRing's TONE_CLASS gold sets text-dorado-imperial; the
    // SVG uses stroke="currentColor" + fill="currentColor" so the gold flows
    // into the ring + crescent vector. Previously this carried
    // `border-dorado-imperial` on the ☽ wrapper — that border-class is gone
    // (no ring-border in the new SVG), the color invariant survives.
    expect(html).toContain('text-dorado-imperial');
    expect(html).toContain('text-blanco-estelar');
  });

  test('positive variant tints decoration in tinta-nocturna (ink-on-light passes AAA)', () => {
    const html = renderToStaticMarkup(h(Logo, { variant: 'positive' }));
    expect(html).toContain('text-tinta-nocturna');
    // Positive variant MUST NOT tint the wordmark in gold/silver on light bg (AA fail).
    expect(html).not.toMatch(
      /data-brand="logo-wordmark"[^>]*class="[^"]*text-dorado-(imperial|palido)/,
    );
    expect(html).not.toMatch(/data-brand="logo-wordmark"[^>]*class="[^"]*text-plata-(luna|eterea)/);
  });

  test('renders the three documented sizes', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      const html = renderToStaticMarkup(h(Logo, { size }));
      expect(html).toContain('data-brand="logo"');
    }
  });
});

describe('G_A-2 Button', () => {
  test('renders <button> by default with type=button', () => {
    const html = renderToStaticMarkup(h(Button, { children: 'Reservar sesión' }));
    expect(html).toMatch(/^<button[\s\S]*<\/button>$/);
    expect(html).toContain('type="button"');
    expect(html).toContain('Reservar sesión');
  });

  test('renders <a> when href is provided (link-as-button)', () => {
    const html = renderToStaticMarkup(h(Button, { href: '/reservar', children: 'Reservar' }));
    expect(html).toMatch(/^<a[\s\S]*<\/a>$/);
    expect(html).toContain('href="/reservar"');
    expect(html).not.toContain('<button');
  });

  test('dark variant uses ink-bg + blanco-estelar text (O-6 §6: ink-on-light = AAA)', () => {
    const html = renderToStaticMarkup(h(Button, { variant: 'dark', children: 'CTA' }));
    expect(html).toContain('bg-tinta-nocturna');
    expect(html).toContain('text-blanco-estelar');
    // O-6 §6 forbids gold-bg on a button used on light bg (would invert to ~2:1).
    expect(html).not.toMatch(/class="[^"]*bg-dorado-(imperial|palido)/);
  });

  test('light variant uses blanco-estelar bg + ink text (sits on dark sections, AAA)', () => {
    const html = renderToStaticMarkup(h(Button, { variant: 'light', children: 'CTA' }));
    expect(html).toContain('bg-blanco-estelar');
    expect(html).toContain('text-tinta-nocturna');
  });

  test('has visible focus ring via focus-visible classes (no removed default)', () => {
    const html = renderToStaticMarkup(h(Button, { children: 'CTA' }));
    expect(html).toMatch(/focus-visible:outline-2/);
    expect(html).toMatch(/focus-visible:outline-offset-2/);
    expect(html).toContain('focus-visible:outline-dorado-imperial');
  });

  test('min touch target is at least 44×44 (min-h-11 = 44px) per O-6 §G', () => {
    const md = renderToStaticMarkup(h(Button, { size: 'md', children: 'CTA' }));
    const lg = renderToStaticMarkup(h(Button, { size: 'lg', children: 'CTA' }));
    expect(md).toMatch(/min-h-11/);
    expect(lg).toMatch(/min-h-12/);
  });

  test('forwards aria-label and disabled to the <button> element', () => {
    const html = renderToStaticMarkup(
      h(Button, {
        'aria-label': 'Enviar solicitud',
        disabled: true,
        children: 'Enviar',
      } as React.ComponentProps<typeof Button>),
    );
    expect(html).toContain('aria-label="Enviar solicitud"');
    expect(html).toContain('disabled');
  });
});

describe('G_A-2 SectionWrapper', () => {
  test('renders a <section> with the supplied id', () => {
    const html = renderToStaticMarkup(
      h(SectionWrapper, { id: 'hero', tone: 'dark', children: 'x' }),
    );
    expect(html).toMatch(/^<section[\s\S]*<\/section>$/);
    expect(html).toContain('id="hero"');
  });

  test('dark tone applies tinta-nocturna bg + blanco-estelar text (AC-1.1.3)', () => {
    const html = renderToStaticMarkup(
      h(SectionWrapper, { id: 's1', tone: 'dark', children: null }),
    );
    expect(html).toContain('bg-tinta-nocturna');
    expect(html).toContain('text-blanco-estelar');
    expect(html).toContain('data-tone="dark"');
  });

  test('light tone applies blanco-estelar bg + tinta-nocturna text (AC-1.1.3)', () => {
    const html = renderToStaticMarkup(
      h(SectionWrapper, { id: 's2', tone: 'light', children: null }),
    );
    expect(html).toContain('bg-blanco-estelar');
    expect(html).toContain('text-tinta-nocturna');
    expect(html).toContain('data-tone="light"');
  });

  test('forwards ariaLabelledby to the section element', () => {
    const html = renderToStaticMarkup(
      h(SectionWrapper, {
        id: 'sobre',
        tone: 'light',
        ariaLabelledby: 'sobre-h2',
        children: null,
      }),
    );
    expect(html).toContain('aria-labelledby="sobre-h2"');
  });

  test('renders provided children inside the centered inner div', () => {
    const html = renderToStaticMarkup(
      h(SectionWrapper, { id: 's3', tone: 'dark' }, h('p', { 'data-marker': 'child' }, 'Inside')),
    );
    expect(html).toContain('data-marker="child"');
    expect(html).toContain('Inside');
    expect(html).toContain('max-w-5xl');
  });
});

describe('G_A-2 Footer', () => {
  test('renders a <footer> with dark tinta-nocturna bg', () => {
    const html = renderToStaticMarkup(h(Footer));
    expect(html).toMatch(/^<footer[\s\S]*<\/footer>$/);
    expect(html).toContain('bg-tinta-nocturna');
    expect(html).toContain('text-blanco-estelar');
  });

  test('contains the brand wordmark via embedded Logo', () => {
    const html = renderToStaticMarkup(h(Footer));
    expect(html).toContain(LOGO_WORDMARK);
    expect(html).toContain('data-brand="logo"');
    expect(html).toContain('data-variant="primary"');
  });

  test('renders a © year line', () => {
    const html = renderToStaticMarkup(h(Footer, { year: 2026 }));
    expect(html).toMatch(/©\s*2026/);
  });

  test('defaults the year to the current calendar year', () => {
    const html = renderToStaticMarkup(h(Footer));
    const current = new Date().getFullYear();
    expect(html).toContain(String(current));
  });
});
