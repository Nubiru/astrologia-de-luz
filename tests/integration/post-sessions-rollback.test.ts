/**
 * G_C-10 integration pairing #3 — INSERT failure → no dispatch (rollback
 * invariant). Spec anchor: S-1 AC-3.1.2 step 5 (the persistence-before-notify
 * non-negotiable from MEGA CP-3 priming).
 *
 * What this catches:
 *   - The dispatcher is invoked OPTIMISTICALLY (before the INSERT lands).
 *     A future "let's fire-and-forget the notification before the row commits
 *     to keep latency low" PR would break the rollback invariant — the
 *     visitor sees a Resend email AND the brand-owner gets a Telegram for a
 *     request that never persisted.
 *   - The 500 response body is HTML / stack-trace instead of the spec
 *     `{ kind: 'insert_failed', error: <spanish> }` shape — the visitor sees
 *     raw Node internals.
 *   - Anti-abuse gates 1a/1b/1c silently flip the rollback path (e.g. honeypot
 *     accidentally fires the dispatcher before returning silent-200).
 *
 * Mocking strategy: `vi.spyOn(db, 'insert')` to throw on the first call. The
 * route catches the throw inside its try block and returns 500; the
 * dispatcher mock is asserted NOT called.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

import { sessions } from '@/infrastructure/db/schema';

vi.hoisted(() => {
  const { closeSync, mkdtempSync, openSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const TMP = mkdtempSync(join(tmpdir(), 'gc10-rollback-'));
  const DB_PATH = join(TMP, 'test.db');
  closeSync(openSync(DB_PATH, 'w'));
  for (const [k, v] of Object.entries({
    TURSO_DATABASE_URL: `file:${DB_PATH}`,
    TURSO_AUTH_TOKEN: 'fixture-token',
    AUTH_SECRET: 'c'.repeat(48),
    AUTH_URL: 'http://localhost:3000',
    AUTH_RESEND_KEY: 're_fixture_rollback_test',
    RESEND_FROM: 'Astrologia de Luz <no-reply@rollback-test.test>',
    ADMIN_EMAILS: 'augusto@astrologiadeluz.com',
    TELEGRAM_BOT_TOKEN: '1:rollback-token',
    TELEGRAM_BOT_USERNAME: 'RollbackTestBot',
    TELEGRAM_WEBHOOK_SECRET: 'd'.repeat(48),
  })) {
    process.env[k] = v;
  }
});

const fx = vi.hoisted(() => ({ dispatchCalls: [] as unknown[] }));

vi.mock('@/application/notify/dispatch-pending', () => ({
  dispatchPending: vi.fn(async (input: unknown) => {
    fx.dispatchCalls.push(input);
    return { outcomes: [], failures: [] };
  }),
}));

const REPO_ROOT = resolve(__dirname, '..', '..');
const MIGRATION_FILES = [
  '0000_init.sql',
  '0001_authjs.sql',
  '0002_cp3_tables.sql',
  '0003_seed_augusto.sql',
] as const;
const AUGUSTO_AVAIL = JSON.stringify({
  tz: 'America/Argentina/Buenos_Aires',
  windows: [0, 1, 2, 3, 4, 5, 6].map((w) => ({
    weekday: w,
    start: '00:00',
    end: '23:00',
  })),
  blackouts: [],
});

const renderSeed = (sql: string, email: string): string => sql.split('$$ADMIN_EMAIL$$').join(email);

const splitStatements = (raw: string): string[] =>
  raw
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

type RoutePOST = (request: NextRequest) => Promise<Response>;
let routePOST: RoutePOST;
let dbClient: ReturnType<typeof import('@/infrastructure/db/client')['getClient']>;
let dbInstance: ReturnType<typeof import('@/infrastructure/db/client')['getDb']>;

const futureSlotIso = (): string => {
  const t = new Date(new Date().getTime() + 24 * 60 * 60 * 1000);
  t.setUTCHours(15, 0, 0, 0);
  return t.toISOString();
};

const buildBody = (overrides: Partial<Record<string, unknown>> = {}) => ({
  teacherSlug: 'augusto-rocha',
  slotUtcIso: futureSlotIso(),
  visitorName: 'Visitante Rollback',
  visitorEmail: 'visitante.rollback@example.test',
  contactPref: 'email' as const,
  contactValue: 'visitante.rollback@example.test',
  visitorTimezone: 'America/Argentina/Buenos_Aires',
  acceptsPending: true,
  companyName: '',
  _t: 1500,
  ...overrides,
});

const callPost = (body: Record<string, unknown>) =>
  routePOST(
    new NextRequest('http://localhost:3000/api/sessions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.30',
      },
      body: JSON.stringify(body),
    }),
  );

beforeAll(async () => {
  const dbModule = await import('@/infrastructure/db/client');
  dbClient = dbModule.getClient();
  dbInstance = dbModule.getDb();
  await dbClient.execute('PRAGMA foreign_keys = ON');
  for (const file of MIGRATION_FILES) {
    const raw = readFileSync(
      resolve(REPO_ROOT, 'src', 'infrastructure', 'db', 'migrations', file),
      'utf8',
    );
    const sql =
      file === '0003_seed_augusto.sql' ? renderSeed(raw, 'augusto@astrologiadeluz.com') : raw;
    for (const stmt of splitStatements(sql)) {
      await dbClient.execute(stmt);
    }
  }
  await dbClient.execute({
    sql: 'UPDATE teachers SET availability = ? WHERE slug = ?',
    args: [AUGUSTO_AVAIL, 'augusto-rocha'],
  });

  const routeMod = await import('@/app/api/sessions/route');
  routePOST = routeMod.POST as unknown as RoutePOST;
}, 30_000);

afterAll(() => {
  dbClient?.close();
});

afterEach(() => {
  vi.restoreAllMocks();
  fx.dispatchCalls.length = 0;
});

// Spy that throws only when the route inserts into the `sessions` table. The
// rate-limit gate (src/infrastructure/rate-limit/token-bucket.ts) ALSO calls db.insert (on the
// rate_limit_buckets table) earlier in the request lifecycle — a blanket
// `db.insert` mock would short-circuit the rate-limit and the route would
// never reach the session insert under test. Narrowing by table reference
// keeps the rate-limit path real.
function installSessionsInsertThrow() {
  const original = dbInstance.insert.bind(dbInstance);
  return vi.spyOn(dbInstance, 'insert').mockImplementation(((table: unknown) => {
    if (table === sessions) {
      throw new Error('simulated INSERT failure');
    }
    return original(table as Parameters<typeof original>[0]);
  }) as never);
}

describe('POST /api/sessions — rollback invariant (AC-3.1.2 step 5)', () => {
  test('INSERT throw → 500 with kind=insert_failed + Spanish error', async () => {
    const insertSpy = installSessionsInsertThrow();
    const res = await callPost(buildBody());
    expect(insertSpy).toHaveBeenCalled();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { kind: string; error: string };
    expect(body.kind).toBe('insert_failed');
    expect(body.error).toMatch(/No pudimos guardar/);
  });

  test('INSERT throw → dispatcher NEVER fires (rollback invariant)', async () => {
    installSessionsInsertThrow();
    await callPost(buildBody({ visitorEmail: 'no-dispatch@example.test' }));
    expect(fx.dispatchCalls).toHaveLength(0);
  });

  test('INSERT throw → no row in DB (visible-state invariant)', async () => {
    installSessionsInsertThrow();
    await callPost(buildBody({ visitorEmail: 'no-row-after-throw@example.test' }));
    const found = await dbClient.execute({
      sql: 'SELECT id FROM sessions WHERE visitor_email = ?',
      args: ['no-row-after-throw@example.test'],
    });
    expect(found.rows).toHaveLength(0);
  });

  test('honeypot silent-drop does NOT fire the dispatcher either', async () => {
    // Negative-evidence: anti-abuse pre-INSERT branches must also keep
    // the dispatcher untouched.
    const res = await callPost(buildBody({ companyName: 'AcmeBots Inc.' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: string };
    expect(body.kind).toBe('received');
    expect(fx.dispatchCalls).toHaveLength(0);
  });

  test('min-fill-time silent-drop does NOT fire the dispatcher either', async () => {
    const res = await callPost(buildBody({ _t: 200 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: string };
    expect(body.kind).toBe('received');
    expect(fx.dispatchCalls).toHaveLength(0);
  });
});
