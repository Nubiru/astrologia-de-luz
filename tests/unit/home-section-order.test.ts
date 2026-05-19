/**
 * G_A-5 unit pairing — home page section order, tone rhythm, CTA cadence.
 *   Scope-extended at G_A-6 to cover the full 7-section flow (S1..S7 + footer).
 *
 * Anchors:
 *   - AC-1.1.2: sections in DOM order #hero → #problemas → #servicios →
 *     #sobre → #testimonios → #faq → #cta-final → <footer>.
 *   - AC-1.1.3: tone alternates dark → light → dark → light → dark → light
 *     → dark → footer-dark (verified via the data-tone attribute SectionWrapper
 *     emits for each section).
 *   - AC-1.1.4: each non-FAQ section ends with a CTA targeting /reservar
 *     (count ≥ 1 per section; S6 FAQ = 0 acceptable).
 *   - AC-1.1.6: home page still renders EXACTLY ONE <h1> after all 7 sections land.
 *   - AC-3.8.1 / AC-3.8.2: the SLA + cancellation strings render in the FAQ.
 *
 * Strategy: render `HomePage` to static HTML via react-dom/server, then walk
 * the section tags in DOM order and assert the contract. The page's section
 * components transitively pull SectionWrapper / Button / CONTENT_PUBLIC; no
 * font / DOM library imports trigger.
 */

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import HomePage from '@/app/page';

const rendered = renderToStaticMarkup(React.createElement(HomePage));

// Pull every <section id="..." data-tone="..."> open tag in DOM order.
const sectionOpens = [...rendered.matchAll(/<section\b([^>]*)>/g)].map(({ 1: attrs }) => {
  const id = attrs?.match(/\bid="([^"]+)"/)?.[1] ?? '';
  const tone = attrs?.match(/\bdata-tone="([^"]+)"/)?.[1] ?? '';
  return { id, tone };
});

const EXPECTED_SECTION_IDS = [
  'hero',
  'problemas',
  'servicios',
  'sobre',
  'testimonios',
  'faq',
  'cta-final',
] as const;

const EXPECTED_TONES: Record<(typeof EXPECTED_SECTION_IDS)[number], 'dark' | 'light'> = {
  hero: 'dark',
  problemas: 'light',
  servicios: 'dark',
  sobre: 'light',
  testimonios: 'dark',
  faq: 'light',
  'cta-final': 'dark',
};

const SECTIONS_WITH_CTA = [
  'hero',
  'problemas',
  'servicios',
  'sobre',
  'testimonios',
  'cta-final',
] as const;

