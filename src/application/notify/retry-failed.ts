/**
 * retry-failed.ts — manual "Reenviar" use case.
 *
 * Factory-default-instance shape per S-2 §7.2.3 C / G_C-31 / D-049 / D-050.
 * Spec anchors: S-1 AC-3.3.4 + AC-3.3.5.
 *
 * Extracts the orchestration body of the prior `app/api/notify/[id]/retry/
 * route.ts` (G_C-15). The route handler is reduced to ~25 LOC: auth-gate +
 * `retryFailed({ notifyLogId })` + outcome→HTTP translation.
 *
 * Deps shape extends §7.2.3 C with `sessions` + `maestrosReader` — needed
 * to resolve the original session + assigned maestro + brand-owner from the
 * notify_log row's FK. Spec §7.2.3 C only enumerated notifyLog/emailSender/
 * telegram; deviation flagged in G_C-31 close-note for SIGMA visibility.
 *
 * Trail-row persistence: a successful retry writes a new notify_log row
 * (preserves the trail per AC-3.3.5). The use case calls
 * `notifyLog.persistFailures([outcome])` for BOTH success + failure;
 * `persistFailures` is permissive by adapter contract (accepts any status,
 * not just non-2xx) — the port name is misleading and slated for a G_C-35
 * rename. The behavior is correct: every retry attempt creates a trail row.
 */

import { CONTENT_EMAIL, CONTENT_PANEL } from '@/infrastructure/content';
import { getComposition } from '@/main/composition';

import type { MaestrosReader, SessionsRepository } from '@/domain/booking/ports';
import type { EventKind } from '@/domain/notifications/event-kinds';
import type { EmailSender, NotifyLog, TelegramBot } from '@/domain/notifications/ports';

import {
  type DispatchOutcome,
  contactChannelLabel,
  formatSlot,
  interpolate,
  truncate,
} from '@/application/notify/shared';

export interface RetryFailedDeps {
  notifyLog: NotifyLog;
  emailSender: EmailSender;
  telegram: TelegramBot;
  sessions: SessionsRepository;
  maestrosReader: MaestrosReader;
}

export interface RetryFailedInput {
  notifyLogId: string;
}

export type RetryFailedOutcome =
  | { kind: 'not_found' }
  | { kind: 'session_missing' }
  | { kind: 'maestro_missing' }
  | { kind: 'brand_owner_missing' }
  | { kind: 'retry_ok'; outcome: DispatchOutcome; attemptNumber: number }
  | { kind: 'retry_failed'; outcome: DispatchOutcome; attemptNumber: number };

export type RetryFailedFn = (input: RetryFailedInput) => Promise<RetryFailedOutcome>;

/** Factory. Tests substitute fakes via deps; production wires through composition. */
export function createRetryFailed(deps: RetryFailedDeps): RetryFailedFn {
  const { notifyLog, emailSender, telegram, sessions, maestrosReader } = deps;

  return async (input: RetryFailedInput): Promise<RetryFailedOutcome> => {
    const log = await notifyLog.findById(input.notifyLogId);
    if (!log) return { kind: 'not_found' };

    const bookingSession = await sessions.findById(log.sessionId);
    if (!bookingSession) return { kind: 'session_missing' };

    const maestro = await maestrosReader.findById(bookingSession.teacherId);
    if (!maestro) return { kind: 'maestro_missing' };

    const brandOwner = await maestrosReader.findBrandOwner();
    if (!brandOwner) return { kind: 'brand_owner_missing' };

    // payload carries the prior attemptNumber + status; bump for new try.
    // Approximation of the original MAX(attempt_number) scoped to (session,
    // event_kind) — sufficient when the panel UX retries the most-recent
    // failure (the dominant path). G_C-35 cleanup-CP may add a port method
    // for the strict MAX semantics if double-retry-failure regressions arise.
    const priorAttempt =
      typeof (log.payload as { attemptNumber?: unknown })?.attemptNumber === 'number'
        ? (log.payload as { attemptNumber: number }).attemptNumber
        : 1;
    const attemptNumber = priorAttempt + 1;

    const outcome = await refireDispatch(
      emailSender,
      telegram,
      log,
      bookingSession,
      maestro,
      brandOwner,
      attemptNumber,
    );

    // Persist the trail row regardless of success or failure.
    await notifyLog.persistFailures([
      {
        sessionId: bookingSession.id,
        channel: outcome.channel,
        eventKind: outcome.eventKind,
        recipient: outcome.recipient,
        status: outcome.status,
        errorBody: outcome.errorBody,
        attemptNumber,
      },
    ]);

    const ok = outcome.status >= 200 && outcome.status < 300;
    return ok
      ? { kind: 'retry_ok', outcome, attemptNumber }
      : { kind: 'retry_failed', outcome, attemptNumber };
  };
}

