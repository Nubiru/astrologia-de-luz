/**
 * G_C-14 integration pairing — visitor-email-failure → AC-3.3.3 warning.
 *
 * Exercises the SHARED failure-handling helper through the transition
 * dispatcher path. AC-3.3.3 says: when the visitor confirmation/decline/
 * cancellation email fails, the dispatcher MUST fire a Telegram warning
 * to the brand-owner with the visitor's email + the Resend status + the
 * session id, so Augusto can reach the visitor out-of-band.
 *
 * Coverage (each test maps to a distinct failure shape):
 *
 *   1. Resend 5xx on `pending → confirmed`: visitor confirmation email
 *      fails → notify_log row + warning Telegram fires with the spec
 *      verbatim text.
 *   2. Same as #1 but `pending → rejected` (the decline email): proves
 *      the warning is event-kind-agnostic (NOT just `visitor_receipt`).
 *   3. Same as #1 but brand-owner has NO `telegram_chat_id`: no warning
 *      fires; notify_log still records the visitor failure.
 *   4. Warning Telegram ITSELF fails → 2 notify_log rows (visitor email
 *      + warning telegram). Proves the warning is logged as a normal
 *      outcome, not silently dropped.
 *
 * What this catches:
 *   - The shared helper drift in `maybeFireVisitorFailureWarning` — e.g.,
 *     the `!isSuccess(...)` branch flips to `isSuccess(...)`, so the
 *     warning never fires on real failures. Call-count assertion catches.
 *   - The interpolated warning text drops a token (e.g., `{sessionId}` is
 *     not substituted because the dispatcher passes `session_id` instead).
 *     Per-token assertion catches it.
 *   - The dispatcher hooks failure logging only for `visitor_receipt`
 *     events (i.e., G_C-13's literal event kind) — would skip
 *     `visitor_confirm` failures here. notify_log row count catches.
 */

import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { type Client, createClient } from '@libsql/client';
import { type LibSQLDatabase, drizzle } from 'drizzle-orm/libsql';
import { beforeEach, describe, expect, test, vi } from 'vitest';

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
  sendMessage: vi.fn(async (input: { chatId: string; text: string; parseMode?: string }) => {
    fx.tgCalls.push(input);
    const stub = fx.tgRespByChatId.get(input.chatId);
    if (stub) return stub;
    return { ok: true as const, result: { message_id: fx.tgCalls.length, chat: { id: 1 } } };
  }),
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
    }) => {
      fx.emailCalls.push(input);
      const stub = fx.emailRespByEventKind.get(input.eventKind);
      if (stub) return stub;
      return { data: { id: `mock-${fx.emailCalls.length}` }, error: null };
    },
  ),
  idempotencyKey: vi.fn(
    (input: { sessionId: string; eventKind: string; attempt: number }) =>
      `mock-${input.sessionId}:${input.eventKind}:${input.attempt}`,
  ),
}));

import { type Session, type Teacher, notifyLog, sessions } from '@/db/schema';
import { type SessionStatus, dispatchTransition } from '@/lib/notify/dispatch-transition';
import { runMigrations } from '../../scripts/migrate';

const ROOT = resolve(__dirname, '..', '..');
const MIGRATIONS = resolve(ROOT, 'db/migrations');
const REF_NOW = 1_779_789_600_000;
const AUGUSTO_CHAT_ID = '111222333';

type Fixture = {
  workdir: string;
  client: Client;
  db: LibSQLDatabase<Record<string, never>>;
};

