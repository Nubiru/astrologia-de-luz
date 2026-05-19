import { CONTENT_PUBLIC } from '@/infrastructure/content/public';
import { Button } from '../brand/Button';
import { SectionWrapper } from '../brand/SectionWrapper';

const SERVICIOS_H2_ID = 'servicios-h2';

export function Servicios() {
  const { heading, items, cta } = CONTENT_PUBLIC.HOME.servicios;

  return (
    <SectionWrapper
      id="servicios"
      tone="dark"
      ariaLabelledby={SERVICIOS_H2_ID}
      innerClassName="flex flex-col items-center text-center gap-10 sm:gap-14"
    >
      <h2
        id={SERVICIOS_H2_ID}
        className="font-editorial italic text-3xl sm:text-4xl md:text-5xl leading-tight text-blanco-estelar max-w-3xl"
      >
        {heading}
      </h2>

      <ul
        data-brand="servicios-grid"
        className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 w-full max-w-5xl text-left"
      >
        {items.map((service) => (
          <li
            key={service.name}
            data-brand="servicio-card"
            className="flex flex-col gap-3 p-6 border border-tinta-media bg-tinta-media/40 rounded-sm"
          >
            <h3 className="font-display uppercase tracking-[0.2em] text-sm text-dorado-imperial">
              <span data-brand="servicio-name">{service.name}</span>
            </h3>
            <p
              data-brand="servicio-duration"
              className="font-body text-xs text-plata-eterea uppercase tracking-[0.3em]"
            >
              {service.duration}
            </p>
            <p
              data-brand="servicio-resultado"
              className="font-body text-sm sm:text-base text-blanco-estelar leading-relaxed"
            >
              {service.resultado}
            </p>
          </li>
        ))}
      </ul>

      <Button variant="light" href={cta.href}>
        {cta.text}
      </Button>
    </SectionWrapper>
  );
}
