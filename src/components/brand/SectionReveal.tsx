import type * as React from 'react';

/**
 * Server Component wrapper that flags its children for the brand-manual §08
 * scroll-driven fade-up reveal. The CSS substrate (animation-timeline: view(),
 * @keyframes fade-up, prefers-reduced-motion shortcut, Firefox @supports
 * fallback) landed at G_A-11 in src/app/globals.css keyed on the
 * [data-reveal="fade-up"] selector — this wrapper only stamps the attribute.
 *
 * No 'use client' directive — pure server-render. Conservative scope per O-12
 * §5 Pattern 2 + lead M-36 answer #2: section headings only, no per-card
 * stagger.
 */
export function SectionReveal({ children }: { children: React.ReactNode }) {
  return <div data-reveal="fade-up">{children}</div>;
}
