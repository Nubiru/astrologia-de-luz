/**
 * G_A-14 pairing — Sobre editorial polish (asymmetric 2-col layout + hairline
 * gold divider + Cormorant drop-cap on first bio paragraph).
 *
 * Anchors AC-G_A-14.1 + AC-G_A-14.2 + AC-G_A-14.4.
 *
 * Fails when:
 *   - The Sobre <article> stops carrying `md:flex-row` (asymmetric desktop
 *     layout collapses back to centered stack — visual regression).
 *   - The hairline gold divider `data-brand="sobre-divider"` is removed or
 *     loses the `hidden md:block` responsive guard (would either disappear
 *     entirely OR leak onto mobile and rupture the centered-stack layout).
 *   - The first <p> of the bio stack loses the `drop-cap` className (the
 *     editorial signal at the column head disappears).
 *   - A subsequent bio paragraph gains `drop-cap` (would double-drop-cap the
 *     column — visual regression).
 *
 * Renders via react-dom/server.renderToStaticMarkup (node env; same pattern
 * as G_A-13/15/16).
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { Sobre } from '@/components/sections/Sobre';

describe('AC-G_A-14.1 + AC-G_A-14.2 — Sobre asymmetric layout + hairline divider', () => {
  const html = renderToStaticMarkup(createElement(Sobre));

  test('<article data-brand="teacher-card"> uses md:flex-row asymmetric layout', () => {
    const articleMatch = html.match(/<article[^>]*data-brand="teacher-card"[^>]*>/);
    expect(articleMatch).not.toBeNull();
    const opener = articleMatch?.[0] ?? '';
    expect(opener).toMatch(/\bflex\b/);
    expect(opener).toMatch(/\bflex-col\b/);
    expect(opener).toMatch(/\bmd:flex-row\b/);
  });

  test('hairline gold divider element exists with data-brand="sobre-divider"', () => {
    const dividerMatch = html.match(/<div[^>]*data-brand="sobre-divider"[^>]*>/);
    expect(dividerMatch).not.toBeNull();
  });

  test('divider is hidden on mobile (`hidden`) and visible on desktop (`md:block`)', () => {
    const dividerMatch = html.match(/<div[^>]*data-brand="sobre-divider"[^>]*>/);
    const className = dividerMatch?.[0] ?? '';
    expect(className).toMatch(/\bhidden\b/);
    expect(className).toMatch(/\bmd:block\b/);
  });

  test('divider is aria-hidden (decoration-only per O-6 §6)', () => {
    const dividerMatch = html.match(/<div[^>]*data-brand="sobre-divider"[^>]*>/);
    expect(dividerMatch?.[0]).toContain('aria-hidden="true"');
  });
});

describe('AC-G_A-14.4 — drop-cap applied only to the first bio paragraph', () => {
  const html = renderToStaticMarkup(createElement(Sobre));

  test('exactly one <p> in the rendered output carries the `drop-cap` className', () => {
    const dropCapMatches = html.match(/<p[^>]*class="[^"]*\bdrop-cap\b[^"]*"/g) ?? [];
    expect(dropCapMatches.length).toBe(1);
  });

  test('the first bio paragraph carries drop-cap; later paragraphs do not', () => {
    // Locate the bio stack via its body-copy-specific marker
    // `text-tinta-media` (which the header's role <p> does NOT carry — that
    // one is `text-tinta-suave uppercase`). The bio stack's wrapper div sets
    // text-tinta-media for the cascade so every inheriting <p> gets it; we
    // grep the wrapper div and collect every <p> tag inside until the wrapper
    // closes. Simpler-but-still-precise: collect <p> tags whose preceding
    // wrapper-div opener carried text-tinta-media. The drop-cap <p> is the
    // first bio-stack <p> by construction (index === 0 in the map).
    const bioStackMatch = html.match(
      /<div\s+class="[^"]*\btext-tinta-media\b[^"]*"[^>]*>([\s\S]*?)<\/div>/,
    );
    expect(bioStackMatch, 'bio stack <div text-tinta-media> not found').not.toBeNull();
    const bioStackInner = bioStackMatch?.[1] ?? '';
    const bioParagraphs = [...bioStackInner.matchAll(/<p\b([^>]*)>/g)].map((m) => m[1] ?? '');
    expect(bioParagraphs.length).toBeGreaterThanOrEqual(2);
    expect(bioParagraphs[0]).toMatch(/\bdrop-cap\b/);
    for (const attrs of bioParagraphs.slice(1)) {
      expect(attrs).not.toMatch(/\bdrop-cap\b/);
    }
  });
});
