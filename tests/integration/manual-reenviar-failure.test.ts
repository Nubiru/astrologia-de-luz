/**
 * G_C-15 pairing — manual "Reenviar" — failure path (AC-3.3.5).
 *
 * Counterpart of `manual-reenviar-success.test.ts`. Same setup, but the
 * dispatcher mock returns a Resend error payload (5xx). The retry endpoint
 * must:
 *
 *   1. Persist the new failure as a fresh `notify_log` row (so the listing
 *      page sees `attempt 1: 502` → `attempt 2: 503` and Augusto knows
 *      retrying didn't help yet).
 *   2. Still return 200 + the failure-flavour toast — the spec is explicit
 *      that the HTTP-response status is informational only; outcome flows
 *      through `CONTENT_PANEL.NOTIFY.reenviar_failed_toast`.
 *
 * These assertions FAIL when:
 *   - The failure path mistakenly returns 5xx (would break the panel UI's
 *     toast-rendering flow — the client expects 200-with-outcome semantics).
 *   - The retry stops writing notify_log rows on failure (trail breaks;
 *     listing page can't show "2 retries, still failing").
 *   - The status / errorBody / attempt_number columns drift away from the
 *     dispatcher's actual outcome.
 *   - The success toast leaks into the failure path (or vice-versa).
 */

import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { type Client, createClient } from '@libsql/client';
import { type LibSQLDatabase, drizzle } from 'drizzle-orm/libsql';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const fx = vi.hoisted(() => ({
  emailCalls: [] as Array<{
    to: string;
    subject: string;
    html: string;
    text: string;
    sessionId: string;
    eventKind: string;
    attempt: number;
  }>,
  authResult: { user: { email: 'admin@astrologiadeluz.com' } } as {
    user: { email: string };
  } | null,
}));

vi.mock('@/lib/env', () => ({
  getEnv: () => ({
    ADMIN_EMAILS: 'augusto@astrologiadeluz.com',
    TELEGRAM_BOT_TOKEN: '0000:test-token',
    AUTH_RESEND_KEY: 're_test',
    RESEND_FROM: 'no-reply@astrologiadeluz.com',
  }),
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => fx.authResult),
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
      // Mirror the Resend SDK's failure payload shape (see lib/resend.ts +
      // lib/notify/shared.ts dispatchEmail mapping).
      return {
        data: null,
        error: { statusCode: 503, message: 'Resend transient failure (mocked)' },
      };
    },
  ),
  idempotencyKey: vi.fn(
    (i: { sessionId: string; eventKind: string; attempt: number }) =>
      `mock-${i.sessionId}:${i.eventKind}:${i.attempt}`,
  ),
}));

vi.mock('@/lib/telegram', () => ({
  sendMessage: vi.fn(async () => ({
    ok: true as const,
    result: { message_id: 1, chat: { id: 1 } },
  })),
}));

import { type Session, type Teacher, notifyLog, sessions } from '@/db/schema';
import { runMigrations } from '../../scripts/migrate';

const ROOT = resolve(__dirname, '..', '..');
const MIGRATIONS = resolve(ROOT, 'db/migrations');
const REF_NOW = 1_779_789_600_000;
const AUGUSTO_CHAT_ID = '999111223';
const LOG_ID = 'log-orig-2';

type Fixture = {
  workdir: string;
  client: Client;
  db: LibSQLDatabase<Record<string, never>>;
};

async function makeFixture(): Promise<Fixture> {
  const workdir = mkdtempSync(join(tmpdir(), 'manual-reenviar-fail-'));
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
      id: 'sess-retry-fail-1',
      teacherId: augusto.id,
      startsAtUtc: REF_NOW,
      durationMinutes: 60,
      status: 'pending',
      visitorName: 'Visitante Falla',
      visitorEmail: 'visitante.falla@example.com',
      contactPref: 'email',
      contactValue: 'visitante.falla@example.com',
      visitorIntent: null,
      visitorTimezone: 'America/Argentina/Buenos_Aires',
      createdAt: REF_NOW,
      updatedAt: REF_NOW,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error('session insert returned no row');
  return row as Session;
}

