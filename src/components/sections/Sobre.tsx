import { CONTENT_PUBLIC } from '@/infrastructure/content/public';
import { Button } from '../brand/Button';
import { SectionWrapper } from '../brand/SectionWrapper';

const SOBRE_H2_ID = 'sobre-h2';

export function Sobre() {
  const { heading, augusto, cta } = CONTENT_PUBLIC.HOME.sobre;

  return (
    <SectionWrapper
      id="sobre"
      tone="light"
      ariaLabelledby={SOBRE_H2_ID}
      innerClassName="flex flex-col items-center text-center gap-10 sm:gap-14"
    >
      <h2
        id={SOBRE_H2_ID}
        className="font-editorial italic text-3xl sm:text-4xl md:text-5xl leading-tight text-tinta-nocturna"
      >
        {heading}
      </h2>

      <article
        data-brand="teacher-card"
        data-teacher-slug="augusto-rocha"
        className="flex flex-col items-center gap-6 sm:gap-8 max-w-3xl text-left"
      >
        <img
          src={augusto.portraitUrl}
          alt={augusto.portraitAlt}
          width={240}
          height={240}
          loading="lazy"
          className="h-40 w-40 sm:h-56 sm:w-56 rounded-full object-cover border border-tinta-suave"
        />

        <header className="flex flex-col items-center gap-1 text-center">
          <h3 className="font-display uppercase tracking-[0.3em] text-base text-tinta-nocturna">
            {augusto.name}
          </h3>
          <p className="font-body text-xs text-tinta-suave uppercase tracking-[0.3em]">
            {augusto.role}
          </p>
        </header>

        <div className="flex flex-col gap-4 font-body text-base sm:text-lg text-tinta-media leading-relaxed">
          {augusto.bio.map((paragraph) => (
            <p key={paragraph.slice(0, 24)}>{paragraph}</p>
          ))}
        </div>
      </article>

      <Button variant="dark" href={cta.href}>
        {cta.text}
      </Button>
    </SectionWrapper>
  );
}
