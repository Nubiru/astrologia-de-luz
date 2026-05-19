/**
 * G_A-14 pairing — Testimonios decorative quote-mark carries `hanging-quote`
 * className (AC-G_A-14.6 + S-4 brand-manual §03 + §06 editorial polish).
 *
 * Fails when:
 *   - Any testimonio card's quote-mark span drops the `hanging-quote` class.
 *   - The hanging-quote class leaks onto a non-quote-mark element (would
 *     mis-indent body text or breaks layout).
 *
 * Renders via react-dom/server.renderToStaticMarkup. CONTENT_PUBLIC.HOME.
 * testimonios ships 3 cards in v1.0; the assertion scales with however many
 * items land in CONTENT.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { Testimonios } from '@/components/sections/Testimonios';
import { CONTENT_PUBLIC } from '@/infrastructure/content/public';

describe('AC-G_A-14.6 — Testimonios decorative quote-mark carries hanging-quote', () => {
  const html = renderToStaticMarkup(createElement(Testimonios));
  const expectedCardCount = CONTENT_PUBLIC.HOME.testimonios.items.length;

  test('every testimonio quote-mark span has the hanging-quote className', () => {
    const quoteMarkSpans = html.match(/<span[^>]*data-brand="testimonio-quote-mark"[^>]*>/g) ?? [];
    expect(quoteMarkSpans.length).toBe(expectedCardCount);
    for (const opener of quoteMarkSpans) {
      expect(opener).toMatch(/\bhanging-quote\b/);
    }
  });

  test('hanging-quote only appears on the decorative quote-mark spans (not on bodies)', () => {
    // Count total `hanging-quote` usages, count quote-mark spans — must be 1:1.
    const totalHits = html.match(/\bhanging-quote\b/g) ?? [];
    expect(totalHits.length).toBe(expectedCardCount);
  });

  test('the quote-mark span retains its decoration-only contract (aria-hidden)', () => {
    const quoteMarkSpans = html.match(/<span[^>]*data-brand="testimonio-quote-mark"[^>]*>/g) ?? [];
    for (const opener of quoteMarkSpans) {
      expect(opener).toContain('aria-hidden="true"');
    }
  });
});
