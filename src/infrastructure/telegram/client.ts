// Telegram Bot API client. Spec anchors: AC-3.2.1, AC-3.2.2, AC-3.7.2, AC-3.7.6.
//
// Thin wrapper over `fetch` against `https://api.telegram.org/bot<TOKEN>/<method>`.
// sendMessage — used by the brand-owner + assigned-maestro pings (parse_mode HTML at the caller).
// setWebhook  — used by the one-time launch-kit ops action (AC-3.7.5) and by tests.
// getWebhookInfo — used by the panel status-dot check (AC-3.7.6); cached for 5min upstream.

import type { TelegramBot } from '@/domain/notifications/ports';
import { getEnv } from '@/infrastructure/env';

const TELEGRAM_API_ORIGIN = 'https://api.telegram.org';

export type TelegramResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error_code?: number; description?: string };

export interface SendMessageInput {
  chatId: number | string;
  text: string;
  parseMode?: 'HTML' | 'MarkdownV2';
}

export interface SetWebhookInput {
  url: string;
  secretToken: string;
}

export interface WebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  ip_address?: string;
  last_error_date?: number;
  last_error_message?: string;
  last_synchronization_error_date?: number;
  max_connections?: number;
  allowed_updates?: string[];
}

function endpoint(method: string): string {
  return `${TELEGRAM_API_ORIGIN}/bot${getEnv().TELEGRAM_BOT_TOKEN}/${method}`;
}

async function call<T>(
  method: string,
  body: Record<string, unknown>,
): Promise<TelegramResponse<T>> {
  const res = await fetch(endpoint(method), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  try {
    return JSON.parse(raw) as TelegramResponse<T>;
  } catch {
    return { ok: false, error_code: res.status, description: raw };
  }
}

export function sendMessage(
  input: SendMessageInput,
): Promise<TelegramResponse<{ message_id: number; chat: { id: number } }>> {
  const body: Record<string, unknown> = { chat_id: input.chatId, text: input.text };
  if (input.parseMode) body.parse_mode = input.parseMode;
  return call('sendMessage', body);
}

export function setWebhook(input: SetWebhookInput): Promise<TelegramResponse<true>> {
  return call('setWebhook', { url: input.url, secret_token: input.secretToken });
}

export function getWebhookInfo(): Promise<TelegramResponse<WebhookInfo>> {
  return call('getWebhookInfo', {});
}

/**
 * TelegramBot adapter (S-2 §7.2.4 C). Translates the existing TelegramResponse
 * union (`{ok:true,result}` / `{ok:false,error_code,description}`) into the
 * port-shaped `{ok, status, errorBody}` for sendMessage; getWebhookInfo
 * projects to the port's narrower result shape (url + last_error_message +
 * pending_update_count). Mirrors `dispatchTelegram` in src/application/notify/
 * shared.ts. Authored W4-3a per spec §7.2.5.
 */
export function makeTelegramBot(): TelegramBot {
  return {
    async sendMessage(input) {
      try {
        const res = await sendMessage(input);
        if (res.ok) return { ok: true, status: 200, errorBody: null };
        return {
          ok: false,
          status: typeof res.error_code === 'number' ? res.error_code : 0,
          errorBody: res.description ?? null,
        };
      } catch (err) {
        return {
          ok: false,
          status: 0,
          errorBody: err instanceof Error ? err.message : String(err),
        };
      }
    },
    async getWebhookInfo() {
      const res = await getWebhookInfo();
      if (!res.ok) return { ok: false };
      return {
        ok: true,
        result: {
          url: res.result.url,
          last_error_message: res.result.last_error_message,
          pending_update_count: res.result.pending_update_count,
        },
      };
    },
  };
}
