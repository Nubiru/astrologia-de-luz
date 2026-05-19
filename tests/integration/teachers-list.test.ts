/**
 * G_C-9 integration pairing — GET /api/teachers contract.
 *
 * Spec anchors: S-1 AC-1.2.3, AC-1.5.3.
 *
 * What this catches:
 *   - The `active=true` filter is dropped (archived teachers leak into the
 *     visitor picker — the booking page would let visitors request a slot
 *     with someone who is no longer taking clients).
 *   - The projection drifts (e.g. `email` accidentally exposed, or `slug`
 *     dropped) — the booking picker contract is a SHAPE contract; exposing
 *     PII or dropping the slug breaks downstream URL construction.
 *   - The ORDER BY is removed / replaced with `id` — the picker shows
 *     teachers in arbitrary insert order, which is fine in tests with one
 *     seed row but visible-as-buggy once Augusto adds Maria + Luis.
 *   - The Node runtime declaration regresses (the libsql client breaks at
 *     module load on Edge).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  const { closeSync, mkdtempSync, openSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const TMP = mkdtempSync(join(tmpdir(), 'gc9-teachers-'));
  const DB_PATH = join(TMP, 'test.db');
  closeSync(openSync(DB_PATH, 'w'));
  for (const [k, v] of Object.entries({
    TURSO_DATABASE_URL: `file:${DB_PATH}`,
    TURSO_AUTH_TOKEN: 'fixture-token',
    AUTH_SECRET: 'c'.repeat(48),
    AUTH_URL: 'http://localhost:3000',
    AUTH_RESEND_KEY: 're_fixture_teachers_test',
    RESEND_FROM: 'Astrologia de Luz <no-reply@teachers-test.test>',
    ADMIN_EMAILS: 'augusto@astrologiadeluz.com',
    TELEGRAM_BOT_TOKEN: '1:teachers-token',
    TELEGRAM_BOT_USERNAME: 'TeachersTestBot',
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

type RouteGET = () => Promise<Response>;
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

  // Insert a second active maestra + one archived teacher so the visibility +
  // ordering + filter contracts all have a row to bite into.
  const NOW = Date.now();
  await dbClient.execute({
    sql: `INSERT INTO teachers (id, slug, name, email, bio, availability, timezone, active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      'maria-uuid-fixture',
      'maria-del-sol',
      'María del Sol',
      'maria@astrologiadeluz.com',
      'Astrología jungiana.',
      '{"tz":null,"windows":[],"blackouts":[]}',
      'Europe/Madrid',
      1,
      NOW,
      NOW,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO teachers (id, slug, name, email, bio, availability, timezone, active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      'luis-uuid-fixture',
      'luis-archived',
      'Luis (archivado)',
      'luis@astrologiadeluz.com',
      'Maestro archivado, no debe aparecer.',
      '{"tz":null,"windows":[],"blackouts":[]}',
      'America/Argentina/Buenos_Aires',
      0,
      NOW,
      NOW,
    ],
  });

  const routeMod = await import('@/app/api/teachers/route');
  routeGET = routeMod.GET as unknown as RouteGET;
});

afterAll(() => {
  dbClient?.close();
});

describe('GET /api/teachers — AC-1.2.3 + AC-1.5.3 contract', () => {
  test('returns 200 + JSON content-type', async () => {
    const res = await routeGET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  test('excludes archived teachers (active=0)', async () => {
    const res = await routeGET();
    const body = (await res.json()) as { maestros: Array<{ slug: string }> };
    const slugs = body.maestros.map((m) => m.slug);
    expect(slugs).not.toContain('luis-archived');
    expect(slugs).toContain('augusto-rocha');
    expect(slugs).toContain('maria-del-sol');
    expect(body.maestros).toHaveLength(2);
  });

  test('returns maestros ordered by name ASC', async () => {
    const res = await routeGET();
    const body = (await res.json()) as { maestros: Array<{ name: string }> };
    const names = body.maestros.map((m) => m.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
    // Sanity: Augusto sorts before María.
    expect(names[0]).toBe('Augusto Rocha');
    expect(names[1]).toBe('María del Sol');
  });

  test('exposes exactly the picker projection (no PII leak)', async () => {
    const res = await routeGET();
    const body = (await res.json()) as { maestros: Array<Record<string, unknown>> };
    const augusto = body.maestros.find((m) => m.slug === 'augusto-rocha');
    expect(augusto).toBeDefined();
    const keys = Object.keys(augusto ?? {}).sort();
    expect(keys).toEqual(['avatarUrl', 'bio', 'id', 'name', 'slug', 'timezone']);
    // Negative-evidence: email + telegram chat id MUST NOT be in the payload.
    expect(keys).not.toContain('email');
    expect(keys).not.toContain('telegramChatId');
    expect(keys).not.toContain('availability');
  });

  test('declares Node runtime (libsql is not Edge-safe)', async () => {
    const routeMod = await import('@/app/api/teachers/route');
    expect(routeMod.runtime).toBe('nodejs');
  });
});
