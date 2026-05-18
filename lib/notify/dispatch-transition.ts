/**
 * lib/notify/dispatch-transition.ts — per-transition visitor email dispatcher.
 *
 * Spec anchors: S-1 AC-3.4.2 + AC-3.3.1 + AC-3.3.3.
 *
 * Fires AFTER `app/api/sessions/[id]/route.ts` (G_C-11) commits a status
 * transition (so the visitor's record is already in its new state). The
 * dispatch matrix is the AC-3.4.2 table:
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
 * All other (from, to) pairs are illegal per AC-2.2.4 — the caller G_C-11
 * rejects them with 409 before reaching this function. If an unknown pair
 * arrives anyway, the dispatcher treats it as a no-op (defense-in-depth;
 * never throws).
 *
 * Failure handling mirrors G_C-13: any non-2xx visitor email outcome
 * triggers the AC-3.3.3 warning Telegram (via the shared helper) and
 * persists to `notify_log`. Event kinds are pulled from the AC-3.2.6
 * enum (lib/resend.ts EventKind):
 *
 *   - pending→confirmed   → `visitor_confirm`
 *   - pending→rejected    → `visitor_decline`
 *   - confirmed→cancelled → `visitor_cancel`
 *
 * Per `dispatch-pending.ts` parity: NEVER throws on dispatch failure.
 * Throws ONLY if the brand-owner seed row is missing.
 */

import type { Session, Teacher } from '@/db/schema';
import { type DbClient, getBrandOwner } from '@/lib/brand-owner';
import { CONTENT_EMAIL } from '@/lib/content';
import {
  type DispatchDb,
  type DispatchOutcome,
  contactChannelLabel,
  dispatchEmail,
  formatSlot,
  interpolate,
  maybeFireVisitorFailureWarning,
  persistFailures,
} from '@/lib/notify/shared';
import type { EventKind } from '@/lib/resend';

export type SessionStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'rejected'
  | 'no_show'
  | 'completed';

export interface DispatchTransitionInput {
  db: DispatchDb;
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

interface EmailDescriptor {
  eventKind: EventKind;
  slot: { subject: string; html: string; text: string };
}

/**
 * Decide which `CONTENT_EMAIL.PUBLIC.*` slot a transition fires (if any).
 * Pure function — exported so the integration pairing can iterate the
 * full matrix without re-deriving.
 */
export function emailDescriptorFor(from: SessionStatus, to: SessionStatus): EmailDescriptor | null {
  if (from === 'pending' && to === 'confirmed') {
    return {
      eventKind: 'visitor_confirm',
      slot: CONTENT_EMAIL.PUBLIC.visitorConfirmed,
    };
  }
  if (from === 'pending' && to === 'rejected') {
    return {
      eventKind: 'visitor_decline',
      slot: CONTENT_EMAIL.PUBLIC.visitorDeclined,
    };
  }
  if (from === 'confirmed' && to === 'cancelled') {
    return {
      eventKind: 'visitor_cancel',
      slot: CONTENT_EMAIL.PUBLIC.visitorCancelled,
    };
  }
  return null;
}

export async function dispatchTransition(
  input: DispatchTransitionInput,
): Promise<DispatchTransitionResult> {
  const { db, session, previousStatus, assignedMaestro, attempt = 1 } = input;
  const newStatus = session.status as SessionStatus;
  const descriptor = emailDescriptorFor(previousStatus, newStatus);
  if (!descriptor) {
    // No-email transition (or illegal pair caller-side — defense-in-depth).
    return { outcomes: [], failures: [], dispatched: false };
  }

  const brandOwner = await getBrandOwner(db as unknown as DbClient);
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

  const visitorOutcome = await dispatchEmail({
    to: session.visitorEmail,
    subject: interpolate(descriptor.slot.subject, vars),
    html: interpolate(descriptor.slot.html, vars),
    text: interpolate(descriptor.slot.text, vars),
    sessionId: session.id,
    eventKind: descriptor.eventKind,
    attempt,
  });

  const outcomes: DispatchOutcome[] = [visitorOutcome];

  const warningOutcome = await maybeFireVisitorFailureWarning({
    visitorOutcome,
    brandOwnerChatId: brandOwner.telegramChatId,
    sessionId: session.id,
    visitorEmail: session.visitorEmail,
    attempt,
  });
  if (warningOutcome) outcomes.push(warningOutcome);

  await persistFailures(db, session.id, outcomes);

  return {
    outcomes,
    failures: outcomes.filter((o) => o.status < 200 || o.status >= 300),
    dispatched: true,
  };
}
