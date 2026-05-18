// POST /api/notify/[id]/retry — manual "Reenviar" recovery endpoint
// (spec anchors: AC-3.3.4 + AC-3.3.5).
//
// Visitor-facing contract: panel-authed only. The route is reachable through
// the per-row "Reenviar" button on `/panel/agenda/notificaciones-fallidas`
// (G_B-7); unauthenticated visitors get 401. The cookie gate is `auth()` from
// `@/auth` — the Auth.js v5 lazy factory (G_C-25) materializes the config on
// first call, so this route does not eager-validate env at module load.
//
// Pipeline (AC-3.3.5 verbatim):
//
//   1. Look up the `notify_log` row by id.
//   2. Re-run the dispatcher synchronously on that single entry (NEW
//      `attempt_number = max(prior_attempt for the (session, eventKind))
//      + 1`, fresh `Idempotency-Key` per AC-3.2.6 — derived inside
//      `dispatchEmail` from the new attempt number).
//   3. On success: insert a new `notify_log` row with the success outcome
//      (preserves the trail per the spec's "so the trail is preserved"
//      clause), return 200 + Spanish toast `reenviar_success_toast`.
//   4. On failure: insert a new `notify_log` row with the new failure,
//      return 200 + toast `reenviar_failed_toast`.
//
// The handler always returns 200 (the visitor-facing UX is a toast outcome,
// not a transport status). 4xx is reserved for auth + lookup failures
// (401 unauthenticated; 404 notify_log row missing; 409 the underlying
// session / maestro / brand-owner row has been hard-deleted out from under
// the log row — a system-invariant breach worth surfacing).
//
// Dispatch reconstruction is by `eventKind` (AC-3.2.6 enum):
//   - `visitor_receipt`   → CONTENT_EMAIL.PUBLIC.visitorRequestReceived
//   - `visitor_confirm`   → CONTENT_EMAIL.PUBLIC.visitorConfirmed
//   - `visitor_decline`   → CONTENT_EMAIL.PUBLIC.visitorDeclined
//   - `visitor_cancel`    → CONTENT_EMAIL.PUBLIC.visitorCancelled
//   - `maestro_fallback`  → CONTENT_EMAIL.PANEL.EMAIL.maestroFallback
//   - `maestro_failure`   → Telegram. Recipient match decides the template:
//       recipient === brandOwner.telegramChatId → brandOwnerNewRequest
//       else → assignedMaestroNewRequest
//
// Known interpretation choice (flag for SIGMA / DELTA): the AC-3.3.3 brand-
// owner *warning* template (BRAND_OWNER_VISITOR_FAILURE_TEMPLATE in
// `lib/notify/shared.ts`) ALSO writes `eventKind=maestro_failure` to the
// notify_log, and ALSO targets the brand-owner chat_id. From the log row
// alone we cannot disambiguate "primary brand-owner ping" from "AC-3.3.3
// warning" — both retry as `brandOwnerNewRequest`. The trade-off is
// acceptable for v1.0: Augusto still receives actionable session info, and
// the warning's purpose (alert that a visitor email failed) is already
// served by the original failed-log row being visible on the listing page.
// A v1.1 follow-up could persist a template-discriminator column on
// notify_log to preserve the warning template through retries.

import { and, eq, sql } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@/auth';
import { getDb } from '@/db/client';
import {
  type NotifyLog,
  type Session,
  type Teacher,
  notifyLog,
  sessions,
  teachers,
} from '@/db/schema';
import { type DbClient, getBrandOwner } from '@/lib/brand-owner';
import { CONTENT_EMAIL, CONTENT_PANEL } from '@/lib/content';
import {
  type DispatchOutcome,
  contactChannelLabel,
  dispatchEmail,
  dispatchTelegram,
  formatSlot,
  interpolate,
} from '@/lib/notify/shared';

export const runtime = 'nodejs';

