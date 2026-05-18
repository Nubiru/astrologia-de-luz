// PATCH /api/sessions/[id] — panel-side status transitions + notes_internal
// updates. Spec anchors: S-1 AC-2.2.4, AC-2.2.5, AC-3.4.1–AC-3.4.4.
//
// Pipeline (AC-2.2.5 verbatim):
//   1. Auth-gate: `auth()` from `@/auth` returns a session; the user's email
//      must still match `ADMIN_EMAILS` (defense-in-depth — Auth.js's signIn
//      callback already gates sign-in, but cookies survive allowlist edits).
//   2. zod-validate the body — `{ status: <new>, note?: string }` for a
//      status flip OR `{ note: string }` for the AC-3.4.4 note-only variant.
//   3. Open a libsql transaction. Re-read the row, verify the (from, to)
//      pair is in the AC-2.2.4 allow-list, verify the AC-2.2.4 time-guard
//      for `confirmed → completed | no_show`. Apply the UPDATE inside the
//      same transaction — `status` + `updated_at` always; `decided_at` only
//      when currently NULL (the "first non-pending transition" invariant);
//      `notes_internal` when supplied.
//   4. Commit.
//   5. AFTER commit (NOT inside the transaction), fire the post-transition
//      dispatcher (AC-3.4.2). The dispatcher itself never throws on
//      delivery failure — it logs into notify_log per AC-3.3.1, so the
//      PATCH response is independent of the email delivery outcome.
//
// Invalid transitions → 409 with `{ kind: 'invalid_transition', from, to }`
// + the Spanish error body from `CONTENT_PANEL.ERRORS.invalidTransition`.
//
// Method gating: only PATCH is exported. Other verbs return 405 + Allow.
// Node runtime — transitively pulls in @libsql/client + the dispatcher's
// Resend HTTP transport.

import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/auth';
import { getDb } from '@/db/client';
import { type Session, type Teacher, sessions, teachers } from '@/db/schema';
import { isAdminEmail } from '@/lib/auth/allowlist';
import { CONTENT_PANEL } from '@/lib/content';
import { getEnv } from '@/lib/env';
import { type SessionStatus, dispatchTransition } from '@/lib/notify/dispatch-transition';
import type { DispatchDb } from '@/lib/notify/shared';

export const runtime = 'nodejs';

const ALL_STATUSES = [
  'pending',
  'confirmed',
  'cancelled',
  'rejected',
  'no_show',
  'completed',
] as const satisfies readonly SessionStatus[];

// AC-2.2.4 — the 6 allowed transitions out of the 36 possible (from, to)
// pairs. Same-state pairs (e.g., pending→pending) are NOT allowed; terminal
// states (cancelled, rejected, completed, no_show) have zero allowed
// outgoing transitions.
const ALLOWED_TRANSITIONS: ReadonlySet<string> = new Set([
  'pending->confirmed',
  'pending->rejected',
  'pending->cancelled',
  'confirmed->cancelled',
  'confirmed->completed',
  'confirmed->no_show',
]);

// AC-2.2.4 — the two time-guarded transitions can only fire after the
// session's scheduled end time. `now()` defaults to `Date.now()`; the
// integration pairing can override for deterministic testing.
function timeGuardSatisfied(
  from: SessionStatus,
  to: SessionStatus,
  session: Session,
  now: number,
): boolean {
  if (from === 'confirmed' && (to === 'completed' || to === 'no_show')) {
    return now >= session.startsAtUtc + session.durationMinutes * 60_000;
  }
  return true;
}

const bodySchema = z
  .object({
    status: z.enum(ALL_STATUSES).optional(),
    note: z.string().optional(),
  })
  .refine((d) => d.status !== undefined || d.note !== undefined, {
    message: 'Se requiere status o note.',
  });

const methodNotAllowed = (): Response =>
  NextResponse.json({ kind: 'method_not_allowed' }, { status: 405, headers: { Allow: 'PATCH' } });

export const GET = methodNotAllowed;
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;

