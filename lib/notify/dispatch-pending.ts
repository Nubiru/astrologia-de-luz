/**
 * lib/notify/dispatch-pending.ts — 3-way fan-out on pending session insert.
 *
 * Spec anchors: S-1 AC-3.2.1–AC-3.2.6 + AC-3.3.1 + AC-3.3.3.
 *
 * Contract (per AC-3.2): on a successful `'pending'` INSERT, this function
 * fires THREE side-effects via `Promise.allSettled` — failure of any one
 * does NOT block the others and does NOT rollback the session row. The
 * function NEVER throws on dispatch failure; it returns a
 * `DispatchPendingResult` with every outcome inspectable + the failure
 * subset isolated. It DOES throw if the brand-owner seed row is missing
 * (system-invariant breach — refuse to silently proceed).
 *
 * Dispatch matrix:
 *
 *   1. Brand-owner Telegram (AC-3.2.1) — Augusto's chat. Skipped (no log)
 *      when `telegram_chat_id` is null on the brand-owner row.
 *   2. Assigned-maestro channel (AC-3.2.2 / AC-3.2.3):
 *      - If assigned IS brand-owner → SKIP (dedupe; brand-owner already
 *        notified in #1).
 *      - Else if assigned has `telegram_chat_id` → Telegram.
 *      - Else → email fallback to `teachers.email` with subject prefix
 *        `[FALLBACK]`.
 *   3. Visitor receipt email (AC-3.2.4) — always fires.
 *
 * Post-fan-out (AC-3.3.3): if dispatch #3 (visitor receipt) failed AND
 * brand-owner has a `telegram_chat_id`, fire an immediate warning Telegram
 * ping to the brand-owner. Shared with G_C-14 (`dispatch-transition.ts`)
 * via `maybeFireVisitorFailureWarning` in `lib/notify/shared.ts`.
 *
 * Event-kind mapping (the AC-3.2.6 enum is shared across notify_log + the
 * Resend Idempotency-Key derivation):
 *
 *   | dispatch                          | channel  | event_kind         |
 *   |-----------------------------------|----------|--------------------|
 *   | brand-owner Telegram              | telegram | `maestro_failure`  |
 *   | assigned-maestro Telegram         | telegram | `maestro_failure`  |
 *   | assigned-maestro email fallback   | resend   | `maestro_fallback` |
 *   | visitor receipt                   | resend   | `visitor_receipt`  |
 *   | AC-3.3.3 warning Telegram         | telegram | `maestro_failure`  |
 */

import type { Session, Teacher } from '@/db/schema';
import { type DbClient, getBrandOwner } from '@/lib/brand-owner';
import { CONTENT_EMAIL, CONTENT_PANEL } from '@/lib/content';
import {
  type DispatchDb,
  type DispatchOutcome,
  contactChannelLabel,
  dispatchEmail,
  dispatchTelegram,
  formatSlot,
  interpolate,
  maybeFireVisitorFailureWarning,
  persistFailures,
} from '@/lib/notify/shared';

export type { DispatchChannel, DispatchOutcome, DispatchDb } from '@/lib/notify/shared';

export interface DispatchPendingInput {
  db: DispatchDb;
  session: Session;
  assignedMaestro: Teacher;
  attempt?: number;
}

export interface DispatchPendingResult {
  outcomes: DispatchOutcome[];
  failures: DispatchOutcome[];
}

/**
 * The load-bearing pending-dispatcher. Caller responsibility (G_C-10):
 *   - `session.id` references a row already INSERTed with `status='pending'`.
 *   - `assignedMaestro` is the row referenced by `session.teacher_id`.
 *   - The caller does NOT need to `await` the result — the dispatcher is
 *     fire-and-forget per AC-3.1.2. The return value exists for the manual
 *     retry path (AC-3.3.5) + the integration pairings.
 */
