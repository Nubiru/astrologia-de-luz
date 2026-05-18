/**
 * G_C-13 integration pairing — failure logging + AC-3.3.3 follow-up warning.
 *
 * Three failure shapes exercise the dispatcher's `notify_log` writes:
 *
 *   1. Visitor receipt email returns Resend 5xx → 1 log row + the AC-3.3.3
 *      brand-owner-warning Telegram fires immediately after.
 *   2. Assigned-maestro Telegram returns `{ ok: false, error_code: 403 }`
 *      (forbidden — e.g., the bot was blocked) → 1 log row, no warning
 *      (the maestro failure is unrelated to visitor delivery).
 *   3. Visitor receipt 5xx but brand-owner has NO chat_id → 1 log row
 *      (the visitor failure) + zero warning Telegram (cannot send).
 *
 * What this catches:
 *   - The notify_log batch INSERT drops the `recipient` column → row is
 *     written but the panel banner cannot surface "to whom did it fail".
 *   - The AC-3.3.3 warning fires even on success → unnecessary noise to
 *     Augusto's chat (call-count assertion catches it).
 *   - Status mapping confuses Telegram `error_code` with HTTP `status` —
 *     a 403 Telegram error_code lands in the row as `status: 200` because
 *     the HTTP-200 response from api.telegram.org masked the operational
 *     failure. The 403-assertion catches it.
 *   - error_body truncation regresses past 2000 chars → schema CHECK is
 *     OK (no schema enforcement) but the stored body bloats unboundedly.
 */

import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { type Client, createClient } from '@libsql/client';
import { type LibSQLDatabase, drizzle } from 'drizzle-orm/libsql';
import { beforeEach, describe, expect, test, vi } from 'vitest';

type TgResponse =
  | { ok: true; result: { message_id: number; chat: { id: number } } }
  | { ok: false; error_code?: number; description?: string };

type EmailResponse = {
  data: unknown;
  error: { statusCode?: number; message?: string } | null;
};

const fx = vi.hoisted(() => ({
  tgCalls: [] as Array<{ chatId: string; text: string; parseMode?: string }>,
  emailCalls: [] as Array<{
    to: string;
    subject: string;
    html: string;
    text: string;
    sessionId: string;
    eventKind: string;
    attempt: number;
  }>,
  tgRespByChatId: new Map<string, unknown>(),
  emailRespByEventKind: new Map<string, unknown>(),
}));

vi.mock('@/lib/env', () => ({
  getEnv: () => ({
    ADMIN_EMAILS: 'augusto@astrologiadeluz.com',
    TELEGRAM_BOT_TOKEN: '0000:test-token',
    AUTH_RESEND_KEY: 're_test',
    RESEND_FROM: 'no-reply@astrologiadeluz.com',
  }),
}));

vi.mock('@/lib/telegram', () => ({
  sendMessage: vi.fn(
    async (input: { chatId: string; text: string; parseMode?: string }): Promise<TgResponse> => {
      fx.tgCalls.push(input);
      const stub = fx.tgRespByChatId.get(input.chatId);
      if (stub) return stub as TgResponse;
      return { ok: true, result: { message_id: fx.tgCalls.length, chat: { id: 1 } } };
    },
  ),
}));

vi.mock('@/lib/resend', () => ({
  sendEmail: vi.fn(
    async (input: {
      to: string;
      subject: string;
      html: string;
      text: string;
      sessionId: string;
      eventKind: string;
      attempt: number;
    }): Promise<EmailResponse> => {
      fx.emailCalls.push(input);
      const stub = fx.emailRespByEventKind.get(input.eventKind);
      if (stub) return stub as EmailResponse;
      return { data: { id: `mock-${fx.emailCalls.length}` }, error: null };
    },
  ),
  idempotencyKey: vi.fn(
    (input: { sessionId: string; eventKind: string; attempt: number }) =>
      `mock-${input.sessionId}:${input.eventKind}:${input.attempt}`,
  ),
}));

import { type Session, type Teacher, notifyLog, sessions, teachers } from '@/db/schema';
import { dispatchPending } from '@/lib/notify/dispatch-pending';
import { runMigrations } from '../../scripts/migrate';

const ROOT = resolve(__dirname, '..', '..');
const MIGRATIONS = resolve(ROOT, 'db/migrations');
const REF_NOW = 1_779_789_600_000;
const AUGUSTO_CHAT_ID = '111222333';
const MARIA_CHAT_ID = '999888777';

type Fixture = {
  workdir: string;
  client: Client;
  db: LibSQLDatabase<Record<string, never>>;
};

