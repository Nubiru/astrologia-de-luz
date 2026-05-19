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
 *   5. confirmed → completed: no-email transition; pre-staged failure
 *      stub is never consumed; zero outcomes, zero log writes.
 *
 * G_C-43 refactor (M-20 / D-056, pilot 6/N): G_C-42's 4-port Path A
 * playbook applied verbatim; only deltas are the
 * `createDispatchPending → createDispatchTransition` factory swap and
 * the `previousStatus` input-shape extension. The stub builders +
 * per-port failure-injection setters are copied byte-identical from
 * tests/integration/notify-failure-logs.test.ts (post-G_C-42 reference).
 * Extension stays IN-FILE per Lesson 2 scope discipline — shared-helper
 * extraction to tests/_helpers/dispatcher-stubs.ts is deferred until
 * all concern-C/D files migrate.
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
import { beforeEach, describe, expect, test } from 'vitest';

import {
  type SessionStatus,
  createDispatchTransition,
} from '@/application/notify/dispatch-transition';
import { makeNotifyLogRepository } from '@/infrastructure/db/repositories/notify-log.repository';
import { type Session, type Teacher, notifyLog, sessions } from '@/infrastructure/db/schema';
import * as schema from '@/infrastructure/db/schema';
import { runMigrations } from '../../scripts/migrate';
import {
  type EmailSenderStub,
  type TelegramBotStub,
  buildEmailSenderStub,
  buildMaestrosReaderStub,
  buildTelegramStub,
} from '../_helpers/dispatcher-stubs';

const ROOT = resolve(__dirname, '..', '..');
const MIGRATIONS = resolve(ROOT, 'src/infrastructure/db/migrations');
const REF_NOW = 1_779_789_600_000;
const AUGUSTO_CHAT_ID = '111222333';

type Fixture = {
  workdir: string;
  client: Client;
  db: LibSQLDatabase<typeof schema>;
};

async function makeFixture(opts: { brandOwnerChatId: string | null }): Promise<Fixture> {
  const workdir = mkdtempSync(join(tmpdir(), 'transition-fail-'));
  const dbPath = join(workdir, 'test.db');
  closeSync(openSync(dbPath, 'w'));
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client, { schema });
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
  db: LibSQLDatabase<typeof schema>,
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
  let emailSender: EmailSenderStub;
  let telegram: TelegramBotStub;

  beforeEach(() => {
    emailSender = buildEmailSenderStub();
    telegram = buildTelegramStub();
  });

  test('Resend 502 on pending→confirmed → notify_log row + warning Telegram fires', async () => {
    const f = await makeFixture({ brandOwnerChatId: AUGUSTO_CHAT_ID });
    try {
      const augusto = await loadAugusto(f.client);
      const session = await insertSession(f.db, augusto, 'sess-fail-confirm', 'confirmed');

      emailSender.setResultByEventKind('visitor_confirm', {
        ok: false,
        status: 502,
        errorBody: 'Resend upstream 502 (mocked)',
      });

      const dispatch = createDispatchTransition({
        emailSender,
        telegram,
        notifyLog: makeNotifyLogRepository(f.db),
        maestrosReader: buildMaestrosReaderStub({ brandOwner: augusto }),
      });

      const result = await dispatch({
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
      expect(telegram.calls).toHaveLength(1);
      expect(telegram.calls[0]?.chatId).toBe(AUGUSTO_CHAT_ID);
      expect(telegram.calls[0]?.text).toContain('falla.t@example.com');
      expect(telegram.calls[0]?.text).toContain('502');
      expect(telegram.calls[0]?.text).toContain(session.id);
      expect(telegram.calls[0]?.text).toContain('contactá manualmente');

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

      emailSender.setResultByEventKind('visitor_decline', {
        ok: false,
        status: 500,
        errorBody: 'Resend 500 boom',
      });

      const dispatch = createDispatchTransition({
        emailSender,
        telegram,
        notifyLog: makeNotifyLogRepository(f.db),
        maestrosReader: buildMaestrosReaderStub({ brandOwner: augusto }),
      });

      const result = await dispatch({
        session,
        previousStatus: 'pending',
        assignedMaestro: augusto,
      });

      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.eventKind).toBe('visitor_decline');
      expect(telegram.calls).toHaveLength(1);
      expect(telegram.calls[0]?.text).toContain('500');

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

      emailSender.setResultByEventKind('visitor_cancel', {
        ok: false,
        status: 503,
        errorBody: 'Resend 503',
      });

      const dispatch = createDispatchTransition({
        emailSender,
        telegram,
        notifyLog: makeNotifyLogRepository(f.db),
        maestrosReader: buildMaestrosReaderStub({ brandOwner: augusto }),
      });

      const result = await dispatch({
        session,
        previousStatus: 'confirmed',
        assignedMaestro: augusto,
      });

      expect(result.outcomes).toHaveLength(1); // only the visitor email outcome (no warning)
      expect(result.failures).toHaveLength(1);
      expect(telegram.calls).toHaveLength(0);

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

      emailSender.setResultByEventKind('visitor_confirm', {
        ok: false,
        status: 502,
        errorBody: 'Resend 502',
      });
      telegram.setResultByChatId(AUGUSTO_CHAT_ID, {
        ok: false,
        status: 502,
        errorBody: 'Telegram api 502',
      });

      const dispatch = createDispatchTransition({
        emailSender,
        telegram,
        notifyLog: makeNotifyLogRepository(f.db),
        maestrosReader: buildMaestrosReaderStub({ brandOwner: augusto }),
      });

      const result = await dispatch({
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
      emailSender.setResultByEventKind('visitor_confirm', {
        ok: false,
        status: 500,
        errorBody: 'should never see this',
      });

      const dispatch = createDispatchTransition({
        emailSender,
        telegram,
        notifyLog: makeNotifyLogRepository(f.db),
        maestrosReader: buildMaestrosReaderStub({ brandOwner: augusto }),
      });

      const result = await dispatch({
        session,
        previousStatus: 'confirmed',
        assignedMaestro: augusto,
      });

      expect(result.dispatched).toBe(false);
      expect(emailSender.calls).toHaveLength(0);
      expect(telegram.calls).toHaveLength(0);
      const rows = await f.db.select().from(notifyLog);
      expect(rows).toHaveLength(0);
    } finally {
      f.client.close();
      rmSync(f.workdir, { recursive: true, force: true });
    }
  });
});
