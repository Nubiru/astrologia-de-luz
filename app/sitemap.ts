import type { MetadataRoute } from 'next';

import { SITE_ORIGIN_FALLBACK } from './layout';

/**
 * v1.0 indexable surface. Panel routes (`/panel/*`) are auth-gated and
 * intentionally excluded — they're declared in `Disallow:` by robots.ts.
 *
 * Each entry pairs a path with a static priority and changeFrequency hint
 * for crawlers. Priorities reflect the conversion funnel: home is the brand
 * entry point (1.0); /reservar is the converting surface (0.8).
 */
export const SITEMAP_ENTRIES = [
  { path: '/', priority: 1.0, changeFrequency: 'monthly' as const },
  { path: '/reservar', priority: 0.8, changeFrequency: 'monthly' as const },
] as const;

export function buildSitemap(baseUrl: string, now: Date = new Date()): MetadataRoute.Sitemap {
  const origin = baseUrl.replace(/\/+$/, '');
  return SITEMAP_ENTRIES.map(({ path, priority, changeFrequency }) => ({
    url: `${origin}${path === '/' ? '' : path}` || origin,
    lastModified: now,
    changeFrequency,
    priority,
  }));
}

export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemap(process.env.AUTH_URL ?? SITE_ORIGIN_FALLBACK);
}