/**
 * Reconstruct the original dispatch from the log row + session/maestro/
 * brand-owner context, and synchronously re-fire it through ports. Mirrors
 * the EventKind dispatch matrix from dispatch-pending + dispatch-transition
 * so the retry path produces the same template + variables the original
 * attempted. Idempotency-key axes (sessionId, eventKind, attemptNumber)
 * flow through `emailSender.send` per AC-3.2.6.
 */
async function refireDispatch(
  emailSender: EmailSender,
  telegram: TelegramBot,
  log: { eventKind: EventKind; channel: 'telegram' | 'resend'; recipient: string },
  bookingSession: {
    id: string;
    visitorName: string;
    visitorEmail: string;
    visitorIntent: string | null;
    visitorTimezone: string | null;
    contactPref: string;
    contactValue: string;
    startsAtUtc: number;
  },
  maestro: {
    name: string;
    email: string;
    timezone: string;
  },
  brandOwner: {
    name: string;
    timezone: string;
    telegramChatId: string | null;
  },
  attemptNumber: number,
): Promise<DispatchOutcome> {
  const visitorTz = bookingSession.visitorTimezone ?? maestro.timezone;
  const slotVisitorLocal = formatSlot(bookingSession.startsAtUtc, visitorTz);
  const slotMaestroLocal = formatSlot(bookingSession.startsAtUtc, maestro.timezone);
  const contactChannel = contactChannelLabel(bookingSession.contactPref);
  const visitorIntent = bookingSession.visitorIntent ?? '—';

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

  const toEmailOutcome = async (
    eventKind: EventKind,
    slot: { subject: string; html: string; text: string },
    to: string,
    varsOverride?: Record<string, string>,
  ): Promise<DispatchOutcome> => {
    const vars = varsOverride ?? visitorEmailVars;
    const res = await emailSender.send({
      to,
      subject: interpolate(slot.subject, vars),
      html: interpolate(slot.html, vars),
      text: interpolate(slot.text, vars),
      sessionId: bookingSession.id,
      eventKind,
      attempt: attemptNumber,
    });
    return {
      channel: 'resend',
      eventKind,
      recipient: to,
      status: res.ok ? 200 : res.status,
      errorBody: res.ok ? null : truncate(res.errorBody),
      attemptNumber,
    };
  };

  switch (log.eventKind) {
    case 'visitor_receipt':
      return toEmailOutcome(
        'visitor_receipt',
        CONTENT_EMAIL.PUBLIC.visitorRequestReceived,
        bookingSession.visitorEmail,
      );
    case 'visitor_confirm':
      return toEmailOutcome(
        'visitor_confirm',
        CONTENT_EMAIL.PUBLIC.visitorConfirmed,
        bookingSession.visitorEmail,
      );
    case 'visitor_decline':
      return toEmailOutcome(
        'visitor_decline',
        CONTENT_EMAIL.PUBLIC.visitorDeclined,
        bookingSession.visitorEmail,
      );
    case 'visitor_cancel':
      return toEmailOutcome(
        'visitor_cancel',
        CONTENT_EMAIL.PUBLIC.visitorCancelled,
        bookingSession.visitorEmail,
      );
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
      return toEmailOutcome('maestro_fallback', slot, maestro.email, fallbackVars);
    }
    case 'maestro_failure': {
      // Telegram. Recipient match → which template (brand-owner vs assigned).
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
      const res = await telegram.sendMessage({
        chatId: log.recipient,
        text,
        parseMode: 'HTML',
      });
      return {
        channel: 'telegram',
        eventKind: 'maestro_failure',
        recipient: log.recipient,
        status: res.ok ? 200 : res.status,
        errorBody: res.ok ? null : truncate(res.errorBody),
        attemptNumber,
      };
    }
    default: {
      // Defense in depth: the CHECK constraint at the DB layer forbids
      // unknown event_kinds, so this branch is unreachable in practice.
      return {
        channel: log.channel,
        eventKind: log.eventKind,
        recipient: log.recipient,
        status: 0,
        errorBody: `Unknown event_kind for retry: ${String(log.eventKind)}`,
        attemptNumber,
      };
    }
  }
}

/**
 * Default-instance — reads composition lazily at each invocation so
 * __resetCompositionForTests() flushes cleanly between tests.
 */
export const retryFailed: RetryFailedFn = (input) => {
  const c = getComposition();
  return createRetryFailed({
    notifyLog: c.notifyLog,
    emailSender: c.emailSender,
    telegram: c.telegram,
    sessions: c.sessions,
    maestrosReader: c.maestrosReader,
  })(input);
};
