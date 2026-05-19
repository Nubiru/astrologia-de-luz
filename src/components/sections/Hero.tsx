import { CONTENT_PUBLIC } from '@/infrastructure/content/public';
import { Button } from '../brand/Button';
import { CrescentRing } from '../brand/CrescentRing';
import { SectionReveal } from '../brand/SectionReveal';
import { SectionWrapper } from '../brand/SectionWrapper';

const HERO_H1_ID = 'hero-h1';

export function Hero() {
  const { eyebrow, h1, sub, cta } = CONTENT_PUBLIC.HOME.hero;

  return (
    <SectionWrapper
      id="hero"
      tone="dark"
      ariaLabelledby={HERO_H1_ID}
      className="relative overflow-hidden"
      innerClassName="flex flex-col items-center text-center gap-8 sm:gap-10"
    >
      <CrescentRing size="xl" tone="gold" />

      <p
        data-brand="hero-eyebrow"
        className="font-display uppercase tracking-display-hero text-xs text-dorado-imperial"
      >
        {eyebrow}
      </p>

      <SectionReveal>
        <h1
          id={HERO_H1_ID}
          className="font-editorial italic text-4xl sm:text-5xl md:text-6xl leading-tight text-blanco-estelar max-w-3xl"
        >
          {h1}
        </h1>
      </SectionReveal>

      <p className="font-body text-base sm:text-lg text-plata-eterea max-w-2xl">{sub}</p>

      <Button variant="light" href={cta.href}>
        {cta.text}
      </Button>
    </SectionWrapper>
  );
}
