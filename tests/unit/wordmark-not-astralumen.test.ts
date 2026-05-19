/**
 * G_A-4 unit pairing — wordmark literal + slot-driven Hero render.
 *
 * Anchors:
 *   - AC-1.1.5: hero copy rendered from CONTENT_PUBLIC.HOME.hero.* (not
 *     hard-coded). Verified structurally: the Hero source MUST import
 *     CONTENT_PUBLIC and reference its hero slots; the hero-copy literals
 *     MUST NOT appear in the Hero source (only in src/infrastructure/content/public.ts).
 *   - AC-1.1.6: Hero contains EXACTLY ONE <h1>; the eyebrow wordmark renders
 *     as <p>/<div> NOT <h1> (heading hierarchy per O-6 §6).
 *   - AC-1.1.7: wordmark literal is "ASTROLOGIA DE LUZ" (uppercase, regular
 *     spaces); "ASTRALUMEN" NEVER appears in any rendered output OR any
 *     CONTENT_PUBLIC value.
 *
 * Strategy: vitest is node-env; render Hero via renderToStaticMarkup and
 * assert against the HTML string. CONTENT_PUBLIC is imported directly (no
 * mock) so the seeded defaults are exercised.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { Hero } from '@/components/sections/Hero';
import { CONTENT_PUBLIC } from '@/infrastructure/content/public';

const ROOT = resolve(__dirname, '..', '..');
const heroSrc = () => readFileSync(resolve(ROOT, 'src/components/sections/Hero.tsx'), 'utf8');
const publicSrc = () => readFileSync(resolve(ROOT, 'src/infrastructure/content/public.ts'), 'utf8');

describe('G_A-4 wordmark literal — AC-1.1.7', () => {
  test('CONTENT_PUBLIC.HOME.hero.eyebrow equals "ASTROLOGIA DE LUZ" verbatim', () => {
    expect(CONTENT_PUBLIC.HOME.hero.eyebrow).toBe('ASTROLOGIA DE LUZ');
  });

  test('CONTENT_PUBLIC contains no "ASTRALUMEN" anywhere (deep walk)', () => {
    const walk = (value: unknown): string[] => {
      if (typeof value === 'string') return [value];
      if (Array.isArray(value)) return value.flatMap(walk);
      if (value && typeof value === 'object')
        return Object.values(value as Record<string, unknown>).flatMap(walk);
      return [];
    };
    const strings = walk(CONTENT_PUBLIC);
    expect(strings.length).toBeGreaterThan(0);
    for (const s of strings) {
      expect(s, `Found "ASTRALUMEN" in CONTENT_PUBLIC string: ${s}`).not.toMatch(/ASTRALUMEN/i);
    }
  });

  test('Hero rendered HTML contains the wordmark literal "ASTROLOGIA DE LUZ"', () => {
    const html = renderToStaticMarkup(React.createElement(Hero));
    expect(html).toContain('ASTROLOGIA DE LUZ');
  });

  test('Hero rendered HTML never contains "ASTRALUMEN"', () => {
    const html = renderToStaticMarkup(React.createElement(Hero));
    expect(html).not.toMatch(/ASTRALUMEN/i);
  });

  test('public.ts source file never contains "ASTRALUMEN" inside a string literal', () => {
    // The runtime deep-walk above already proves no CONTENT_PUBLIC value carries
    // the word. This guard catches the orthogonal failure-mode where a future
    // edit drops an "ASTRALUMEN" literal into a non-exported helper / scaffold
    // string. Comments are explicitly excluded — public.ts contains a
    // "NOT adopted" comment referencing the rejected wordmark, which is fine.
    const src = publicSrc()
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '');
    expect(src).not.toMatch(/ASTRALUMEN/i);
  });
});

describe('G_A-4 slot-driven Hero render — AC-1.1.5', () => {
  test('Hero source imports CONTENT_PUBLIC from infrastructure/content/public (post-G_C-35 cleanup-CP)', () => {
    expect(heroSrc()).toMatch(
      /import\s*\{[^}]*CONTENT_PUBLIC[^}]*\}\s*from\s*['"][^'"]*infrastructure\/content\/public['"]/,
    );
  });

  test('Hero source references CONTENT_PUBLIC.HOME.hero (the slot under read)', () => {
    expect(heroSrc()).toContain('CONTENT_PUBLIC.HOME.hero');
  });

  test('Hero source contains NO hero-copy literals (rules out hard-coded copy)', () => {
    const src = heroSrc();
    // The seeded H1 / sub / cta strings only live in src/infrastructure/content/public.ts.
    // If Hero hard-codes them, replacing the slot value would NOT re-render
    // the new copy — AC-1.1.5 would silently regress.
    expect(src).not.toContain(CONTENT_PUBLIC.HOME.hero.h1);
    expect(src).not.toContain(CONTENT_PUBLIC.HOME.hero.sub);
    expect(src).not.toContain(CONTENT_PUBLIC.HOME.hero.cta.text);
    // The wordmark "ASTROLOGIA DE LUZ" is a known-shared literal between
    // content + (e.g.) Logo wordmark; we permit it elsewhere but ASSERT it
    // is NOT in Hero source (Hero renders the slot value).
    expect(src).not.toContain('ASTROLOGIA DE LUZ');
  });

  test('Hero renders every value declared in CONTENT_PUBLIC.HOME.hero', () => {
    const html = renderToStaticMarkup(React.createElement(Hero));
    const hero = CONTENT_PUBLIC.HOME.hero;
    expect(html).toContain(hero.eyebrow);
    expect(html).toContain(hero.h1);
    expect(html).toContain(hero.sub);
    expect(html).toContain(hero.cta.text);
    expect(html).toContain(`href="${hero.cta.href}"`);
  });
});

describe('G_A-4 heading hierarchy — AC-1.1.6', () => {
  test('Hero renders EXACTLY ONE <h1> (the emotional claim)', () => {
    const html = renderToStaticMarkup(React.createElement(Hero));
    const h1Opens = html.match(/<h1\b[^>]*>/g) ?? [];
    expect(h1Opens).toHaveLength(1);
  });

  test('the wordmark eyebrow renders as <p>/<div>, NOT <h1>', () => {
    const html = renderToStaticMarkup(React.createElement(Hero));
    const eyebrowTag = html.match(/<([a-z]+)\b[^>]*data-brand="hero-eyebrow"[^>]*>/i);
    expect(eyebrowTag).not.toBeNull();
    expect(['p', 'div', 'span']).toContain(eyebrowTag?.[1]?.toLowerCase());
    // Negative: the eyebrow's tag is definitively NOT <h1>.
    const eyebrowOpen = eyebrowTag?.[0] ?? '';
    expect(eyebrowOpen.toLowerCase()).not.toMatch(/<h1\b/);
  });

  test('the H1 textContent matches CONTENT_PUBLIC.HOME.hero.h1', () => {
    const html = renderToStaticMarkup(React.createElement(Hero));
    const h1Body = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/);
    expect(h1Body).not.toBeNull();
    const text = (h1Body?.[1] ?? '').replace(/<[^>]+>/g, '').trim();
    expect(text).toBe(CONTENT_PUBLIC.HOME.hero.h1);
  });
});

describe('G_A-4 Hero CTA contract — AC-1.1.4', () => {
  test('Hero CTA href points at /reservar (slot value)', () => {
    expect(CONTENT_PUBLIC.HOME.hero.cta.href).toBe('/reservar');
    const html = renderToStaticMarkup(React.createElement(Hero));
    expect(html).toMatch(/<a\b[^>]*href="\/reservar"[^>]*>/);
  });

  test('Hero CTA renders inside the #hero section (anchor-style nav)', () => {
    const html = renderToStaticMarkup(React.createElement(Hero));
    const heroSection = html.match(/<section\b[^>]*id="hero"[^>]*>[\s\S]*?<\/section>/);
    expect(heroSection).not.toBeNull();
    expect(heroSection?.[0]).toMatch(/href="\/reservar"/);
  });
});

describe('G_A-4 hero word-budget (O-6 §C shape contract)', () => {
  test('hero.h1 fits the ≤12-palabras hero-claim budget', () => {
    const palabras = CONTENT_PUBLIC.HOME.hero.h1.trim().split(/\s+/).length;
    expect(palabras).toBeLessThanOrEqual(12);
    expect(palabras).toBeGreaterThan(0);
  });

  test('hero.sub fits the ≤22-palabras positioning-line budget', () => {
    const palabras = CONTENT_PUBLIC.HOME.hero.sub.trim().split(/\s+/).length;
    expect(palabras).toBeLessThanOrEqual(22);
    expect(palabras).toBeGreaterThan(0);
  });
});