async function makeFixture(opts: { brandOwnerChatId: string | null }): Promise<Fixture> {
  const workdir = mkdtempSync(join(tmpdir(), 'transition-fail-'));
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

async function loadAugusto(client: Client): Promise<Teacher> {
  const rows = await client.execute("SELECT * FROM teachers WHERE slug = 'augusto-rocha'");
  const r = rows.rows[0];
  if (!r) throw new Error('Augusto seed missing');
  return {
    id: r.id as string,
    slug: r.slug as string,
    name: r.name as string,
    email: r.email as string,
    bio: (r.bio as string | null) ?? null,
    telegramChatId: (r.telegram_chat_id as string | null) ?? null,
    availability: r.availability as string,
    avatarUrl: (r.avatar_url as string | null) ?? null,
    timezone: r.timezone as string,
    active: Boolean(r.active),
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

async function insertSession(
  db: LibSQLDatabase<Record<string, never>>,
  augusto: Teacher,
  id: string,
  status: SessionStatus,
): Promise<Session> {
  const inserted = await db
    .insert(sessions)
    .values({
      id,
      teacherId: augusto.id,
      startsAtUtc: REF_NOW,
      durationMinutes: 60,
      status,
      visitorName: 'Visitante Falla T',
      visitorEmail: 'falla.t@example.com',
      contactPref: 'email',
      contactValue: 'falla.t@example.com',
      visitorIntent: 'Probar el camino de fallo de transición.',
      visitorTimezone: 'America/Argentina/Buenos_Aires',
      createdAt: REF_NOW,
      updatedAt: REF_NOW,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error('session insert returned no row');
  return row as Session;
}

describe('G_C-14 — visitor-email-failure → AC-3.3.3 warning Telegram', () => {
  beforeEach(() => {
    fx.tgCalls.length = 0;
    fx.emailCalls.length = 0;
    fx.tgRespByChatId.clear();
    fx.emailRespByEventKind.clear();
  });

  test('Resend 502 on pending→confirmed → notify_log row + warning Telegram fires', async () => {
    const f = await makeFixture({ brandOwnerChatId: AUGUSTO_CHAT_ID });
    try {
      const augusto = await loadAugusto(f.client);
      const session = await insertSession(f.db, augusto, 'sess-fail-confirm', 'confirmed');

      fx.emailRespByEventKind.set('visitor_confirm', {
        data: null,
        error: { statusCode: 502, message: 'Resend upstream 502 (mocked)' },
      });

      const result = await dispatchTransition({
        db: f.db,
        session,
        previousStatus: 'pending',
        assignedMaestro: augusto,
      });

      expect(result.dispatched).toBe(true);
      expect(result.outcomes).toHaveLength(2); // visitor email + warning telegram
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.eventKind).toBe('visitor_confirm');
      expect(result.failures[0]?.status).toBe(502);

      // The warning Telegram fires to brand-owner with verbatim text + tokens.
      expect(fx.tgCalls).toHaveLength(1);
      expect(fx.tgCalls[0]?.chatId).toBe(AUGUSTO_CHAT_ID);
      expect(fx.tgCalls[0]?.text).toContain('falla.t@example.com');
      expect(fx.tgCalls[0]?.text).toContain('502');
      expect(fx.tgCalls[0]?.text).toContain(session.id);
      expect(fx.tgCalls[0]?.text).toContain('contactá manualmente');

      const rows = await f.db.select().from(notifyLog);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.eventKind).toBe('visitor_confirm');
      expect(rows[0]?.channel).toBe('resend');
      expect(rows[0]?.status).toBe(502);
    } finally {
      f.client.close();
      rmSync(f.workdir, { recursive: true, force: true });
    }
  });

  test('Resend 5xx on pending→rejected (decline email) → same warning path fires', async () => {
    const f = await makeFixture({ brandOwnerChatId: AUGUSTO_CHAT_ID });
    try {
      const augusto = await loadAugusto(f.client);
      const session = await insertSession(f.db, augusto, 'sess-fail-decline', 'rejected');

      fx.emailRespByEventKind.set('visitor_decline', {
        data: null,
        error: { statusCode: 500, message: 'Resend 500 boom' },
      });

      const result = await dispatchTransition({
        db: f.db,
        session,
        previousStatus: 'pending',
        assignedMaestro: augusto,
      });

      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.eventKind).toBe('visitor_decline');
      expect(fx.tgCalls).toHaveLength(1);
      expect(fx.tgCalls[0]?.text).toContain('500');

      const rows = await f.db.select().from(notifyLog);
      expect(rows[0]?.eventKind).toBe('visitor_decline');
    } finally {
      f.client.close();
      rmSync(f.workdir, { recursive: true, force: true });
    }
  });

  test('brand-owner without chat_id → no warning fires, visitor failure still logged', async () => {
    const f = await makeFixture({ brandOwnerChatId: null });
    try {
      const augusto = await loadAugusto(f.client);
      const session = await insertSession(f.db, augusto, 'sess-fail-no-tg', 'cancelled');

      fx.emailRespByEventKind.set('visitor_cancel', {
        data: null,
        error: { statusCode: 503, message: 'Resend 503' },
      });

      const result = await dispatchTransition({
        db: f.db,
        session,
        previousStatus: 'confirmed',
        assignedMaestro: augusto,
      });

      expect(result.outcomes).toHaveLength(1); // only the visitor email outcome (no warning)
      expect(result.failures).toHaveLength(1);
      expect(fx.tgCalls).toHaveLength(0);

      const rows = await f.db.select().from(notifyLog);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.eventKind).toBe('visitor_cancel');
    } finally {
      f.client.close();
      rmSync(f.workdir, { recursive: true, force: true });
    }
  });

  test('warning Telegram itself fails → BOTH failures land in notify_log', async () => {
    const f = await makeFixture({ brandOwnerChatId: AUGUSTO_CHAT_ID });
    try {
      const augusto = await loadAugusto(f.client);
      const session = await insertSession(f.db, augusto, 'sess-fail-double', 'confirmed');

      fx.emailRespByEventKind.set('visitor_confirm', {
        data: null,
        error: { statusCode: 502, message: 'Resend 502' },
      });
      fx.tgRespByChatId.set(AUGUSTO_CHAT_ID, {
        ok: false,
        error_code: 502,
        description: 'Telegram api 502',
      });

      const result = await dispatchTransition({
        db: f.db,
        session,
        previousStatus: 'pending',
        assignedMaestro: augusto,
      });

      expect(result.outcomes).toHaveLength(2);
      expect(result.failures).toHaveLength(2);

      const rows = await f.db.select().from(notifyLog);
      expect(rows).toHaveLength(2);
      const channels = new Set(rows.map((r) => r.channel));
      expect(channels).toEqual(new Set(['resend', 'telegram']));
    } finally {
      f.client.close();
      rmSync(f.workdir, { recursive: true, force: true });
    }
  });

  test('confirmed→completed (no-email path): visitor failure SET-stub never consumed → no log writes', async () => {
    const f = await makeFixture({ brandOwnerChatId: AUGUSTO_CHAT_ID });
    try {
      const augusto = await loadAugusto(f.client);
      const session = await insertSession(f.db, augusto, 'sess-noemail-completed', 'completed');

      // Pre-stage a failure stub that would fire IF the dispatcher attempted
      // a send — proves the no-email branch genuinely doesn't reach Resend.
      fx.emailRespByEventKind.set('visitor_confirm', {
        data: null,
        error: { statusCode: 500, message: 'should never see this' },
      });

      const result = await dispatchTransition({
        db: f.db,
        session,
        previousStatus: 'confirmed',
        assignedMaestro: augusto,
      });

      expect(result.dispatched).toBe(false);
      expect(fx.emailCalls).toHaveLength(0);
      expect(fx.tgCalls).toHaveLength(0);
      const rows = await f.db.select().from(notifyLog);
      expect(rows).toHaveLength(0);
    } finally {
      f.client.close();
      rmSync(f.workdir, { recursive: true, force: true });
    }
  });
});
