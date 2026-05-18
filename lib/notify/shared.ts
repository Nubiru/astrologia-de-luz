/**
 * lib/notify/shared.ts — primitives shared by both dispatchers.
 *
 * Spec anchors: S-1 AC-3.2 + AC-3.3 + AC-3.4 (the notify-fan-out family).
 *
 * G_C-13 (`dispatch-pending.ts`) and G_C-14 (`dispatch-transition.ts`) BOTH
 * need:
 *   - The `DispatchOutcome` row shape (so the manual-retry handler G_C-15
 *     can re-emit any prior dispatch).
 *   - The `dispatchTelegram` + `dispatchEmail` helpers — they encapsulate
 *     the Telegram `{ ok, error_code }` vs HTTP-status decoupling AND the
 *     Resend `{ error }` payload normalisation, so the two dispatchers
 *     never disagree on what counts as a 2xx success.
 *   - The AC-3.3.3 brand-owner-warning-on-visitor-email-failure helper —
 *     this is the load-bearing handoff to Augusto when Resend's transactional
 *     channel breaks, and the spec is explicit that BOTH AC-3.2 (pending)
 *     AND AC-3.4 (transitions) must trigger it.
 *   - The `persistFailures` notify_log batch INSERT — AC-3.3.1 is failure-
 *     only telemetry; both dispatchers write rows on the same schema and
 *     truncation contract.
 *   - Pure helpers (`interpolate`, `formatSlot`, `contactChannelLabel`,
 *     `truncate`, `isSuccess`).
 *
 * Inline Spanish string carve-out (continued from G_C-13): the AC-3.3.3
 * warning template (`BRAND_OWNER_VISITOR_FAILURE_TEMPLATE`) is lifted
 * VERBATIM from the spec; the canonical home is `CONTENT_PANEL.NOTIFY.
 * brandOwnerVisitorEmailFailure` which does not yet exist (pool-b's G_B-10
 * is the queued task). NOTIFICATIONS 2026-05-18T11:03Z documents the
 * janitorial cleanup recipe.
 */

import { randomUUID } from 'node:crypto';

import { formatInTimeZone } from 'date-fns-tz';
import { es } from 'date-fns/locale';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';

import { notifyLog } from '@/db/schema';
import { type EventKind, sendEmail } from '@/lib/resend';
import { sendMessage } from '@/lib/telegram';

export type DispatchChannel = 'telegram' | 'resend';

export interface DispatchOutcome {
  channel: DispatchChannel;
  eventKind: EventKind;
  /** chat_id (Telegram) or email address (Resend). */
  recipient: string;
  /** HTTP status; 0 on synchronous throw or telegram non-ok with no error_code. */
  status: number;
  /** Truncated to 2000 chars per AC-3.3.1; null on success. */
  errorBody: string | null;
  /** 1-based; carried forward by the AC-3.3.5 manual-retry handler. */
  attemptNumber: number;
}

/**
 * Loose Drizzle DB type — both dispatchers only insert into `notify_log`
 * (and reach into the brand-owner row via the `brand-owner.ts` lookup).
 * Widening from `LibSQLDatabase<typeof schema>` to a structural superset
 * lets test fixtures use `drizzle(client)` without per-call-site casts.
 */
export type DispatchDb = LibSQLDatabase<Record<string, unknown>>;

export const ERROR_BODY_MAX = 2000;
export const SLOT_FORMAT = 'EEE d MMM · HH:mm';

/** AC-3.3.3 verbatim. See the carve-out note in the file header. */
export const BRAND_OWNER_VISITOR_FAILURE_TEMPLATE =
  '⚠ Solicitud recibida pero email a {visitorEmail} no salió (Resend {status}). Sesión {sessionId} pendiente; contactá manualmente.';

export function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

export function truncate(value: string | null): string | null {
  if (value === null) return null;
  return value.length > ERROR_BODY_MAX ? value.slice(0, ERROR_BODY_MAX) : value;
}

export function formatSlot(epochMs: number, tz: string): string {
  return formatInTimeZone(new Date(epochMs), tz, SLOT_FORMAT, { locale: es });
}

export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? (vars[key] ?? '') : match,
  );
}

export function contactChannelLabel(pref: string): string {
  switch (pref) {
    case 'email':
      return 'correo';
    case 'whatsapp':
      return 'WhatsApp';
    case 'phone':
      return 'teléfono';
    default:
      return pref;
  }
}

