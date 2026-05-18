// Resend transactional-email client. Spec anchors: AC-3.2.4, AC-3.2.6, AC-3.3.3.
//
// idempotencyKey({sessionId, eventKind, attempt}) — SHA256 hex of
// `${sessionId}:${eventKind}:${attempt}` per AC-3.2.6. The same triple yields
// the same key, so a retry of the same dispatch reaches Resend with the same
// Idempotency-Key header and is deduped server-side; any axis change (session,
// kind, attempt) produces a different key and a new send.

import { createHash } from 'node:crypto';
import { Resend } from 'resend';

import { getEnv } from '@/lib/env';

export type EventKind =
  | 'visitor_receipt'
  | 'visitor_confirm'
  | 'visitor_decline'
  | 'visitor_cancel'
  | 'maestro_fallback'
  | 'maestro_failure';

export interface IdempotencyKeyInput {
  sessionId: string;
  eventKind: EventKind;
  attempt: number;
}

export function idempotencyKey(input: IdempotencyKeyInput): string {
  return createHash('sha256')
    .update(`${input.sessionId}:${input.eventKind}:${input.attempt}`)
    .digest('hex');
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  sessionId: string;
  eventKind: EventKind;
  attempt: number;
}

let client: Resend | undefined;

export function getResendClient(): Resend {
  if (client === undefined) client = new Resend(getEnv().AUTH_RESEND_KEY);
  return client;
}

export async function sendEmail(input: SendEmailInput) {
  const key = idempotencyKey({
    sessionId: input.sessionId,
    eventKind: input.eventKind,
    attempt: input.attempt,
  });
  return getResendClient().emails.send(
    {
      from: getEnv().RESEND_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    },
    { idempotencyKey: key },
  );
}

// Test-only escape hatch: resets the lazily-cached client so a test that
// remocks env can construct a fresh Resend instance against the new key.
export function __resetResendClient(): void {
  client = undefined;
}
