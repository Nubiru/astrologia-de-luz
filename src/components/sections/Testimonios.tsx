import { CONTENT_PUBLIC } from '@/infrastructure/content/public';
import { Button } from '../brand/Button';
import { SectionReveal } from '../brand/SectionReveal';
import { SectionWrapper } from '../brand/SectionWrapper';

const TESTIMONIOS_H2_ID = 'testimonios-h2';

export function Testimonios() {
  const { heading, items, cta } = CONTENT_PUBLIC.HOME.testimonios;

  return (
    <SectionWrapper
      id="testimonios"
      tone="dark"
      ariaLabelledby={TESTIMONIOS_H2_ID}
      innerClassName="flex flex-col items-center text-center gap-10 sm:gap-14"
    >
      <SectionReveal>
        <h2
          id={TESTIMONIOS_H2_ID}
          className="font-editorial italic text-3xl sm:text-4xl md:text-5xl leading-tight text-blanco-estelar max-w-3xl"
        >
          {heading}
        </h2>
      </SectionReveal>

      <ul
        data-brand="testimonios-grid"
        className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 w-full max-w-5xl text-left"
      >
        {items.map((t) => (
          <li
            key={t.name}
            data-brand="testimonio-card"
            className="flex flex-col gap-4 p-6 border border-tinta-media bg-tinta-media/40 rounded-sm card-hover"
          >
            <span
              aria-hidden="true"
              data-brand="testimonio-quote-mark"
              className="font-display text-3xl leading-none text-dorado-imperial hanging-quote"
            >
              “
            </span>
            <blockquote className="font-editorial italic text-base sm:text-lg text-blanco-estelar leading-relaxed">
              {t.quote}
            </blockquote>
            <footer className="font-body text-sm text-plata-eterea uppercase tracking-display-md">
              <span data-brand="testimonio-name">{t.name}</span>
              {t.city ? (
                <>
                  <span aria-hidden="true"> · </span>
                  <span data-brand="testimonio-city">{t.city}</span>
                </>
              ) : null}
            </footer>
          </li>
        ))}
      </ul>

      <Button variant="light" href={cta.href}>
        {cta.text}
      </Button>
    </SectionWrapper>
  );
}
