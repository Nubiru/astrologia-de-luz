/**
 * G_C-36 W4-5 integration pairing — post-migration smoke (AC-G_C-36.4).
 *
 * Exercises the 4 happy-path entry points after the wave-4 src/ restructure:
 *
 *   1. `/`              — public landing page (server component module load).
 *   2. `/reservar`      — booking surface (server component module load).
 *   3. `/panel`         — auth-gated panel root (server component module load).
 *   4. `/api/auth/csrf` — Auth.js v5 csrf-token endpoint (catch-all route).
 *
 * For (1)-(3) the smoke is the IMPORT itself: server-component modules must
 * resolve clean against the post-W4 `src/**` tree + path-aliases + composition
 * root, without any side-effect on import. Going further (rendering the JSX)
 * would require a full RSC harness and pulls in concerns out of scope for a
 * post-restructure migration smoke. The build-collect-page-data spec already
 * verifies the no-getEnv-at-module-load invariant for the load-bearing imports.
 *
 * For (4) we hit the real Auth.js GET handler with a NextRequest at
 * `/api/auth/csrf` and assert a 200 JSON response carrying a `csrfToken`
 * — the cheap, deterministic anchor that the auth catch-all is wired,
 * AUTH_SECRET is honoured, and the v5 lazy-init path resolves end-to-end.
 *
 * These assertions FAIL when:
 *   - A wave-4 path-alias drifts (`@/...` doesn't resolve from `src/**`) and
 *     a page module throws at import.
 *   - `getComposition()` falls into eager-import territory at a page module's
 *     module body — would surface as an unhandled exception during import.
 *   - The Auth.js catch-all silently 404s (e.g., the [...nextauth] segment
 *     was renamed or its `runtime = 'nodejs'` export was dropped + the route
 *     no longer matches).
 *   - AUTH_SECRET reading throws inside the Auth.js handler — would 500
 *     instead of returning the csrf token JSON.
 */

import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

import { type Client, createClient } from '@libsql/client';
import { NextRequest } from 'next/server';

vi.hoisted(() => {
  for (const [k, v] of Object.entries({
    TURSO_DATABASE_URL: 'file::memory:?cache=shared',
    TURSO_AUTH_TOKEN: 'post-migration-smoke',
    AUTH_SECRET: 'p'.repeat(48),
    AUTH_URL: 'http://localhost:3000',
    AUTH_RESEND_KEY: 're_post_migration_smoke',
    RESEND_FROM: 'Astrologia de Luz <no-reply@smoke.test>',
    ADMIN_EMAILS: 'augusto@astrologiadeluz.com',
    TELEGRAM_BOT_TOKEN: '1:post-migration-smoke',
    TELEGRAM_BOT_USERNAME: 'PostMigrationSmokeBot',
    TELEGRAM_WEBHOOK_SECRET: 'q'.repeat(48),
  })) {
    process.env[k] = v;
  }
});

const REPO_ROOT = resolve(__dirname, '..', '..');
const MIG_DIR = resolve(REPO_ROOT, 'src/infrastructure/db/migrations');
const MIGRATION_FILES = ['0000_init.sql', '0001_authjs.sql', '0002_cp3_tables.sql'];

const splitStatements = (raw: string): string[] =>
  raw
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

let workdir: string;
let client: Client;

beforeAll(async () => {
  workdir = mkdtempSync(join(tmpdir(), 'post-migration-smoke-'));
  const dbPath = join(workdir, 'test.db');
  closeSync(openSync(dbPath, 'w'));
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
  client = createClient({ url: `file:${dbPath}` });
  await client.execute('PRAGMA foreign_keys = ON');
  for (const file of MIGRATION_FILES) {
    const sql = readFileSync(resolve(MIG_DIR, file), 'utf8');
    for (const stmt of splitStatements(sql)) {
      await client.execute(stmt);
    }
  }
});

afterAll(() => {
  client.close();
  rmSync(workdir, { recursive: true, force: true });
});

describe('AC-G_C-36.4 — post-migration smoke walk (4 happy-path routes)', () => {
  test('/ — public landing page module loads without throwing', async () => {
    const mod = await import('@/app/page');
    expect(typeof mod.default).toBe('function');
  });

  test('/reservar — booking-surface page module loads without throwing', async () => {
    const mod = await import('@/app/reservar/page');
    expect(typeof mod.default).toBe('function');
  });

  test('/panel — panel-root page module loads without throwing', async () => {
    const mod = await import('@/app/panel/page');
    expect(typeof mod.default).toBe('function');
  });

  test('/api/auth/csrf — Auth.js v5 csrf endpoint returns 200 with a csrfToken', async () => {
    const { GET } = await import('@/app/api/auth/[...nextauth]/route');
    const req = new NextRequest('http://localhost:3000/api/auth/csrf', {
      method: 'GET',
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { csrfToken?: string };
    // Auth.js v5 returns a hex csrfToken (≥32 chars) on the unauthenticated path.
    expect(typeof body.csrfToken).toBe('string');
    expect(body.csrfToken?.length ?? 0).toBeGreaterThanOrEqual(32);
  });
});
