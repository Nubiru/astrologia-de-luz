/**
 * G_C-15 / G_C-46 integration pairing — manual "Reenviar" failure path
 * (AC-3.3.5).
 *
 * Counterpart of `manual-reenviar-success.test.ts`. Same setup, but the
 * dispatcher stub returns an `ok: false` port result (5xx). The retry
 * endpoint must:
 *
 *   1. Persist the new failure as a fresh `notify_log` row (so the listing
 *      page sees `attempt 1: 502` → `attempt 2: 503` and Augusto knows
 *      retrying didn't help yet).
 *   2. Still return 200 + the failure-flavour toast — the spec is explicit
 *      that the HTTP-response status is informational only; outcome flows
 *      through `CONTENT_PANEL.NOTIFY.reenviar_failed_toast`.
 *
 * G_C-46 refactor (M-20 / D-056, pilot 9/N — concern D.2, LAST cascade
 * file): composition-level injection per the G_C-45 playbook + the per-port
 * failure-injection setters from G_C-42 (notify-failure-logs.test.ts).
 * `emailSender.setResultByEventKind('visitor_receipt', { ok: false, status,
 * errorBody })` drives the retry-failed outcome through the REAL route
 * handler + REAL repositories wrapping an in-memory libSQL fixture — only
 * the side-effect ports (emailSender / telegram) are stubbed so trail-row
 * assertions stay byte-identical.
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

// Auth-gate is the route's integration seam — keep mocked so the route
// reaches the use-case (the failure-path tests bypass the 401 short-circuit
// and exercise the retryFailed orchestration end-to-end).
vi.mock('@/infrastructure/auth/config', () => ({
  auth: vi.fn(async () => fx.authResult),
}));

import { type Session, type Teacher, notifyLog, sessions } from '@/infrastructure/db/schema';
import * as schema from '@/infrastructure/db/schema';
import { runMigrations } from '../../scripts/migrate';

const ROOT = resolve(__dirname, '..', '..');
const MIGRATIONS = resolve(ROOT, 'src/infrastructure/db/migrations');
const REF_NOW = 1_779_789_600_000;
const AUGUSTO_CHAT_ID = '999111223';
const LOG_ID = 'log-orig-2';
const RETRY_FAILURE_BODY = 'Resend transient failure (mocked)';

type Fixture = {
  workdir: string;
  client: Client;
  db: LibSQLDatabase<typeof schema>;
};

async function makeFixture(): Promise<Fixture> {
  const workdir = mkdtempSync(join(tmpdir(), 'manual-reenviar-fail-'));
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
  db: LibSQLDatabase<typeof schema>,
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
  let emailSender: EmailSenderStub;
  let telegram: TelegramBotStub;

  beforeEach(async () => {
    // The REAL maestros.repository.findBrandOwner() reads
    // `getEnv().ADMIN_EMAILS` to resolve the brand-owner row. Composition
    // injection bypasses every adapter the production composition factory
    // creates, but the REAL repository inside testComposition still reaches
    // env at invocation time. Set the values directly — mirrors
    // tests/unit/composition-wiring.test.ts and G_C-45's success-path test.
    process.env.TURSO_DATABASE_URL = 'file::memory:?cache=shared';
    process.env.TURSO_AUTH_TOKEN = 'manual-reenviar-fail-fixture';
    process.env.AUTH_SECRET = 'a'.repeat(48);
    process.env.AUTH_URL = 'http://localhost:3000';
    process.env.AUTH_RESEND_KEY = 're_manual_reenviar_fail_fixture';
    process.env.RESEND_FROM = 'Astrologia de Luz <no-reply@manual-reenviar-fail.test>';
    process.env.ADMIN_EMAILS = 'augusto@astrologiadeluz.com';
    process.env.TELEGRAM_BOT_TOKEN = '1:manual-reenviar-fail-fixture';
    process.env.TELEGRAM_BOT_USERNAME = 'ManualReenviarFailBot';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'b'.repeat(48);

    fx.authResult = { user: { email: 'admin@astrologiadeluz.com' } };
    f = await makeFixture();
    await f.client.execute(
      `UPDATE teachers SET telegram_chat_id = '${AUGUSTO_CHAT_ID}' WHERE slug = 'augusto-rocha'`,
    );
    augusto = await loadAugusto(f.client);
    session = await insertPendingSession(f.db, augusto);
    await insertFailedLog(f.db, session.id);

    // Test composition: REAL repositories over the in-memory DB (trail-row
    // assertions stay byte-identical with AC-3.3.5) + stubbed side-effect
    // ports. Pre-seed the email failure via setResultByEventKind so EVERY
    // retry of `visitor_receipt` returns the injected 503 / errorBody pair
    // — drives the retry_failed outcome end-to-end without touching
    // production code.
    emailSender = buildEmailSenderStub();
    emailSender.setResultByEventKind('visitor_receipt', {
      ok: false,
      status: 503,
      errorBody: RETRY_FAILURE_BODY,
    });
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
    expect(rows[1]?.errorBody).toBe(RETRY_FAILURE_BODY);
    expect(rows[1]?.sessionId).toBe(session.id);
  });

  test('the failure path still fired the dispatch (attempt=2) — caller sees evidence of the try', async () => {
    await callRetry(LOG_ID);

    expect(emailSender.calls).toHaveLength(1);
    expect(emailSender.calls[0]?.attempt).toBe(2);
    expect(emailSender.calls[0]?.eventKind).toBe('visitor_receipt');
    // Idempotency-key axes (sessionId + eventKind + attempt) carry the
    // bumped attempt — Resend dedupe must treat this as a NEW send.
  });
});
