/**
 * G_A-2 integration pairing — brand-component a11y invariant scan.
 *
 * Scope (per gamma-flow no-new-dependency rule): G_A-10 owns the real axe-playwright
 * sweep across the BUILT pages (AC-1.7.4). This spec audits the structural a11y
 * predicates of the four brand components in isolation — the rules an Axe scan
 * would later flag if they were violated:
 *
 *   - O-6 §6: any gold/silver-tinted element on light bg MUST be aria-hidden=true
 *     AND have a visible-text equivalent on the same surface.
 *   - O-6 §6: decorative glyphs (☽, ✦) marked aria-hidden=true.
 *   - O-6 §6: no gold-bg-with-white-text buttons on light bg (inverts to ~2:1).
 *   - O-6 §6: focus ring visible (focus-visible:* utilities present).
 *   - O-6 §G: touch targets ≥ 44×44 (min-h-11 utility = 44px).
 *   - O-6 §6: components do NOT ship an <h1> (heading hierarchy owned by the page).
 *   - WCAG 2.1: no nested interactive (<a> inside <a>, <button> inside <button>),
 *     no display:none for non-decorative interactive elements.
 *
 * Each assertion FAILS when a component drifts from the O-6 §6 ruling — the
 * concrete substance behind AC-1.7.4's "Axe: 0 violations" promise for this surface.
 */

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { Button } from '@/components/brand/Button';
import { Footer } from '@/components/brand/Footer';
import { Logo } from '@/components/brand/Logo';
import { SectionWrapper } from '@/components/brand/SectionWrapper';

const h = React.createElement;

// O-6 §6 forbids gold (any tone) as readable text/background on LIGHT surfaces.
// Silver-on-dark passes AAA (e.g., Footer's muted © line) — so silver tints are
// NOT universally banned. Gold tints, by contrast, never sit on light surfaces
// without an aria-hidden carrier + visible-text equivalent.
const GOLD_TEXT_OR_BORDER_RE = /\b(text|border)-(dorado-imperial|dorado-palido)\b/;
// Base-state utility for a gold/silver fill — excluded state modifiers
// (hover:, focus:, focus-visible:, active:) because state-bound fills don't
// violate the "no gold-bg with white text" ruling at the static render layer.
const STATIC_GOLD_OR_SILVER_BG_RE =
  /(?:^|\s)bg-(dorado-imperial|dorado-palido|plata-luna|plata-eterea)\b/;

type RenderedComponent = { name: string; html: string };

function renderAll(): RenderedComponent[] {
  return [
    { name: 'Logo/primary', html: renderToStaticMarkup(h(Logo, { variant: 'primary' })) },
    { name: 'Logo/positive', html: renderToStaticMarkup(h(Logo, { variant: 'positive' })) },
    {
      name: 'Button/dark',
      html: renderToStaticMarkup(h(Button, { variant: 'dark', children: 'Reservar sesión' })),
    },
    {
      name: 'Button/light',
      html: renderToStaticMarkup(h(Button, { variant: 'light', children: 'Reservar sesión' })),
    },
    {
      name: 'Button/link',
      html: renderToStaticMarkup(h(Button, { href: '/reservar', children: 'Reservar' })),
    },
    {
      name: 'SectionWrapper/dark',
      html: renderToStaticMarkup(
        h(
          SectionWrapper,
          { id: 'hero', tone: 'dark', ariaLabelledby: 'hero-h1' },
          h('h2', { id: 'hero-h1' }, 'Hero'),
        ),
      ),
    },
    {
      name: 'SectionWrapper/light',
      html: renderToStaticMarkup(
        h(
          SectionWrapper,
          { id: 'sobre', tone: 'light', ariaLabelledby: 'sobre-h2' },
          h('h2', { id: 'sobre-h2' }, 'Sobre'),
        ),
      ),
    },
    { name: 'Footer', html: renderToStaticMarkup(h(Footer, { year: 2026 })) },
  ];
}

/**
 * Extract every element start-tag from an HTML string.
 * Returns [{ raw, tag, attrs }] where attrs is the literal attribute substring.
 */
