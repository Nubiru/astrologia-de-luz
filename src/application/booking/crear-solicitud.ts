/**
 * crear-solicitud.ts — visitor session request use case.
 *
 * Factory-default-instance shape per S-2 §7.2.3 D / G_C-31 / D-049 / D-050.
 * Spec anchors: S-1 AC-3.1.1, AC-3.1.2, AC-3.1.3, AC-3.5.1–AC-3.5.4, R-5.
 *
 * Extracts the orchestration body of the prior `src/app/api/sessions/route.ts`
 * POST handler. The route handler reduces to ~25 LOC: JSON parse + honeypot
 * extraction + `crearSolicitud(input)` + `CrearSolicitudOutcome` →
 * `NextResponse` translation.
 *
 * Pipeline (AC-3.1.2 — persistence-before-notify is the non-negotiable
 * invariant; INSERT failure path MUST NEVER reach the dispatcher):
 *
 *   1. Anti-abuse silent-drop (honeypot OR min-fill-time → 'received').
 *   2. IP rate-limit (`rateLimit.check(ip)` → 'rate_limited').
 *   3. Zod-validate body (→ 'invalid' fieldErrors).
 *   4. Maestro lookup (slug + active=true → 'maestro_gone' on miss).
 *   5. Slot re-derive in maestro tz, subtract confirmed sessions
 *      (→ 'slot_taken' + availableSlots if not in derived set).
 *   6. INSERT 'pending' (→ 'insert_failed' on throw).
 *   7. Dispatch fan-out (awaited; never throws on delivery failure).
 *   8. Return 'created' with session + assignedMaestro.
 */

import type { NewSession, Session, Teacher } from '@/infrastructure/db/schema';
import { resolveIp } from '@/infrastructure/rate-limit/token-bucket';
import { getComposition } from '@/main/composition';

import { type Availability, AvailabilityShape } from '@/domain/booking/availability';
import type {
  Clock,
  MaestrosReader,
  RateLimitGate,
  SessionsRepository,
} from '@/domain/booking/ports';

import { deriveSlots } from '@/application/booking/derive-availability';
import { sessionRequestSchema } from '@/application/booking/validate-request';
import { type DispatchPendingFn, dispatchPending } from '@/application/notify/dispatch-pending';

export interface CrearSolicitudDeps {
  sessions: SessionsRepository;
  maestrosReader: MaestrosReader;
  rateLimit: RateLimitGate;
  dispatch: DispatchPendingFn;
  clock: Clock;
}

export interface CrearSolicitudInput {
  rawBody: unknown;
  requestHeaders: Headers;
  honeypotCompany: string | null;
  honeypotT: number | null;
}

export type CrearSolicitudOutcome =
  | { kind: 'received' }
  | { kind: 'rate_limited'; retryAfterSeconds: number }
  | { kind: 'invalid'; fieldErrors: Record<string, string> }
  | { kind: 'invalid_body'; error: string }
  | { kind: 'slot_taken'; availableSlots: Date[] }
  | { kind: 'maestro_gone' }
  | { kind: 'insert_failed' }
  | { kind: 'created'; session: Session; assignedMaestro: Teacher };

export type CrearSolicitudFn = (input: CrearSolicitudInput) => Promise<CrearSolicitudOutcome>;

const MIN_FILL_MS = 800;
const HORIZON_DAYS = 14;
const DURATION_MIN = 60;
const HORIZON_MS = HORIZON_DAYS * 24 * 60 * 60 * 1000;

