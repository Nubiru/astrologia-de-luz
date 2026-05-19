import { CONTENT_PUBLIC } from '@/infrastructure/content/public';
import { Button } from '../brand/Button';
import { SectionWrapper } from '../brand/SectionWrapper';

const CTA_FINAL_H2_ID = 'cta-final-h2';

export function CtaFinal() {
  const { line, cta } = CONTENT_PUBLIC.HOME.ctaFinal;

  return (
    <SectionWrapper
      id="cta-final"
      tone="dark"
      ariaLabelledby={CTA_FINAL_H2_ID}
      innerClassName="flex flex-col items-center text-center gap-10 sm:gap-12"
    >
      <span
        aria-hidden="true"
        data-brand="cta-final-ornament"
        className="font-display text-3xl text-dorado-imperial"
      >
        ☽
      </span>

      <h2
        id={CTA_FINAL_H2_ID}
        className="font-editorial italic text-3xl sm:text-4xl md:text-5xl leading-tight text-blanco-estelar max-w-3xl"
      >
        {line}
      </h2>

      <Button variant="light" size="lg" href={cta.href}>
        {cta.text}
      </Button>
    </SectionWrapper>
  );
}
