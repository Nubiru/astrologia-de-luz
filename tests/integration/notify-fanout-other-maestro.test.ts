/**
 * G_C-13 / G_C-41 integration pairing — assigned-maestro-distinct-from-
 * brand-owner (AC-3.2.5 verbatim case).
 *
 * Scenario: a second maestro Maria is added via the admin path with her own
 * `telegram_chat_id`. A visitor requests a session with Maria. The dispatcher
 * MUST fire THREE distinct side-effects:
 *
 *   - Telegram → Augusto (brand-owner, always-on per AC-3.2.1)
 *   - Telegram → Maria (assigned-maestro; AC-3.2.2 branch where chat_id IS set)
 *   - Resend  → visitor (receipt email; AC-3.2.4)
 *
 * Plus a 4th case in this file: assigned maestro has NO chat_id → falls back
 * to email per AC-3.2.3 (the `[FALLBACK]` subject prefix is the load-bearing
 * tell that the fallback branch was taken).
 *
 * G_C-41 refactor (M-20 / D-056, pilot 4/N): same Path A 4-port playbook as
 * G_C-40. The 3 vi.mock blocks + vi.hoisted fx are deleted; each test builds
 * local stubs (EmailSender + TelegramBot + MaestrosReader) and wires them
 * via `createDispatchPending`. The REAL `makeNotifyLogRepository(f.db)` is
 * used so the `notify_log` row-count assertion stays byte-identical. Helpers
 * are co-located by intentional COPY from notify-fanout-augusto.test.ts —
 * extraction to a shared test helper is a deliberate follow-up (Lesson 2
 * scope discipline; would touch 6+ files).
 *
 * What this catches:
 *   - Telegram bodies route to the wrong chat_id (e.g., both pings hit
 *     Augusto's id) — the per-chat_id assertion catches it.
 *   - The fallback branch fires Telegram-with-no-chat_id (would crash) when
 *     it should be the maestroFallback email — the email subject `[FALLBACK]`
 *     prefix assertion catches it.
 *   - The dedupe of AC-3.2.2 regresses to dedupe-when-emails-match (instead
 *     of dedupe-when-ids-match) and skips Maria's Telegram because she
 *     happens to share Augusto's locale — id-based assertion catches it.
 *   - The `assignedMaestroNewRequest` Telegram body bleeds the maestro's name
 *     into the body (AC-3.2.2 specifies "no maestroName — message goes to
 *     the maestro themselves") — body assertion catches it.
 *   - The composition wiring leaks back into the dispatcher — Path A's
 *     factory-direct call bypasses composition entirely, so any leak would
 *     surface as LibsqlError on the test's empty env.
 */

import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { type Client, createClient } from '@libsql/client';
import { type LibSQLDatabase, drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

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

async function makeFixture(): Promise<Fixture> {
  const workdir = mkdtempSync(join(tmpdir(), 'notify-other-'));
  const dbPath = join(workdir, 'test.db');
  closeSync(openSync(dbPath, 'w'));
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client, { schema });
  await runMigrations(db, 'augusto@astrologiadeluz.com', MIGRATIONS);
  // Augusto's chat_id post-seed; Maria added with her own chat_id.
  await client.execute(
    `UPDATE teachers SET telegram_chat_id = '${AUGUSTO_CHAT_ID}' WHERE slug = 'augusto-rocha'`,
  );
  return { workdir, client, db };
}

async function loadTeacherBySlug(client: Client, slug: string): Promise<Teacher> {
  const rows = await client.execute({
    sql: 'SELECT * FROM teachers WHERE slug = ?',
    args: [slug],
  });
  const r = rows.rows[0];
  if (!r) throw new Error(`teacher ${slug} not found`);
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
      visitorName: 'Visitante Dos',
      visitorEmail: 'visitante.dos@example.com',
      contactPref: 'whatsapp',
      contactValue: '+5491111111111',
      visitorIntent: 'Carta natal completa.',
      visitorTimezone: 'America/Argentina/Buenos_Aires',
      createdAt: REF_NOW,
      updatedAt: REF_NOW,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error('session insert returned no row');
  return row as Session;
}

