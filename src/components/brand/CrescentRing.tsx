import type * as React from 'react';

/**
 * Brand-manual §04 logo construction primitive: a thin gold (or ink) hairline
 * ring with a crescent-moon glyph inscribed. Replaces the legacy
 * `<span aria-hidden>☽</span>` ornament + ring-border pattern at 3 callsites
 * (Hero, CtaFinal, Logo) with a single SVG-vector glyph so the moon scales
 * cleanly at every size without depending on the device font's ☽ glyph
 * fidelity.
 *
 * Server Component — no 'use client', no hooks, no client API. Pure SVG.
 */

export type CrescentTone = 'gold' | 'ink';
export type CrescentSize = 'sm' | 'md' | 'lg' | 'xl';

export type CrescentRingProps = {
  size: CrescentSize;
  tone?: CrescentTone;
};

const TONE_CLASS: Record<CrescentTone, string> = {
  gold: 'text-dorado-imperial',
  ink: 'text-tinta-nocturna',
};

const SIZE_CLASS: Record<CrescentSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-12 w-12',
  lg: 'h-16 w-16',
  xl: 'h-24 w-24',
};

export function CrescentRing({ size, tone = 'gold' }: CrescentRingProps): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      data-brand="crescent-ring"
      data-tone={tone}
      data-size={size}
      className={`inline-flex items-center justify-center ${TONE_CLASS[tone]} ${SIZE_CLASS[size]}`}
    >
      <svg
        viewBox="0 0 64 64"
        width="100%"
        height="100%"
        fill="none"
        stroke="currentColor"
        aria-hidden="true"
      >
        <circle cx={32} cy={32} r={30} strokeWidth={1.25} />
        <path
          d="M 38 14 a 18 18 0 1 0 0 36 a 14 14 0 1 1 0 -36 z"
          fill="currentColor"
          stroke="none"
        />
      </svg>
    </span>
  );
}
