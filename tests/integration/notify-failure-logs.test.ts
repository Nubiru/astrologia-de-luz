/**
 * G_C-13 / G_C-42 integration pairing — failure logging + AC-3.3.3 follow-up
 * warning.
 *
 * Three failure shapes exercise the dispatcher's `notify_log` writes:
 *
 *   1. Visitor receipt email returns Resend 5xx → 1 log row + the AC-3.3.3
 *      brand-owner-warning Telegram fires immediately after.
 *   2. Assigned-maestro Telegram returns `{ ok: false, status: 403 }`
 *      (forbidden — e.g., the bot was blocked) → 1 log row, no warning
 *      (the maestro failure is unrelated to visitor delivery).
 *   3. Visitor receipt 5xx but brand-owner has NO chat_id → 1 log row
 *      (the visitor failure) + zero warning Telegram (cannot send).
 *
 * G_C-42 refactor (M-20 / D-056, pilot 5/N): G_C-40 4-port Path A playbook +
 * a per-file failure-injection stub extension. The stub builders gain
 * `setResultByEventKind` (email) and `setResultByChatId` (telegram) setters,
 * keyed the same way the old `fx.emailRespByEventKind` / `fx.tgRespByChatId`
 * maps were keyed. The shape change `{ok,error_code,description}` /
 * `{data,error:{statusCode,message}}` → `{ok,status,errorBody}` is the
 * boundary translation the production adapter does at runtime; tests now
 * speak the port shape directly. Extension stays IN-FILE per Lesson 2 scope
 * discipline — extraction to tests/_helpers/dispatcher-stubs.ts is deferred
 * until all concern-C/D files migrate.
 *
 * What this catches:
 *   - The notify_log batch INSERT drops the `recipient` column → row is
 *     written but the panel banner cannot surface "to whom did it fail".
 *   - The AC-3.3.3 warning fires even on success → unnecessary noise to
 *     Augusto's chat (call-count assertion catches it).
 *   - Status mapping confuses Telegram `status` with the eventual HTTP code —
 *     a 403 lands in the row as 200 because the dispatcher mis-routed the
 *     port's `{ok:false,status:403}` shape. The 403 assertion catches it.
 *   - error_body truncation regresses past 2000 chars → the dispatcher's
 *     `truncate()` is bypassed; the row stores the full 2500-char bloat.
 *   - Composition wiring leaks back in — Path A's factory-direct call
 *     bypasses composition entirely, so any leak would surface as
 *     LibsqlError on the test's empty env.
 */

import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { type Client, createClient } from '@libsql/client';
import { type LibSQLDatabase, drizzle } from 'drizzle-orm/libsql';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDispatchPending } from '@/application/notify/dispatch-pending';
import { makeNotifyLogRepository } from '@/infrastructure/db/repositories/notify-log.repository';
import {
  type Session,
  type Teacher,
  notifyLog,
  sessions,
  teachers,
} from '@/infrastructure/db/schema';
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
const MARIA_CHAT_ID = '999888777';

type Fixture = {
  workdir: string;
  client: Client;
  db: LibSQLDatabase<typeof schema>;
};

