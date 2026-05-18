import type { Metadata } from 'next';
import type * as React from 'react';

import { brandFontVariables } from './fonts';
import './globals.css';

export const HOME_TITLE_DEFAULT = 'Astrologia de Luz — Claridad para tus próximos pasos';
export const TITLE_TEMPLATE = '%s — Astrologia de Luz';
export const SITE_DESCRIPTION =
  'Lectura del cielo con Augusto Rocha. Claridad y orientación para los momentos en los que necesitás dar tu próximo paso.';
export const OG_DEFAULT_IMAGE = '/og-default.jpg';

/**
 * Pure factory so the integration pairing can build + assert the metadata
 * shape without booting the env Proxy. The runtime `metadata` export below
 * applies `env.AUTH_URL` (the canonical production origin Auth.js v5 already
 * validates as a URL — re-using it avoids a NEXT_PUBLIC_SITE_URL env sprawl
 * for the same identity).
 */
export function buildBaseMetadata(baseUrl: string): Metadata {
  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: HOME_TITLE_DEFAULT,
      template: TITLE_TEMPLATE,
    },
    description: SITE_DESCRIPTION,
    alternates: {
      canonical: '/',
    },
    openGraph: {
      type: 'website',
      siteName: 'Astrologia de Luz',
      locale: 'es_ES',
      url: '/',
      title: HOME_TITLE_DEFAULT,
      description: SITE_DESCRIPTION,
      images: [{ url: OG_DEFAULT_IMAGE, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: HOME_TITLE_DEFAULT,
      description: SITE_DESCRIPTION,
      images: [OG_DEFAULT_IMAGE],
    },
    icons: {
      icon: '/favicon.ico',
      apple: '/apple-touch-icon.png',
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

// AUTH_URL is the canonical production origin Auth.js v5 validates as a URL
// (lib/env.ts). Re-using it here (with a fallback to the brand domain) avoids
// a NEXT_PUBLIC_SITE_URL env sprawl for the same identity. Reading
// `process.env.AUTH_URL` directly — instead of through the zod-validating env
// Proxy — keeps SEO bootstrapping decoupled from Auth.js's boot-time gate, so
// the layout's `metadata` export evaluates cleanly in any context.
export const SITE_ORIGIN_FALLBACK = 'https://astrologiadeluz.com';
export const metadata: Metadata = buildBaseMetadata(process.env.AUTH_URL ?? SITE_ORIGIN_FALLBACK);

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={brandFontVariables}>
      <body>{children}</body>
    </html>
  );
}