describe('G_C-13 — separate-maestro fan-out (AC-3.2.5)', () => {
  let f: Fixture;

  beforeEach(async () => {
    f = await makeFixture();
  });

  afterEach(() => {
    f.client.close();
    rmSync(f.workdir, { recursive: true, force: true });
  });

  test('Maria has chat_id → 3 dispatches: Telegram→Augusto + Telegram→Maria + Email→visitor', async () => {
    const maria = await seedMaria(f.db, MARIA_CHAT_ID);
    const augusto = await loadTeacherBySlug(f.client, 'augusto-rocha');
    const session = await insertSessionFor(f.db, maria, 'sess-maria-1');

    const emailSender = buildEmailSenderStub();
    const telegram = buildTelegramStub();
    const dispatch = createDispatchPending({
      emailSender,
      telegram,
      notifyLog: makeNotifyLogRepository(f.db),
      maestrosReader: buildMaestrosReaderStub({ brandOwner: augusto }),
    });

    const result = await dispatch({ session, assignedMaestro: maria });

    expect(telegram.calls).toHaveLength(2);
    expect(emailSender.calls).toHaveLength(1);
    expect(result.outcomes).toHaveLength(3);
    expect(result.failures).toHaveLength(0);

    // Recipients are correct — order-independent because Promise.allSettled.
    const chatIds = new Set(telegram.calls.map((c) => c.chatId));
    expect(chatIds).toEqual(new Set([AUGUSTO_CHAT_ID, MARIA_CHAT_ID]));

    // Brand-owner ping mentions Maria as maestroName.
    const ownerPing = telegram.calls.find((c) => c.chatId === AUGUSTO_CHAT_ID);
    expect(ownerPing?.text).toContain(maria.name);
    expect(ownerPing?.text).toContain('Visitante Dos');

    // Maria's ping does NOT mention her own name (AC-3.2.2 — no maestroName
    // token in `assignedMaestroNewRequest`).
    const mariaPing = telegram.calls.find((c) => c.chatId === MARIA_CHAT_ID);
    expect(mariaPing?.text).toContain('Visitante Dos');
    expect(mariaPing?.text).not.toContain('Maestro:');

    // The Spanish channel label maps `whatsapp` → 'WhatsApp' (AC-3.2.4 contact_pref humanization).
    expect(ownerPing?.text).toContain('WhatsApp');

    // Visitor email lands on the right address with visitor_receipt kind.
    expect(emailSender.calls[0]?.to).toBe('visitante.dos@example.com');
    expect(emailSender.calls[0]?.eventKind).toBe('visitor_receipt');
    // Cross-pollution check — augusto is the brand-owner; visitor email cites him as signer.
    expect(emailSender.calls[0]?.text).toContain(augusto.name);
  });

  test('Maria has NO chat_id → fallback email fires instead of Telegram (AC-3.2.3)', async () => {
    const maria = await seedMaria(f.db, null);
    const augusto = await loadTeacherBySlug(f.client, 'augusto-rocha');
    const session = await insertSessionFor(f.db, maria, 'sess-maria-fallback');

    const emailSender = buildEmailSenderStub();
    const telegram = buildTelegramStub();
    const dispatch = createDispatchPending({
      emailSender,
      telegram,
      notifyLog: makeNotifyLogRepository(f.db),
      maestrosReader: buildMaestrosReaderStub({ brandOwner: augusto }),
    });

    await dispatch({ session, assignedMaestro: maria });

    // Two Telegrams becomes one — Augusto's only (Maria's branch goes email).
    expect(telegram.calls).toHaveLength(1);
    expect(telegram.calls[0]?.chatId).toBe(AUGUSTO_CHAT_ID);

    // Two emails — fallback to Maria + visitor receipt.
    expect(emailSender.calls).toHaveLength(2);
    const fallback = emailSender.calls.find((c) => c.eventKind === 'maestro_fallback');
    expect(fallback).toBeDefined();
    expect(fallback?.to).toBe(maria.email);
    expect(fallback?.subject.startsWith('[FALLBACK] ')).toBe(true);
    expect(fallback?.text).toContain(maria.name);

    const visitor = emailSender.calls.find((c) => c.eventKind === 'visitor_receipt');
    expect(visitor?.to).toBe('visitante.dos@example.com');
  });

  test('notify_log stays empty on the all-success path (3 dispatches green)', async () => {
    const maria = await seedMaria(f.db, MARIA_CHAT_ID);
    const augusto = await loadTeacherBySlug(f.client, 'augusto-rocha');
    const session = await insertSessionFor(f.db, maria, 'sess-maria-2');

    const dispatch = createDispatchPending({
      emailSender: buildEmailSenderStub(),
      telegram: buildTelegramStub(),
      notifyLog: makeNotifyLogRepository(f.db),
      maestrosReader: buildMaestrosReaderStub({ brandOwner: augusto }),
    });

    await dispatch({ session, assignedMaestro: maria });

    const rows = await f.db.select().from(notifyLog);
    expect(rows).toHaveLength(0);
  });
});
