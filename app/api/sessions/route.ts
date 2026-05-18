// POST /api/sessions — visitor request creation (the load-bearing booking
// endpoint). Spec anchors: S-1 AC-3.1.1, AC-3.1.2, AC-3.1.3, AC-3.5.1,
// AC-3.5.2, AC-3.5.3, AC-3.5.4, R-5.
//
// Pipeline (AC-3.1.2 — persistence-before-notify is the non-negotiable
// invariant; INSERT failure path MUST NEVER reach the dispatcher):
//
//   1. Anti-abuse gates (AC-3.5):
//      a. Honeypot field `companyName` non-empty → silent 200.
//      b. Min-fill-time `_t < 800ms` → silent 200.
//      c. IP rate-limit > 3/hour → 429 + Retry-After.
//   2. zod-validate the body (AC-3.1.1) — 422 with field-keyed Spanish errors.
//   3. Maestro lookup by slug+active=true — 422 when archived or absent.
//   4. Re-derive slots in maestro tz, subtract confirmed sessions; if the
//      submitted slotUtcIso is not in the derived set → 409 with
//      `{ kind: "slot_taken", availableSlots }` so the client can re-render
//      the grid in-place (AC-3.1.3 + AC-3.6.1).
//   5. INSERT row with status='pending'. Any throw → 500 BEFORE the
//      dispatcher fires (rollback invariant).
//   6. Dispatch fan-out (3-way Promise.allSettled inside
//      lib/notify/dispatch-pending.ts; failures already isolated by the
//      dispatcher; we await so the Vercel function lifecycle does not
//      terminate mid-dispatch).
//   7. 201 with the dual-TZ shaping fields pool-a needs to render the
//      confirmation panel (AC-1.2.9).
//
// Method discipline: only POST. Other verbs return 405 with `Allow: POST`.
// Node runtime required transitively via the libsql client + the
// dispatcher's Resend HTTP transport.

import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { getDb } from '@/db/client';
import { type Session, type Teacher, sessions, teachers } from '@/db/schema';
import { deriveSlots } from '@/lib/availability/derive';
import { type Availability, AvailabilityShape } from '@/lib/availability/schema';
import { dispatchPending } from '@/lib/notify/dispatch-pending';
import type { DispatchDb } from '@/lib/notify/shared';
import { checkRateLimit, resolveIp } from '@/lib/rate-limit';
import { sessionRequestSchema } from '@/lib/validation/sessions';

export const runtime = 'nodejs';

const MIN_FILL_MS = 800;
const HORIZON_DAYS = 14;
const DURATION_MIN = 60;
const HORIZON_MS = HORIZON_DAYS * 24 * 60 * 60 * 1000;
const SLOT_TAKEN_MSG = 'Ese horario ya no está disponible.';
const MAESTRO_GONE_MSG = 'Ese maestro ya no está disponible.';
const INSERT_FAIL_MSG = 'No pudimos guardar tu solicitud. Probá de nuevo en unos minutos.';
const rateLimitMsg = (minutes: number): string =>
  `Demasiadas solicitudes. Probá de nuevo en ${minutes} minuto${minutes === 1 ? '' : 's'}.`;

// AC-3.5.1 + AC-3.5.2: silent-drop pretends success — the bot sees the same
// happy-path body but no row is written and no dispatch fires.
const silentDrop = (): Response => NextResponse.json({ kind: 'received' }, { status: 200 });

const methodNotAllowed = (): Response =>
  NextResponse.json({ kind: 'method_not_allowed' }, { status: 405, headers: { Allow: 'POST' } });

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;

