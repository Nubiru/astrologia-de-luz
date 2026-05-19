/**
 * dispatch-transition.ts — per-transition visitor email dispatcher.
 *
 * Factory-default-instance shape per S-2 §7.2.3 B / G_C-31 / D-049 / D-050.
 * Spec anchors: S-1 AC-3.4.2 + AC-3.3.1 + AC-3.3.3.
 *
 * Fires AFTER the PATCH handler commits a status transition (so the
 * visitor's record is already in its new state). The dispatch matrix is
 * the AC-3.4.2 table:
 *
 *   | from       | to        | email                                       |
 *   |------------|-----------|---------------------------------------------|
 *   | pending    | confirmed | CONTENT_EMAIL.PUBLIC.visitorConfirmed       |
 *   | pending    | rejected  | CONTENT_EMAIL.PUBLIC.visitorDeclined        |
 *   | pending    | cancelled | (no email — admin internal action)          |
 *   | confirmed  | cancelled | CONTENT_EMAIL.PUBLIC.visitorCancelled       |
 *   | confirmed  | completed | (no email)                                  |
 *   | confirmed  | no_show   | (no email)                                  |
 *
 * Failure handling mirrors dispatch-pending: any non-2xx visitor email
 * outcome triggers the AC-3.3.3 warning Telegram and persists to
 * notify_log. DB-access seam now behind ports (§7.2.3 B refactor).
 */

import { CONTENT_EMAIL } from '@/infrastructure/content';
import type { Session, Teacher } from '@/infrastructure/db/schema';
import { getComposition } from '@/main/composition';

import type { MaestrosReader } from '@/domain/booking/ports';
import type { EventKind } from '@/domain/notifications/event-kinds';
import type { EmailSender, NotifyLog, TelegramBot } from '@/domain/notifications/ports';

import {
  BRAND_OWNER_VISITOR_FAILURE_TEMPLATE,
  type DispatchOutcome,
  contactChannelLabel,
  formatSlot,
  interpolate,
  isSuccess,
  truncate,
} from '@/application/notify/shared';

export type SessionStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'rejected'
  | 'no_show'
  | 'completed';

export interface DispatchTransitionDeps {
  emailSender: EmailSender;
  telegram: TelegramBot;
  notifyLog: NotifyLog;
  maestrosReader: MaestrosReader;
}

export interface DispatchTransitionInput {
  /** Session row AFTER the status update has been committed. */
  session: Session;
  /** Status BEFORE the update (what the row used to look like). */
  previousStatus: SessionStatus;
  assignedMaestro: Teacher;
  /** 1-based attempt counter — AC-3.2.6 keys derive from this. */
  attempt?: number;
}

export interface DispatchTransitionResult {
  outcomes: DispatchOutcome[];
  failures: DispatchOutcome[];
  /**
   * `false` when the transition is a documented no-email path
   * (pending→cancelled / confirmed→completed / confirmed→no_show), OR
   * when the (from, to) pair is illegal/unknown. `true` when the email
   * dispatcher actually ran (succeeded OR failed).
   */
  dispatched: boolean;
}

export type DispatchTransitionFn = (
  input: DispatchTransitionInput,
) => Promise<DispatchTransitionResult>;

interface EmailDescriptor {
  eventKind: EventKind;
  slot: { subject: string; html: string; text: string };
}

/**
 * Decide which CONTENT_EMAIL.PUBLIC.* slot a transition fires (if any).
 * Pure function — exported so the integration pairing can iterate the
 * full matrix without re-deriving.
 */
export function emailDescriptorFor(from: SessionStatus, to: SessionStatus): EmailDescriptor | null {
  if (from === 'pending' && to === 'confirmed') {
    return { eventKind: 'visitor_confirm', slot: CONTENT_EMAIL.PUBLIC.visitorConfirmed };
  }
  if (from === 'pending' && to === 'rejected') {
    return { eventKind: 'visitor_decline', slot: CONTENT_EMAIL.PUBLIC.visitorDeclined };
  }
  if (from === 'confirmed' && to === 'cancelled') {
    return { eventKind: 'visitor_cancel', slot: CONTENT_EMAIL.PUBLIC.visitorCancelled };
  }
  return null;
}

