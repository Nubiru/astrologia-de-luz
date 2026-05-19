/**
 * G_C-12 pairing — Telegram Bot API client (AC-3.2.1, AC-3.2.2, AC-3.7.2, AC-3.7.6).
 *
 * Stubs `globalThis.fetch` and asserts that `sendMessage` / `setWebhook` /
 * `getWebhookInfo` each assemble the request shape Telegram's Bot API expects:
 *   - URL = `https://api.telegram.org/bot<TOKEN>/<method>`
 *   - POST + JSON content-type
 *   - body shape matches the API contract (snake_case keys, no extra fields,
 *     optional parse_mode only when supplied)
 *   - response JSON is forwarded transparently
 *
 * These assertions FAIL when:
 *   - The base URL is rewritten to a CDN / proxy and Telegram never receives
 *     the call (silent 1-hour outage of the brand-owner ping channel).
 *   - A casing change drops `chat_id` → `chatId` (sends never deliver).
 *   - parse_mode is unconditionally set when the caller did not opt in
 *     (caller-controlled per AC-3.2.1 vs AC-3.7.3).
 *   - getWebhookInfo body diverges from `{}` and Telegram 4xx-s, killing the
 *     panel status dot.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/infrastructure/env', () => ({
  getEnv: () => ({
    TELEGRAM_BOT_TOKEN: '1234567890:TEST-TOKEN-FIXTURE',
  }),
}));

import { getWebhookInfo, sendMessage, setWebhook } from '@/infrastructure/telegram/client';

const EXPECTED_BASE = 'https://api.telegram.org/bot1234567890:TEST-TOKEN-FIXTURE';

type FetchArgs = Parameters<typeof fetch>;

function stubFetch(jsonBody: unknown): { calls: FetchArgs[] } {
  const calls: FetchArgs[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((...args: FetchArgs) => {
      calls.push(args);
      return Promise.resolve(
        new Response(JSON.stringify(jsonBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch,
  );
  return { calls };
}

function parseBody(call: FetchArgs): Record<string, unknown> {
  const init = call[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lib/telegram sendMessage — URL + body assembly', () => {
  test('POSTs to https://api.telegram.org/bot<TOKEN>/sendMessage with chat_id + text', async () => {
    const { calls } = stubFetch({ ok: true, result: { message_id: 42, chat: { id: 7 } } });
    const res = await sendMessage({ chatId: 7, text: 'hola' });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error('expected at least one fetch call');
    const [url, init] = call;
    expect(url).toBe(`${EXPECTED_BASE}/sendMessage`);
    expect((init as RequestInit).method).toBe('POST');
    expect(((init as RequestInit).headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    );
    expect(parseBody(call)).toEqual({ chat_id: 7, text: 'hola' });
    expect(res).toEqual({ ok: true, result: { message_id: 42, chat: { id: 7 } } });
  });

  test('forwards parse_mode only when supplied (HTML for brand-owner ping)', async () => {
    const { calls } = stubFetch({ ok: true, result: { message_id: 1, chat: { id: 99 } } });
    await sendMessage({ chatId: 99, text: '<b>nueva</b>', parseMode: 'HTML' });

    const call = calls[0];
    if (!call) throw new Error('expected at least one fetch call');
    expect(parseBody(call)).toEqual({
      chat_id: 99,
      text: '<b>nueva</b>',
      parse_mode: 'HTML',
    });
  });

  test('chat_id is sent verbatim when given as a string (channel handles)', async () => {
    const { calls } = stubFetch({ ok: true, result: { message_id: 2, chat: { id: 0 } } });
    await sendMessage({ chatId: '@astrologia_owner', text: 'ping' });

    const call = calls[0];
    if (!call) throw new Error('expected at least one fetch call');
    const body = parseBody(call);
    expect(body.chat_id).toBe('@astrologia_owner');
    expect(body).not.toHaveProperty('parse_mode');
  });

  test('Telegram 4xx error envelope is forwarded transparently to the caller', async () => {
    stubFetch({ ok: false, error_code: 400, description: 'chat not found' });
    const res = await sendMessage({ chatId: 0, text: 'lost' });
    expect(res).toEqual({ ok: false, error_code: 400, description: 'chat not found' });
  });

  test('non-JSON body (proxy outage) downgrades to ok=false with the raw text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response('<html>502 Bad Gateway</html>', { status: 502 })),
      ) as unknown as typeof fetch,
    );
    const res = await sendMessage({ chatId: 1, text: 'x' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error_code).toBe(502);
      expect(res.description).toContain('502 Bad Gateway');
    }
  });
});

describe('lib/telegram setWebhook — URL + body assembly', () => {
  test('POSTs to <BASE>/setWebhook with url + secret_token (snake_case)', async () => {
    const { calls } = stubFetch({ ok: true, result: true });
    await setWebhook({
      url: 'https://astrologiadeluz.com/api/telegram/webhook',
      secretToken: 'shh-secret',
    });
    const call = calls[0];
    if (!call) throw new Error('expected at least one fetch call');
    expect(call[0]).toBe(`${EXPECTED_BASE}/setWebhook`);
    expect(parseBody(call)).toEqual({
      url: 'https://astrologiadeluz.com/api/telegram/webhook',
      secret_token: 'shh-secret',
    });
  });
});

describe('lib/telegram getWebhookInfo — URL + body assembly', () => {
  test('POSTs to <BASE>/getWebhookInfo with empty body', async () => {
    const { calls } = stubFetch({
      ok: true,
      result: {
        url: 'https://astrologiadeluz.com/api/telegram/webhook',
        has_custom_certificate: false,
        pending_update_count: 0,
      },
    });
    const res = await getWebhookInfo();
    const call = calls[0];
    if (!call) throw new Error('expected at least one fetch call');
    expect(call[0]).toBe(`${EXPECTED_BASE}/getWebhookInfo`);
    expect(parseBody(call)).toEqual({});
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.url).toContain('astrologiadeluz.com');
    }
  });
});