export async function POST(request: NextRequest): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { kind: 'invalid_body', error: 'Cuerpo JSON inválido.' },
      { status: 422 },
    );
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return NextResponse.json(
      { kind: 'invalid_body', error: 'Cuerpo JSON inválido.' },
      { status: 422 },
    );
  }
  const body = raw as Record<string, unknown>;

  // ─── 1a. Honeypot (AC-3.5.1) ───────────────────────────────────────────
  if (typeof body.companyName === 'string' && body.companyName.trim().length > 0) {
    return silentDrop();
  }

  // ─── 1b. Min-fill-time (AC-3.5.2) ──────────────────────────────────────
  const t = body._t;
  if (typeof t !== 'number' || !Number.isFinite(t) || t < MIN_FILL_MS) {
    return silentDrop();
  }

  // ─── 1c. IP rate-limit (AC-3.5.3 + AC-3.5.4) ───────────────────────────
  const ip = resolveIp(request.headers);
  const db = getDb();
  const verdict = await checkRateLimit(db, ip);
  if (!verdict.allowed) {
    const minutes = Math.max(1, Math.ceil(verdict.retryAfterSeconds / 60));
    return NextResponse.json(
      { kind: 'rate_limited', error: rateLimitMsg(minutes) },
      {
        status: 429,
        headers: { 'Retry-After': String(verdict.retryAfterSeconds) },
      },
    );
  }

  // ─── 2. zod-validate (AC-3.1.1) ────────────────────────────────────────
  const parsed = sessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return NextResponse.json({ kind: 'invalid', fieldErrors }, { status: 422 });
  }
  const input = parsed.data;

  // ─── 3. Maestro lookup (AC-3.1.2 step 3) ───────────────────────────────
  const maestroRows = await db
    .select()
    .from(teachers)
    .where(and(eq(teachers.slug, input.teacherSlug), eq(teachers.active, true)))
    .limit(1);
  const maestro: Teacher | undefined = maestroRows[0];
  if (!maestro) {
    return NextResponse.json({ kind: 'maestro_gone', error: MAESTRO_GONE_MSG }, { status: 422 });
  }

  // ─── 4. Slot re-derive (AC-3.1.2 step 4 + R-5) ─────────────────────────
  const slotDate = new Date(input.slotUtcIso);
  if (Number.isNaN(slotDate.getTime())) {
    return NextResponse.json(
      { kind: 'invalid', fieldErrors: { slotUtcIso: 'Slot inválido.' } },
      { status: 422 },
    );
  }

  let availability: Availability | null;
  try {
    const parsedAvail = AvailabilityShape.safeParse(JSON.parse(maestro.availability));
    availability = parsedAvail.success ? parsedAvail.data : null;
  } catch {
    availability = null;
  }
  if (!availability) {
    return NextResponse.json(
      { kind: 'slot_taken', error: SLOT_TAKEN_MSG, availableSlots: [] },
      { status: 409 },
    );
  }

  const now = new Date();
  const rangeStartUtc = now;
  const rangeEndUtc = new Date(now.getTime() + HORIZON_MS);
  const confirmedRows = await db
    .select({ startsAtUtc: sessions.startsAtUtc })
    .from(sessions)
    .where(and(eq(sessions.teacherId, maestro.id), eq(sessions.status, 'confirmed')));

  const derived = deriveSlots({
    availability,
    teacherTz: maestro.timezone,
    rangeStartUtc,
    rangeEndUtc,
    durationMinutes: DURATION_MIN,
    alreadyConfirmedUtc: confirmedRows.map((r) => new Date(r.startsAtUtc)),
  });
  const slotMs = slotDate.getTime();
  const slotMatch = derived.some((d) => d.getTime() === slotMs);
  if (!slotMatch) {
    return NextResponse.json(
      {
        kind: 'slot_taken',
        error: SLOT_TAKEN_MSG,
        availableSlots: derived.map((d) => d.toISOString()),
      },
      { status: 409 },
    );
  }

  // ─── 5. INSERT pending (AC-3.1.2 step 5; rollback invariant) ───────────
  const sessionId = crypto.randomUUID();
  const nowMs = Date.now();
  let insertedSession: Session;
  try {
    const inserted = await db
      .insert(sessions)
      .values({
        id: sessionId,
        teacherId: maestro.id,
        startsAtUtc: slotMs,
        durationMinutes: DURATION_MIN,
        status: 'pending',
        visitorName: input.visitorName.trim(),
        visitorEmail: input.visitorEmail.trim().toLowerCase(),
        contactPref: input.contactPref,
        contactValue: input.contactValue.trim(),
        visitorIntent: input.visitorIntent?.trim() || null,
        visitorTimezone: input.visitorTimezone,
        createdAt: nowMs,
        updatedAt: nowMs,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('INSERT returned no row');
    insertedSession = row;
  } catch {
    return NextResponse.json({ kind: 'insert_failed', error: INSERT_FAIL_MSG }, { status: 500 });
  }

  // ─── 6. Fan-out (AC-3.2). Awaited so the serverless function lifecycle
  //     does not terminate mid-dispatch; failures already isolated inside
  //     dispatchPending via Promise.allSettled.
  await dispatchPending({
    db: db as unknown as DispatchDb,
    session: insertedSession,
    assignedMaestro: maestro,
  });

  // ─── 7. 201 confirmation (AC-3.1.2 step 7 + AC-1.2.9 dual-TZ inputs).
  return NextResponse.json(
    {
      kind: 'created',
      sessionId: insertedSession.id,
      slotUtcIso: new Date(insertedSession.startsAtUtc).toISOString(),
      maestroName: maestro.name,
      maestroTimezone: maestro.timezone,
      visitorTimezone: input.visitorTimezone,
    },
    { status: 201 },
  );
}
