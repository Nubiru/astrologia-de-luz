/**
 * G_A-9 — /reservar testimonios section (AC-1.2.11).
 *
 * Pure Server Component (no client state) — renders the first 2 testimonios
 * from `CONTENT_PUBLIC.HOME.testimonios[]` between step 3 (slot grid) and
 * step 4 (form). The HOME slot is the SINGLE source of truth for testimonio
 * copy across the site; this surface shows the abbreviated set per O-5's
 * optional addition.
 *
 * AC-1.2.11 says the section hides when `< 1` entries are configured. We
 * map that to: return `null` when the slice is empty. Renderer-safe (no
 * empty container in DOM).
 */

import { CONTENT_PUBLIC } from '@/infrastructure/content/public';

export type ReservarTestimoniosProps = {
  /**
   * Maximum number of testimonios to render. AC-1.2.11 caps at 2; the
   * prop exists so the e2e specs can lock the upper bound explicitly.
   */
  readonly limit?: number;
};

const DEFAULT_LIMIT = 2;

export function ReservarTestimonios({
  limit = DEFAULT_LIMIT,
}: ReservarTestimoniosProps = {}): React.ReactElement | null {
  const all = CONTENT_PUBLIC.HOME.testimonios.items;
  const slice = all.slice(0, Math.max(0, limit));
  if (slice.length < 1) return null;

  const { reservarTestimoniosEyebrow, reservarTestimoniosHeading } = CONTENT_PUBLIC.RESERVAR;

  return (
    <section
      data-brand="reservar-testimonios"
      data-testimonio-count={slice.length}
      aria-labelledby="reservar-testimonios-h2"
      className="w-full"
    >
      <p
        data-brand="step-eyebrow"
        className="font-display uppercase tracking-display-lg text-xs text-tinta-suave"
      >
        {reservarTestimoniosEyebrow}
      </p>
      <h2
        id="reservar-testimonios-h2"
        className="mt-2 font-editorial italic text-2xl sm:text-3xl text-tinta-nocturna"
      >
        {reservarTestimoniosHeading}
      </h2>

      <ul
        data-brand="reservar-testimonios-list"
        className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6"
      >
        {slice.map((t, idx) => (
          <li
            key={`${t.name}-${t.city}`}
            data-brand="reservar-testimonio-card"
            data-testimonio-index={idx}
            className="p-5 border border-tinta-suave bg-blanco-estelar rounded-sm flex flex-col gap-3"
          >
            <p
              data-brand="testimonio-quote"
              className="font-editorial italic text-base sm:text-lg text-tinta-nocturna leading-relaxed"
            >
              “{t.quote}”
            </p>
            <p data-brand="testimonio-attribution" className="font-body text-sm text-tinta-suave">
              <span data-brand="testimonio-name">{t.name}</span>
              <span aria-hidden="true"> · </span>
              <span data-brand="testimonio-city">{t.city}</span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
