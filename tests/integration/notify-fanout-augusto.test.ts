/**
 * G_C-13 integration pairing — brand-owner-is-assigned dedupe (AC-3.2.2 dedupe + AC-3.2.5).
 *
 * Scenario: Augusto IS the assigned maestro for the visitor's request. The
 * dispatcher MUST fire exactly TWO side-effects (NOT three) — one Telegram
 * ping to Augusto + one visitor receipt email. The second Telegram ping
 * (assigned-maestro) is the dedupe target.
 *
 * What this catches:
 *   - AC-3.2.2 dedupe regression — the assigned-maestro path fires
 *     unconditionally instead of skipping when assigned IS brand-owner.
 *     The mocked `sendMessage` would be called 2× (Augusto chat_id twice)
 *     and the assertion on call count fails.
 *   - The brand-owner Telegram body forgets to interpolate `{maestroName}`
 *     with the assigned-maestro's name (which here equals brand-owner) —
 *     the body assertion catches it.
 *   - The visitor receipt event_kind drifts from `'visitor_receipt'` —
 *     the sendEmail mock call assertion catches it.
 *   - Successful dispatches accidentally write `notify_log` rows — the
 *     row-count assertion catches it (success path is failure-only logging).
 */

import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { type Client, createClient } from '@libsql/client';
import { type LibSQLDatabase, drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

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
  tgResultByChatId: new Map<
    string,
    | { ok: true; result: { message_id: number; chat: { id: number } } }
    | { ok: false; error_code?: number; description?: string }
  >(),
  emailResultBySubject: new Map<
    string,
    { data: unknown; error: { statusCode?: number; message?: string } | null }
  >(),
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
    return (
      fx.tgResultByChatId.get(input.chatId) ?? {
        ok: true as const,
        result: { message_id: fx.tgCalls.length, chat: { id: 1 } },
      }
    );
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
      return (
        fx.emailResultBySubject.get(input.subject) ?? {
          data: { id: `mock-${fx.emailCalls.length}` },
          error: null,
        }
      );
    },
  ),
  idempotencyKey: vi.fn(
    (input: { sessionId: string; eventKind: string; attempt: number }) =>
      `mock-${input.sessionId}:${input.eventKind}:${input.attempt}`,
  ),
}));

import { type Session, type Teacher, notifyLog, sessions } from '@/db/schema';
import { dispatchPending } from '@/lib/notify/dispatch-pending';
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

async function makeFixture(): Promise<Fixture> {
  const workdir = mkdtempSync(join(tmpdir(), 'notify-augusto-'));
  const dbPath = join(workdir, 'test.db');
  closeSync(openSync(dbPath, 'w'));
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client) as LibSQLDatabase<Record<string, never>>;
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
  db: LibSQLDatabase<Record<string, never>>,
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
    fx.tgCalls.length = 0;
    fx.emailCalls.length = 0;
    fx.tgResultByChatId.clear();
    fx.emailResultBySubject.clear();
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
    const result = await dispatchPending({ db: f.db, session, assignedMaestro: augusto });

    expect(fx.tgCalls).toHaveLength(1);
    expect(fx.emailCalls).toHaveLength(1);
    expect(result.outcomes).toHaveLength(2);
    expect(result.failures).toHaveLength(0);
  });

  test('the single Telegram fires to brand-owner chat_id with brandOwnerNewRequest template', async () => {
    await dispatchPending({ db: f.db, session, assignedMaestro: augusto });

    expect(fx.tgCalls[0]?.chatId).toBe(AUGUSTO_CHAT_ID);
    expect(fx.tgCalls[0]?.parseMode).toBe('HTML');
    // Spec-anchored substitutions (CONTENT_PANEL.NOTIFY.brandOwnerNewRequest).
    expect(fx.tgCalls[0]?.text).toContain('Nueva solicitud');
    expect(fx.tgCalls[0]?.text).toContain(augusto.name); // maestroName == brand-owner name
    expect(fx.tgCalls[0]?.text).toContain('Visitante Uno');
    expect(fx.tgCalls[0]?.text).toContain('Necesito claridad sobre un cambio.');
  });

  test('the single email fires to the visitor with visitor_receipt event_kind', async () => {
    await dispatchPending({ db: f.db, session, assignedMaestro: augusto });

    expect(fx.emailCalls[0]?.to).toBe('visitante@example.com');
    expect(fx.emailCalls[0]?.eventKind).toBe('visitor_receipt');
    expect(fx.emailCalls[0]?.attempt).toBe(1);
    expect(fx.emailCalls[0]?.subject).toBe('Recibimos tu solicitud — Astrologia de Luz');
    // SLA token interpolated from CONTENT_PANEL.LANDING.sla.text.
    expect(fx.emailCalls[0]?.text).toContain('24-48 horas');
    expect(fx.emailCalls[0]?.text).toContain('Visitante Uno');
    expect(fx.emailCalls[0]?.text).toContain(augusto.name);
  });

  test('notify_log stays empty on the all-success path', async () => {
    await dispatchPending({ db: f.db, session, assignedMaestro: augusto });

    const rows = await f.db.select().from(notifyLog);
    expect(rows).toHaveLength(0);
  });

  test('skips the brand-owner Telegram when brand-owner has no chat_id (1 dispatch only)', async () => {
    await f.client.execute(
      "UPDATE teachers SET telegram_chat_id = NULL WHERE slug = 'augusto-rocha'",
    );
    augusto = await loadAugusto(f.client);
    await dispatchPending({ db: f.db, session, assignedMaestro: augusto });

    expect(fx.tgCalls).toHaveLength(0);
    expect(fx.emailCalls).toHaveLength(1);
    expect(fx.emailCalls[0]?.eventKind).toBe('visitor_receipt');
    // No log row — brand-owner-skip is NOT a failure; only non-2xx outcomes log.
    const rows = await f.db.select().from(notifyLog);
    expect(rows).toHaveLength(0);
  });
});
