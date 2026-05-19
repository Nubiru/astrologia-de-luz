/**
 * G_C-15 / G_C-45 integration pairing — manual "Reenviar" success path
 * (AC-3.3.4 + AC-3.3.5) + 401 panel-gate + 404 missing-log.
 *
 * G_C-45 refactor (M-20 / D-056, pilot 8/N — concern D.1, NEW Path A
 * variant): composition-level injection. Concerns A–C (G_C-38..G_C-44)
 * called the use-case factories directly (createDispatchPending /
 * createGetWebhookStatus / createGetBrandOwner). Concern D tests the
 * FULL ROUTE HANDLER — `POST /api/notify/[id]/retry` — which (a) auth-
 * gates via NextAuth, (b) calls `retryFailed` default-instance which (c)
 * calls `getComposition() → getDb()` to access ports. The route handler
 * is what is under test; the composition is the integration seam.
 *
 * Pattern: `vi.spyOn(compositionMod, 'getComposition').mockReturnValue(
 * testComposition)`. The test composition uses REAL repositories
 * (makeSessionsRepository / makeMaestrosRepository / makeNotifyLogRepository)
 * wrapping the in-memory libSQL fixture so trail-row assertions stay
 * byte-identical. Only the side-effect ports (emailSender / telegram) are
 * stubbed — preserving the failure-only telemetry invariant (AC-3.3.1).
 *
 * Why this is the right Path A variant for route tests (not a violation
 * of "no vi.mock of composition"): the production layer-up rule is "tests
 * do not reach into infrastructure module state via vi.mock". The
 * composition root IS the seam where production wiring is decided; for
 * route-handler integration tests, replacing the composition is the
 * canonical way to swap concrete adapters without touching infrastructure
 * modules. The integration test still exercises real SQL via the REAL
 * repositories — `vi.mock` only remains on `@/infrastructure/auth/config`,
 * which IS the route's auth seam (mocking it is canonical for testing
 * auth-gated handlers).
 *
 * What this catches:
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

import {
  type EmailSenderStub,
  type TelegramBotStub,
  buildEmailSenderStub,
  buildTelegramStub,
  buildTestComposition,
  installTestComposition,
} from '../_helpers/dispatcher-stubs';

const fx = vi.hoisted(() => ({
  authResult: { user: { email: 'admin@astrologiadeluz.com' } } as {
    user: { email: string };
  } | null,
}));

// Auth-gate is the route's integration seam — keep mocked so the 401 path
// (AC-3.3.5 panel-authed contract) is exercised end-to-end.
vi.mock('@/infrastructure/auth/config', () => ({
  auth: vi.fn(async () => fx.authResult),
}));

import { type Session, type Teacher, notifyLog, sessions } from '@/infrastructure/db/schema';
import * as schema from '@/infrastructure/db/schema';
import { runMigrations } from '../../scripts/migrate';

const ROOT = resolve(__dirname, '..', '..');
const MIGRATIONS = resolve(ROOT, 'src/infrastructure/db/migrations');
const REF_NOW = 1_779_789_600_000;
const AUGUSTO_CHAT_ID = '999111222';
const LOG_ID = 'log-orig-1';

type Fixture = {
  workdir: string;
  client: Client;
  db: LibSQLDatabase<typeof schema>;
};

async function makeFixture(): Promise<Fixture> {
  const workdir = mkdtempSync(join(tmpdir(), 'manual-reenviar-ok-'));
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
  db: LibSQLDatabase<typeof schema>,
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
  let emailSender: EmailSenderStub;
  let telegram: TelegramBotStub;

  beforeEach(async () => {
    // The REAL maestros.repository.findBrandOwner() reads
    // `getEnv().ADMIN_EMAILS` to resolve the brand-owner row. Composition
    // injection bypasses every adapter the production composition factory
    // creates (emailSender / telegram / rateLimit / etc.), but the REAL
    // repository inside testComposition still reaches env at invocation
    // time. Set the values directly — mirrors the pattern used by
    // tests/unit/composition-wiring.test.ts. The legacy
    // `vi.mock('@/infrastructure/env')` is no longer required.
    process.env.TURSO_DATABASE_URL = 'file::memory:?cache=shared';
    process.env.TURSO_AUTH_TOKEN = 'manual-reenviar-ok-fixture';
    process.env.AUTH_SECRET = 'a'.repeat(48);
    process.env.AUTH_URL = 'http://localhost:3000';
    process.env.AUTH_RESEND_KEY = 're_manual_reenviar_ok_fixture';
    process.env.RESEND_FROM = 'Astrologia de Luz <no-reply@manual-reenviar.test>';
    process.env.ADMIN_EMAILS = 'augusto@astrologiadeluz.com';
    process.env.TELEGRAM_BOT_TOKEN = '1:manual-reenviar-ok-fixture';
    process.env.TELEGRAM_BOT_USERNAME = 'ManualReenviarOkBot';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'b'.repeat(48);

    fx.authResult = { user: { email: 'admin@astrologiadeluz.com' } };
    f = await makeFixture();
    await f.client.execute(
      `UPDATE teachers SET telegram_chat_id = '${AUGUSTO_CHAT_ID}' WHERE slug = 'augusto-rocha'`,
    );
    augusto = await loadAugusto(f.client);
    session = await insertPendingSession(f.db, augusto);
    await insertFailedLog(f.db, session.id);

    // Build the test composition via the shared helper: REAL repositories
    // over the in-memory DB (so trail-row assertions stay byte-identical
    // with AC-3.3.5) + stubbed side-effect ports (so dispatch firings are
    // recorded against `.calls` arrays).
    emailSender = buildEmailSenderStub();
    telegram = buildTelegramStub();
    installTestComposition(
      buildTestComposition(f.db, {
        emailSender,
        telegram,
        clock: { now: () => new Date(REF_NOW) },
      }),
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

    expect(emailSender.calls).toHaveLength(1);
    expect(emailSender.calls[0]?.to).toBe('visitante.retry@example.com');
    expect(emailSender.calls[0]?.eventKind).toBe('visitor_receipt');
    expect(emailSender.calls[0]?.attempt).toBe(2);
    // Subject pulled from CONTENT_EMAIL.PUBLIC.visitorRequestReceived.
    expect(emailSender.calls[0]?.subject).toBe('Recibimos tu solicitud — Astrologia de Luz');
    // Visitor + maestro vars interpolated.
    expect(emailSender.calls[0]?.text).toContain('Visitante Retry');
    expect(emailSender.calls[0]?.text).toContain(augusto.name);
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
    expect(emailSender.calls).toHaveLength(0);
    // No log row written.
    const rows = await f.db.select().from(notifyLog);
    expect(rows).toHaveLength(1); // only the original failure
  });

  test('returns 404 when the notify_log id does not exist', async () => {
    const res = await callRetry('does-not-exist');
    expect(res.status).toBe(404);
    expect(emailSender.calls).toHaveLength(0);
  });
});
