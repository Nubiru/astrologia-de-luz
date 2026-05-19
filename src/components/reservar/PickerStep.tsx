import { CONTENT_PUBLIC } from '@/infrastructure/content/public';

export type PickerStepMaestro = {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly bio: string | null;
  readonly avatarUrl: string | null;
  readonly timezone: string;
};

export type PickerStepProps = {
  stepNumber: number;
  maestros: ReadonlyArray<PickerStepMaestro>;
};

const PICKER_H2_ID = 'reservar-picker-h2';
const PICKER_RADIOGROUP_LABEL = CONTENT_PUBLIC.RESERVAR.pickerHeading;

function initialsFrom(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
}

function bioExcerpt(bio: string | null): string {
  if (!bio) return CONTENT_PUBLIC.RESERVAR.pickerCardBioFallback;
  const first = bio.split(/(?<=[.!?])\s+/)[0] ?? bio;
  return first.length > 140 ? `${first.slice(0, 139).trimEnd()}…` : first;
}

export function PickerStep({ stepNumber, maestros }: PickerStepProps) {
  const { stepLabels, pickerHeading, pickerChooseLabel } = CONTENT_PUBLIC.RESERVAR;

  return (
    <section
      data-step="picker"
      data-step-number={stepNumber}
      aria-labelledby={PICKER_H2_ID}
      className="w-full"
    >
      <p
        data-brand="step-eyebrow"
        className="font-display uppercase tracking-[0.3em] text-xs text-tinta-suave"
      >
        Paso {stepNumber} · {stepLabels.maestro}
      </p>
      <h2
        id={PICKER_H2_ID}
        className="mt-2 font-editorial italic text-2xl sm:text-3xl text-tinta-nocturna"
      >
        {pickerHeading}
      </h2>

      <ul
        role="radiogroup"
        aria-label={PICKER_RADIOGROUP_LABEL}
        data-brand="picker-radiogroup"
        className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6"
      >
        {maestros.map((m, idx) => {
          const cardId = `maestro-card-${m.slug}`;
          return (
            <li key={m.id} className="contents">
              <button
                type="button"
                // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA APG card-radio pattern — <button role="radio"> is canonical when the card wraps rich content (avatar + name + bio); <input type="radio"> cannot contain block content. Pattern asserted by tests/e2e/reservar-2-maestros-4-steps.spec.ts:8,58.
                role="radio"
                aria-checked="false"
                aria-labelledby={`${cardId}-name`}
                aria-describedby={`${cardId}-bio`}
                data-brand="maestro-card"
                data-maestro-slug={m.slug}
                data-maestro-index={idx}
                className="group flex flex-col items-start gap-4 p-5 text-left border border-tinta-suave bg-blanco-estelar text-tinta-nocturna rounded-sm transition-colors hover:border-tinta-nocturna focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dorado-imperial"
              >
                {m.avatarUrl ? (
                  <img
                    src={m.avatarUrl}
                    alt={`Retrato de ${m.name}`}
                    width={96}
                    height={96}
                    loading="lazy"
                    className="h-16 w-16 rounded-full object-cover border border-tinta-suave"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    data-brand="maestro-avatar-fallback"
                    className="inline-flex h-16 w-16 items-center justify-center rounded-full border border-tinta-suave bg-plata-eterea font-display text-base text-tinta-nocturna"
                  >
                    {initialsFrom(m.name)}
                  </span>
                )}

                <span
                  id={`${cardId}-name`}
                  data-brand="maestro-name"
                  className="font-display uppercase tracking-[0.2em] text-sm"
                >
                  {m.name}
                </span>

                <span
                  id={`${cardId}-bio`}
                  data-brand="maestro-bio"
                  className="font-body text-sm text-tinta-media leading-relaxed"
                >
                  {bioExcerpt(m.bio)}
                </span>

                <span
                  data-brand="maestro-choose"
                  className="mt-auto font-display uppercase tracking-[0.3em] text-xs text-dorado-imperial group-hover:text-tinta-nocturna"
                >
                  {pickerChooseLabel}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