describe('G_A-5/G_A-6 section DOM order — AC-1.1.2', () => {
  test('home renders the full 7-section flow in spec-locked DOM order', () => {
    const ids = sectionOpens.map((s) => s.id);
    expect(ids).toEqual([...EXPECTED_SECTION_IDS]);
  });

  test('every section id is unique (no DOM collisions)', () => {
    const ids = sectionOpens.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('the page-level <footer data-brand="footer"> sits AFTER every <section>', () => {
    const lastSectionEnd = rendered.lastIndexOf('</section>');
    const pageFooterOpen = rendered.search(/<footer\b[^>]*data-brand="footer"/);
    expect(pageFooterOpen).toBeGreaterThan(lastSectionEnd);
  });
});

describe('G_A-5/G_A-6 tone rhythm — AC-1.1.3', () => {
  test('every section carries its expected tone (dark/light alternating + footer-dark)', () => {
    const tones = Object.fromEntries(sectionOpens.map((s) => [s.id, s.tone]));
    expect(tones).toMatchObject(EXPECTED_TONES);
  });

  test('adjacent sections alternate tone (no two-in-a-row of the same tone)', () => {
    for (let i = 1; i < sectionOpens.length; i++) {
      expect(
        sectionOpens[i]?.tone,
        `section "${sectionOpens[i]?.id}" tone "${sectionOpens[i]?.tone}" matches previous "${sectionOpens[i - 1]?.tone}"`,
      ).not.toBe(sectionOpens[i - 1]?.tone);
    }
  });

  test('page Footer (data-brand="footer") carries the dark surface class', () => {
    // Inner <footer> elements inside testimonio cards (attribution lines) are
    // legal HTML5 — selectively target the brand Footer via its data attribute.
    const open = rendered.match(/<footer\b[^>]*data-brand="footer"[^>]*>/);
    expect(open, 'no <footer data-brand="footer"> found in rendered HomePage').not.toBeNull();
    expect(open?.[0]).toMatch(/\bbg-tinta-nocturna\b/);
  });
});

describe('G_A-5/G_A-6 per-section CTA cadence — AC-1.1.4', () => {
  function extractSection(id: string): string {
    const open = new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*>`);
    const start = rendered.match(open);
    if (!start || start.index === undefined) return '';
    const afterOpen = rendered.slice(start.index);
    const closeIdx = afterOpen.indexOf('</section>');
    return closeIdx === -1 ? afterOpen : afterOpen.slice(0, closeIdx + '</section>'.length);
  }

  test.each(SECTIONS_WITH_CTA)('section #%s contains ≥ 1 anchor with href="/reservar"', (id) => {
    const html = extractSection(id);
    const ctas = html.match(/<a\b[^>]*href="\/reservar"[^>]*>/g) ?? [];
    expect(ctas.length).toBeGreaterThanOrEqual(1);
  });

  test('#faq contains ZERO /reservar CTA (AC-1.1.4 "FAQ softens")', () => {
    const html = extractSection('faq');
    const ctas = html.match(/<a\b[^>]*href="\/reservar"[^>]*>/g) ?? [];
    expect(ctas.length).toBe(0);
  });
});

describe('G_A-5/G_A-6 heading hierarchy — AC-1.1.6', () => {
  test('home page renders EXACTLY ONE <h1> after all 7 sections land', () => {
    const h1Opens = rendered.match(/<h1\b[^>]*>/g) ?? [];
    expect(h1Opens).toHaveLength(1);
  });

  test('every non-hero section uses <h2> as its heading (NOT h1)', () => {
    for (const id of ['problemas', 'servicios', 'sobre', 'testimonios', 'faq', 'cta-final']) {
      const h2Id = id === 'cta-final' ? 'cta-final-h2' : `${id}-h2`;
      expect(rendered, `section #${id} missing <h2 id="${h2Id}">`).toMatch(
        new RegExp(`<h2\\b[^>]*\\bid="${h2Id}"`),
      );
    }
  });

  test('SectionWrapper wires aria-labelledby on each section to its h2', () => {
    for (const id of ['problemas', 'servicios', 'sobre', 'testimonios', 'faq', 'cta-final']) {
      const h2Id = id === 'cta-final' ? 'cta-final-h2' : `${id}-h2`;
      expect(rendered).toMatch(
        new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*aria-labelledby="${h2Id}"`),
      );
    }
  });
});

describe('G_A-5/G_A-6 CONTENT slot drive — AC-1.1.5 / AC-1.1.10', () => {
  test('CONTENT_PUBLIC.HOME values appear in the rendered HTML across all sections', async () => {
    const { CONTENT_PUBLIC } = await import('@/infrastructure/content/public');
    const { HOME } = CONTENT_PUBLIC;

    expect(rendered).toContain(HOME.problemas.heading);
    for (const item of HOME.problemas.items) expect(rendered).toContain(item);

    expect(rendered).toContain(HOME.servicios.heading);
    for (const s of HOME.servicios.items) {
      expect(rendered).toContain(s.name);
      expect(rendered).toContain(s.duration);
      expect(rendered).toContain(s.resultado);
    }

    expect(rendered).toContain(HOME.sobre.heading);
    expect(rendered).toContain(HOME.sobre.augusto.name);
    expect(rendered).toContain(HOME.sobre.augusto.role);

    expect(rendered).toContain(HOME.testimonios.heading);
    for (const t of HOME.testimonios.items) {
      expect(rendered).toContain(t.quote);
      expect(rendered).toContain(t.name);
    }

    expect(rendered).toContain(HOME.faq.heading);
    for (const entry of HOME.faq.items) {
      expect(rendered).toContain(entry.q);
      expect(rendered).toContain(entry.a);
    }

    expect(rendered).toContain(HOME.ctaFinal.line);
  });
});

describe('G_A-6 FAQ surfaces cross-pool slot drive — AC-3.8.1 / AC-3.8.2', () => {
  test('CONTENT_PANEL.LANDING.sla.text appears verbatim inside #faq', async () => {
    const { CONTENT_PANEL } = await import('@/infrastructure/content/panel');
    const open = /<section\b[^>]*\bid="faq"[^>]*>/;
    const start = rendered.search(open);
    expect(start).toBeGreaterThan(-1);
    const faqSlice = rendered.slice(start);
    expect(faqSlice).toContain(CONTENT_PANEL.LANDING.sla.text);
  });

  test('CONTENT_PANEL.RESERVAR.cancellation.text appears verbatim inside #faq', async () => {
    const { CONTENT_PANEL } = await import('@/infrastructure/content/panel');
    const open = /<section\b[^>]*\bid="faq"[^>]*>/;
    const start = rendered.search(open);
    const faqSlice = rendered.slice(start);
    expect(faqSlice).toContain(CONTENT_PANEL.RESERVAR.cancellation.text);
  });
});

describe('G_A-6 FAQ uses native <details>/<summary> — AC-1.1.11', () => {
  test('the #faq section contains one <details> per FAQ entry', async () => {
    const { CONTENT_PUBLIC } = await import('@/infrastructure/content/public');
    const open = /<section\b[^>]*\bid="faq"[^>]*>/;
    const start = rendered.search(open);
    const closeIdx = rendered.indexOf('</section>', start);
    const faqSlice = rendered.slice(start, closeIdx);
    const detailsCount = (faqSlice.match(/<details\b[^>]*>/g) ?? []).length;
    const summaryCount = (faqSlice.match(/<summary\b[^>]*>/g) ?? []).length;
    expect(detailsCount).toBe(CONTENT_PUBLIC.HOME.faq.items.length);
    expect(summaryCount).toBe(CONTENT_PUBLIC.HOME.faq.items.length);
  });
});
