/**
 * G_A-17 pairing — Servicios + Testimonios <li> cards carry the
 * `.card-hover` micro-state className (AC-G_A-17.3 + AC-G_A-17.4 +
 * AC-G_A-17.5).
 *
 * Fails when:
 *   - Any Servicios card (<li data-brand="servicio-card">) drops the
 *     `card-hover` className.
 *   - Any Testimonios card (<li data-brand="testimonio-card">) drops the
 *     `card-hover` className.
 *   - The card-hover class leaks onto a non-card element (would translate
 *     unintended chrome on hover — visual regression).
 *
 * Renders via react-dom/server.renderToStaticMarkup (node env; same pattern
 * as G_A-13/15/16/14).
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { Servicios } from '@/components/sections/Servicios';
import { Testimonios } from '@/components/sections/Testimonios';
import { CONTENT_PUBLIC } from '@/infrastructure/content/public';

describe('AC-G_A-17.3 + AC-G_A-17.5 — Servicios cards have card-hover', () => {
  const html = renderToStaticMarkup(createElement(Servicios));
  const expectedCount = CONTENT_PUBLIC.HOME.servicios.items.length;

  test('every servicio card <li> carries the card-hover className', () => {
    const cardOpeners = html.match(/<li[^>]*data-brand="servicio-card"[^>]*>/g) ?? [];
    expect(cardOpeners.length).toBe(expectedCount);
    for (const opener of cardOpeners) {
      expect(opener).toMatch(/\bcard-hover\b/);
    }
  });
});

describe('AC-G_A-17.4 + AC-G_A-17.5 — Testimonios cards have card-hover', () => {
  const html = renderToStaticMarkup(createElement(Testimonios));
  const expectedCount = CONTENT_PUBLIC.HOME.testimonios.items.length;

  test('every testimonio card <li> carries the card-hover className', () => {
    const cardOpeners = html.match(/<li[^>]*data-brand="testimonio-card"[^>]*>/g) ?? [];
    expect(cardOpeners.length).toBe(expectedCount);
    for (const opener of cardOpeners) {
      expect(opener).toMatch(/\bcard-hover\b/);
    }
  });
});

describe('card-hover stays on its declared consumers (no leak)', () => {
  test('Servicios card-hover count equals Servicios card count', () => {
    const html = renderToStaticMarkup(createElement(Servicios));
    const expectedCount = CONTENT_PUBLIC.HOME.servicios.items.length;
    const hits = html.match(/\bcard-hover\b/g) ?? [];
    expect(hits.length).toBe(expectedCount);
  });

  test('Testimonios card-hover count equals Testimonios card count', () => {
    const html = renderToStaticMarkup(createElement(Testimonios));
    const expectedCount = CONTENT_PUBLIC.HOME.testimonios.items.length;
    const hits = html.match(/\bcard-hover\b/g) ?? [];
    expect(hits.length).toBe(expectedCount);
  });
});