type TxResult =
  | { kind: 'ok'; row: Session; previousStatus: SessionStatus; statusChanged: boolean }
  | { kind: 'not_found' }
  | { kind: 'invalid_transition'; from: SessionStatus; to: SessionStatus }
  | { kind: 'guard_failed'; from: SessionStatus; to: SessionStatus };

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // ─── 1. Auth-gate (AC-3.4.1 + lista-de-acceso defense-in-depth) ───────
  const authSession = await auth();
  const callerEmail = authSession?.user?.email;
  if (!callerEmail || !isAdminEmail(callerEmail, getEnv().ADMIN_EMAILS)) {
    return NextResponse.json({ kind: 'unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  // ─── 2. Parse + validate body ─────────────────────────────────────────
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
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return NextResponse.json({ kind: 'invalid', fieldErrors }, { status: 422 });
  }
  const { status: newStatus, note } = parsed.data;

  const db = getDb();
  const now = Date.now();

  // ─── 3 + 4. Transactional re-read + guard + UPDATE + commit (AC-2.2.5) ─
  const txResult = await db.transaction(async (tx): Promise<TxResult> => {
    const rows = await tx.select().from(sessions).where(eq(sessions.id, id)).limit(1);
    const current = rows[0];
    if (!current) return { kind: 'not_found' };

    const fromStatus = current.status as SessionStatus;

    if (newStatus !== undefined) {
      const transitionKey = `${fromStatus}->${newStatus}`;
      if (!ALLOWED_TRANSITIONS.has(transitionKey)) {
        return { kind: 'invalid_transition', from: fromStatus, to: newStatus };
      }
      if (!timeGuardSatisfied(fromStatus, newStatus, current, now)) {
        // Guard failure still surfaces as invalid_transition to the caller —
        // from the panel UI's perspective the affordance was offered too
        // early (e.g., completed button before session end). AC-3.4.3
        // unifies the 409 surface; the kind discriminator lets the UI hint
        // at the cause when needed.
        return { kind: 'guard_failed', from: fromStatus, to: newStatus };
      }

      // AC-2.2.5 — set status + updated_at always; decided_at only if NULL.
      const updateValues: Partial<Session> = {
        status: newStatus,
        updatedAt: now,
      };
      if (current.decidedAt === null) updateValues.decidedAt = now;
      if (note !== undefined) updateValues.notesInternal = note;

      const updated = await tx
        .update(sessions)
        .set(updateValues)
        .where(eq(sessions.id, id))
        .returning();
      const row = updated[0];
      if (!row) return { kind: 'not_found' };
      return { kind: 'ok', row, previousStatus: fromStatus, statusChanged: true };
    }

    // AC-3.4.4 — note-only variant. No status flip, no email side-effect.
    if (note !== undefined) {
      const updated = await tx
        .update(sessions)
        .set({ notesInternal: note, updatedAt: now })
        .where(eq(sessions.id, id))
        .returning();
      const row = updated[0];
      if (!row) return { kind: 'not_found' };
      return { kind: 'ok', row, previousStatus: fromStatus, statusChanged: false };
    }

    // Unreachable — zod refine already rejects empty payloads. Belt-and-
    // braces in case the schema is later relaxed without updating this
    // branch.
    return { kind: 'not_found' };
  });

  if (txResult.kind === 'not_found') {
    return NextResponse.json({ kind: 'not_found' }, { status: 404 });
  }
  if (txResult.kind === 'invalid_transition' || txResult.kind === 'guard_failed') {
    // AC-3.4.3 verbatim: the response body's `kind` discriminator is
    // `'invalid_transition'` for every 409 (the panel UI does not yet
    // surface a distinct "wait until session ends" affordance — that's a
    // v1.1 candidate). `guardFailed` is exposed as a boolean side-channel
    // so a future UI can hint at the cause without breaking the contract.
    const errorText = CONTENT_PANEL.ERRORS.invalidTransition
      .replace('{from}', txResult.from)
      .replace('{to}', txResult.to);
    return NextResponse.json(
      {
        kind: 'invalid_transition',
        from: txResult.from,
        to: txResult.to,
        guardFailed: txResult.kind === 'guard_failed',
        error: errorText,
      },
      { status: 409 },
    );
  }

  // ─── 5. AFTER-commit dispatch (AC-3.4.2 — outside the transaction) ─────
  if (txResult.statusChanged) {
    const maestroRows = await db
      .select()
      .from(teachers)
      .where(eq(teachers.id, txResult.row.teacherId))
      .limit(1);
    const maestro = maestroRows[0] as Teacher | undefined;
    if (maestro) {
      await dispatchTransition({
        db: db as unknown as DispatchDb,
        session: txResult.row,
        previousStatus: txResult.previousStatus,
        assignedMaestro: maestro,
      });
    }
  }

  return NextResponse.json(
    {
      kind: txResult.statusChanged ? 'updated' : 'note_updated',
      session: txResult.row,
    },
    { status: 200 },
  );
}
