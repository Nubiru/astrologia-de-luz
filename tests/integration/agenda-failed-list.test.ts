/**
 * G_B-7 integration pairing — failed-notification log queries that drive
 * the AC-3.3.2 banner + AC-3.3.5 listing surface.
 *
 * Spec anchors: S-1 AC-3.3.1 (notify_log row contract) +
 * AC-3.3.2 (7-day rolling failure count drives the `/panel/agenda`
 * banner) + AC-3.3.5 (failed-log listing rendered at
 * `/panel/agenda/notificaciones-fallidas` from the same SELECT shape).
 *
 * The pairing exercises the two `@/application/panel/failed-log`
 * helpers against an in-memory libSQL (file-backed temp dir) with the
 * project's real migrations applied, so the test catches:
 *
 *   - Failed-row filter regressions (e.g., dropping the `status === 0`
 *     branch would silently miss synchronous-throw failures, so the
 *     dispatcher's network errors stop surfacing in the banner / list).
 *   - Trail-row leak: a successful retry writes a `status=200` row.
 *     The list MUST exclude it; if the filter regresses to "any row
 *     in window", successful retries appear in the failed list and
 *     mislead Augusto.
 *   - 7-day window regression: a row at `sinceMs - 1` MUST NOT count;
 *     a row at `sinceMs` MUST count (inclusive lower bound).
 *   - Ordering regression: the listing returns rows ordered by
 *     `created_at DESC` so the most recent failures land at the top
 *     (admin reads top-down).
 *
 * Pattern follows tests/integration/notify-failure-logs.test.ts —
 * file-backed temp libSQL + `runMigrations` + direct row inserts via
 * the libsql client. NotifyLog rows reference sessions.id (NOT NULL FK
 * with ON DELETE CASCADE), so the test seeds a session row first via
 * the Augusto-seeded teacher row.
 */

import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { type Client, createClient } from '@libsql/client';
import { type LibSQLDatabase, drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  FAILED_LOG_WINDOW_MS,
  countFailedNotifyLogs,
  selectFailedNotifyLogs,
} from '@/application/panel/failed-log';
import * as schema from '@/infrastructure/db/schema';

import { runMigrations } from '../../scripts/migrate';

const ROOT = resolve(__dirname, '..', '..');
const MIGRATIONS = resolve(ROOT, 'src/infrastructure/db/migrations');

// Stable reference time; tests derive their seed timestamps from this
// so absolute-time drift in the test suite does not flake the window
// assertions.
const REF_NOW = 1_779_789_600_000;
const SEVEN_DAYS_MS = FAILED_LOG_WINDOW_MS;

interface Fixture {
  workdir: string;
  client: Client;
  db: LibSQLDatabase<typeof schema>;
  teacherId: string;
  sessionId: string;
}

async function makeFixture(): Promise<Fixture> {
  const workdir = mkdtempSync(join(tmpdir(), 'failed-list-'));
  const dbPath = join(workdir, 'test.db');
  closeSync(openSync(dbPath, 'w'));
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client, { schema });
  await runMigrations(db, 'augusto@astrologiadeluz.com', MIGRATIONS);

  // Resolve the Augusto-seeded teacher row id; sessions.teacher_id is a
  // NOT NULL FK referencing it.
  const teacherRows = await client.execute("SELECT id FROM teachers WHERE slug = 'augusto-rocha'");
  const firstTeacher = teacherRows.rows[0];
  if (!firstTeacher) throw new Error('agenda-failed-list: Augusto seed row missing');
  const teacherId = String(firstTeacher.id);

  // Seed one session row; every notify_log row references it via FK.
  const sessionId = 'fixture-session-1';
  await client.execute({
    sql: `INSERT INTO sessions
      (id, teacher_id, starts_at_utc, duration_minutes, status,
       visitor_name, visitor_email, contact_pref, contact_value,
       visitor_intent, visitor_timezone, created_at, updated_at)
      VALUES (?, ?, ?, 60, 'pending', ?, ?, 'email', ?, ?, ?, ?, ?)`,
    args: [
      sessionId,
      teacherId,
      REF_NOW + 24 * 60 * 60 * 1000,
      'Carolina Estévez',
      'carolina@example.test',
      'carolina@example.test',
      'Intención de prueba.',
      'America/Argentina/Buenos_Aires',
      REF_NOW - 60 * 60 * 1000,
      REF_NOW - 60 * 60 * 1000,
    ],
  });

  return { workdir, client, db, teacherId, sessionId };
}

interface SeedLog {
  id: string;
  status: number;
  attemptNumber?: number;
  createdAt: number;
  errorBody?: string | null;
  eventKind?: string;
  channel?: 'resend' | 'telegram';
  recipient?: string;
}

