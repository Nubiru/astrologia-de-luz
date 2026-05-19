// POST /api/sessions — visitor request creation. Thin HTTP-translation
// layer; orchestration lives at @/application/booking/crear-solicitud.
//
// Spec anchors: S-1 AC-3.1.1–AC-3.5.4 + S-2 §7.2.6 A (extract plan).
//
// Method discipline: only POST. Other verbs return 405 with `Allow: POST`.
// Node runtime required transitively via the libsql client + the
// dispatcher's Resend HTTP transport.

import { type NextRequest, NextResponse } from 'next/server';

import { type CrearSolicitudOutcome, crearSolicitud } from '@/application/booking/crear-solicitud';

export const runtime = 'nodejs';

const SLOT_TAKEN_MSG = 'Ese horario ya no está disponible.';
const MAESTRO_GONE_MSG = 'Ese maestro ya no está disponible.';
const INSERT_FAIL_MSG = 'No pudimos guardar tu solicitud. Probá de nuevo en unos minutos.';
const rateLimitMsg = (minutes: number): string =>
  `Demasiadas solicitudes. Probá de nuevo en ${minutes} minuto${minutes === 1 ? '' : 's'}.`;

const methodNotAllowed = (): Response =>
  NextResponse.json({ kind: 'method_not_allowed' }, { status: 405, headers: { Allow: 'POST' } });

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;

export async function POST(request: NextRequest): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { kind: 'invalid_body', error: 'Cuerpo JSON inválido.' },
      { status: 422 },
    );
  }

  const body =
    typeof rawBody === 'object' && rawBody !== null && !Array.isArray(rawBody)
      ? (rawBody as Record<string, unknown>)
      : {};
  const honeypotCompany = typeof body.companyName === 'string' ? body.companyName : null;
  const honeypotT = typeof body._t === 'number' ? body._t : null;

  const outcome = await crearSolicitud({
    rawBody,
    requestHeaders: request.headers,
    honeypotCompany,
    honeypotT,
  });

  return translateOutcomeToResponse(outcome);
}

function translateOutcomeToResponse(outcome: CrearSolicitudOutcome): Response {
  switch (outcome.kind) {
    case 'received':
      return NextResponse.json({ kind: 'received' }, { status: 200 });
    case 'rate_limited': {
      const minutes = Math.max(1, Math.ceil(outcome.retryAfterSeconds / 60));
      return NextResponse.json(
        { kind: 'rate_limited', error: rateLimitMsg(minutes) },
        { status: 429, headers: { 'Retry-After': String(outcome.retryAfterSeconds) } },
      );
    }
    case 'invalid':
      return NextResponse.json(
        { kind: 'invalid', fieldErrors: outcome.fieldErrors },
        { status: 422 },
      );
    case 'invalid_body':
      return NextResponse.json({ kind: 'invalid_body', error: outcome.error }, { status: 422 });
    case 'maestro_gone':
      return NextResponse.json({ kind: 'maestro_gone', error: MAESTRO_GONE_MSG }, { status: 422 });
    case 'slot_taken':
      return NextResponse.json(
        {
          kind: 'slot_taken',
          error: SLOT_TAKEN_MSG,
          availableSlots: outcome.availableSlots.map((d) => d.toISOString()),
        },
        { status: 409 },
      );
    case 'insert_failed':
      return NextResponse.json({ kind: 'insert_failed', error: INSERT_FAIL_MSG }, { status: 500 });
    case 'created':
      return NextResponse.json(
        {
          kind: 'created',
          sessionId: outcome.session.id,
          slotUtcIso: new Date(outcome.session.startsAtUtc).toISOString(),
          maestroName: outcome.assignedMaestro.name,
          maestroTimezone: outcome.assignedMaestro.timezone,
          visitorTimezone: outcome.session.visitorTimezone,
        },
        { status: 201 },
      );
  }
}
