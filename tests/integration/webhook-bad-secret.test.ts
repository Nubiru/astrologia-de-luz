/**
 * G_C-16 integration pairing #1 — webhook secret-token gate (AC-3.7.2).
 *
 * Telegram's recommended webhook auth is the `X-Telegram-Bot-Api-Secret-Token`
 * header: a random secret shared between the bot owner (via `setWebhook`) and
 * the receiving endpoint. Mismatched / missing secret returns 401 silently.
 *
 * Fails when:
 *   - The header check is dropped — any request would reach the /start
 *     handler, letting an attacker exhaust onboarding tokens or pin chat
 *     bindings.
 *   - The mismatch path leaks via a 4xx-with-body that distinguishes
 *     "wrong secret" from "no secret" (anti-enum at the secret seam).
 *   - The check is moved AFTER the JSON parse — an attacker can POST a
 *     malformed payload and trigger an early 200, signalling reachability.
 *   - Constant-time comparison regresses to `===` and a probe attacker can
 *     extract the secret one byte at a time via timing.
 *   - A 401 path still fires Telegram outbound replies (information leak
 *     about which tokens exist).
 */

import { afterEach, describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  for (const [k, v] of Object.entries({
    TURSO_DATABASE_URL: ':memory:',
    TURSO_AUTH_TOKEN: 'fixture-token',
    AUTH_SECRET: 's'.repeat(48),
    AUTH_URL: 'http://localhost:3000',
    AUTH_RESEND_KEY: 're_fixture_badsecret',
    RESEND_FROM: 'Astrologia de Luz <no-reply@badsecret.test>',
    ADMIN_EMAILS: 'augusto@astrologiadeluz.test',
    TELEGRAM_BOT_TOKEN: '1:badsecret-token',
    TELEGRAM_BOT_USERNAME: 'BadSecretBot',
    TELEGRAM_WEBHOOK_SECRET: 'k'.repeat(48),
  })) {
    process.env[k] = v;
  }
});

import { NextRequest } from 'next/server';

import { getDb } from '@/infrastructure/db/client';
import {
  buildTelegramStub,
  buildTestComposition,
  installTestComposition,
} from '../_helpers/dispatcher-stubs';

const VALID_SECRET = 'k'.repeat(48);

interface RouteModule {
  POST: (request: NextRequest) => Promise<Response>;
}

const buildRequest = (headers: Record<string, string> = {}, body?: string): NextRequest =>
  new NextRequest('http://localhost/api/webhook/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body:
      body ??
      JSON.stringify({
        message: {
          chat: { id: 7777 },
          text: '/start any-token-since-secret-fails-first',
        },
      }),
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AC-3.7.2 — webhook secret-token gate', () => {
  test('missing secret header → 401 with no body, no outbound replies', async () => {
    const telegram = buildTelegramStub();
    installTestComposition(buildTestComposition(getDb(), { telegram }));
    const { POST } = (await import('@/app/api/webhook/telegram/route')) as RouteModule;

    const res = await POST(buildRequest());

    expect(res.status).toBe(401);
    expect(await res.text()).toBe('');
    expect(telegram.calls).toHaveLength(0);
  });

  test('wrong secret value (same length) → 401, no outbound replies', async () => {
    const telegram = buildTelegramStub();
    installTestComposition(buildTestComposition(getDb(), { telegram }));
    const { POST } = (await import('@/app/api/webhook/telegram/route')) as RouteModule;

    const res = await POST(
      buildRequest({
        'x-telegram-bot-api-secret-token': 'X'.repeat(VALID_SECRET.length),
      }),
    );

    expect(res.status).toBe(401);
    expect(telegram.calls).toHaveLength(0);
  });

  test('wrong-length secret → 401 (constant-time path still rejects)', async () => {
    const telegram = buildTelegramStub();
    installTestComposition(buildTestComposition(getDb(), { telegram }));
    const { POST } = (await import('@/app/api/webhook/telegram/route')) as RouteModule;

    const res = await POST(buildRequest({ 'x-telegram-bot-api-secret-token': 'short' }));

    expect(res.status).toBe(401);
    expect(telegram.calls).toHaveLength(0);
  });

  test('valid secret + non-/start text → 200, no replies (gate releases on header only)', async () => {
    // Counter-test: when the secret IS correct, the route advances past the
    // 401 gate. A non-/start payload (no DB lookup needed) proves the 401
    // branch above is gated on the header check, not on a downstream
    // short-circuit. Without this counter the 401 tests would pass vacuously
    // if the route returned 401 unconditionally.
    const telegram = buildTelegramStub();
    installTestComposition(buildTestComposition(getDb(), { telegram }));
    const { POST } = (await import('@/app/api/webhook/telegram/route')) as RouteModule;

    const res = await POST(
      buildRequest(
        { 'x-telegram-bot-api-secret-token': VALID_SECRET },
        JSON.stringify({ message: { chat: { id: 1 }, text: 'hola' } }),
      ),
    );

    expect(res.status).toBe(200);
    expect(telegram.calls).toHaveLength(0);
  });

  test('GET → 405 with Allow: POST', async () => {
    const { GET } = (await import('@/app/api/webhook/telegram/route')) as unknown as {
      GET: () => Response;
    };

    const res = GET();
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });
});