async function seedNotifyLog(fx: Fixture, log: SeedLog): Promise<void> {
  await fx.client.execute({
    sql: `INSERT INTO notify_log
      (id, session_id, event_kind, channel, recipient, status, error_body, attempt_number, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      log.id,
      fx.sessionId,
      log.eventKind ?? 'visitor_confirm',
      log.channel ?? 'resend',
      log.recipient ?? 'carolina@example.test',
      log.status,
      log.errorBody ?? null,
      log.attemptNumber ?? 1,
      log.createdAt,
    ],
  });
}

describe('G_B-7 — countFailedNotifyLogs (AC-3.3.2 banner threshold)', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(() => {
    fx.client.close();
    rmSync(fx.workdir, { recursive: true, force: true });
  });

  test('returns 0 when notify_log is empty', async () => {
    const count = await countFailedNotifyLogs(fx.db, REF_NOW - SEVEN_DAYS_MS);
    expect(count).toBe(0);
  });

  test('counts a single status=503 row inside the window', async () => {
    await seedNotifyLog(fx, { id: 'log-1', status: 503, createdAt: REF_NOW - 60_000 });
    const count = await countFailedNotifyLogs(fx.db, REF_NOW - SEVEN_DAYS_MS);
    expect(count).toBe(1);
  });

  test('counts a status=0 synchronous-throw row (network/DNS failure)', async () => {
    await seedNotifyLog(fx, { id: 'log-0', status: 0, createdAt: REF_NOW - 60_000 });
    const count = await countFailedNotifyLogs(fx.db, REF_NOW - SEVEN_DAYS_MS);
    expect(count).toBe(1);
  });

  test('EXCLUDES a status=200 successful retry trail row in the same window', async () => {
    await seedNotifyLog(fx, { id: 'log-ok', status: 200, createdAt: REF_NOW - 60_000 });
    const count = await countFailedNotifyLogs(fx.db, REF_NOW - SEVEN_DAYS_MS);
    expect(count).toBe(0);
  });

  test('EXCLUDES rows older than `sinceMs` (window lower-bound is inclusive)', async () => {
    const since = REF_NOW - SEVEN_DAYS_MS;
    await seedNotifyLog(fx, { id: 'log-before', status: 503, createdAt: since - 1 });
    await seedNotifyLog(fx, { id: 'log-at-bound', status: 503, createdAt: since });
    const count = await countFailedNotifyLogs(fx.db, since);
    // `log-before` is OUTSIDE; `log-at-bound` is INSIDE.
    expect(count).toBe(1);
  });

  test('mixed seed: 2 failures + 1 success + 1 stale → count = 2', async () => {
    await seedNotifyLog(fx, { id: 'log-fail-1', status: 502, createdAt: REF_NOW - 60_000 });
    await seedNotifyLog(fx, { id: 'log-fail-2', status: 0, createdAt: REF_NOW - 120_000 });
    await seedNotifyLog(fx, { id: 'log-ok', status: 200, createdAt: REF_NOW - 30_000 });
    await seedNotifyLog(fx, { id: 'log-old', status: 503, createdAt: REF_NOW - SEVEN_DAYS_MS - 1 });
    const count = await countFailedNotifyLogs(fx.db, REF_NOW - SEVEN_DAYS_MS);
    expect(count).toBe(2);
  });
});

describe('G_B-7 — selectFailedNotifyLogs (AC-3.3.5 listing surface)', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(() => {
    fx.client.close();
    rmSync(fx.workdir, { recursive: true, force: true });
  });

  test('returns [] when notify_log is empty', async () => {
    const rows = await selectFailedNotifyLogs(fx.db, REF_NOW - SEVEN_DAYS_MS);
    expect(rows).toEqual([]);
  });

  test('returns a single seeded failure row with every projection field populated', async () => {
    await seedNotifyLog(fx, {
      id: 'log-1',
      status: 503,
      createdAt: REF_NOW - 60_000,
      errorBody: 'Resend rejected the request: rate-limited.',
      attemptNumber: 2,
      eventKind: 'visitor_decline',
      channel: 'resend',
      recipient: 'mateo@example.test',
    });
    const rows = await selectFailedNotifyLogs(fx.db, REF_NOW - SEVEN_DAYS_MS);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({
      id: 'log-1',
      sessionId: fx.sessionId,
      eventKind: 'visitor_decline',
      channel: 'resend',
      recipient: 'mateo@example.test',
      status: 503,
      errorBody: 'Resend rejected the request: rate-limited.',
      attemptNumber: 2,
      createdAt: REF_NOW - 60_000,
    });
  });

  test('orders rows by created_at DESC (most-recent first)', async () => {
    await seedNotifyLog(fx, { id: 'log-old', status: 503, createdAt: REF_NOW - 600_000 });
    await seedNotifyLog(fx, { id: 'log-mid', status: 502, createdAt: REF_NOW - 300_000 });
    await seedNotifyLog(fx, { id: 'log-new', status: 0, createdAt: REF_NOW - 60_000 });
    const rows = await selectFailedNotifyLogs(fx.db, REF_NOW - SEVEN_DAYS_MS);
    expect(rows.map((r) => r.id)).toEqual(['log-new', 'log-mid', 'log-old']);
  });

  test('EXCLUDES status=200 successful retry trail rows', async () => {
    await seedNotifyLog(fx, { id: 'log-fail', status: 503, createdAt: REF_NOW - 120_000 });
    await seedNotifyLog(fx, { id: 'log-success-retry', status: 200, createdAt: REF_NOW - 60_000 });
    const rows = await selectFailedNotifyLogs(fx.db, REF_NOW - SEVEN_DAYS_MS);
    expect(rows.map((r) => r.id)).toEqual(['log-fail']);
  });
});
