/**
 * G_A-13 pairing — <SectionReveal> wrapper presence on the 7 home-page section
 * headings (AC-G_A-13.1, AC-G_A-13.2, AC-G_A-13.3).
 *
 * Fails when:
 *   - SectionReveal.tsx gains a `'use client'` directive (would break the
 *     "Server Component, zero hydration cost" contract from O-12 §5 Pattern 2).
 *   - Any of the 7 section H1/H2 headings stop being wrapped by the
 *     `data-reveal="fade-up"` div (regression on the conservative-scope reveal).
 *   - <SectionReveal> stops emitting the literal `data-reveal="fade-up"`
 *     attribute (the CSS substrate at globals.css keyed on this selector would
 *     silently no-op without the attribute).
 *
 * Uses react-dom/server.renderToStaticMarkup (synchronous SSR string) so no
 * jsdom or @testing-library dependency is needed; vitest's node environment is
 * sufficient. The visual behaviour (prefers-reduced-motion, Firefox @supports
 * fallback, scroll-driven animation-timeline) is verified at ALPHA A-1, not
 * here — per AC-G_A-13.5 this pairing is structural only.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ComponentType, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { SectionReveal } from '@/components/brand/SectionReveal';
import { CtaFinal } from '@/components/sections/CtaFinal';
import { Faq } from '@/components/sections/Faq';
import { Hero } from '@/components/sections/Hero';
import { Problemas } from '@/components/sections/Problemas';
import { Servicios } from '@/components/sections/Servicios';
import { Sobre } from '@/components/sections/Sobre';
import { Testimonios } from '@/components/sections/Testimonios';

const ROOT = resolve(__dirname, '..', '..');

const SECTION_HEADINGS: ReadonlyArray<{
  label: string;
  component: ComponentType;
  headingTag: 'h1' | 'h2';
  headingId: string;
}> = [
  { label: 'Hero', component: Hero, headingTag: 'h1', headingId: 'hero-h1' },
  { label: 'Problemas', component: Problemas, headingTag: 'h2', headingId: 'problemas-h2' },
  { label: 'Servicios', component: Servicios, headingTag: 'h2', headingId: 'servicios-h2' },
  { label: 'Sobre', component: Sobre, headingTag: 'h2', headingId: 'sobre-h2' },
  { label: 'Testimonios', component: Testimonios, headingTag: 'h2', headingId: 'testimonios-h2' },
  { label: 'Faq', component: Faq, headingTag: 'h2', headingId: 'faq-h2' },
  { label: 'CtaFinal', component: CtaFinal, headingTag: 'h2', headingId: 'cta-final-h2' },
];

describe('AC-G_A-13.1 — SectionReveal is a Server Component', () => {
  test('SectionReveal.tsx source has no "use client" directive', () => {
    const source = readFileSync(resolve(ROOT, 'src/components/brand/SectionReveal.tsx'), 'utf8');
    // The Next.js "use client" directive is a bare string-literal statement on
    // its own line; the regex is anchored to line boundaries so that the
    // phrase appearing inside a JSDoc comment ("No 'use client' directive...")
    // does NOT trigger a false positive.
    expect(source).not.toMatch(/^\s*['"]use client['"]\s*;?\s*$/m);
  });

  test('renders a div carrying data-reveal="fade-up" with children inside', () => {
    const html = renderToStaticMarkup(createElement(SectionReveal, null, 'hello'));
    expect(html).toContain('data-reveal="fade-up"');
    expect(html).toContain('hello');
    expect(html.startsWith('<div data-reveal="fade-up">')).toBe(true);
    expect(html.endsWith('</div>')).toBe(true);
  });
});

describe('AC-G_A-13.2 + AC-G_A-13.3 — each section heading is wrapped by SectionReveal', () => {
  for (const { label, component, headingTag, headingId } of SECTION_HEADINGS) {
    test(`${label} — <${headingTag} id="${headingId}"> sits inside a data-reveal="fade-up" wrapper`, () => {
      const html = renderToStaticMarkup(createElement(component));

      const wrapperOpenIdx = html.indexOf('<div data-reveal="fade-up">');
      const headingOpenIdx = html.indexOf(`<${headingTag} id="${headingId}"`);

      expect(
        wrapperOpenIdx,
        `${label}: <div data-reveal="fade-up"> missing in rendered markup`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        headingOpenIdx,
        `${label}: <${headingTag} id="${headingId}"> missing in rendered markup`,
      ).toBeGreaterThanOrEqual(0);

      // Wrapper opens BEFORE the heading...
      expect(wrapperOpenIdx).toBeLessThan(headingOpenIdx);

      // ...and no intervening </div> exists between them (the heading sits
      // directly inside the data-reveal wrapper, not a sibling further down).
      const between = html.slice(
        wrapperOpenIdx + '<div data-reveal="fade-up">'.length,
        headingOpenIdx,
      );
      expect(
        between.includes('</div>'),
        `${label}: a </div> appears between the data-reveal wrapper and the heading — heading is NOT a child of the wrapper`,
      ).toBe(false);
    });
  }
});
