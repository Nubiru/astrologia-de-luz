/**
 * G_C-9 integration pairing — GET /api/teachers/[slug]/availability contract.
 *
 * Spec anchors: S-1 AC-1.2.5, AC-1.2.6, AC-2.1.4, AC-3.6.2, R-1, R-5.
 *
 * What this catches:
 *   - The slug 404 path is wired through `eq(slug, ...)` only (no
 *     `active=true`) — an archived maestro's slot calendar leaks to the
 *     visitor, undoing AC-1.5.3 at the API layer.
 *   - The `tz` query param is silently accepted without validation — a
 *     malformed string would crash deriveSlots downstream.
 *   - Already-confirmed sessions are NOT subtracted — the picker offers
 *     slots the POST /api/sessions handler would then 409 (R-5; bad UX).
 *   - The range window is anchored in server TZ instead of visitor TZ — a
 *     Tokyo visitor at 23:00 local would see "yesterday" as their day 0.
 *   - Past slots leak (a 09:00 slot when the visitor's local clock is
 *     14:00).
 *   - The shape contract drifts (rangeStartUtc / rangeEndUtc dropped, slots
 *     wrapped in `data: {...}`, etc.) — pool-a's G_A-8 day-strip consumer
 *     unpacks the exact shape.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  const { closeSync, mkdtempSync, openSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const TMP = mkdtempSync(join(tmpdir(), 'gc9-avail-'));
  const DB_PATH = join(TMP, 'test.db');
  closeSync(openSync(DB_PATH, 'w'));
  for (const [k, v] of Object.entries({
    TURSO_DATABASE_URL: `file:${DB_PATH}`,
    TURSO_AUTH_TOKEN: 'fixture-token',
    AUTH_SECRET: 'c'.repeat(48),
    AUTH_URL: 'http://localhost:3000',
    AUTH_RESEND_KEY: 're_fixture_avail_test',
    RESEND_FROM: 'Astrologia de Luz <no-reply@avail-test.test>',
    ADMIN_EMAILS: 'augusto@astrologiadeluz.com',
    TELEGRAM_BOT_TOKEN: '1:avail-token',
    TELEGRAM_BOT_USERNAME: 'AvailTestBot',
    TELEGRAM_WEBHOOK_SECRET: 'd'.repeat(48),
  })) {
    process.env[k] = v;
  }
});

const REPO_ROOT = resolve(__dirname, '..', '..');
const MIGRATION_FILES = [
  '0000_init.sql',
  '0001_authjs.sql',
  '0002_cp3_tables.sql',
  '0003_seed_augusto.sql',
] as const;

const renderSeed = (sql: string, email: string): string => sql.split('$$ADMIN_EMAIL$$').join(email);

const splitStatements = (raw: string): string[] =>
  raw
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

// 2026-06-02 (a Tuesday) at 10:00 UTC — the anchor for every test below.
// Picked so that "today + 14 days in BSAS" lands cleanly between known
// Mondays in the window: 2026-06-01 (Mon, today-in-BSAS), 2026-06-08, 2026-06-15.
const FROZEN_NOW = new Date('2026-06-02T10:00:00.000Z');

const AUGUSTO_AVAIL = JSON.stringify({
  tz: 'America/Argentina/Buenos_Aires',
  windows: [
    // Monday 09:00-12:00 BSAS = 12:00-15:00Z → 3 slots
    { weekday: 1, start: '09:00', end: '12:00' },
  ],
  blackouts: [],
});

type RouteGET = (
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) => Promise<Response>;
let routeGET: RouteGET;
let dbClient: ReturnType<typeof import('@/infrastructure/db/client')['getClient']>;

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

  // Replace the seeded empty availability with a real Monday window.
  await dbClient.execute({
    sql: 'UPDATE teachers SET availability = ? WHERE slug = ?',
    args: [AUGUSTO_AVAIL, 'augusto-rocha'],
  });

  // Add an archived row for the 404 contract.
  await dbClient.execute({
    sql: `INSERT INTO teachers (id, slug, name, email, bio, availability, timezone, active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      'archived-uuid',
      'archived-maestro',
      'Archivado',
      'archived@astrologiadeluz.com',
      null,
      AUGUSTO_AVAIL,
      'America/Argentina/Buenos_Aires',
      0,
      FROZEN_NOW.getTime(),
      FROZEN_NOW.getTime(),
    ],
  });

  const routeMod = await import('@/app/api/teachers/[slug]/availability/route');
  routeGET = routeMod.GET as unknown as RouteGET;
}, 30_000);

afterAll(() => {
  dbClient?.close();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
});

afterEach(async () => {
  vi.useRealTimers();
  // Clean any sessions inserted by individual tests so the next test starts fresh.
  await dbClient.execute('DELETE FROM sessions');
});

const callGet = async (slug: string, search = '') => {
  const url = `http://localhost:3000/api/teachers/${slug}/availability${search}`;
  return routeGET(new NextRequest(url, { method: 'GET' }), { params: Promise.resolve({ slug }) });
};

describe('GET /api/teachers/[slug]/availability — slug + tz gates', () => {
  test('404 when slug does not resolve', async () => {
    const res = await callGet('nope');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Maestro/);
  });

  test('404 when teacher is archived (active=0)', async () => {
    const res = await callGet('archived-maestro');
    expect(res.status).toBe(404);
  });

  test('400 when tz is malformed', async () => {
    const res = await callGet('augusto-rocha', '?tz=Not/A_Real_Zone');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Zona horaria/i);
  });
});

describe('GET /api/teachers/[slug]/availability — shape + range (AC-1.2.5)', () => {
  test('returns { tz, rangeStartUtc, rangeEndUtc, slots } shape', async () => {
    const res = await callGet('augusto-rocha', '?tz=America/Argentina/Buenos_Aires');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tz: string;
      rangeStartUtc: string;
      rangeEndUtc: string;
      slots: string[];
    };
    expect(body.tz).toBe('America/Argentina/Buenos_Aires');
    expect(typeof body.rangeStartUtc).toBe('string');
    expect(typeof body.rangeEndUtc).toBe('string');
    expect(Array.isArray(body.slots)).toBe(true);
  });

  test('rangeStartUtc is start-of-today in the VISITOR TZ (not server TZ)', async () => {
    // BSAS visitor on 2026-06-02T10:00Z → BSAS local is 2026-06-02T07:00 (UTC-3).
    // Start of "today" in BSAS = 2026-06-02T00:00 BSAS = 2026-06-02T03:00Z.
    const res = await callGet('augusto-rocha', '?tz=America/Argentina/Buenos_Aires');
    const body = (await res.json()) as { rangeStartUtc: string };
    expect(body.rangeStartUtc).toBe('2026-06-02T03:00:00.000Z');
  });

  test('a Tokyo visitor sees Tokyo-anchored day boundaries', async () => {
    // Tokyo at FROZEN_NOW (2026-06-02T10:00Z) = 2026-06-02T19:00 JST (+09:00).
    // Today-in-Tokyo = 2026-06-02; start = 2026-06-02T00:00 JST = 2026-06-01T15:00Z.
    const res = await callGet('augusto-rocha', '?tz=Asia/Tokyo');
    const body = (await res.json()) as { rangeStartUtc: string; rangeEndUtc: string };
    expect(body.rangeStartUtc).toBe('2026-06-01T15:00:00.000Z');
    // 14 days later: 2026-06-16T00:00 JST = 2026-06-15T15:00Z.
    expect(body.rangeEndUtc).toBe('2026-06-15T15:00:00.000Z');
  });
});

describe('GET /api/teachers/[slug]/availability — slot derivation', () => {
  test('emits 3 Monday slots per Monday-in-range with the BSAS 09:00-12:00 window', async () => {
    const res = await callGet('augusto-rocha', '?tz=America/Argentina/Buenos_Aires');
    const body = (await res.json()) as { slots: string[] };
    // BSAS today is 2026-06-02 (Tue). 14-day window covers Mondays:
    //   2026-06-08 (Mon), 2026-06-15 (Mon). (2026-06-01 already passed.)
    // Each Monday: 09:00, 10:00, 11:00 BSAS = 12:00Z, 13:00Z, 14:00Z.
    expect(body.slots).toEqual([
      '2026-06-08T12:00:00.000Z',
      '2026-06-08T13:00:00.000Z',
      '2026-06-08T14:00:00.000Z',
      '2026-06-15T12:00:00.000Z',
      '2026-06-15T13:00:00.000Z',
      '2026-06-15T14:00:00.000Z',
    ]);
  });

  test('subtracts already-confirmed sessions (R-5)', async () => {
    // Confirm the 13:00Z slot on 2026-06-08; the response should omit it.
    await dbClient.execute({
      sql: `INSERT INTO sessions (id, teacher_id, starts_at_utc, duration_minutes, status, visitor_name, visitor_email, contact_pref, contact_value, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        'session-1',
        'augusto-rocha-uuid-stable',
        new Date('2026-06-08T13:00:00.000Z').getTime(),
        60,
        'confirmed',
        'Visitor',
        'visitor@example.test',
        'email',
        'visitor@example.test',
        FROZEN_NOW.getTime(),
        FROZEN_NOW.getTime(),
      ],
    });
    const res = await callGet('augusto-rocha', '?tz=America/Argentina/Buenos_Aires');
    const body = (await res.json()) as { slots: string[] };
    expect(body.slots).not.toContain('2026-06-08T13:00:00.000Z');
    // The bracketing slots stay.
    expect(body.slots).toContain('2026-06-08T12:00:00.000Z');
    expect(body.slots).toContain('2026-06-08T14:00:00.000Z');
  });

  test('PENDING sessions are NOT subtracted (only confirmed lock the slot)', async () => {
    // A pending session does NOT reserve the slot — only `confirmed` does, per
    // the partial-unique index `WHERE status = 'confirmed'` (AC-2.2.2).
    await dbClient.execute({
      sql: `INSERT INTO sessions (id, teacher_id, starts_at_utc, duration_minutes, status, visitor_name, visitor_email, contact_pref, contact_value, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        'session-pending',
        'augusto-rocha-uuid-stable',
        new Date('2026-06-08T12:00:00.000Z').getTime(),
        60,
        'pending',
        'Visitor',
        'pending@example.test',
        'email',
        'pending@example.test',
        FROZEN_NOW.getTime(),
        FROZEN_NOW.getTime(),
      ],
    });
    const res = await callGet('augusto-rocha', '?tz=America/Argentina/Buenos_Aires');
    const body = (await res.json()) as { slots: string[] };
    expect(body.slots).toContain('2026-06-08T12:00:00.000Z');
  });
});

describe('GET /api/teachers/[slug]/availability — empty + defensive', () => {
  test('returns an empty slots[] when the maestro has empty availability windows (R-9)', async () => {
    await dbClient.execute({
      sql: 'UPDATE teachers SET availability = ? WHERE slug = ?',
      args: ['{"tz":null,"windows":[],"blackouts":[]}', 'augusto-rocha'],
    });
    const res = await callGet('augusto-rocha', '?tz=America/Argentina/Buenos_Aires');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { slots: string[] };
    expect(body.slots).toEqual([]);
    // Restore for any later test.
    await dbClient.execute({
      sql: 'UPDATE teachers SET availability = ? WHERE slug = ?',
      args: [AUGUSTO_AVAIL, 'augusto-rocha'],
    });
  });

  test('returns empty slots[] when the availability JSON violates the shape (defensive)', async () => {
    await dbClient.execute({
      sql: 'UPDATE teachers SET availability = ? WHERE slug = ?',
      args: ['{"junk":true}', 'augusto-rocha'],
    });
    const res = await callGet('augusto-rocha', '?tz=America/Argentina/Buenos_Aires');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { slots: string[] };
    expect(body.slots).toEqual([]);
    await dbClient.execute({
      sql: 'UPDATE teachers SET availability = ? WHERE slug = ?',
      args: [AUGUSTO_AVAIL, 'augusto-rocha'],
    });
  });

  test('declares Node runtime', async () => {
    const routeMod = await import('@/app/api/teachers/[slug]/availability/route');
    expect(routeMod.runtime).toBe('nodejs');
  });
});