const methodNotAllowed = (): Response =>
  NextResponse.json({ kind: 'method_not_allowed' }, { status: 405, headers: { Allow: 'POST' } });

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // ─── 0. Auth (panel-authed; AC-3.3.5 implicit via /panel/* boundary) ──
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ kind: 'unauthorized' }, { status: 401 });
  }

  const { id: logId } = await params;
  const db = getDb();

  // ─── 1. Look up the notify_log row by id ──────────────────────────────
  const logRows = await db.select().from(notifyLog).where(eq(notifyLog.id, logId)).limit(1);
  const log = logRows[0];
  if (!log) {
    return NextResponse.json({ kind: 'not_found' }, { status: 404 });
  }

  // ─── 2. Resolve session + maestro + brand-owner from the log's FK ─────
  const sessionRows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, log.sessionId))
    .limit(1);
  const sessionRow = sessionRows[0];
  if (!sessionRow) {
    return NextResponse.json({ kind: 'session_missing' }, { status: 409 });
  }

  const maestroRows = await db
    .select()
    .from(teachers)
    .where(eq(teachers.id, sessionRow.teacherId))
    .limit(1);
  const maestro = maestroRows[0];
  if (!maestro) {
    return NextResponse.json({ kind: 'maestro_missing' }, { status: 409 });
  }

  const brandOwner = await getBrandOwner(db as unknown as DbClient);
  if (!brandOwner) {
    return NextResponse.json({ kind: 'brand_owner_missing' }, { status: 500 });
  }

  // ─── 3. Bump attempt = MAX(prior) + 1 scoped to (session, eventKind) ──
  // Scoping to (session_id, event_kind) preserves the AC-3.2.6
  // idempotency-key axes — a retry of the same kind for the same session
  // increments the third axis (attempt), so Resend dedupe sees a fresh
  // key. Scoping only to session_id would over-bump across kinds and
  // produce non-monotonic per-kind trails on the listing page.
  const maxRows = await db
    .select({ maxAttempt: sql<number | null>`MAX(${notifyLog.attemptNumber})` })
    .from(notifyLog)
    .where(and(eq(notifyLog.sessionId, log.sessionId), eq(notifyLog.eventKind, log.eventKind)));
  const newAttempt = (maxRows[0]?.maxAttempt ?? log.attemptNumber) + 1;

  // ─── 4. Reconstruct + fire the dispatch ───────────────────────────────
  const outcome = await refireDispatch(log, sessionRow, maestro, brandOwner, newAttempt);

  // ─── 5. Persist the new outcome (success AND failure — preserve trail) ─
  await db.insert(notifyLog).values({
    id: crypto.randomUUID(),
    sessionId: log.sessionId,
    eventKind: outcome.eventKind,
    channel: outcome.channel,
    recipient: outcome.recipient,
    status: outcome.status,
    errorBody: outcome.errorBody,
    attemptNumber: newAttempt,
    createdAt: Date.now(),
  });

  // ─── 6. Always 200; outcome surfaces through the toast slot ───────────
  const ok = outcome.status >= 200 && outcome.status < 300;
  return NextResponse.json(
    {
      kind: ok ? 'retry_ok' : 'retry_failed',
      toast: ok
        ? CONTENT_PANEL.NOTIFY.reenviar_success_toast
        : CONTENT_PANEL.NOTIFY.reenviar_failed_toast,
      attemptNumber: newAttempt,
      status: outcome.status,
    },
    { status: 200 },
  );
}

/**
 * Reconstruct the original dispatch from the log row + session/maestro/
 * brand-owner context, and synchronously re-fire it. Returns the new
 * DispatchOutcome — caller is responsible for the notify_log INSERT.
 *
 * Each branch mirrors the corresponding dispatch in `lib/notify/
 * dispatch-pending.ts` and `lib/notify/dispatch-transition.ts` so the
 * retry path produces the same template + variables the original
 * dispatch attempted. Idempotency-key axes (sessionId, eventKind,
 * attemptNumber) flow through `dispatchEmail` per AC-3.2.6.
 */
