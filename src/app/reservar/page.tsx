import type { Metadata } from 'next';

import { Footer } from '@/components/brand/Footer';
import { SectionWrapper } from '@/components/brand/SectionWrapper';
import { PickerStep, type PickerStepMaestro } from '@/components/reservar/PickerStep';
import { CONTENT_PUBLIC } from '@/infrastructure/content/public';
import { getDb } from '@/infrastructure/db/client';
import { teachers } from '@/infrastructure/db/schema';
import { asc, eq } from 'drizzle-orm';

export const runtime = 'nodejs';
// G_C-25: /reservar reads `teachers` from libsql via `getDb()` on every render.
// Next 16's default SSG behaviour would attempt to prerender this page at build
// time — which calls `getDb()` and therefore `getEnv()`, which throws when
// production env vars are absent at build (`npm run qa` locally). Marking the
// page dynamic opts out of SSG so env is only accessed per-request. The DB
// read is per-visitor anyway (active-maestros catalog can be mutated by admin
// CRUD); SSG'ing it would freeze the catalog at deploy time.
export const dynamic = 'force-dynamic';

// Per-page metadata — composes with the root layout's `title.template`
// ("%s — Astrologia de Luz") so the rendered <title> is exactly
// "Reservar sesión — Astrologia de Luz" per AC-1.7.1.
export const metadata: Metadata = {
  title: 'Reservar sesión',
  alternates: { canonical: '/reservar' },
};

/**
 * Pool-a-owned active-maestros query. Mirrors G_C-9's
 * `src/app/api/teachers/route.ts` projection so the picker can read the same
 * shape with or without the HTTP hop. Server Components are encouraged to
 * read the DB directly per Next 16 App Router conventions; the `/api/teachers`
 * route stays in place for cross-system + client-side consumers.
 */
async function loadActiveMaestros(): Promise<PickerStepMaestro[]> {
  const rows = await getDb()
    .select({
      id: teachers.id,
      slug: teachers.slug,
      name: teachers.name,
      bio: teachers.bio,
      avatarUrl: teachers.avatarUrl,
      timezone: teachers.timezone,
    })
    .from(teachers)
    .where(eq(teachers.active, true))
    .orderBy(asc(teachers.name));
  return rows;
}

const PAGE_H1_ID = 'reservar-h1';

export default async function ReservarPage() {
  const maestros = await loadActiveMaestros();
  const single = maestros.length === 1 ? maestros[0] : null;
  const { RESERVAR } = CONTENT_PUBLIC;

  const sub = single
    ? RESERVAR.subWithMaestroTemplate.replace('{name}', single.name)
    : RESERVAR.subDefault;

  // AC-1.2.2 / AC-1.2.4 — when EXACTLY 1 active maestro the picker step is
  // OMITTED ENTIRELY. The remaining three steps re-number 1/2/3.
  const showPicker = maestros.length >= 2;
  const stepNumberFor = (id: 'picker' | 'dia' | 'horario' | 'form'): number => {
    const order = showPicker
      ? (['picker', 'dia', 'horario', 'form'] as const)
      : (['dia', 'horario', 'form'] as const);
    const idx = (order as readonly string[]).indexOf(id);
    return idx === -1 ? -1 : idx + 1;
  };

  return (
    <>
      <SectionWrapper
        id="reservar-hero"
        tone="dark"
        ariaLabelledby={PAGE_H1_ID}
        innerClassName="flex flex-col items-center text-center gap-6 sm:gap-8"
      >
        <p
          data-brand="reservar-eyebrow"
          className="font-display uppercase tracking-[0.5em] text-xs text-dorado-imperial"
        >
          ASTROLOGIA DE LUZ
        </p>
        <h1
          id={PAGE_H1_ID}
          className="font-editorial italic text-4xl sm:text-5xl md:text-6xl leading-tight text-blanco-estelar max-w-3xl"
        >
          {RESERVAR.heading}
        </h1>
        <p
          data-brand="reservar-sub"
          data-single-maestro={single ? single.slug : null}
          className="font-body text-base sm:text-lg text-plata-eterea max-w-2xl"
        >
          {sub}
        </p>
      </SectionWrapper>

      <SectionWrapper
        id="reservar-steps"
        tone="light"
        innerClassName="flex flex-col gap-14 sm:gap-20"
      >
        {showPicker ? (
          <PickerStep stepNumber={stepNumberFor('picker')} maestros={maestros} />
        ) : null}

        <section data-step="dia" data-step-number={stepNumberFor('dia')} className="w-full">
          <p
            data-brand="step-eyebrow"
            className="font-display uppercase tracking-[0.3em] text-xs text-tinta-suave"
          >
            Paso {stepNumberFor('dia')} · {RESERVAR.stepLabels.dia}
          </p>
          <h2 className="mt-2 font-editorial italic text-2xl sm:text-3xl text-tinta-nocturna">
            {RESERVAR.stepLabels.dia}
          </h2>
          <p className="mt-4 font-body text-sm text-tinta-suave">{RESERVAR.stepPlaceholders.dia}</p>
        </section>

        <section data-step="horario" data-step-number={stepNumberFor('horario')} className="w-full">
          <p
            data-brand="step-eyebrow"
            className="font-display uppercase tracking-[0.3em] text-xs text-tinta-suave"
          >
            Paso {stepNumberFor('horario')} · {RESERVAR.stepLabels.horario}
          </p>
          <h2 className="mt-2 font-editorial italic text-2xl sm:text-3xl text-tinta-nocturna">
            {RESERVAR.stepLabels.horario}
          </h2>
          <p className="mt-4 font-body text-sm text-tinta-suave">
            {RESERVAR.stepPlaceholders.horario}
          </p>
        </section>

        <section data-step="form" data-step-number={stepNumberFor('form')} className="w-full">
          <p
            data-brand="step-eyebrow"
            className="font-display uppercase tracking-[0.3em] text-xs text-tinta-suave"
          >
            Paso {stepNumberFor('form')} · {RESERVAR.stepLabels.form}
          </p>
          <h2 className="mt-2 font-editorial italic text-2xl sm:text-3xl text-tinta-nocturna">
            {RESERVAR.stepLabels.form}
          </h2>
          <p className="mt-4 font-body text-sm text-tinta-suave">
            {RESERVAR.stepPlaceholders.form}
          </p>
        </section>
      </SectionWrapper>

      <Footer />
    </>
  );
}
