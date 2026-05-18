import { CONTENT_PUBLIC } from '../../lib/content/public';
import { Button } from '../brand/Button';
import { SectionWrapper } from '../brand/SectionWrapper';

const PROBLEMAS_H2_ID = 'problemas-h2';

export function Problemas() {
  const { heading, items, cta } = CONTENT_PUBLIC.HOME.problemas;

  return (
    <SectionWrapper
      id="problemas"
      tone="light"
      ariaLabelledby={PROBLEMAS_H2_ID}
      innerClassName="flex flex-col items-center text-center gap-10 sm:gap-14"
    >
      <h2
        id={PROBLEMAS_H2_ID}
        className="font-editorial italic text-3xl sm:text-4xl md:text-5xl leading-tight text-tinta-nocturna max-w-3xl"
      >
        {heading}
      </h2>

      <ul
        data-brand="problemas-grid"
        className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8 w-full max-w-3xl text-left"
      >
        {items.map((text) => (
          <li
            key={text}
            data-brand="problema-card"
            className="font-body text-base sm:text-lg text-tinta-media border-l-2 border-tinta-suave pl-5 py-2"
          >
            {text}
          </li>
        ))}
      </ul>

      <Button variant="dark" href={cta.href}>
        {cta.text}
      </Button>
    </SectionWrapper>
  );
}