async function refireDispatch(
  log: NotifyLog,
  bookingSession: Session,
  maestro: Teacher,
  brandOwner: Teacher,
  attemptNumber: number,
): Promise<DispatchOutcome> {
  const visitorTz = bookingSession.visitorTimezone ?? maestro.timezone;
  const slotVisitorLocal = formatSlot(bookingSession.startsAtUtc, visitorTz);
  const slotMaestroLocal = formatSlot(bookingSession.startsAtUtc, maestro.timezone);
  const contactChannel = contactChannelLabel(bookingSession.contactPref);
  const visitorIntent = bookingSession.visitorIntent ?? '—';

  // Email variants share the visitor-facing variable set used by
  // dispatch-pending + dispatch-transition.
  const visitorEmailVars = {
    visitorName: bookingSession.visitorName,
    maestroName: maestro.name,
    slotVisitorLocal,
    visitorTimezone: visitorTz,
    slotMaestroLocal,
    maestroTimezone: maestro.timezone,
    brandOwnerName: brandOwner.name,
    contactChannel,
    sla: CONTENT_PANEL.LANDING.sla.text,
  };

  switch (log.eventKind) {
    case 'visitor_receipt': {
      const slot = CONTENT_EMAIL.PUBLIC.visitorRequestReceived;
      return dispatchEmail({
        to: bookingSession.visitorEmail,
        subject: slot.subject,
        html: interpolate(slot.html, visitorEmailVars),
        text: interpolate(slot.text, visitorEmailVars),
        sessionId: bookingSession.id,
        eventKind: 'visitor_receipt',
        attempt: attemptNumber,
      });
    }
    case 'visitor_confirm': {
      const slot = CONTENT_EMAIL.PUBLIC.visitorConfirmed;
      return dispatchEmail({
        to: bookingSession.visitorEmail,
        subject: slot.subject,
        html: interpolate(slot.html, visitorEmailVars),
        text: interpolate(slot.text, visitorEmailVars),
        sessionId: bookingSession.id,
        eventKind: 'visitor_confirm',
        attempt: attemptNumber,
      });
    }
    case 'visitor_decline': {
      const slot = CONTENT_EMAIL.PUBLIC.visitorDeclined;
      return dispatchEmail({
        to: bookingSession.visitorEmail,
        subject: slot.subject,
        html: interpolate(slot.html, visitorEmailVars),
        text: interpolate(slot.text, visitorEmailVars),
        sessionId: bookingSession.id,
        eventKind: 'visitor_decline',
        attempt: attemptNumber,
      });
    }
    case 'visitor_cancel': {
      const slot = CONTENT_EMAIL.PUBLIC.visitorCancelled;
      return dispatchEmail({
        to: bookingSession.visitorEmail,
        subject: slot.subject,
        html: interpolate(slot.html, visitorEmailVars),
        text: interpolate(slot.text, visitorEmailVars),
        sessionId: bookingSession.id,
        eventKind: 'visitor_cancel',
        attempt: attemptNumber,
      });
    }
    case 'maestro_fallback': {
      const slot = CONTENT_EMAIL.PANEL.EMAIL.maestroFallback;
      const fallbackVars = {
        maestroName: maestro.name,
        slotMaestroLocal,
        maestroTimezone: maestro.timezone,
        visitorName: bookingSession.visitorName,
        visitorEmail: bookingSession.visitorEmail,
        contactChannel,
        contactValue: bookingSession.contactValue,
        visitorIntent,
      };
      return dispatchEmail({
        to: maestro.email,
        subject: interpolate(slot.subject, fallbackVars),
        html: interpolate(slot.html, fallbackVars),
        text: interpolate(slot.text, fallbackVars),
        sessionId: bookingSession.id,
        eventKind: 'maestro_fallback',
        attempt: attemptNumber,
      });
    }
    case 'maestro_failure': {
      // Telegram. Recipient match → which template.
      const toBrandOwner = log.recipient === brandOwner.telegramChatId;
      const text = toBrandOwner
        ? interpolate(CONTENT_PANEL.NOTIFY.brandOwnerNewRequest, {
            maestroName: maestro.name,
            visitorName: bookingSession.visitorName,
            slotBrandOwnerLocal: formatSlot(bookingSession.startsAtUtc, brandOwner.timezone),
            contactChannel,
            contactValue: bookingSession.contactValue,
            visitorIntent,
          })
        : interpolate(CONTENT_PANEL.NOTIFY.assignedMaestroNewRequest, {
            visitorName: bookingSession.visitorName,
            slotMaestroLocal,
            contactChannel,
            contactValue: bookingSession.contactValue,
            visitorIntent,
          });
      return dispatchTelegram(log.recipient, text, 'maestro_failure', attemptNumber);
    }
    default: {
      // Defense in depth: the CHECK constraint at the DB layer (AC-3.3.1)
      // forbids unknown event_kinds, so this branch is unreachable in
      // practice. Return a synthesized 0-status outcome that the caller
      // logs as a failure rather than throwing into the route response.
      return {
        channel: log.channel as DispatchOutcome['channel'],
        eventKind: log.eventKind as DispatchOutcome['eventKind'],
        recipient: log.recipient,
        status: 0,
        errorBody: `Unknown event_kind for retry: ${String(log.eventKind)}`,
        attemptNumber,
      };
    }
  }
}
