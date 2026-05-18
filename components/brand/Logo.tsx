export type LogoVariant = 'primary' | 'positive';
export type LogoSize = 'sm' | 'md' | 'lg';

export type LogoProps = {
  variant?: LogoVariant;
  size?: LogoSize;
  className?: string;
};

export const LOGO_WORDMARK = 'ASTROLOGIA DE LUZ';
export const LOGO_GLYPH = '☽';

const SIZE_CLASSES: Record<LogoSize, { ring: string; wordmark: string }> = {
  sm: { ring: 'h-8 w-8 text-base', wordmark: 'text-[0.625rem]' },
  md: { ring: 'h-12 w-12 text-xl', wordmark: 'text-xs' },
  lg: { ring: 'h-16 w-16 text-2xl', wordmark: 'text-sm' },
};

export function Logo({ variant = 'positive', size = 'md', className = '' }: LogoProps) {
  const isDark = variant === 'primary';
  const ringTint = isDark
    ? 'border-dorado-imperial text-dorado-imperial'
    : 'border-tinta-nocturna text-tinta-nocturna';
  const wordmarkTint = isDark ? 'text-blanco-estelar' : 'text-tinta-nocturna';
  const { ring: ringSize, wordmark: wordmarkSize } = SIZE_CLASSES[size];

  return (
    <span
      data-brand="logo"
      data-variant={variant}
      className={`inline-flex flex-col items-center gap-2 ${className}`}
    >
      <span
        aria-hidden="true"
        data-brand="logo-mark"
        className={`relative inline-flex items-center justify-center rounded-full border ${ringTint} ${ringSize}`}
      >
        {LOGO_GLYPH}
      </span>
      <span
        data-brand="logo-wordmark"
        className={`font-display uppercase tracking-[0.4em] ${wordmarkSize} ${wordmarkTint}`}
      >
        {LOGO_WORDMARK}
      </span>
    </span>
  );
}