async function makeFixture(opts: { brandOwnerChatId: string | null }): Promise<Fixture> {
  const workdir = mkdtempSync(join(tmpdir(), 'notify-fail-'));
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
  if (!r) throw new Error('Augusto seed row not found');
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

async function seedMaria(
  db: LibSQLDatabase<typeof schema>,
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
  db: LibSQLDatabase<typeof schema>,
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
  let emailSender: EmailSenderStub;
  let telegram: TelegramBotStub;

  beforeEach(() => {
    emailSender = buildEmailSenderStub();
    telegram = buildTelegramStub();
  });

  test('visitor email 5xx → 1 notify_log row + AC-3.3.3 warning Telegram fires', async () => {
    const f = await makeFixture({ brandOwnerChatId: AUGUSTO_CHAT_ID });
    try {
      const maria = await seedMaria(f.db, MARIA_CHAT_ID);
      const augusto = await loadAugusto(f.client);
      const session = await insertSessionFor(f.db, maria, 'sess-fail-1');

      emailSender.setResultByEventKind('visitor_receipt', {
        ok: false,
        status: 502,
        errorBody: 'Resend upstream 502 (mocked)',
      });

      const dispatch = createDispatchPending({
        emailSender,
        telegram,
        notifyLog: makeNotifyLogRepository(f.db),
        maestrosReader: buildMaestrosReaderStub({ brandOwner: augusto }),
      });

      const result = await dispatch({ session, assignedMaestro: maria });

      // Outcomes: 2 successful Telegrams + 1 failed email + 1 warning Telegram = 4.
      expect(result.outcomes).toHaveLength(4);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.eventKind).toBe('visitor_receipt');
      expect(result.failures[0]?.status).toBe(502);

      // 3 Telegram calls (2 fan-out + 1 warning).
      expect(telegram.calls).toHaveLength(3);
      const warning = telegram.calls[2];
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
      const augusto = await loadAugusto(f.client);
      const session = await insertSessionFor(f.db, maria, 'sess-fail-2');

      telegram.setResultByChatId(MARIA_CHAT_ID, {
        ok: false,
        status: 403,
        errorBody: 'Forbidden: bot was blocked by the user',
      });

      const dispatch = createDispatchPending({
        emailSender,
        telegram,
        notifyLog: makeNotifyLogRepository(f.db),
        maestrosReader: buildMaestrosReaderStub({ brandOwner: augusto }),
      });

      const result = await dispatch({ session, assignedMaestro: maria });

      expect(result.outcomes).toHaveLength(3); // brand-owner + assigned + visitor
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.channel).toBe('telegram');
      expect(result.failures[0]?.recipient).toBe(MARIA_CHAT_ID);
      expect(result.failures[0]?.status).toBe(403);
      expect(result.failures[0]?.errorBody).toContain('Forbidden');

      // No warning Telegram — visitor email succeeded, so AC-3.3.3 does not fire.
      // Total Telegram calls = 2 (brand-owner success + maestro failure attempt).
      expect(telegram.calls).toHaveLength(2);

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
      const augusto = await loadAugusto(f.client);
      const session = await insertSessionFor(f.db, maria, 'sess-fail-3');

      emailSender.setResultByEventKind('visitor_receipt', {
        ok: false,
        status: 503,
        errorBody: 'Resend 503',
      });

      const dispatch = createDispatchPending({
        emailSender,
        telegram,
        notifyLog: makeNotifyLogRepository(f.db),
        maestrosReader: buildMaestrosReaderStub({ brandOwner: augusto }),
      });

      const result = await dispatch({ session, assignedMaestro: maria });

      // Outcomes: brand-owner skipped (no chat_id) + Maria Telegram OK + visitor 503 = 2 outcomes.
      // No warning fires because brand-owner has no chat_id to receive it.
      expect(result.outcomes).toHaveLength(2);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.eventKind).toBe('visitor_receipt');
      expect(result.failures[0]?.status).toBe(503);

      // Total Telegram calls = 1 (Maria only).
      expect(telegram.calls).toHaveLength(1);
      expect(telegram.calls[0]?.chatId).toBe(MARIA_CHAT_ID);

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
      const augusto = await loadAugusto(f.client);
      const session = await insertSessionFor(f.db, maria, 'sess-fail-4');

      const longMessage = 'x'.repeat(2500);
      emailSender.setResultByEventKind('visitor_receipt', {
        ok: false,
        status: 500,
        errorBody: longMessage,
      });

      const dispatch = createDispatchPending({
        emailSender,
        telegram,
        notifyLog: makeNotifyLogRepository(f.db),
        maestrosReader: buildMaestrosReaderStub({ brandOwner: augusto }),
      });

      await dispatch({ session, assignedMaestro: maria });

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
      const augusto = await loadAugusto(f.client);
      const session = await insertSessionFor(f.db, maria, 'sess-fail-5');

      emailSender.setResultByEventKind('visitor_receipt', {
        ok: false,
        status: 500,
        errorBody: 'boom',
      });

      const dispatch = createDispatchPending({
        emailSender,
        telegram,
        notifyLog: makeNotifyLogRepository(f.db),
        maestrosReader: buildMaestrosReaderStub({ brandOwner: augusto }),
      });

      await dispatch({ session, assignedMaestro: maria, attempt: 3 });

      const rows = await f.db.select().from(notifyLog);
      expect(rows[0]?.attemptNumber).toBe(3);
      const visitorEmail = emailSender.calls.find((c) => c.eventKind === 'visitor_receipt');
      expect(visitorEmail?.attempt).toBe(3);
    } finally {
      f.client.close();
      rmSync(f.workdir, { recursive: true, force: true });
    }
  });
});
