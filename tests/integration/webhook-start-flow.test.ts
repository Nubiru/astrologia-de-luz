/**
 * G_C-16 integration pairing #2 — /start <token> onboarding flow (AC-3.7.3).
 *
 * End-to-end DB-truth pairing: runs the real migrations + seed migration into
 * an on-disk libSQL fixture, inserts a fresh onboarding token for a
 * non-brand-owner maestro, drives the route's POST handler with a Telegram
 * Update payload, then asserts (a) the row writes the spec mandates landed,
 * and (b) the two outbound replies fired through the TelegramBot port.
 *
 * Fails when:
 *   - The token lookup widens beyond `consumed_at IS NULL AND expires_at > now`
 *     — an expired or consumed token would re-bind the chat_id, breaking the
 *     single-use semantics of AC-3.7.1.
 *   - The chat_id UPDATE writes the message_id / sender_id by mistake (the
 *     spec is explicit: `message.chat.id` is the binding).
 *   - The token UPDATE forgets `consumed_at = Date.now()`, leaving the token
 *     reusable across requests (anti-replay broken).
 *   - The brand-owner ping fires when the onboarded teacher IS the brand
 *     owner — sending the dedup message to the same chat as the maestro
 *     reply is the AC-3.2.2-mirrored noise pattern.
 *   - The brand-owner ping panics when `brandOwner.telegramChatId` is NULL
 *     — should skip silently per S-1 §11 closing paragraph (line 650).
 *   - Either reply uses the wrong CONTENT slot key (would silently send an
 *     empty body OR the wrong maestro's name into the bind text).
 */

import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  const { closeSync, mkdtempSync, openSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const TMP = mkdtempSync(join(tmpdir(), 'gc16-start-'));
  const DB_PATH = join(TMP, 'webhook.db');
  closeSync(openSync(DB_PATH, 'w'));
  process.env.__GC16_TMP = TMP;
  for (const [k, v] of Object.entries({
    TURSO_DATABASE_URL: `file:${DB_PATH}`,
    TURSO_AUTH_TOKEN: 'fixture-token',
    AUTH_SECRET: 'w'.repeat(48),
    AUTH_URL: 'http://localhost:3000',
    AUTH_RESEND_KEY: 're_fixture_startflow',
    RESEND_FROM: 'Astrologia de Luz <no-reply@startflow.test>',
    ADMIN_EMAILS: 'augusto@astrologiadeluz.test',
    TELEGRAM_BOT_TOKEN: '1:startflow-token',
    TELEGRAM_BOT_USERNAME: 'StartFlowBot',
    TELEGRAM_WEBHOOK_SECRET: 'w'.repeat(48),
  })) {
    process.env[k] = v;
  }
});

import { getClient, getDb } from '@/infrastructure/db/client';
import { teacherOnboardingTokens, teachers } from '@/infrastructure/db/schema';

import {
  buildTelegramStub,
  buildTestComposition,
  installTestComposition,
} from '../_helpers/dispatcher-stubs';

const VALID_SECRET = 'w'.repeat(48);
const ADMIN_EMAIL = 'augusto@astrologiadeluz.test';

const REPO_ROOT = resolve(__dirname, '..', '..');
const MIGRATION_FILES = [
  '0000_init.sql',
  '0001_authjs.sql',
  '0002_cp3_tables.sql',
  '0003_seed_augusto.sql',
] as const;

const renderSeed = (sql: string, email: string): string => sql.split('$$ADMIN_EMAIL$$').join(email);

const splitStatements = (raw: string): string[] =>
  raw
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

interface RouteModule {
  POST: (request: NextRequest) => Promise<Response>;
}

const buildPostRequest = (chatId: number, text: string, secret = VALID_SECRET): NextRequest =>
  new NextRequest('http://localhost/api/webhook/telegram', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': secret,
    },
    body: JSON.stringify({
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: chatId, is_bot: false, first_name: 'Maestro' },
        chat: { id: chatId, type: 'private' },
        text,
      },
    }),
  });

const AUGUSTO_ID = 'augusto-rocha-uuid-stable';
const MARIA_ID = 'maria-luz-uuid-fixture';
const MARIA_EMAIL = 'maria@astrologiadeluz.test';

beforeAll(async () => {
  const client = getClient();
  for (const file of MIGRATION_FILES) {
    const path = join(REPO_ROOT, 'src/infrastructure/db/migrations', file);
    const raw = readFileSync(path, 'utf8');
    const sql = file === '0003_seed_augusto.sql' ? renderSeed(raw, ADMIN_EMAIL) : raw;
    for (const stmt of splitStatements(sql)) {
      await client.execute(stmt);
    }
  }
});

