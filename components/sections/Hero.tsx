import { CONTENT_PUBLIC } from '../../lib/content/public';
import { Button } from '../brand/Button';
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
      <span
        aria-hidden="true"
        data-brand="hero-ornament"
        className="relative inline-flex h-24 w-24 items-center justify-center rounded-full border border-dorado-imperial text-3xl text-dorado-imperial"
      >
        ☽
      </span>

      <p
        data-brand="hero-eyebrow"
        className="font-display uppercase tracking-[0.5em] text-xs text-dorado-imperial"
      >
        {eyebrow}
      </p>

      <h1
        id={HERO_H1_ID}
        className="font-editorial italic text-4xl sm:text-5xl md:text-6xl leading-tight text-blanco-estelar max-w-3xl"
      >
        {h1}
      </h1>

      <p className="font-body text-base sm:text-lg text-plata-eterea max-w-2xl">{sub}</p>

      <Button variant="light" href={cta.href}>
        {cta.text}
      </Button>
    </SectionWrapper>
  );
}