async function insertFailedLog(
  db: LibSQLDatabase<Record<string, never>>,
  sessionId: string,
): Promise<void> {
  await db.insert(notifyLog).values({
    id: LOG_ID,
    sessionId,
    eventKind: 'visitor_receipt',
    channel: 'resend',
    recipient: 'visitante.falla@example.com',
    status: 502,
    errorBody: 'Bad Gateway from upstream Resend',
    attemptNumber: 1,
    createdAt: REF_NOW,
  });
}

async function callRetry(logId: string): Promise<Response> {
  const { POST } = await import('@/app/api/notify/[id]/retry/route');
  const req = new NextRequest(`http://localhost:3000/api/notify/${logId}/retry`, {
    method: 'POST',
  });
  return POST(req, { params: Promise.resolve({ id: logId }) });
}

describe('G_C-15 — manual Reenviar failure path (AC-3.3.5)', () => {
  let f: Fixture;
  let augusto: Teacher;
  let session: Session;

  beforeEach(async () => {
    fx.emailCalls.length = 0;
    fx.authResult = { user: { email: 'admin@astrologiadeluz.com' } };
    f = await makeFixture();
    await f.client.execute(
      `UPDATE teachers SET telegram_chat_id = '${AUGUSTO_CHAT_ID}' WHERE slug = 'augusto-rocha'`,
    );
    augusto = await loadAugusto(f.client);
    session = await insertPendingSession(f.db, augusto);
    await insertFailedLog(f.db, session.id);

    const dbClientMod = await import('@/db/client');
    vi.spyOn(dbClientMod, 'getDb').mockReturnValue(
      f.db as unknown as ReturnType<typeof dbClientMod.getDb>,
    );
  });

  afterEach(() => {
    f.client.close();
    rmSync(f.workdir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test('returns 200 with retry_failed kind + reenviar_failed_toast when dispatcher fails', async () => {
    const res = await callRetry(LOG_ID);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      kind: string;
      toast: string;
      attemptNumber: number;
      status: number;
    };
    expect(body.kind).toBe('retry_failed');
    expect(body.toast).toBe('No se pudo reenviar. Revisá el registro para más detalles.');
    expect(body.attemptNumber).toBe(2);
    expect(body.status).toBe(503);
  });

  test('inserts a NEW notify_log row mirroring the new failure (trail preserved)', async () => {
    await callRetry(LOG_ID);

    const rows = await f.db.select().from(notifyLog).orderBy(notifyLog.attemptNumber);
    expect(rows).toHaveLength(2);
    // Original failure preserved.
    expect(rows[0]?.status).toBe(502);
    expect(rows[0]?.attemptNumber).toBe(1);
    // Retry failure recorded with the NEW upstream status + error body.
    expect(rows[1]?.status).toBe(503);
    expect(rows[1]?.attemptNumber).toBe(2);
    expect(rows[1]?.eventKind).toBe('visitor_receipt');
    expect(rows[1]?.channel).toBe('resend');
    expect(rows[1]?.errorBody).toBe('Resend transient failure (mocked)');
    expect(rows[1]?.sessionId).toBe(session.id);
  });

  test('the failure path still fired the dispatch (attempt=2) — caller sees evidence of the try', async () => {
    await callRetry(LOG_ID);

    expect(fx.emailCalls).toHaveLength(1);
    expect(fx.emailCalls[0]?.attempt).toBe(2);
    expect(fx.emailCalls[0]?.eventKind).toBe('visitor_receipt');
    // Idempotency-key axes (sessionId + eventKind + attempt) carry the
    // bumped attempt — Resend dedupe must treat this as a NEW send.
  });
});
