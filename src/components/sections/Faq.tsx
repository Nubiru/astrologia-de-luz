import { CONTENT_PUBLIC } from '@/infrastructure/content/public';
import { SectionReveal } from '../brand/SectionReveal';
import { SectionWrapper } from '../brand/SectionWrapper';

const FAQ_H2_ID = 'faq-h2';

export function Faq() {
  const { heading, items } = CONTENT_PUBLIC.HOME.faq;

  return (
    <SectionWrapper
      id="faq"
      tone="light"
      ariaLabelledby={FAQ_H2_ID}
      innerClassName="flex flex-col items-center gap-10 sm:gap-14"
    >
      <SectionReveal>
        <h2
          id={FAQ_H2_ID}
          className="font-editorial italic text-3xl sm:text-4xl md:text-5xl leading-tight text-tinta-nocturna max-w-3xl text-center"
        >
          {heading}
        </h2>
      </SectionReveal>

      <div data-brand="faq-list" className="flex flex-col gap-2 w-full max-w-3xl">
        {items.map((entry) => (
          <details
            key={entry.q}
            data-brand="faq-entry"
            className="group border-b border-tinta-suave py-4"
          >
            <summary className="font-display uppercase tracking-display-md text-sm sm:text-base text-tinta-nocturna cursor-pointer list-none flex items-start justify-between gap-4">
              <span className="flex-1">{entry.q}</span>
              <span
                aria-hidden="true"
                className="font-display text-lg text-tinta-suave transition-transform duration-micro ease-elegant group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-3 font-body text-base text-tinta-media leading-relaxed">{entry.a}</p>
          </details>
        ))}
      </div>
    </SectionWrapper>
  );
}
