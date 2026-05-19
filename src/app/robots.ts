import type { MetadataRoute } from 'next';

import { SITE_ORIGIN_FALLBACK } from './layout';

/**
 * Crawl policy: visitor surface is fully indexable; the auth-gated panel is
 * disallowed (Augusto's calendar surface must not appear in search results
 * even with magic-link gating in front of it).
 *
 * The sitemap URL is constructed from the same origin (env.AUTH_URL) so
 * `/sitemap.xml` always resolves on the same host crawlers visit.
 */
export const ROBOTS_DISALLOW = ['/panel', '/panel/', '/api/'] as const;
export const ROBOTS_ALLOW = ['/'] as const;

export function buildRobots(baseUrl: string): MetadataRoute.Robots {
  const origin = baseUrl.replace(/\/+$/, '');
  return {
    rules: [
      {
        userAgent: '*',
        allow: [...ROBOTS_ALLOW],
        disallow: [...ROBOTS_DISALLOW],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}

export default function robots(): MetadataRoute.Robots {
  return buildRobots(process.env.AUTH_URL ?? SITE_ORIGIN_FALLBACK);
}