afterAll(() => {
  const tmp = process.env.__GC16_TMP;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  const client = getClient();
  // Clean per-test mutable rows so each scenario starts from a known state.
  await client.execute('DELETE FROM teacher_onboarding_tokens');
  await client.execute(`DELETE FROM teachers WHERE id = '${MARIA_ID}'`);
  // Reset Augusto's chat_id between cases — some tests pre-bind it (happy
  // path needs the brand-owner ping to have a destination) and others want
  // it unbound (self-onboarding case).
  await client.execute(`UPDATE teachers SET telegram_chat_id = NULL WHERE id = '${AUGUSTO_ID}'`);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const insertMaria = async (): Promise<void> => {
  const now = Date.now();
  const client = getClient();
  await client.execute({
    sql: `INSERT INTO teachers (id, slug, name, email, availability, timezone, active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    args: [
      MARIA_ID,
      'maria-luz',
      'María de Luz',
      MARIA_EMAIL,
      '{"tz":"America/Argentina/Buenos_Aires","windows":[],"blackouts":[]}',
      'America/Argentina/Buenos_Aires',
      now,
      now,
    ],
  });
};

const insertToken = async (
  token: string,
  teacherId: string,
  expiresAt: number,
  consumedAt: number | null = null,
): Promise<void> => {
  const client = getClient();
  await client.execute({
    sql: `INSERT INTO teacher_onboarding_tokens (token, teacher_id, expires_at, consumed_at)
          VALUES (?, ?, ?, ?)`,
    args: [token, teacherId, expiresAt, consumedAt],
  });
};

const setAugustoChatId = async (chatId: string): Promise<void> => {
  const client = getClient();
  await client.execute({
    sql: 'UPDATE teachers SET telegram_chat_id = ? WHERE id = ?',
    args: [chatId, AUGUSTO_ID],
  });
};

describe('AC-3.7.3 — /start <token> happy path (non-brand-owner)', () => {
  test('binds chat_id + consumes token + sends maestro reply + brand-owner ping', async () => {
    const MARIA_CHAT_ID = 9999;
    const AUGUSTO_CHAT_ID = '5555';
    const TOKEN = 'token-happy-path-fixture-xyz';

    await insertMaria();
    await insertToken(TOKEN, MARIA_ID, Date.now() + 60_000);
    await setAugustoChatId(AUGUSTO_CHAT_ID);

    const telegram = buildTelegramStub();
    installTestComposition(buildTestComposition(getDb(), { telegram }));
    const { POST } = (await import('@/app/api/webhook/telegram/route')) as RouteModule;

    const t0 = Date.now();
    const res = await POST(buildPostRequest(MARIA_CHAT_ID, `/start ${TOKEN}`));

    expect(res.status).toBe(200);

    // DB: María's chat_id bound, token consumed.
    const db = getDb();
    const [mariaRow] = await db.select().from(teachers).where(eq(teachers.id, MARIA_ID)).limit(1);
    expect(mariaRow?.telegramChatId).toBe(String(MARIA_CHAT_ID));

    const [tokenRow] = await db
      .select()
      .from(teacherOnboardingTokens)
      .where(eq(teacherOnboardingTokens.token, TOKEN))
      .limit(1);
    expect(tokenRow?.consumedAt).not.toBeNull();
    expect(tokenRow?.consumedAt ?? 0).toBeGreaterThanOrEqual(t0);

    // Telegram: 2 calls — maestro reply (to María's chat) + brand-owner ping
    // (to Augusto's chat). Order matters: maestro first, owner second.
    expect(telegram.calls).toHaveLength(2);
    const [maestroReply, ownerPing] = telegram.calls;
    expect(maestroReply?.chatId).toBe(MARIA_CHAT_ID);
    expect(maestroReply?.text).toContain('María de Luz');
    expect(maestroReply?.text).toContain('Listo');
    expect(ownerPing?.chatId).toBe(AUGUSTO_CHAT_ID);
    expect(ownerPing?.text).toContain('María de Luz');
    expect(ownerPing?.text).toContain('conectado al bot');
  });
});

describe('AC-3.7.3 — /start <token> brand-owner self-onboarding (dedupe)', () => {
  test('Augusto onboarding himself → 1 telegram call, brand-owner ping skipped', async () => {
    const AUGUSTO_CHAT_ID = 4242;
    const TOKEN = 'token-augusto-self-onboard';

    await insertToken(TOKEN, AUGUSTO_ID, Date.now() + 60_000);
    // Augusto's chat_id starts NULL (beforeEach reset).

    const telegram = buildTelegramStub();
    installTestComposition(buildTestComposition(getDb(), { telegram }));
    const { POST } = (await import('@/app/api/webhook/telegram/route')) as RouteModule;

    const res = await POST(buildPostRequest(AUGUSTO_CHAT_ID, `/start ${TOKEN}`));

    expect(res.status).toBe(200);

    const db = getDb();
    const [augustoRow] = await db
      .select()
      .from(teachers)
      .where(eq(teachers.id, AUGUSTO_ID))
      .limit(1);
    expect(augustoRow?.telegramChatId).toBe(String(AUGUSTO_CHAT_ID));

    // Exactly 1 call — the maestro reply to himself. The brand-owner ping is
    // skipped because teacher.email === ADMIN_EMAILS[0]; sending it would be
    // self-addressed noise (mirrors AC-3.2.2's assigned-maestro dedupe).
    expect(telegram.calls).toHaveLength(1);
    expect(telegram.calls[0]?.chatId).toBe(AUGUSTO_CHAT_ID);
    expect(telegram.calls[0]?.text).toContain('Augusto Rocha');
  });
});

describe('AC-3.7.3 — /start <token> rejection paths', () => {
  test('expired token → 200, no DB writes, no telegram calls', async () => {
    const TOKEN = 'token-expired-fixture';
    await insertMaria();
    await insertToken(TOKEN, MARIA_ID, Date.now() - 1_000); // expired 1s ago

    const telegram = buildTelegramStub();
    installTestComposition(buildTestComposition(getDb(), { telegram }));
    const { POST } = (await import('@/app/api/webhook/telegram/route')) as RouteModule;

    const res = await POST(buildPostRequest(8888, `/start ${TOKEN}`));

    expect(res.status).toBe(200);
    expect(telegram.calls).toHaveLength(0);

    const db = getDb();
    const [mariaRow] = await db.select().from(teachers).where(eq(teachers.id, MARIA_ID)).limit(1);
    expect(mariaRow?.telegramChatId).toBeNull();

    const [tokenRow] = await db
      .select()
      .from(teacherOnboardingTokens)
      .where(eq(teacherOnboardingTokens.token, TOKEN))
      .limit(1);
    expect(tokenRow?.consumedAt).toBeNull();
  });

  test('already-consumed token → 200, no further DB writes, no telegram calls', async () => {
    const TOKEN = 'token-already-consumed-fixture';
    const CONSUMED_AT = Date.now() - 10_000;
    await insertMaria();
    // Pre-bound chat_id from the original consume; the second /start must
    // NOT overwrite it (single-use semantics).
    const client = getClient();
    await client.execute({
      sql: 'UPDATE teachers SET telegram_chat_id = ? WHERE id = ?',
      args: ['original-chat-1111', MARIA_ID],
    });
    await insertToken(TOKEN, MARIA_ID, Date.now() + 60_000, CONSUMED_AT);

    const telegram = buildTelegramStub();
    installTestComposition(buildTestComposition(getDb(), { telegram }));
    const { POST } = (await import('@/app/api/webhook/telegram/route')) as RouteModule;

    const res = await POST(buildPostRequest(2222, `/start ${TOKEN}`));

    expect(res.status).toBe(200);
    expect(telegram.calls).toHaveLength(0);

    const db = getDb();
    const [mariaRow] = await db.select().from(teachers).where(eq(teachers.id, MARIA_ID)).limit(1);
    // chat_id unchanged from the pre-bound value — proves the UPDATE didn't fire.
    expect(mariaRow?.telegramChatId).toBe('original-chat-1111');

    const [tokenRow] = await db
      .select()
      .from(teacherOnboardingTokens)
      .where(eq(teacherOnboardingTokens.token, TOKEN))
      .limit(1);
    // consumed_at unchanged — the second /start did NOT re-stamp it.
    expect(tokenRow?.consumedAt).toBe(CONSUMED_AT);
  });

  test('unknown token → 200, no DB writes, no telegram calls', async () => {
    const telegram = buildTelegramStub();
    installTestComposition(buildTestComposition(getDb(), { telegram }));
    const { POST } = (await import('@/app/api/webhook/telegram/route')) as RouteModule;

    const res = await POST(buildPostRequest(3333, '/start does-not-exist'));

    expect(res.status).toBe(200);
    expect(telegram.calls).toHaveLength(0);
  });
});

describe('AC-3.7.3 — brand-owner ping skipped silently when owner chat_id is NULL', () => {
  test('non-brand-owner onboards but Augusto has not onboarded → 1 telegram call', async () => {
    const TOKEN = 'token-owner-chat-null';
    await insertMaria();
    await insertToken(TOKEN, MARIA_ID, Date.now() + 60_000);
    // Augusto's chat_id stays NULL (beforeEach reset).

    const telegram = buildTelegramStub();
    installTestComposition(buildTestComposition(getDb(), { telegram }));
    const { POST } = (await import('@/app/api/webhook/telegram/route')) as RouteModule;

    const res = await POST(buildPostRequest(7777, `/start ${TOKEN}`));

    expect(res.status).toBe(200);
    // Maestro reply lands; brand-owner ping skipped silently per S-1 line 650.
    expect(telegram.calls).toHaveLength(1);
    expect(telegram.calls[0]?.chatId).toBe(7777);
    expect(telegram.calls[0]?.text).toContain('María de Luz');
  });
});
