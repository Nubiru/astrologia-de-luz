// Notifications bounded-context ports. Spec anchor: S-2 §7.2.4 C (verbatim bodies).
//
// W4-4 stub: pure TS interfaces. Adapters live in src/infrastructure/email/,
// src/infrastructure/telegram/, src/infrastructure/db/repositories/notify-log/.

import type { EventKind } from '@/domain/notifications/event-kinds';

/**
 * EmailSender — Resend HTTP transport at the email seam.
 * Vernon Ch.3 row 10 — Anti-Corruption Layer at the external API boundary.
 */
export interface EmailSender {
  send(input: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    sessionId: string;
    eventKind: EventKind;
    attempt: number;
  }): Promise<{ ok: boolean; status: number; errorBody: string | null }>;
}

/**
 * TelegramBot — Telegram Bot API.
 * Vernon row 10 — ACL at the Telegram seam.
 */
export interface TelegramBot {
  sendMessage(input: {
    chatId: number | string;
    text: string;
    parseMode?: 'HTML' | 'MarkdownV2';
  }): Promise<{ ok: boolean; status: number; errorBody: string | null }>;
  getWebhookInfo(): Promise<{
    ok: boolean;
    result?: {
      url: string;
      last_error_message?: string;
      pending_update_count: number;
    };
  }>;
}

/**
 * NotifyLog — failure-only telemetry write port (AC-3.3.1).
 * Vernon Ch.4 row 16 — Repository as right-side Adapter (small surface, single Aggregate).
 */
export interface NotifyLog {
  persistFailures(
    outcomes: Array<{
      sessionId: string;
      channel: 'telegram' | 'resend';
      eventKind: EventKind;
      recipient: string;
      status: number;
      errorBody: string | null;
      attemptNumber: number;
    }>,
  ): Promise<void>;
  findById(id: string): Promise<{
    sessionId: string;
    channel: 'telegram' | 'resend';
    eventKind: EventKind;
    recipient: string;
    payload: unknown; // for retry path G_C-15
  } | null>;
}
