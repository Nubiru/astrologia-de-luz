import { CrescentRing } from './CrescentRing';

export type LogoVariant = 'primary' | 'positive';
export type LogoSize = 'sm' | 'md' | 'lg';

export type LogoProps = {
  variant?: LogoVariant;
  size?: LogoSize;
  className?: string;
};

export const LOGO_WORDMARK = 'ASTROLOGIA DE LUZ';
export const LOGO_GLYPH = '☽';

/*
 * WORDMARK_SIZE escape-hatch — S-4 AC-G_A-12.4.
 *
 * The `sm` wordmark variant ships `text-[0.625rem]` (10px) — below the Tailwind
 * `text-xs` floor (0.75rem / 12px). This is the only hardcoded literal in the
 * brand component tree that survives the G_A-12 codemod. Rationale: a 10px
 * decorative-caps wordmark at the smallest brand-mark size is a single-use
 * brand-signal at a sub-body type-scale; promoting it to a `--text-2xs` @theme
 * token would be a single-use anti-pattern per SOUL Simplicity-Test ("Adding a
 * new token for a one-off is a Band-Aid Test failure"). Reviewer-challenge
 * clause: keep this comment unless the literal is promoted OR removed — drift
 * here means the codemod was reverted without spec update.
 */
const WORDMARK_SIZE: Record<LogoSize, string> = {
  sm: 'text-[0.625rem]', // stylelint-ignore custom/no-hardcode -- one-off: wordmark sm-variant 10px Cinzel uppercase, brand-signal at decorative size below body floor; promotion to --text-2xs token is single-use anti-pattern per SOUL Simplicity-Test.
  md: 'text-xs',
  lg: 'text-sm',
};

export function Logo({ variant = 'positive', size = 'md', className = '' }: LogoProps) {
  const isDark = variant === 'primary';
  const wordmarkTint = isDark ? 'text-blanco-estelar' : 'text-tinta-nocturna';

  return (
    <span
      data-brand="logo"
      data-variant={variant}
      className={`inline-flex flex-col items-center gap-2 ${className}`}
    >
      <CrescentRing size={size} tone={isDark ? 'gold' : 'ink'} />
      <span
        data-brand="logo-wordmark"
        className={`font-display uppercase tracking-display-hero ${WORDMARK_SIZE[size]} ${wordmarkTint}`}
      >
        {LOGO_WORDMARK}
      </span>
    </span>
  );
}
