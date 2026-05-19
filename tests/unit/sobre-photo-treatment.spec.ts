/**
 * G_A-15 pairing — Sobre portrait sits inside a .photo-treated wrapper
 * (AC-G_A-15.3 + AC-G_A-15.4).
 *
 * Fails when:
 *   - The portrait <img> in Sobre.tsx is no longer wrapped by a div
 *     carrying className `photo-treated` (the CSS-layer composition from
 *     globals.css would have no anchor).
 *   - The wrapper div drops `rounded-full overflow-hidden` (the box-shadow
 *     vignette + gold overlay + grain would spill outside the circular
 *     portrait shape).
 *   - The <img> loses any of the original styling: src=augusto.portraitUrl,
 *     alt=augusto.portraitAlt, or the `h-40 w-40 sm:h-56 sm:w-56` size
 *     classes (image asset stays reusable per lead M-36 answer #5 — wrapper
 *     does the treatment, image is untouched).
 *
 * Renders the section via react-dom/server.renderToStaticMarkup (matches the
 * G_A-13 pattern: node-only, no jsdom dep, vitest's default environment is
 * sufficient).
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { Sobre } from '@/components/sections/Sobre';
import { CONTENT_PUBLIC } from '@/infrastructure/content/public';

describe('AC-G_A-15.3 + AC-G_A-15.4 — Sobre portrait photo-treated wrapper', () => {
  const html = renderToStaticMarkup(createElement(Sobre));
  const { portraitUrl, portraitAlt } = CONTENT_PUBLIC.HOME.sobre.augusto;

  test('rendered markup contains a .photo-treated wrapper div', () => {
    expect(html).toMatch(/<div\s+class="[^"]*\bphoto-treated\b[^"]*"/);
  });

  test('wrapper also carries rounded-full + overflow-hidden so the vignette clips to the portrait shape', () => {
    const wrapperMatch = html.match(/<div\s+class="([^"]*\bphoto-treated\b[^"]*)"/);
    expect(wrapperMatch, 'photo-treated wrapper missing in markup').not.toBeNull();
    const className = wrapperMatch?.[1] ?? '';
    expect(className).toMatch(/\brounded-full\b/);
    expect(className).toMatch(/\boverflow-hidden\b/);
  });

  test('the <img> sits inside the wrapper (open-div ... img ... close-div, no intervening </div>)', () => {
    const wrapperOpen = html.indexOf('photo-treated');
    const imgOpen = html.indexOf(`src="${portraitUrl}"`);
    expect(wrapperOpen, 'photo-treated wrapper missing').toBeGreaterThanOrEqual(0);
    expect(imgOpen, 'portrait img missing in markup').toBeGreaterThanOrEqual(0);
    expect(wrapperOpen).toBeLessThan(imgOpen);

    // No </div> appears between the wrapper opener and the img → img is a
    // direct child of the wrapper, not a sibling further down the DOM.
    const between = html.slice(wrapperOpen, imgOpen);
    expect(between.includes('</div>')).toBe(false);
  });

  test('image preserves original alt + size classes (AC-G_A-15.5: asset untouched)', () => {
    expect(html).toContain(`alt="${portraitAlt}"`);
    // The Tailwind size classes are preserved verbatim — wrapping must NOT
    // shrink or restyle the image itself.
    expect(html).toMatch(
      /<img[^>]*\bclass="[^"]*\bh-40\b[^"]*\bw-40\b[^"]*\bsm:h-56\b[^"]*\bsm:w-56\b/,
    );
    expect(html).toMatch(/<img[^>]*\bclass="[^"]*\brounded-full\b[^"]*\bobject-cover\b/);
  });
});
