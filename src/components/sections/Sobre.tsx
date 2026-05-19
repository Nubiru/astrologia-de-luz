import { CONTENT_PUBLIC } from '@/infrastructure/content/public';
import { Button } from '../brand/Button';
import { SectionReveal } from '../brand/SectionReveal';
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
      <SectionReveal>
        <h2
          id={SOBRE_H2_ID}
          className="font-editorial italic text-3xl sm:text-4xl md:text-5xl leading-tight text-tinta-nocturna"
        >
          {heading}
        </h2>
      </SectionReveal>

      <article
        data-brand="teacher-card"
        data-teacher-slug="augusto-rocha"
        className="flex flex-col md:flex-row md:items-start gap-2xl md:gap-3xl max-w-5xl mx-auto text-left"
      >
        <div className="rounded-full overflow-hidden photo-treated">
          <img
            src={augusto.portraitUrl}
            alt={augusto.portraitAlt}
            width={240}
            height={240}
            loading="lazy"
            className="h-40 w-40 sm:h-56 sm:w-56 rounded-full object-cover border border-tinta-suave"
          />
        </div>

        <div
          aria-hidden="true"
          data-brand="sobre-divider"
          className="hidden md:block w-px self-stretch bg-gradient-to-b from-transparent via-dorado-imperial to-transparent"
        />

        <div className="flex flex-1 flex-col gap-6 sm:gap-8">
          <header className="flex flex-col items-center gap-1 text-center md:items-start md:text-left">
            <h3 className="font-display uppercase tracking-display-lg text-base text-tinta-nocturna">
              {augusto.name}
            </h3>
            <p className="font-body text-xs text-tinta-suave uppercase tracking-display-lg">
              {augusto.role}
            </p>
          </header>

          <div className="flex flex-col gap-4 font-body text-base sm:text-lg text-tinta-media leading-relaxed">
            {augusto.bio.map((paragraph, index) => (
              <p key={paragraph.slice(0, 24)} className={index === 0 ? 'drop-cap' : undefined}>
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      </article>

      <Button variant="dark" href={cta.href}>
        {cta.text}
      </Button>
    </SectionWrapper>
  );
}