async function makeFixture(opts: { brandOwnerChatId: string | null }): Promise<Fixture> {
  const workdir = mkdtempSync(join(tmpdir(), 'notify-fail-'));
  const dbPath = join(workdir, 'test.db');
  closeSync(openSync(dbPath, 'w'));
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client) as LibSQLDatabase<Record<string, never>>;
  await runMigrations(db, 'augusto@astrologiadeluz.com', MIGRATIONS);
  if (opts.brandOwnerChatId !== null) {
    await client.execute(
      `UPDATE teachers SET telegram_chat_id = '${opts.brandOwnerChatId}' WHERE slug = 'augusto-rocha'`,
    );
  }
  return { workdir, client, db };
}

async function seedMaria(
  db: LibSQLDatabase<Record<string, never>>,
  chatId: string | null,
): Promise<Teacher> {
  const inserted = await db
    .insert(teachers)
    .values({
      id: 'maria-uuid',
      slug: 'maria-luna',
      name: 'María Luna',
      email: 'maria@astrologiadeluz.com',
      bio: null,
      telegramChatId: chatId,
      availability: '{"tz":"America/Argentina/Buenos_Aires","windows":[],"blackouts":[]}',
      avatarUrl: null,
      timezone: 'America/Argentina/Buenos_Aires',
      active: true,
      createdAt: REF_NOW,
      updatedAt: REF_NOW,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error('Maria insert returned no row');
  return row as Teacher;
}

async function insertSessionFor(
  db: LibSQLDatabase<Record<string, never>>,
  maestro: Teacher,
  id: string,
): Promise<Session> {
  const inserted = await db
    .insert(sessions)
    .values({
      id,
      teacherId: maestro.id,
      startsAtUtc: REF_NOW,
      durationMinutes: 60,
      status: 'pending',
      visitorName: 'Visitante Falla',
      visitorEmail: 'falla@example.com',
      contactPref: 'email',
      contactValue: 'falla@example.com',
      visitorIntent: 'Probar el camino de fallo.',
      visitorTimezone: 'America/Argentina/Buenos_Aires',
      createdAt: REF_NOW,
      updatedAt: REF_NOW,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error('session insert returned no row');
  return row as Session;
}

describe('G_C-13 — failure logging + AC-3.3.3 warning Telegram', () => {
  beforeEach(() => {
    fx.tgCalls.length = 0;
    fx.emailCalls.length = 0;
    fx.tgRespByChatId.clear();
    fx.emailRespByEventKind.clear();
  });

  test('visitor email 5xx → 1 notify_log row + AC-3.3.3 warning Telegram fires', async () => {
    const f = await makeFixture({ brandOwnerChatId: AUGUSTO_CHAT_ID });
    try {
      const maria = await seedMaria(f.db, MARIA_CHAT_ID);
      const session = await insertSessionFor(f.db, maria, 'sess-fail-1');

      fx.emailRespByEventKind.set('visitor_receipt', {
        data: null,
        error: { statusCode: 502, message: 'Resend upstream 502 (mocked)' },
      });

      const result = await dispatchPending({ db: f.db, session, assignedMaestro: maria });

      // Outcomes: 2 successful Telegrams + 1 failed email + 1 warning Telegram = 4.
      expect(result.outcomes).toHaveLength(4);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.eventKind).toBe('visitor_receipt');
      expect(result.failures[0]?.status).toBe(502);

      // 3 Telegram calls (2 fan-out + 1 warning).
      expect(fx.tgCalls).toHaveLength(3);
      const warning = fx.tgCalls[2];
      expect(warning?.chatId).toBe(AUGUSTO_CHAT_ID);
      expect(warning?.text).toContain('falla@example.com');
      expect(warning?.text).toContain('502');
      expect(warning?.text).toContain(session.id);
      expect(warning?.text).toContain('contactá manualmente');

      // notify_log has the visitor-receipt failure (only — the warning succeeded).
      const rows = await f.db.select().from(notifyLog);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.eventKind).toBe('visitor_receipt');
      expect(rows[0]?.channel).toBe('resend');
      expect(rows[0]?.recipient).toBe('falla@example.com');
      expect(rows[0]?.status).toBe(502);
      expect(rows[0]?.errorBody).toContain('Resend upstream 502');
      expect(rows[0]?.attemptNumber).toBe(1);
      expect(rows[0]?.sessionId).toBe(session.id);
    } finally {
      f.client.close();
      rmSync(f.workdir, { recursive: true, force: true });
    }
  });

  test('Telegram → assigned-maestro returns ok:false → status mapped from error_code, no warning fires', async () => {
    const f = await makeFixture({ brandOwnerChatId: AUGUSTO_CHAT_ID });
    try {
      const maria = await seedMaria(f.db, MARIA_CHAT_ID);
      const session = await insertSessionFor(f.db, maria, 'sess-fail-2');

      fx.tgRespByChatId.set(MARIA_CHAT_ID, {
        ok: false,
        error_code: 403,
        description: 'Forbidden: bot was blocked by the user',
      });

      const result = await dispatchPending({ db: f.db, session, assignedMaestro: maria });

      expect(result.outcomes).toHaveLength(3); // brand-owner + assigned + visitor
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.channel).toBe('telegram');
      expect(result.failures[0]?.recipient).toBe(MARIA_CHAT_ID);
      expect(result.failures[0]?.status).toBe(403);
      expect(result.failures[0]?.errorBody).toContain('Forbidden');

      // No warning Telegram — visitor email succeeded, so AC-3.3.3 does not fire.
      // Total Telegram calls = 2 (brand-owner success + maestro failure attempt).
      expect(fx.tgCalls).toHaveLength(2);

      const rows = await f.db.select().from(notifyLog);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe(403);
      expect(rows[0]?.channel).toBe('telegram');
    } finally {
      f.client.close();
      rmSync(f.workdir, { recursive: true, force: true });
    }
  });

  test('visitor email fails AND brand-owner has no chat_id → no warning fires, 1 notify_log row', async () => {
    const f = await makeFixture({ brandOwnerChatId: null });
    try {
      const maria = await seedMaria(f.db, MARIA_CHAT_ID);
      const session = await insertSessionFor(f.db, maria, 'sess-fail-3');

      fx.emailRespByEventKind.set('visitor_receipt', {
        data: null,
        error: { statusCode: 503, message: 'Resend 503' },
      });

      const result = await dispatchPending({ db: f.db, session, assignedMaestro: maria });

      // Outcomes: brand-owner skipped (no chat_id) + Maria Telegram OK + visitor 503 = 2 outcomes.
      // No warning fires because brand-owner has no chat_id to receive it.
      expect(result.outcomes).toHaveLength(2);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.eventKind).toBe('visitor_receipt');
      expect(result.failures[0]?.status).toBe(503);

      // Total Telegram calls = 1 (Maria only).
      expect(fx.tgCalls).toHaveLength(1);
      expect(fx.tgCalls[0]?.chatId).toBe(MARIA_CHAT_ID);

      const rows = await f.db.select().from(notifyLog);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe(503);
    } finally {
      f.client.close();
      rmSync(f.workdir, { recursive: true, force: true });
    }
  });

  test('error_body truncates to 2000 chars (AC-3.3.1)', async () => {
    const f = await makeFixture({ brandOwnerChatId: AUGUSTO_CHAT_ID });
    try {
      const maria = await seedMaria(f.db, MARIA_CHAT_ID);
      const session = await insertSessionFor(f.db, maria, 'sess-fail-4');

      const longMessage = 'x'.repeat(2500);
      fx.emailRespByEventKind.set('visitor_receipt', {
        data: null,
        error: { statusCode: 500, message: longMessage },
      });

      await dispatchPending({ db: f.db, session, assignedMaestro: maria });

      const rows = await f.db.select().from(notifyLog);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.errorBody?.length).toBe(2000);
    } finally {
      f.client.close();
      rmSync(f.workdir, { recursive: true, force: true });
    }
  });

  test('attempt parameter flows into notify_log row + idempotency key derivation', async () => {
    const f = await makeFixture({ brandOwnerChatId: AUGUSTO_CHAT_ID });
    try {
      const maria = await seedMaria(f.db, MARIA_CHAT_ID);
      const session = await insertSessionFor(f.db, maria, 'sess-fail-5');

      fx.emailRespByEventKind.set('visitor_receipt', {
        data: null,
        error: { statusCode: 500, message: 'boom' },
      });

      await dispatchPending({ db: f.db, session, assignedMaestro: maria, attempt: 3 });

      const rows = await f.db.select().from(notifyLog);
      expect(rows[0]?.attemptNumber).toBe(3);
      const visitorEmail = fx.emailCalls.find((c) => c.eventKind === 'visitor_receipt');
      expect(visitorEmail?.attempt).toBe(3);
    } finally {
      f.client.close();
      rmSync(f.workdir, { recursive: true, force: true });
    }
  });
});
