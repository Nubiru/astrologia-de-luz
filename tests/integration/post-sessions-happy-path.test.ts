/**
 * G_C-10 integration pairing #1 — POST /api/sessions happy path.
 *
 * Spec anchors: S-1 AC-3.1.1, AC-3.1.2 (steps 5-7), AC-3.2 fan-out invocation.
 *
 * What this catches:
 *   - The 201 response body drifts from the AC-1.2.9 dual-TZ inputs (pool-a's
 *     G_A-9 confirmation panel reads `slotUtcIso` + `maestroName` +
 *     `maestroTimezone` + `visitorTimezone`).
 *   - The dispatcher is invoked BEFORE the INSERT row exists (the assertion
 *     reads the dispatchPending call's `session.id` and checks the same row
 *     exists in DB).
 *   - The visitor email is silently passed through with mixed case (the
 *     stored row + the dispatched payload should be lower-cased).
 *   - `visitor_intent` is persisted as empty-string when the request omits
 *     it (should be NULL — distinguishes "intent provided but blank" from
 *     "no intent").
 *   - The Node runtime declaration regresses (libsql + dispatcher's
 *     Resend HTTP transport are not Edge-safe).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  const { closeSync, mkdtempSync, openSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const TMP = mkdtempSync(join(tmpdir(), 'gc10-happy-'));
  const DB_PATH = join(TMP, 'test.db');
  closeSync(openSync(DB_PATH, 'w'));
  for (const [k, v] of Object.entries({
    TURSO_DATABASE_URL: `file:${DB_PATH}`,
    TURSO_AUTH_TOKEN: 'fixture-token',
    AUTH_SECRET: 'c'.repeat(48),
    AUTH_URL: 'http://localhost:3000',
    AUTH_RESEND_KEY: 're_fixture_happy_test',
    RESEND_FROM: 'Astrologia de Luz <no-reply@happy-test.test>',
    ADMIN_EMAILS: 'augusto@astrologiadeluz.com',
    TELEGRAM_BOT_TOKEN: '1:happy-token',
    TELEGRAM_BOT_USERNAME: 'HappyTestBot',
    TELEGRAM_WEBHOOK_SECRET: 'd'.repeat(48),
  })) {
    process.env[k] = v;
  }
});

const fx = vi.hoisted(() => ({
  dispatchCalls: [] as Array<{
    sessionId: string;
    maestroSlug: string;
    visitorEmail: string;
  }>,
}));

vi.mock('@/application/notify/dispatch-pending', () => ({
  dispatchPending: vi.fn(
    async (input: {
      session: { id: string; visitorEmail: string };
      assignedMaestro: { slug: string };
    }) => {
      fx.dispatchCalls.push({
        sessionId: input.session.id,
        maestroSlug: input.assignedMaestro.slug,
        visitorEmail: input.session.visitorEmail,
      });
      return { outcomes: [], failures: [] };
    },
  ),
}));

const REPO_ROOT = resolve(__dirname, '..', '..');
const MIGRATION_FILES = [
  '0000_init.sql',
  '0001_authjs.sql',
  '0002_cp3_tables.sql',
  '0003_seed_augusto.sql',
] as const;
const SLOT_AVAIL = JSON.stringify({
  tz: 'America/Argentina/Buenos_Aires',
  // Every weekday 00:00-23:00 BSAS so any slot in the next 14 days lands inside a window.
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

// Pick a slot that is in the future for the test run — start-of-tomorrow in
// BSAS = tomorrow's 00:00 BSAS = tomorrow-1 03:00Z. Add 12 hours to get a
// "tomorrow at noon BSAS" slot that lives well inside the 14-day window.
const tomorrowNoonBsasUtc = (): string => {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  tomorrow.setUTCHours(15, 0, 0, 0); // 15:00Z = 12:00 BSAS (UTC-3)
  return tomorrow.toISOString();
};

const buildBody = (overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  teacherSlug: 'augusto-rocha',
  slotUtcIso: tomorrowNoonBsasUtc(),
  visitorName: 'Visitante Uno',
  visitorEmail: 'Visitante.Uno@Example.test',
  contactPref: 'email',
  contactValue: 'visitante.uno@example.test',
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
        'x-forwarded-for': '203.0.113.10', // unique IP per file → fresh rate-limit bucket
      },
      body: JSON.stringify(body),
    }),
  );

beforeAll(async () => {
  const dbMod = await import('@/infrastructure/db/client');
  dbClient = dbMod.getClient();
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
    args: [SLOT_AVAIL, 'augusto-rocha'],
  });

  const routeMod = await import('@/app/api/sessions/route');
  routePOST = routeMod.POST as unknown as RoutePOST;
}, 30_000);

afterAll(() => {
  dbClient?.close();
});

describe('POST /api/sessions — happy path (AC-3.1.2 steps 5-7)', () => {
  test('returns 201 with the dual-TZ confirmation shape', async () => {
    fx.dispatchCalls.length = 0;
    const slot = tomorrowNoonBsasUtc();
    const res = await callPost(buildBody({ slotUtcIso: slot }));

    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await res.json()) as {
      kind: string;
      sessionId: string;
      slotUtcIso: string;
      maestroName: string;
      maestroTimezone: string;
      visitorTimezone: string;
    };
    expect(body.kind).toBe('created');
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.slotUtcIso).toBe(slot);
    expect(body.maestroName).toBe('Augusto Rocha');
    expect(body.maestroTimezone).toBe('America/Argentina/Buenos_Aires');
    expect(body.visitorTimezone).toBe('America/Argentina/Buenos_Aires');
  });

  test('persists the row with the lower-cased visitor email + null intent', async () => {
    fx.dispatchCalls.length = 0;
    const slot = new Date(new Date().getTime() + 2 * 24 * 60 * 60 * 1000);
    slot.setUTCHours(16, 0, 0, 0); // 16:00Z = 13:00 BSAS — different from prior test
    const slotIso = slot.toISOString();

    const res = await callPost(buildBody({ slotUtcIso: slotIso, visitorIntent: undefined }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { sessionId: string };

    const stored = await dbClient.execute({
      sql: 'SELECT visitor_email, visitor_intent, status FROM sessions WHERE id = ?',
      args: [body.sessionId],
    });
    expect(stored.rows[0]?.visitor_email).toBe('visitante.uno@example.test');
    expect(stored.rows[0]?.visitor_intent).toBeNull();
    expect(stored.rows[0]?.status).toBe('pending');
  });

  test('invokes dispatchPending exactly once with the inserted session id', async () => {
    fx.dispatchCalls.length = 0;
    const slot = new Date(new Date().getTime() + 3 * 24 * 60 * 60 * 1000);
    slot.setUTCHours(17, 0, 0, 0);
    const res = await callPost(buildBody({ slotUtcIso: slot.toISOString() }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { sessionId: string };

    expect(fx.dispatchCalls).toHaveLength(1);
    expect(fx.dispatchCalls[0]?.sessionId).toBe(body.sessionId);
    expect(fx.dispatchCalls[0]?.maestroSlug).toBe('augusto-rocha');
    // Dispatcher receives the canonicalised (lower-cased) email — same value
    // the DB stored.
    expect(fx.dispatchCalls[0]?.visitorEmail).toBe('visitante.uno@example.test');
  });

  test('declares Node runtime + exports POST + returns 405 for other methods', async () => {
    const routeMod = await import('@/app/api/sessions/route');
    expect(routeMod.runtime).toBe('nodejs');
    expect(typeof routeMod.POST).toBe('function');
    const getRes = await (routeMod.GET as () => Response)();
    expect(getRes.status).toBe(405);
    expect(getRes.headers.get('Allow')).toBe('POST');
  });
});
