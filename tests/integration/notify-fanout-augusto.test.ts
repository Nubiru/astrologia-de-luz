/**
 * G_C-13 / G_C-40 integration pairing — brand-owner-is-assigned dedupe
 * (AC-3.2.2 dedupe + AC-3.2.5).
 *
 * Scenario: Augusto IS the assigned maestro for the visitor's request. The
 * dispatcher MUST fire exactly TWO side-effects (NOT three) — one Telegram
 * ping to Augusto + one visitor receipt email. The second Telegram ping
 * (assigned-maestro) is the dedupe target.
 *
 * G_C-40 refactor (M-20 / D-056, pilot 3/N): the legacy module-mocked
 * fan-out shape (vi.mock of env / telegram-client / email-resend +
 * vi.hoisted fx) is replaced by Path A — each test builds local stubs for
 * the 4 dispatcher ports (EmailSender + TelegramBot + NotifyLog +
 * MaestrosReader), wires them via `createDispatchPending(deps)`, and asserts
 * against per-stub `.calls` arrays. The in-memory libSQL fixture is
 * preserved + the REAL `makeNotifyLogRepository(db)` adapter is wired so
 * the `notify_log` row-count assertions stay byte-identical (the failure-
 * only telemetry contract per AC-3.3.1).
 *
 * What this catches:
 *   - AC-3.2.2 dedupe regression — the assigned-maestro path fires
 *     unconditionally instead of skipping when assigned IS brand-owner.
 *     The TelegramBot stub's `.calls` array would have 2 entries
 *     (Augusto chat_id twice) and the length assertion fails.
 *   - The brand-owner Telegram body forgets to interpolate `{maestroName}`
 *     with the assigned-maestro's name (which here equals brand-owner) —
 *     the body assertion catches it.
 *   - The visitor receipt event_kind drifts from `'visitor_receipt'` —
 *     the EmailSender stub's `.calls` assertion catches it.
 *   - Successful dispatches accidentally write `notify_log` rows — the
 *     row-count assertion catches it (success path is failure-only
 *     logging) because we use the real NotifyLog adapter.
 *   - The composition wiring leaks back into the dispatcher (someone
 *     adds a getComposition() call) — Path A's factory-direct call
 *     bypasses composition entirely, so any leak would surface as
 *     LibsqlError on the test's empty env.
 */

