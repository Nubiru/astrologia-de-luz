/**
 * dispatch-pending.ts — 3-way fan-out on pending session insert.
 *
 * Factory-default-instance shape per S-2 §7.2.3 A / G_C-31 / D-049 / D-050.
 * Spec anchors: S-1 AC-3.2.1–AC-3.2.6 + AC-3.3.1 + AC-3.3.3.
 *
 * Contract (per AC-3.2): on a successful 'pending' INSERT, this function
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
 * ping to the brand-owner.
 *
 * Event-kind mapping (the AC-3.2.6 enum is shared across notify_log + the
 * Resend Idempotency-Key derivation):
 *
 *   | dispatch                          | channel  | event_kind         |
 *   |-----------------------------------|----------|--------------------|
 *   | brand-owner Telegram              | telegram | maestro_failure    |
 *   | assigned-maestro Telegram         | telegram | maestro_failure    |
 *   | assigned-maestro email fallback   | resend   | maestro_fallback   |
 *   | visitor receipt                   | resend   | visitor_receipt    |
 *   | AC-3.3.3 warning Telegram         | telegram | maestro_failure    |
 *
 * The DB-access seam from the previous shape ("db: DispatchDb") is now
 * behind the `notifyLog` + `maestrosReader` ports per CP-3. The dispatcher
 * no longer knows it's talking to libsql.
 */

import { CONTENT_EMAIL, CONTENT_PANEL } from '@/infrastructure/content';
import type { Session, Teacher } from '@/infrastructure/db/schema';
import { getComposition } from '@/main/composition';

import type { MaestrosReader } from '@/domain/booking/ports';
import type { EventKind } from '@/domain/notifications/event-kinds';
import type { EmailSender, NotifyLog, TelegramBot } from '@/domain/notifications/ports';

import {
  BRAND_OWNER_VISITOR_FAILURE_TEMPLATE,
  type DispatchChannel,
  type DispatchOutcome,
  contactChannelLabel,
  formatSlot,
  interpolate,
  isSuccess,
  truncate,
} from '@/application/notify/shared';

export type { DispatchChannel, DispatchOutcome };

export interface DispatchPendingDeps {
  emailSender: EmailSender;
  telegram: TelegramBot;
  notifyLog: NotifyLog;
  maestrosReader: MaestrosReader;
}

export interface DispatchPendingInput {
  session: Session;
  assignedMaestro: Teacher;
  attempt?: number;
}

export interface DispatchPendingResult {
  outcomes: DispatchOutcome[];
  failures: DispatchOutcome[];
}

export type DispatchPendingFn = (input: DispatchPendingInput) => Promise<DispatchPendingResult>;

async function sendTelegramOutcome(
  telegram: TelegramBot,
  chatId: string,
  text: string,
  eventKind: EventKind,
  attemptNumber: number,
): Promise<DispatchOutcome> {
  const res = await telegram.sendMessage({ chatId, text, parseMode: 'HTML' });
  return {
    channel: 'telegram',
    eventKind,
    recipient: chatId,
    status: res.ok ? 200 : res.status,
    errorBody: res.ok ? null : truncate(res.errorBody),
    attemptNumber,
  };
}

async function sendEmailOutcome(
  emailSender: EmailSender,
  args: {
    to: string;
    subject: string;
    html: string;
    text: string;
    sessionId: string;
    eventKind: EventKind;
    attempt: number;
  },
): Promise<DispatchOutcome> {
  const res = await emailSender.send(args);
  return {
    channel: 'resend',
    eventKind: args.eventKind,
    recipient: args.to,
    status: res.ok ? 200 : res.status,
    errorBody: res.ok ? null : truncate(res.errorBody),
    attemptNumber: args.attempt,
  };
}

async function maybeFireVisitorFailureWarning(
  telegram: TelegramBot,
  args: {
    visitorOutcome: DispatchOutcome;
    brandOwnerChatId: string | null;
    sessionId: string;
    visitorEmail: string;
    attempt: number;
  },
): Promise<DispatchOutcome | null> {
  if (isSuccess(args.visitorOutcome.status)) return null;
  if (!args.brandOwnerChatId) return null;
  const text = interpolate(BRAND_OWNER_VISITOR_FAILURE_TEMPLATE, {
    visitorEmail: args.visitorEmail,
    status: String(args.visitorOutcome.status),
    sessionId: args.sessionId,
  });
  return sendTelegramOutcome(
    telegram,
    args.brandOwnerChatId,
    text,
    'maestro_failure',
    args.attempt,
  );
}

/** Factory. Tests substitute fakes via deps; production wires through composition. */
export function createDispatchPending(deps: DispatchPendingDeps): DispatchPendingFn {
  const { emailSender, telegram, notifyLog, maestrosReader } = deps;

  return async (input: DispatchPendingInput): Promise<DispatchPendingResult> => {
    const { session, assignedMaestro, attempt = 1 } = input;
    const brandOwner = await maestrosReader.findBrandOwner();
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

    // ─── 1. brand-owner Telegram ────────────────────────────────────────────
    const brandOwnerTask: Promise<DispatchOutcome | null> = brandOwner.telegramChatId
      ? sendTelegramOutcome(
          telegram,
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

    // ─── 2. assigned-maestro channel (Telegram or email-fallback) ───────────
    let assignedTask: Promise<DispatchOutcome | null> = Promise.resolve(null);
    if (!isAssignedBrandOwner) {
      if (assignedMaestro.telegramChatId) {
        assignedTask = sendTelegramOutcome(
          telegram,
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
        assignedTask = sendEmailOutcome(emailSender, {
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

    // ─── 3. visitor receipt email ───────────────────────────────────────────
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
    const visitorTask: Promise<DispatchOutcome> = sendEmailOutcome(emailSender, {
      to: session.visitorEmail,
      subject: visitorSlot.subject,
      html: interpolate(visitorSlot.html, visitorVars),
      text: interpolate(visitorSlot.text, visitorVars),
      sessionId: session.id,
      eventKind: 'visitor_receipt',
      attempt,
    });

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
      const warningOutcome = await maybeFireVisitorFailureWarning(telegram, {
        visitorOutcome,
        brandOwnerChatId: brandOwner.telegramChatId,
        sessionId: session.id,
        visitorEmail: session.visitorEmail,
        attempt,
      });
      if (warningOutcome) outcomes.push(warningOutcome);
    }

    const failures = outcomes.filter((o) => !isSuccess(o.status));
    if (failures.length > 0) {
      await notifyLog.persistFailures(
        failures.map((o) => ({
          sessionId: session.id,
          channel: o.channel,
          eventKind: o.eventKind,
          recipient: o.recipient,
          status: o.status,
          errorBody: o.errorBody,
          attemptNumber: o.attemptNumber,
        })),
      );
    }

    return { outcomes, failures };
  };
}

/**
 * Default-instance — reads composition lazily at each invocation so
 * __resetCompositionForTests() flushes cleanly between tests.
 */
export const dispatchPending: DispatchPendingFn = (input) => {
  const c = getComposition();
  return createDispatchPending({
    emailSender: c.emailSender,
    telegram: c.telegram,
    notifyLog: c.notifyLog,
    maestrosReader: c.maestrosReader,
  })(input);
};
