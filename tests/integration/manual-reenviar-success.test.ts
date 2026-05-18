/**
 * G_C-15 pairing — manual "Reenviar" — success path (AC-3.3.5).
 *
 * Exercises the load-bearing happy-path of the AC-3.3.5 retry endpoint:
 *
 *   1. A prior failed `notify_log` row exists (the listing page's source).
 *   2. POST `/api/notify/[id]/retry` with a valid auth session.
 *   3. Dispatcher (mocked at the `@/lib/resend` boundary) returns 2xx.
 *   4. Handler INSERTs a new `notify_log` row with
 *      `attempt_number = prior + 1` AND `status` in the 2xx range.
 *   5. Response: 200 + `kind: 'retry_ok'` + Spanish toast
 *      `CONTENT_PANEL.NOTIFY.reenviar_success_toast`.
 *
 * These assertions FAIL when:
 *   - The auth gate is dropped and unauthenticated callers reach the
 *     handler (regression on AC-3.3.5 panel-authed contract).
 *   - The attempt_number bump is misscoped (e.g. scoped to session_id
 *     only, double-counting across event_kinds, OR not bumped at all —
 *     either case breaks the AC-3.2.6 idempotency-key axis on retries).
 *   - The success path forgets to INSERT a new notify_log row (the
 *     "preserve the trail" clause — without the row, the listing page
 *     never sees the recovery).
 *   - The toast slot drifts away from the spec's `reenviar_success_toast`.
 *   - The handler propagates a 5xx instead of always returning 200 with
 *     a toast outcome (the spec is explicit: success/failure both 200).
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
      return { data: { id: `mock-${fx.emailCalls.length}` }, error: null };
    },
  ),
  idempotencyKey: vi.fn(
    (i: { sessionId: string; eventKind: string; attempt: number }) =>
      `mock-${i.sessionId}:${i.eventKind}:${i.attempt}`,
  ),
}));

// Telegram is not exercised in this file, but the production route imports
// it transitively — mocking keeps the module load deterministic.
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
const AUGUSTO_CHAT_ID = '999111222';
const LOG_ID = 'log-orig-1';

type Fixture = {
  workdir: string;
  client: Client;
  db: LibSQLDatabase<Record<string, never>>;
};

async function makeFixture(): Promise<Fixture> {
  const workdir = mkdtempSync(join(tmpdir(), 'manual-reenviar-ok-'));
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
      id: 'sess-retry-ok-1',
      teacherId: augusto.id,
      startsAtUtc: REF_NOW,
      durationMinutes: 60,
      status: 'pending',
      visitorName: 'Visitante Retry',
      visitorEmail: 'visitante.retry@example.com',
      contactPref: 'email',
      contactValue: 'visitante.retry@example.com',
      visitorIntent: 'Quería claridad antes de elegir.',
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
    recipient: 'visitante.retry@example.com',
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

describe('G_C-15 — manual Reenviar success path (AC-3.3.5)', () => {
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

    // Bind the production db handle to the in-memory test client (the route
    // imports `getDb` from `@/db/client`; without this the handler would
    // attach to whatever real connection the env vars point at).
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

  test('returns 200 with retry_ok kind + reenviar_success_toast when dispatcher succeeds', async () => {
    const res = await callRetry(LOG_ID);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      kind: string;
      toast: string;
      attemptNumber: number;
      status: number;
    };
    expect(body.kind).toBe('retry_ok');
    expect(body.toast).toBe('Notificación reenviada correctamente.');
    expect(body.attemptNumber).toBe(2);
    expect(body.status).toBe(200);
  });

  test('re-fires the same eventKind via dispatchEmail with attempt = prior + 1', async () => {
    await callRetry(LOG_ID);

    expect(fx.emailCalls).toHaveLength(1);
    expect(fx.emailCalls[0]?.to).toBe('visitante.retry@example.com');
    expect(fx.emailCalls[0]?.eventKind).toBe('visitor_receipt');
    expect(fx.emailCalls[0]?.attempt).toBe(2);
    // Subject pulled from CONTENT_EMAIL.PUBLIC.visitorRequestReceived.
    expect(fx.emailCalls[0]?.subject).toBe('Recibimos tu solicitud — Astrologia de Luz');
    // Visitor + maestro vars interpolated.
    expect(fx.emailCalls[0]?.text).toContain('Visitante Retry');
    expect(fx.emailCalls[0]?.text).toContain(augusto.name);
  });

  test('inserts a NEW notify_log row with status 200 + attempt_number 2 (trail preserved)', async () => {
    await callRetry(LOG_ID);

    const rows = await f.db.select().from(notifyLog).orderBy(notifyLog.attemptNumber);
    expect(rows).toHaveLength(2);
    // Row 1 = the original failure (status 502, attempt 1).
    expect(rows[0]?.status).toBe(502);
    expect(rows[0]?.attemptNumber).toBe(1);
    // Row 2 = the retry success (status 200, attempt 2).
    expect(rows[1]?.status).toBe(200);
    expect(rows[1]?.attemptNumber).toBe(2);
    expect(rows[1]?.eventKind).toBe('visitor_receipt');
    expect(rows[1]?.channel).toBe('resend');
    expect(rows[1]?.errorBody).toBeNull();
    // Same session_id so the trail clusters per-session on the listing page.
    expect(rows[1]?.sessionId).toBe(session.id);
  });

  test('returns 401 when the caller has no auth session (panel-gated)', async () => {
    fx.authResult = null;
    const res = await callRetry(LOG_ID);
    expect(res.status).toBe(401);
    // No dispatch fires when the auth gate rejects.
    expect(fx.emailCalls).toHaveLength(0);
    // No log row written.
    const rows = await f.db.select().from(notifyLog);
    expect(rows).toHaveLength(1); // only the original failure
  });

  test('returns 404 when the notify_log id does not exist', async () => {
    const res = await callRetry('does-not-exist');
    expect(res.status).toBe(404);
    expect(fx.emailCalls).toHaveLength(0);
  });
});