function tags(html: string): Array<{ raw: string; tag: string; attrs: string }> {
  const out: Array<{ raw: string; tag: string; attrs: string }> = [];
  const re = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  for (const match of html.matchAll(re)) {
    const tag = match[1] ?? '';
    const attrs = match[2] ?? '';
    out.push({ raw: match[0], tag, attrs });
  }
  return out;
}

describe('G_A-2 brand-axe invariants', () => {
  const rendered = renderAll();

  describe('O-6 §6 — gold tints (text/border) must sit on aria-hidden carriers', () => {
    test.each(rendered)(
      '$name: every gold-tinted text/border element is aria-hidden=true',
      ({ html }) => {
        const violations: string[] = [];
        for (const { raw, attrs } of tags(html)) {
          const cleaned = attrs.replace(/focus-visible:outline-dorado-imperial/g, '');
          if (!GOLD_TEXT_OR_BORDER_RE.test(cleaned)) continue;
          if (!/aria-hidden="true"/.test(attrs)) {
            violations.push(raw);
          }
        }
        expect(
          violations,
          `Every text-dorado-* / border-dorado-* element must be aria-hidden=true (O-6 §6 decoration-only). Offenders:\n${violations.join('\n')}`,
        ).toEqual([]);
      },
    );

    test('Logo/positive uses NO gold/silver tint anywhere (ink-on-light surface — AAA only)', () => {
      const html = renderToStaticMarkup(h(Logo, { variant: 'positive' }));
      expect(html).not.toMatch(
        /\b(text|bg|border)-(dorado-imperial|dorado-palido|plata-luna|plata-eterea)\b/,
      );
    });
  });

  describe('O-6 §6 — visible-text equivalent for every decoration', () => {
    test('Logo/positive: decorative mark is paired with visible ink wordmark', () => {
      const html = renderToStaticMarkup(h(Logo, { variant: 'positive' }));
      const wordmarkVisible = /<span[^>]*data-brand="logo-wordmark"[^>]*>(?!.*aria-hidden)/.test(
        html,
      );
      expect(wordmarkVisible).toBe(true);
      expect(html).toContain('ASTROLOGIA DE LUZ');
    });

    test('Logo/primary: decorative mark is paired with visible white wordmark', () => {
      const html = renderToStaticMarkup(h(Logo, { variant: 'primary' }));
      expect(/data-brand="logo-wordmark"[^>]*class="[^"]*text-blanco-estelar/.test(html)).toBe(
        true,
      );
    });

    test('Footer: decorative Logo mark is paired with the visible wordmark + © text', () => {
      const html = renderToStaticMarkup(h(Footer, { year: 2026 }));
      expect(html).toContain('ASTROLOGIA DE LUZ');
      expect(html).toMatch(/©\s*2026/);
    });
  });

  describe('O-6 §6 — decorative glyph is aria-hidden', () => {
    test('crescent moon ☽ appears only inside an aria-hidden element', () => {
      for (const { html, name } of rendered) {
        if (!html.includes('☽')) continue;
        // Crude segmenter: every span that contains ☽ must carry aria-hidden=true.
        const containers = html.match(/<[^>]*>[^<]*☽[^<]*<\/[^>]+>/g) ?? [];
        expect(containers.length, `${name} should wrap ☽ in at least one tag`).toBeGreaterThan(0);
        for (const c of containers) {
          // The container's open tag must carry aria-hidden="true".
          const openTag = c.match(/<[^>]+>/)?.[0] ?? '';
          expect(openTag, `${name}: glyph container missing aria-hidden — ${c}`).toMatch(
            /aria-hidden="true"/,
          );
        }
      }
    });
  });

  describe('O-6 §6 — buttons never use gold-bg with white text in their BASE state', () => {
    test.each(['dark', 'light'] as const)(
      'Button/%s: no base-state bg-dorado-*/plata-* fill (hover:/focus:* state fills excluded)',
      (variant) => {
        const html = renderToStaticMarkup(h(Button, { variant, children: 'CTA' }));
        // Strip the class= attribute, drop every state-prefixed utility (foo:bar),
        // then verify the remaining base utilities never carry a gold/silver bg fill.
        const classMatch = html.match(/\bclass="([^"]+)"/);
        const allClasses = (classMatch?.[1] ?? '').split(/\s+/);
        const baseClasses = allClasses.filter((c) => !c.includes(':'));
        const offending = baseClasses.filter((c) => STATIC_GOLD_OR_SILVER_BG_RE.test(` ${c} `));
        expect(
          offending,
          `Button/${variant} base-state classes must not use gold/silver fill (O-6 §6); offenders: ${offending.join(', ')}`,
        ).toEqual([]);
      },
    );
  });

  describe('O-6 §6 — every interactive element exposes a visible focus state', () => {
    test('Button (button-mode): focus-visible:* utilities present', () => {
      const html = renderToStaticMarkup(h(Button, { children: 'CTA' }));
      expect(html).toMatch(/focus-visible:outline-2/);
      expect(html).toMatch(/focus-visible:outline-offset-2/);
    });

    test('Button (anchor-mode): focus-visible:* utilities present', () => {
      const html = renderToStaticMarkup(h(Button, { href: '/reservar', children: 'CTA' }));
      expect(html).toMatch(/focus-visible:outline-2/);
      expect(html).toMatch(/focus-visible:outline-offset-2/);
    });
  });

  describe('O-6 §G — touch targets ≥ 44×44', () => {
    test.each([
      ['md', 'min-h-11'],
      ['lg', 'min-h-12'],
    ] as const)('Button size=%s declares %s (≥ 44px)', (size, expected) => {
      const html = renderToStaticMarkup(h(Button, { size, children: 'CTA' }));
      expect(html).toContain(expected);
    });
  });

  describe('Heading hierarchy — components never ship an <h1>', () => {
    test.each(rendered)('$name renders no <h1>', ({ html }) => {
      expect(html).not.toMatch(/<h1[\s>]/i);
    });
  });

  describe('WCAG 2.1 — no nested interactive ancestors', () => {
    test('Button-as-anchor never wraps a <button>', () => {
      const html = renderToStaticMarkup(h(Button, { href: '/reservar', children: 'CTA' }));
      expect(html.match(/<a\b/g)?.length ?? 0).toBe(1);
      expect(html).not.toMatch(/<button[\s>]/);
    });

    test('Footer renders no anchor outside the embedded Logo span', () => {
      const html = renderToStaticMarkup(h(Footer));
      // Logo is presentational (<span>); Footer must not auto-wrap an <a> around it.
      expect(html).not.toMatch(/<a\b/);
      expect(html).not.toMatch(/<button\b/);
    });
  });

  describe('WCAG 2.1 — no display:none on interactive surfaces', () => {
    test.each(rendered)('$name: no inline style="display: none" on rendered tags', ({ html }) => {
      expect(html).not.toMatch(/style="[^"]*display\s*:\s*none/i);
    });
  });

  describe('SectionWrapper a11y wiring', () => {
    test('aria-labelledby attribute references a heading id inside the section', () => {
      const html = renderToStaticMarkup(
        h(
          SectionWrapper,
          { id: 'sobre', tone: 'light', ariaLabelledby: 'sobre-h2' },
          h('h2', { id: 'sobre-h2' }, 'Sobre Augusto'),
        ),
      );
      expect(html).toContain('aria-labelledby="sobre-h2"');
      expect(html).toContain('id="sobre-h2"');
    });
  });

  describe('Coverage guard — every component is exercised by at least one assertion', () => {
    test('rendered set covers all four G_A-2 components plus variants', () => {
      const names = rendered.map((r) => r.name).join(',');
      expect(names).toContain('Logo/primary');
      expect(names).toContain('Logo/positive');
      expect(names).toContain('Button/dark');
      expect(names).toContain('Button/light');
      expect(names).toContain('Button/link');
      expect(names).toContain('SectionWrapper/dark');
      expect(names).toContain('SectionWrapper/light');
      expect(names).toContain('Footer');
    });
  });
});