/** Factory. Tests substitute fakes via deps; production wires through composition. */
export function createCrearSolicitud(deps: CrearSolicitudDeps): CrearSolicitudFn {
  const { sessions, maestrosReader, rateLimit, dispatch, clock } = deps;

  return async (input: CrearSolicitudInput): Promise<CrearSolicitudOutcome> => {
    // ─── 1a. Honeypot (AC-3.5.1) ─────────────────────────────────────────
    if (input.honeypotCompany !== null && input.honeypotCompany.trim().length > 0) {
      return { kind: 'received' };
    }

    // ─── 1b. Min-fill-time (AC-3.5.2) ────────────────────────────────────
    if (
      input.honeypotT === null ||
      !Number.isFinite(input.honeypotT) ||
      input.honeypotT < MIN_FILL_MS
    ) {
      return { kind: 'received' };
    }

    // ─── 2. Body-shape check ─────────────────────────────────────────────
    if (
      typeof input.rawBody !== 'object' ||
      input.rawBody === null ||
      Array.isArray(input.rawBody)
    ) {
      return { kind: 'invalid_body', error: 'Cuerpo JSON inválido.' };
    }
    const body = input.rawBody as Record<string, unknown>;

    // ─── 3. IP rate-limit (AC-3.5.3 + AC-3.5.4) ──────────────────────────
    const ip = resolveIp(input.requestHeaders);
    const verdict = await rateLimit.check(ip);
    if (!verdict.allowed) {
      return { kind: 'rate_limited', retryAfterSeconds: verdict.retryAfterSeconds };
    }

    // ─── 4. zod-validate (AC-3.1.1) ──────────────────────────────────────
    const parsed = sessionRequestSchema.safeParse(body);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.');
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return { kind: 'invalid', fieldErrors };
    }
    const validated = parsed.data;

    // ─── 5. Maestro lookup (AC-3.1.2 step 3) ─────────────────────────────
    const maestro = await maestrosReader.findActiveBySlug(validated.teacherSlug);
    if (!maestro) {
      return { kind: 'maestro_gone' };
    }

    // ─── 6. Slot re-derive (AC-3.1.2 step 4 + R-5) ───────────────────────
    const slotDate = new Date(validated.slotUtcIso);
    if (Number.isNaN(slotDate.getTime())) {
      return { kind: 'invalid', fieldErrors: { slotUtcIso: 'Slot inválido.' } };
    }

    let availability: Availability | null;
    try {
      const parsedAvail = AvailabilityShape.safeParse(JSON.parse(maestro.availability));
      availability = parsedAvail.success ? parsedAvail.data : null;
    } catch {
      availability = null;
    }
    if (!availability) {
      return { kind: 'slot_taken', availableSlots: [] };
    }

    const nowDate = clock.now();
    const rangeStartUtc = nowDate;
    const rangeEndUtc = new Date(nowDate.getTime() + HORIZON_MS);
    const confirmedStarts = await sessions.confirmedStartsForMaestroInRange({
      maestroId: maestro.id,
      rangeStartUtc,
      rangeEndUtc,
    });

    const derived = deriveSlots({
      availability,
      teacherTz: maestro.timezone,
      rangeStartUtc,
      rangeEndUtc,
      durationMinutes: DURATION_MIN,
      alreadyConfirmedUtc: confirmedStarts,
    });
    const slotMs = slotDate.getTime();
    const slotMatch = derived.some((d) => d.getTime() === slotMs);
    if (!slotMatch) {
      return { kind: 'slot_taken', availableSlots: derived };
    }

    // ─── 7. INSERT 'pending' (AC-3.1.2 step 5; rollback invariant) ───────
    const sessionId = crypto.randomUUID();
    const nowMs = nowDate.getTime();
    const insertInput: NewSession = {
      id: sessionId,
      teacherId: maestro.id,
      startsAtUtc: slotMs,
      durationMinutes: DURATION_MIN,
      status: 'pending',
      visitorName: validated.visitorName.trim(),
      visitorEmail: validated.visitorEmail.trim().toLowerCase(),
      contactPref: validated.contactPref,
      contactValue: validated.contactValue.trim(),
      visitorIntent: validated.visitorIntent?.trim() || null,
      visitorTimezone: validated.visitorTimezone,
      createdAt: nowMs,
      updatedAt: nowMs,
    };

    let insertedSession: Session;
    try {
      insertedSession = await sessions.insertPending(insertInput);
    } catch {
      return { kind: 'insert_failed' };
    }

    // ─── 8. Fan-out (AC-3.2 — fire-and-forget, never rejects on delivery
    //     failure; awaited so the serverless function lifecycle does not
    //     terminate mid-dispatch).
    await dispatch({
      session: insertedSession,
      assignedMaestro: maestro,
    });

    return { kind: 'created', session: insertedSession, assignedMaestro: maestro };
  };
}

/**
 * Default-instance — reads composition lazily at each invocation so
 * __resetCompositionForTests() flushes cleanly between tests.
 */
export const crearSolicitud: CrearSolicitudFn = (input) => {
  const c = getComposition();
  return createCrearSolicitud({
    sessions: c.sessions,
    maestrosReader: c.maestrosReader,
    rateLimit: c.rateLimit,
    dispatch: dispatchPending,
    clock: c.clock,
  })(input);
};
