'use client';

/**
 * G_A-9 — Post-submit confirmation panel (AC-1.2.9).
 *
 * Rendered in place of the form section on 201 Created. Shows:
 *   - Confirmation heading + lede.
 *   - The dual-TZ slot literal:
 *       `Tu solicitud: <dd> de <mes>, <HH:MM> (tu hora · <IANA-visitor>) ·
 *        <HH:MM> (hora de <teacher>, <IANA-teacher>).`
 *   - SLA line from `CONTENT_PANEL.LANDING.sla.text` (AC-3.8.1 — same slot
 *     the FAQ + the visitor-receipt email read).
 *
 * `formatConfirmationLine` is exported as a pure helper for any future test
 * that wants to lock the dual-TZ template. The visible literal renders via
 * `Intl.DateTimeFormat('es-AR', …)` so DST + month-name correctness comes
 * from the browser's tz database, not a hand-rolled table.
 */

import { CONTENT_PANEL } from '@/infrastructure/content/panel';
import { CONTENT_PUBLIC } from '@/infrastructure/content/public';

export type ConfirmationPanelProps = {
  readonly slotUtcIso: string;
  readonly maestroName: string;
  readonly maestroTimezone: string;
  readonly visitorTimezone: string;
};

/**
 * Pure helper — renders the AC-1.2.9 dual-TZ literal. Exported so tests +
 * other render paths (e.g., the visitor-receipt email body) can re-use the
 * exact same string format.
 */
export function formatConfirmationLine({
  slotUtcIso,
  maestroName,
  maestroTimezone,
  visitorTimezone,
}: ConfirmationPanelProps): string {
  const slot = new Date(slotUtcIso);
  if (Number.isNaN(slot.getTime())) return '';

  // `es-AR` produces "20 de mayo" via `{day:'numeric', month:'long'}` and
  // 24h-format HH:MM via `{hour:'2-digit', minute:'2-digit', hour12:false}`.
  const dateLabel = new Intl.DateTimeFormat('es-AR', {
    timeZone: visitorTimezone,
    day: 'numeric',
    month: 'long',
  }).format(slot);
  const visitorHHMM = new Intl.DateTimeFormat('es-AR', {
    timeZone: visitorTimezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(slot);
  const teacherHHMM = new Intl.DateTimeFormat('es-AR', {
    timeZone: maestroTimezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(slot);

  const { confirmationLineTemplate } = CONTENT_PUBLIC.RESERVAR;
  return confirmationLineTemplate
    .replace('{date}', dateLabel)
    .replace('{visitorTime}', visitorHHMM)
    .replace('{visitorTz}', visitorTimezone)
    .replace('{teacherTime}', teacherHHMM)
    .replace('{teacher}', maestroName)
    .replace('{teacherTz}', maestroTimezone);
}

const CONFIRMATION_H2_ID = 'reservar-confirmation-h2';

export function ConfirmationPanel(props: ConfirmationPanelProps): React.ReactElement {
  const { confirmationHeading, confirmationLede } = CONTENT_PUBLIC.RESERVAR;
  const line = formatConfirmationLine(props);

  return (
    <output
      data-brand="reservar-confirmation"
      aria-live="polite"
      aria-labelledby={CONFIRMATION_H2_ID}
      className="block rounded-sm border border-tinta-suave bg-blanco-estelar p-6 sm:p-8"
    >
      <h2
        id={CONFIRMATION_H2_ID}
        className="font-editorial italic text-2xl sm:text-3xl text-tinta-nocturna"
      >
        {confirmationHeading}
      </h2>
      <p data-brand="confirmation-lede" className="mt-3 font-body text-base text-tinta-nocturna">
        {confirmationLede}
      </p>
      <p
        data-brand="confirmation-line"
        data-slot-utc={props.slotUtcIso}
        data-maestro-name={props.maestroName}
        data-visitor-tz={props.visitorTimezone}
        data-maestro-tz={props.maestroTimezone}
        className="mt-6 font-body text-base text-tinta-nocturna"
      >
        {line}
      </p>
      <p data-brand="confirmation-sla" className="mt-4 font-body text-sm text-tinta-suave">
        {CONTENT_PANEL.LANDING.sla.text}
      </p>
    </output>
  );
}