import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { type Client, createClient } from '@libsql/client';
import { type LibSQLDatabase, drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { createDispatchPending } from '@/application/notify/dispatch-pending';
import { makeNotifyLogRepository } from '@/infrastructure/db/repositories/notify-log.repository';
import { type Session, type Teacher, notifyLog, sessions } from '@/infrastructure/db/schema';
import * as schema from '@/infrastructure/db/schema';
import { runMigrations } from '../../scripts/migrate';
import {
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

async function makeFixture(): Promise<Fixture> {
  const workdir = mkdtempSync(join(tmpdir(), 'notify-augusto-'));
  const dbPath = join(workdir, 'test.db');
  closeSync(openSync(dbPath, 'w'));
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client, { schema });
  await runMigrations(db, 'augusto@astrologiadeluz.com', MIGRATIONS);
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

async function insertPendingSession(
  db: LibSQLDatabase<typeof schema>,
  augusto: Teacher,
): Promise<Session> {
  const inserted = await db
    .insert(sessions)
    .values({
      id: 'sess-augusto-1',
      teacherId: augusto.id,
      startsAtUtc: REF_NOW,
      durationMinutes: 60,
      status: 'pending',
      visitorName: 'Visitante Uno',
      visitorEmail: 'visitante@example.com',
      contactPref: 'email',
      contactValue: 'visitante@example.com',
      visitorIntent: 'Necesito claridad sobre un cambio.',
      visitorTimezone: 'America/Argentina/Buenos_Aires',
      createdAt: REF_NOW,
      updatedAt: REF_NOW,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error('session insert returned no row');
  return row as Session;
}

describe('G_C-13 — brand-owner-is-assigned dedupe (AC-3.2.2 + AC-3.2.5)', () => {
  let f: Fixture;
  let augusto: Teacher;
  let session: Session;

  beforeEach(async () => {
    f = await makeFixture();
    // Set Augusto's telegram chat_id post-seed so the brand-owner Telegram fires.
    await f.client.execute(
      `UPDATE teachers SET telegram_chat_id = '${AUGUSTO_CHAT_ID}' WHERE slug = 'augusto-rocha'`,
    );
    augusto = await loadAugusto(f.client);
    session = await insertPendingSession(f.db, augusto);
  });

  afterEach(() => {
    f.client.close();
    rmSync(f.workdir, { recursive: true, force: true });
  });

  test('fires EXACTLY one Telegram + one Resend email when brand-owner IS the assigned maestro', async () => {
    const emailSender = buildEmailSenderStub();
    const telegram = buildTelegramStub();
    const maestrosReader = buildMaestrosReaderStub({ brandOwner: augusto });
    const dispatch = createDispatchPending({
      emailSender,
      telegram,
      notifyLog: makeNotifyLogRepository(f.db),
      maestrosReader,
    });

    const result = await dispatch({ session, assignedMaestro: augusto });

    expect(telegram.calls).toHaveLength(1);
    expect(emailSender.calls).toHaveLength(1);
    expect(result.outcomes).toHaveLength(2);
    expect(result.failures).toHaveLength(0);
  });

  test('the single Telegram fires to brand-owner chat_id with brandOwnerNewRequest template', async () => {
    const emailSender = buildEmailSenderStub();
    const telegram = buildTelegramStub();
    const dispatch = createDispatchPending({
      emailSender,
      telegram,
      notifyLog: makeNotifyLogRepository(f.db),
      maestrosReader: buildMaestrosReaderStub({ brandOwner: augusto }),
    });

    await dispatch({ session, assignedMaestro: augusto });

    expect(telegram.calls[0]?.chatId).toBe(AUGUSTO_CHAT_ID);
    expect(telegram.calls[0]?.parseMode).toBe('HTML');
    // Spec-anchored substitutions (CONTENT_PANEL.NOTIFY.brandOwnerNewRequest).
    expect(telegram.calls[0]?.text).toContain('Nueva solicitud');
    expect(telegram.calls[0]?.text).toContain(augusto.name); // maestroName == brand-owner name
    expect(telegram.calls[0]?.text).toContain('Visitante Uno');
    expect(telegram.calls[0]?.text).toContain('Necesito claridad sobre un cambio.');
  });

  test('the single email fires to the visitor with visitor_receipt event_kind', async () => {
    const emailSender = buildEmailSenderStub();
    const telegram = buildTelegramStub();
    const dispatch = createDispatchPending({
      emailSender,
      telegram,
      notifyLog: makeNotifyLogRepository(f.db),
      maestrosReader: buildMaestrosReaderStub({ brandOwner: augusto }),
    });

    await dispatch({ session, assignedMaestro: augusto });

    expect(emailSender.calls[0]?.to).toBe('visitante@example.com');
    expect(emailSender.calls[0]?.eventKind).toBe('visitor_receipt');
    expect(emailSender.calls[0]?.attempt).toBe(1);
    expect(emailSender.calls[0]?.subject).toBe('Recibimos tu solicitud — Astrologia de Luz');
    // SLA token interpolated from CONTENT_PANEL.LANDING.sla.text.
    expect(emailSender.calls[0]?.text).toContain('24-48 horas');
    expect(emailSender.calls[0]?.text).toContain('Visitante Uno');
    expect(emailSender.calls[0]?.text).toContain(augusto.name);
  });

  test('notify_log stays empty on the all-success path', async () => {
    const dispatch = createDispatchPending({
      emailSender: buildEmailSenderStub(),
      telegram: buildTelegramStub(),
      notifyLog: makeNotifyLogRepository(f.db),
      maestrosReader: buildMaestrosReaderStub({ brandOwner: augusto }),
    });

    await dispatch({ session, assignedMaestro: augusto });

    const rows = await f.db.select().from(notifyLog);
    expect(rows).toHaveLength(0);
  });

  test('skips the brand-owner Telegram when brand-owner has no chat_id (1 dispatch only)', async () => {
    // Under Path A, the no-chat-id state is expressed via the maestrosReader
    // stub returning a teacher with telegramChatId: null — no DB UPDATE
    // required. `assignedMaestro` must also have null so the dispatcher's
    // dedupe arm doesn't try the assigned-Telegram path either (id match
    // triggers dedupe; the same object identity guarantees both have null).
    const augustoNoChat: Teacher = { ...augusto, telegramChatId: null };
    const emailSender = buildEmailSenderStub();
    const telegram = buildTelegramStub();
    const dispatch = createDispatchPending({
      emailSender,
      telegram,
      notifyLog: makeNotifyLogRepository(f.db),
      maestrosReader: buildMaestrosReaderStub({ brandOwner: augustoNoChat }),
    });

    await dispatch({ session, assignedMaestro: augustoNoChat });

    expect(telegram.calls).toHaveLength(0);
    expect(emailSender.calls).toHaveLength(1);
    expect(emailSender.calls[0]?.eventKind).toBe('visitor_receipt');
    // No log row — brand-owner-skip is NOT a failure; only non-2xx outcomes log.
    const rows = await f.db.select().from(notifyLog);
    expect(rows).toHaveLength(0);
  });
});
