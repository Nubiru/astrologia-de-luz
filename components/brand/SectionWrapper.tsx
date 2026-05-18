import type * as React from 'react';

export type SectionTone = 'dark' | 'light';

export type SectionWrapperProps = {
  id: string;
  tone: SectionTone;
  ariaLabelledby?: string;
  className?: string;
  innerClassName?: string;
  children?: React.ReactNode;
};

const TONE_CLASSES: Record<SectionTone, string> = {
  dark: 'bg-tinta-nocturna text-blanco-estelar',
  light: 'bg-blanco-estelar text-tinta-nocturna',
};

export function SectionWrapper({
  id,
  tone,
  ariaLabelledby,
  className = '',
  innerClassName = '',
  children,
}: SectionWrapperProps) {
  return (
    <section
      id={id}
      aria-labelledby={ariaLabelledby}
      data-brand="section"
      data-tone={tone}
      className={`w-full py-16 sm:py-24 px-6 sm:px-10 ${TONE_CLASSES[tone]} ${className}`}
    >
      <div className={`mx-auto max-w-5xl ${innerClassName}`}>{children}</div>
    </section>
  );
}
