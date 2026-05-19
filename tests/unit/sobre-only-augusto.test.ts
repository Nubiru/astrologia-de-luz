/**
 * G_A-6 unit pairing — #sobre renders ONE teacher card (Augusto).
 *
 * Anchors:
 *   - AC-1.1.9: "Other teachers do NOT appear on `/` per O-6 §B3 (iii) —
 *     teacher discovery happens at `/reservar`. Verified by counting
 *     teacher-card components on `/`: must equal exactly 1 (Augusto)."
 *   - AC-1.1.10: bio renders from CONTENT_PUBLIC.HOME.sobre.augusto.bio
 *     (not literals).
 *
 * Strategy: render the Sobre section in isolation AND the full HomePage —
 * the section-level test catches Sobre.tsx defects (wrong card count, missing
 * Augusto identity); the page-level test guards against a future regression
 * where another section accidentally injects a `data-brand="teacher-card"`
 * sibling element.
 */

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import HomePage from '@/app/page';
import { Sobre } from '@/components/sections/Sobre';
import { CONTENT_PUBLIC } from '@/infrastructure/content/public';

const sobreHtml = renderToStaticMarkup(React.createElement(Sobre));
const homeHtml = renderToStaticMarkup(React.createElement(HomePage));

describe('G_A-6 Sobre renders exactly 1 teacher card — AC-1.1.9', () => {
  test('Sobre section has EXACTLY ONE element with data-brand="teacher-card"', () => {
    const cards = sobreHtml.match(/data-brand="teacher-card"/g) ?? [];
    expect(cards).toHaveLength(1);
  });

  test('the single teacher card belongs to Augusto (slug + name)', () => {
    expect(sobreHtml).toMatch(/data-teacher-slug="augusto-rocha"/);
    expect(sobreHtml).toContain(CONTENT_PUBLIC.HOME.sobre.augusto.name);
  });

  test('home page has EXACTLY ONE teacher card across ALL sections', () => {
    const cards = homeHtml.match(/data-brand="teacher-card"/g) ?? [];
    expect(cards).toHaveLength(1);
  });

  test('home page renders Augusto and no other teacher slugs', () => {
    const slugs = homeHtml.match(/data-teacher-slug="([^"]+)"/g) ?? [];
    expect(slugs).toHaveLength(1);
    expect(slugs[0]).toBe('data-teacher-slug="augusto-rocha"');
  });
});

describe('G_A-6 Sobre content slot drive — AC-1.1.10', () => {
  test('heading "Sobre Augusto" renders from the slot', () => {
    expect(sobreHtml).toContain(CONTENT_PUBLIC.HOME.sobre.heading);
  });

  test('every bio paragraph renders verbatim from the slot', () => {
    for (const para of CONTENT_PUBLIC.HOME.sobre.augusto.bio) {
      expect(sobreHtml).toContain(para);
    }
  });

  test('role + portrait alt text + portrait URL come from the slot', () => {
    expect(sobreHtml).toContain(CONTENT_PUBLIC.HOME.sobre.augusto.role);
    expect(sobreHtml).toContain(`alt="${CONTENT_PUBLIC.HOME.sobre.augusto.portraitAlt}"`);
    expect(sobreHtml).toContain(`src="${CONTENT_PUBLIC.HOME.sobre.augusto.portraitUrl}"`);
  });

  test('portrait <img> declares width + height (CLS-prevention; Lighthouse SEO floor)', () => {
    expect(sobreHtml).toMatch(/<img\b[^>]*\bwidth="\d+"/);
    expect(sobreHtml).toMatch(/<img\b[^>]*\bheight="\d+"/);
  });

  test('portrait <img> uses loading="lazy" (below-the-fold perf)', () => {
    expect(sobreHtml).toMatch(/<img\b[^>]*\bloading="lazy"/);
  });
});

describe('G_A-6 Sobre bio length guard — augusto-input §A1', () => {
  test('combined bio paragraphs land within the 150–250 palabras budget', () => {
    const combined = CONTENT_PUBLIC.HOME.sobre.augusto.bio.join(' ');
    const palabras = combined.trim().split(/\s+/).length;
    expect(palabras).toBeGreaterThanOrEqual(150);
    expect(palabras).toBeLessThanOrEqual(250);
  });

  test('bio is split into ≥ 2 paragraphs (readability)', () => {
    expect(CONTENT_PUBLIC.HOME.sobre.augusto.bio.length).toBeGreaterThanOrEqual(2);
  });
});

describe('G_A-6 Sobre heading hierarchy', () => {
  test('Sobre uses <h2> for the section heading, <h3> for the teacher name (NOT h1)', () => {
    expect(sobreHtml).toMatch(/<h2\b[^>]*\bid="sobre-h2"/);
    expect(sobreHtml).toMatch(/<h3\b[^>]*>/);
    expect(sobreHtml).not.toMatch(/<h1\b/);
  });
});
