import type * as React from 'react';

export type ButtonVariant = 'dark' | 'light';
export type ButtonSize = 'md' | 'lg';

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: React.ReactNode;
};

type ButtonAsButton = CommonProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps | 'href'> & {
    href?: undefined;
  };

type ButtonAsAnchor = CommonProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps> & {
    href: string;
  };

export type BrandButtonProps = ButtonAsButton | ButtonAsAnchor;

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: 'min-h-11 px-6 text-sm',
  lg: 'min-h-12 px-8 text-base',
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // dark = ink-on-light. Sits on blanco-estelar sections.
  // Per O-6 §6: ink-bg + blanco-estelar text = AAA on light bg.
  dark: 'bg-tinta-nocturna text-blanco-estelar border border-tinta-nocturna hover:bg-tinta-media',
  // light = blanco-estelar-on-dark. Sits on tinta-nocturna sections.
  // blanco-estelar bg + tinta-nocturna text = AAA on dark bg.
  light: 'bg-blanco-estelar text-tinta-nocturna border border-blanco-estelar hover:bg-plata-eterea',
};

const BASE_CLASSES =
  'inline-flex items-center justify-center font-display uppercase tracking-[0.2em] no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dorado-imperial disabled:opacity-50 disabled:cursor-not-allowed';

function buildClassName(variant: ButtonVariant, size: ButtonSize, extra: string) {
  return `${BASE_CLASSES} ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${extra}`.trim();
}

export function Button(props: BrandButtonProps) {
  const { variant = 'dark', size = 'lg', className = '', children } = props;
  const classes = buildClassName(variant, size, className);
  const dataAttrs = { 'data-brand': 'button', 'data-variant': variant } as const;

  if ('href' in props && props.href !== undefined) {
    const { variant: _v, size: _s, className: _c, children: _ch, href, ...rest } = props;
    return (
      <a href={href} className={classes} {...dataAttrs} {...rest}>
        {children}
      </a>
    );
  }

  const {
    variant: _v,
    size: _s,
    className: _c,
    children: _ch,
    type,
    href: _h,
    ...rest
  } = props as ButtonAsButton;
  return (
    <button type={type ?? 'button'} className={classes} {...dataAttrs} {...rest}>
      {children}
    </button>
  );
}