export async function dispatchPending(input: DispatchPendingInput): Promise<DispatchPendingResult> {
  const { db, session, assignedMaestro, attempt = 1 } = input;
  const brandOwner = await getBrandOwner(db as unknown as DbClient);
  if (!brandOwner) {
    throw new Error(
      'dispatch-pending: brand-owner row missing — run scripts/migrate.ts (seed 0003_seed_augusto.sql)',
    );
  }

  const isAssignedBrandOwner = assignedMaestro.id === brandOwner.id;
  const visitorTz = session.visitorTimezone ?? assignedMaestro.timezone;
  const contactLabel = contactChannelLabel(session.contactPref);
  const visitorIntent = session.visitorIntent ?? '—';

  const slotVisitorLocal = formatSlot(session.startsAtUtc, visitorTz);
  const slotMaestroLocal = formatSlot(session.startsAtUtc, assignedMaestro.timezone);
  const slotBrandOwnerLocal = formatSlot(session.startsAtUtc, brandOwner.timezone);

  // ─── 1. brand-owner Telegram ──────────────────────────────────────────
  const brandOwnerTask: Promise<DispatchOutcome | null> = brandOwner.telegramChatId
    ? dispatchTelegram(
        brandOwner.telegramChatId,
        interpolate(CONTENT_PANEL.NOTIFY.brandOwnerNewRequest, {
          maestroName: assignedMaestro.name,
          visitorName: session.visitorName,
          slotBrandOwnerLocal,
          contactChannel: contactLabel,
          contactValue: session.contactValue,
          visitorIntent,
        }),
        'maestro_failure',
        attempt,
      )
    : Promise.resolve(null);

  // ─── 2. assigned-maestro channel (Telegram or email-fallback) ─────────
  let assignedTask: Promise<DispatchOutcome | null> = Promise.resolve(null);
  if (!isAssignedBrandOwner) {
    if (assignedMaestro.telegramChatId) {
      assignedTask = dispatchTelegram(
        assignedMaestro.telegramChatId,
        interpolate(CONTENT_PANEL.NOTIFY.assignedMaestroNewRequest, {
          visitorName: session.visitorName,
          slotMaestroLocal,
          contactChannel: contactLabel,
          contactValue: session.contactValue,
          visitorIntent,
        }),
        'maestro_failure',
        attempt,
      );
    } else {
      const slot = CONTENT_EMAIL.PANEL.EMAIL.maestroFallback;
      const vars = {
        maestroName: assignedMaestro.name,
        slotMaestroLocal,
        maestroTimezone: assignedMaestro.timezone,
        visitorName: session.visitorName,
        visitorEmail: session.visitorEmail,
        contactChannel: contactLabel,
        contactValue: session.contactValue,
        visitorIntent,
      };
      assignedTask = dispatchEmail({
        to: assignedMaestro.email,
        subject: interpolate(slot.subject, vars),
        html: interpolate(slot.html, vars),
        text: interpolate(slot.text, vars),
        sessionId: session.id,
        eventKind: 'maestro_fallback',
        attempt,
      });
    }
  }

  // ─── 3. visitor receipt email ─────────────────────────────────────────
  const visitorSlot = CONTENT_EMAIL.PUBLIC.visitorRequestReceived;
  const visitorVars = {
    visitorName: session.visitorName,
    maestroName: assignedMaestro.name,
    slotVisitorLocal,
    visitorTimezone: visitorTz,
    slotMaestroLocal,
    maestroTimezone: assignedMaestro.timezone,
    brandOwnerName: brandOwner.name,
    contactChannel: contactLabel,
    sla: CONTENT_PANEL.LANDING.sla.text,
  };
  const visitorTask: Promise<DispatchOutcome> = dispatchEmail({
    to: session.visitorEmail,
    subject: visitorSlot.subject,
    html: interpolate(visitorSlot.html, visitorVars),
    text: interpolate(visitorSlot.text, visitorVars),
    sessionId: session.id,
    eventKind: 'visitor_receipt',
    attempt,
  });

  // Promise.allSettled honors AC-3.2 wording — our dispatch* helpers never
  // reject (they translate throws into status=0 outcomes), but a future
  // maintainer who reaches for `throw` will not silently rollback siblings.
  const settled = await Promise.allSettled([brandOwnerTask, assignedTask, visitorTask]);

  const outcomes: DispatchOutcome[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value !== null) {
      outcomes.push(result.value);
    }
  }

  // AC-3.3.3 follow-up: visitor receipt failure → Telegram warning.
  const visitorSettled = settled[2];
  const visitorOutcome = visitorSettled.status === 'fulfilled' ? visitorSettled.value : null;
  if (visitorOutcome) {
    const warningOutcome = await maybeFireVisitorFailureWarning({
      visitorOutcome,
      brandOwnerChatId: brandOwner.telegramChatId,
      sessionId: session.id,
      visitorEmail: session.visitorEmail,
      attempt,
    });
    if (warningOutcome) outcomes.push(warningOutcome);
  }

  await persistFailures(db, session.id, outcomes);

  return {
    outcomes,
    failures: outcomes.filter((o) => o.status < 200 || o.status >= 300),
  };
}
