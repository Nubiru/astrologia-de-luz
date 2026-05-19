// PATCH /api/sessions/[id] — panel-side status transitions + notes_internal
// updates. Spec anchors: S-1 AC-2.2.4, AC-2.2.5, AC-3.4.1–AC-3.4.4 + S-2
// §7.2.6 B.
//
// Hybrid shape (deviation from §7.2.6 B's "action: approve/reject" narrowing
// flagged in G_C-31 close-note): the route preserves the legacy
// `body.status: newStatus` contract so patch-sessions-6x6.test.ts continues
// to drive all 6 transitions without migration. The aprobarSesion +
// rechazarSesion use cases (G_C-31) are exposed for future direct callers
// (admin SDK, CLI) and unit-tested in isolation; the route still owns the
// transaction + decided_at + notes_internal axes because the port surface
// doesn't yet cover those.
//
// Pipeline (AC-2.2.5):
//   1. Auth-gate: auth() session + isAdminEmail (defense-in-depth — Auth.js's
//      signIn callback gates sign-in but cookies survive allowlist edits).
//   2. zod-validate body: { status?, note? } — refine requires one of them.
//   3. Open libsql transaction. Re-read row, verify (from, to) allow-list,
//      verify time-guard for confirmed → completed | no_show. Apply UPDATE
//      inside the transaction — status + updated_at always; decided_at only
//      when currently NULL; notes_internal when supplied.
//   4. Commit.
//   5. AFTER commit (not inside the transaction), fire the post-transition
//      dispatcher (AC-3.4.2). The dispatcher never throws on delivery
//      failure — logs to notify_log per AC-3.3.1.

import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { type SessionStatus, dispatchTransition } from '@/application/notify/dispatch-transition';
import { isAdminEmail } from '@/infrastructure/auth/allowlist';
import { auth } from '@/infrastructure/auth/config';
import { CONTENT_PANEL } from '@/infrastructure/content';
import { getDb } from '@/infrastructure/db/client';
import { type Session, type Teacher, sessions, teachers } from '@/infrastructure/db/schema';
import { getEnv } from '@/infrastructure/env';

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
// pairs.
const ALLOWED_TRANSITIONS: ReadonlySet<string> = new Set([
  'pending->confirmed',
  'pending->rejected',
  'pending->cancelled',
  'confirmed->cancelled',
  'confirmed->completed',
  'confirmed->no_show',
]);

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
  // ─── 1. Auth-gate ─────────────────────────────────────────────────────
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

  // ─── 3 + 4. Transactional re-read + guard + UPDATE + commit ───────────
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
        return { kind: 'guard_failed', from: fromStatus, to: newStatus };
      }

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

    return { kind: 'not_found' };
  });

  if (txResult.kind === 'not_found') {
    return NextResponse.json({ kind: 'not_found' }, { status: 404 });
  }
  if (txResult.kind === 'invalid_transition' || txResult.kind === 'guard_failed') {
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

  // ─── 5. AFTER-commit dispatch (AC-3.4.2 — outside the transaction) ────
  if (txResult.statusChanged) {
    const maestroRows = await db
      .select()
      .from(teachers)
      .where(eq(teachers.id, txResult.row.teacherId))
      .limit(1);
    const maestro = maestroRows[0] as Teacher | undefined;
    if (maestro) {
      await dispatchTransition({
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
