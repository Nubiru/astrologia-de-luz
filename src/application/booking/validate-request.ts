// POST /api/sessions body validator. Spec anchor: S-1 AC-3.1.1.
//
// Mirrors the AC-2.2.1 sessions table contract — names, lengths, regex —
// plus the AC-3.5.1 honeypot + AC-3.5.2 min-fill-time hidden fields. Error
// messages are inline Spanish strings; the spec's `CONTENT.RESERVAR.ERRORS`
// slot is pool-a-owned (D-029 CONTENT module split) and not yet authored —
// same carve-out pattern as G_C-13's BRAND_OWNER_VISITOR_FAILURE_TEMPLATE
// (NOTIFICATIONS 2026-05-18T11:03Z). When pool-a's G_A-9 lands
// CONTENT_PUBLIC.RESERVAR.ERRORS, the strings below should migrate over
// and this module re-exports them.

import { z } from 'zod';

const VISITOR_NAME_RE = /^[\p{L}\p{M}\s'-]+$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const SLOT_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

export const ERR = {
  nameMin: 'El nombre debe tener al menos 2 caracteres.',
  nameMax: 'El nombre no puede pasar de 80 caracteres.',
  nameChars: 'El nombre tiene caracteres no permitidos.',
  email: 'Correo inválido.',
  contactPref: 'Elegí un método de contacto.',
  contactValueMin: 'El contacto debe tener al menos 5 caracteres.',
  contactValueMax: 'El contacto es demasiado largo.',
  slot: 'El horario seleccionado no es válido.',
  tz: 'Zona horaria inválida.',
  intentMax: 'La consulta es demasiado larga.',
  slug: 'Maestro inválido.',
  fillTime: 'Falta un momento — completá el formulario tranquilo.',
} as const;

const isValidTz = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

export const sessionRequestSchema = z.object({
  teacherSlug: z.string().regex(SLUG_RE, ERR.slug),
  slotUtcIso: z.string().regex(SLOT_ISO_RE, ERR.slot),
  visitorName: z
    .string()
    .min(2, ERR.nameMin)
    .max(80, ERR.nameMax)
    .regex(VISITOR_NAME_RE, ERR.nameChars),
  visitorEmail: z.string().min(1, ERR.email).max(254, ERR.email).regex(EMAIL_RE, ERR.email),
  contactPref: z.enum(['email', 'whatsapp', 'phone'], {
    errorMap: () => ({ message: ERR.contactPref }),
  }),
  contactValue: z.string().min(5, ERR.contactValueMin).max(40, ERR.contactValueMax),
  visitorTimezone: z.string().refine(isValidTz, ERR.tz),
  visitorIntent: z.string().max(500, ERR.intentMax).optional(),
  acceptsPending: z.boolean(),
});

export type SessionRequest = z.infer<typeof sessionRequestSchema>;