/** Factory. Tests substitute fakes via deps; production wires through composition. */
export function createDispatchTransition(deps: DispatchTransitionDeps): DispatchTransitionFn {
  const { emailSender, telegram, notifyLog, maestrosReader } = deps;

  return async (input: DispatchTransitionInput): Promise<DispatchTransitionResult> => {
    const { session, previousStatus, assignedMaestro, attempt = 1 } = input;
    const newStatus = session.status as SessionStatus;
    const descriptor = emailDescriptorFor(previousStatus, newStatus);
    if (!descriptor) {
      // No-email transition (or illegal pair caller-side — defense-in-depth).
      return { outcomes: [], failures: [], dispatched: false };
    }

    const brandOwner = await maestrosReader.findBrandOwner();
    if (!brandOwner) {
      throw new Error(
        'dispatch-transition: brand-owner row missing — run scripts/migrate.ts (seed 0003_seed_augusto.sql)',
      );
    }

    const visitorTz = session.visitorTimezone ?? assignedMaestro.timezone;
    const vars: Record<string, string> = {
      visitorName: session.visitorName,
      maestroName: assignedMaestro.name,
      slotVisitorLocal: formatSlot(session.startsAtUtc, visitorTz),
      visitorTimezone: visitorTz,
      slotMaestroLocal: formatSlot(session.startsAtUtc, assignedMaestro.timezone),
      maestroTimezone: assignedMaestro.timezone,
      contactChannel: contactChannelLabel(session.contactPref),
      brandOwnerName: brandOwner.name,
    };

    const sendRes = await emailSender.send({
      to: session.visitorEmail,
      subject: interpolate(descriptor.slot.subject, vars),
      html: interpolate(descriptor.slot.html, vars),
      text: interpolate(descriptor.slot.text, vars),
      sessionId: session.id,
      eventKind: descriptor.eventKind,
      attempt,
    });
    const visitorOutcome: DispatchOutcome = {
      channel: 'resend',
      eventKind: descriptor.eventKind,
      recipient: session.visitorEmail,
      status: sendRes.ok ? 200 : sendRes.status,
      errorBody: sendRes.ok ? null : truncate(sendRes.errorBody),
      attemptNumber: attempt,
    };

    const outcomes: DispatchOutcome[] = [visitorOutcome];

    // AC-3.3.3 — visitor failure + brand-owner has chat → warning Telegram.
    if (!isSuccess(visitorOutcome.status) && brandOwner.telegramChatId) {
      const text = interpolate(BRAND_OWNER_VISITOR_FAILURE_TEMPLATE, {
        visitorEmail: session.visitorEmail,
        status: String(visitorOutcome.status),
        sessionId: session.id,
      });
      const warnRes = await telegram.sendMessage({
        chatId: brandOwner.telegramChatId,
        text,
        parseMode: 'HTML',
      });
      outcomes.push({
        channel: 'telegram',
        eventKind: 'maestro_failure',
        recipient: brandOwner.telegramChatId,
        status: warnRes.ok ? 200 : warnRes.status,
        errorBody: warnRes.ok ? null : truncate(warnRes.errorBody),
        attemptNumber: attempt,
      });
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

    return { outcomes, failures, dispatched: true };
  };
}

/**
 * Default-instance — reads composition lazily at each invocation so
 * __resetCompositionForTests() flushes cleanly between tests.
 */
export const dispatchTransition: DispatchTransitionFn = (input) => {
  const c = getComposition();
  return createDispatchTransition({
    emailSender: c.emailSender,
    telegram: c.telegram,
    notifyLog: c.notifyLog,
    maestrosReader: c.maestrosReader,
  })(input);
};
