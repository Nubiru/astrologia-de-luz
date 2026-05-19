'use client';

/**
 * G_A-8 — Horario step (slot grid + TZ display).
 *
 * Consumes `useReservarBooking()` from `./DayStrip` (sibling provider).
 *
 * Spec anchors:
 *   - AC-1.2.6  slot button shape (role=radio, min 44×44 CSS px, HH:MM 24h).
 *   - AC-1.2.8  TZ display literal "Zona horaria: <IANA> (UTC<±HH:MM>) · Cambiar"
 *               with fallback to America/Argentina/Buenos_Aires.
 *
 * `formatTzDisplay` is exported as a pure helper so the G_A-8 unit pairing
 * (`tests/unit/slot-tz-display.test.ts`) can exercise the fallback + offset
 * formatting paths in isolation (Vitest runs in node env — no DOM).
 */

import type { ReactNode } from 'react';

import { CONTENT_PUBLIC } from '@/infrastructure/content/public';

import { type ReservarSlot, useReservarBooking } from './DayStrip';

export const TZ_DISPLAY_FALLBACK = 'America/Argentina/Buenos_Aires';

/**
 * Pure helper — derives the TZ display literal for the visitor.
 *
 * Output shape (AC-1.2.8): `Zona horaria: <IANA> (UTC<±HH:MM>) · Cambiar`.
 *
 * @param detectedTz  result of `Intl.DateTimeFormat().resolvedOptions().timeZone`
 *                    OR `null`/`undefined`/empty when detection failed.
 * @param now         injection point for tests; defaults to a fresh Date.
 *                    The current instant is needed because the UTC offset
 *                    of an IANA TZ shifts across DST transitions.
 */
export function formatTzDisplay(
  detectedTz: string | null | undefined,
  now: Date = new Date(),
): { iana: string; offsetLabel: string; display: string } {
  const candidate =
    typeof detectedTz === 'string' && detectedTz.trim().length > 0
      ? detectedTz.trim()
      : TZ_DISPLAY_FALLBACK;

  const iana = canResolveTz(candidate, now) ? candidate : TZ_DISPLAY_FALLBACK;
  const offsetLabel = computeUtcOffsetLabel(iana, now);
  const display = `${CONTENT_PUBLIC.RESERVAR.tzDisplayLabel}: ${iana} (${offsetLabel}) · ${CONTENT_PUBLIC.RESERVAR.tzDisplayChangeLabel}`;
  return { iana, offsetLabel, display };
}

function canResolveTz(tz: string, now: Date): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(now);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns `UTC±HH:MM`. `longOffset` outputs `GMT±HH:MM`; we rewrite the
 * prefix so the visible literal matches AC-1.2.8 verbatim.
 */
function computeUtcOffsetLabel(tz: string, now: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'longOffset',
    }).formatToParts(now);
    const raw = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (!raw) return 'UTC+00:00';
    // `longOffset` returns "GMT" (no offset) for UTC itself — normalize.
    if (raw === 'GMT') return 'UTC+00:00';
    return raw.replace(/^GMT/, 'UTC');
  } catch {
    return 'UTC+00:00';
  }
}

export type SlotGridProps = {
  readonly stepNumber: number;
};

const SLOT_GRID_H2_ID = 'reservar-slot-grid-h2';

export function SlotGrid({ stepNumber }: SlotGridProps) {
  const {
    status,
    visitorTz,
    slotsForSelectedDay,
    selectedDayYmd,
    selectedSlotIso,
    setSelectedSlotIso,
  } = useReservarBooking();
  const { stepLabels, slotGridAriaLabel, slotsEmptyState, idleEmptyState, pickADayHint } =
    CONTENT_PUBLIC.RESERVAR;

  const tz = formatTzDisplay(visitorTz);

  let body: ReactNode;
  if (status === 'idle') {
    body = (
      <p data-brand="horario-idle" className="mt-4 font-body text-sm text-tinta-suave">
        {idleEmptyState}
      </p>
    );
  } else if (!selectedDayYmd) {
    body = (
      <p data-brand="horario-pick-day" className="mt-4 font-body text-sm text-tinta-suave">
        {pickADayHint}
      </p>
    );
  } else if (slotsForSelectedDay.length === 0) {
    body = (
      <p data-brand="horario-empty" className="mt-4 font-body text-sm text-tinta-suave">
        {slotsEmptyState}
      </p>
    );
  } else {
    body = (
      <ul
        role="radiogroup"
        aria-label={slotGridAriaLabel}
        data-brand="slot-grid"
        className="mt-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3"
      >
        {slotsForSelectedDay.map((slot: ReservarSlot) => {
          const selected = slot.iso === selectedSlotIso;
          return (
            <li key={slot.iso} className="contents">
              <button
                type="button"
                // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA APG — slot card-radio carries label + (future) extra context; <input type=radio> cannot wrap block content.
                role="radio"
                aria-checked={selected}
                data-brand="slot-button"
                data-slot-iso={slot.iso}
                data-slot-selected={selected}
                onClick={() => setSelectedSlotIso(slot.iso)}
                className={[
                  'inline-flex items-center justify-center min-w-[44px] min-h-[44px] px-4 py-3 border rounded-sm transition-colors duration-micro ease-elegant', // stylelint-ignore custom/no-hardcode -- 44×44 is the AC-1.2.6 minimum touch-target floor (WCAG 2.5.5 Enhanced); a11y constraint, not a brand-design number — promotion to a token is single-use anti-pattern per SOUL Simplicity-Test.
                  'font-display tabular-nums uppercase tracking-display-md text-sm',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dorado-imperial',
                  selected
                    ? 'border-tinta-nocturna bg-tinta-nocturna text-blanco-estelar'
                    : 'border-tinta-suave bg-blanco-estelar text-tinta-nocturna hover:border-tinta-nocturna',
                ].join(' ')}
              >
                {slot.hhmm}
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section
      data-step="horario"
      data-step-number={stepNumber}
      aria-labelledby={SLOT_GRID_H2_ID}
      className="w-full"
    >
      <p
        data-brand="step-eyebrow"
        className="font-display uppercase tracking-display-lg text-xs text-tinta-suave"
      >
        Paso {stepNumber} · {stepLabels.horario}
      </p>
      <h2
        id={SLOT_GRID_H2_ID}
        className="mt-2 font-editorial italic text-2xl sm:text-3xl text-tinta-nocturna"
      >
        {stepLabels.horario}
      </h2>

      {body}

      <p
        data-brand="tz-display"
        data-tz-iana={tz.iana}
        data-tz-offset={tz.offsetLabel}
        className="mt-6 font-body text-xs text-tinta-suave"
      >
        {tz.display}
      </p>
    </section>
  );
}