export async function dispatchTelegram(
  chatId: string,
  text: string,
  eventKind: EventKind,
  attemptNumber: number,
): Promise<DispatchOutcome> {
  try {
    const res = await sendMessage({ chatId, text, parseMode: 'HTML' });
    if (res.ok) {
      return {
        channel: 'telegram',
        eventKind,
        recipient: chatId,
        status: 200,
        errorBody: null,
        attemptNumber,
      };
    }
    return {
      channel: 'telegram',
      eventKind,
      recipient: chatId,
      status: typeof res.error_code === 'number' ? res.error_code : 0,
      errorBody: truncate(res.description ?? null),
      attemptNumber,
    };
  } catch (err) {
    return {
      channel: 'telegram',
      eventKind,
      recipient: chatId,
      status: 0,
      errorBody: truncate(err instanceof Error ? err.message : String(err)),
      attemptNumber,
    };
  }
}

export async function dispatchEmail(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
  sessionId: string;
  eventKind: EventKind;
  attempt: number;
}): Promise<DispatchOutcome> {
  try {
    const res = await sendEmail({
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      sessionId: args.sessionId,
      eventKind: args.eventKind,
      attempt: args.attempt,
    });
    const error = (res as { error?: { statusCode?: number; message?: string } | null }).error;
    if (!error) {
      return {
        channel: 'resend',
        eventKind: args.eventKind,
        recipient: args.to,
        status: 200,
        errorBody: null,
        attemptNumber: args.attempt,
      };
    }
    return {
      channel: 'resend',
      eventKind: args.eventKind,
      recipient: args.to,
      status: typeof error.statusCode === 'number' ? error.statusCode : 0,
      errorBody: truncate(error.message ?? null),
      attemptNumber: args.attempt,
    };
  } catch (err) {
    return {
      channel: 'resend',
      eventKind: args.eventKind,
      recipient: args.to,
      status: 0,
      errorBody: truncate(err instanceof Error ? err.message : String(err)),
      attemptNumber: args.attempt,
    };
  }
}

/**
 * AC-3.3.3 — if the visitor email failed AND the brand-owner has a
 * `telegram_chat_id`, fire a warning Telegram so Augusto can contact the
 * visitor out-of-band. Returns the warning outcome (success OR failure)
 * for the caller to fold into its outcomes/notify_log batch, or null when
 * no warning fires (visitor outcome was 2xx, or brand-owner has no chat).
 */
export async function maybeFireVisitorFailureWarning(args: {
  visitorOutcome: DispatchOutcome;
  brandOwnerChatId: string | null;
  sessionId: string;
  visitorEmail: string;
  attempt: number;
}): Promise<DispatchOutcome | null> {
  if (isSuccess(args.visitorOutcome.status)) return null;
  if (!args.brandOwnerChatId) return null;
  const text = interpolate(BRAND_OWNER_VISITOR_FAILURE_TEMPLATE, {
    visitorEmail: args.visitorEmail,
    status: String(args.visitorOutcome.status),
    sessionId: args.sessionId,
  });
  return dispatchTelegram(args.brandOwnerChatId, text, 'maestro_failure', args.attempt);
}

/**
 * Batch-INSERT every non-2xx outcome into `notify_log` (AC-3.3.1).
 * No-op when nothing failed — the table is failure-only telemetry, so a
 * single dispatch that succeeded writes no row.
 *
 * Returns the count of rows written (= the count of failures), useful as
 * an assertion target in the pairings AND for the manual-retry handler
 * G_C-15 to log how many entries it just escalated.
 */
export async function persistFailures(
  db: DispatchDb,
  sessionId: string,
  outcomes: DispatchOutcome[],
  now: number = Date.now(),
): Promise<number> {
  const failures = outcomes.filter((o) => !isSuccess(o.status));
  if (failures.length === 0) return 0;
  await db.insert(notifyLog).values(
    failures.map((o) => ({
      id: randomUUID(),
      sessionId,
      eventKind: o.eventKind,
      channel: o.channel,
      recipient: o.recipient,
      status: o.status,
      errorBody: o.errorBody,
      attemptNumber: o.attemptNumber,
      createdAt: now,
    })),
  );
  return failures.length;
}
