/**
 * G_B-2 integration pairing — `GET /api/auth/session` shape contract
 * (AC-2.4.6 + AC-2.4.2).
 *
 * Drives the catch-all route handler from `app/api/auth/[...nextauth]/route.ts`
 * twice — once with no session cookie, once with a freshly-encoded JWT
 * session cookie — and asserts:
 *
 *   1. **No-cookie path returns an EMPTY 200 JSON session.** This is the
 *      Auth.js v5 contract for unauthenticated callers: not 401, not 403, but
 *      `200 {}`. Panel pages need this to render a deterministic "signed-out"
 *      UI without branching on HTTP errors.
 *   2. **Valid-cookie path returns a 200 JSON payload with `user` + `expires`.**
 *      The session callback can shape `user` further; the load-bearing
 *      invariant is that an Auth.js-issued JWT round-trips through the
 *      handler and produces a non-empty payload.
 *   3. **The route's GET is the SAME function the auth.ts handlers export.**
 *      A future refactor that hand-rolls a parallel session endpoint instead
 *      of re-exporting would silently bypass every signIn callback / adapter
 *      hook G_B-1 already verified. Catch that here.
 *
 * Mocking strategy: zero, modulo `TURSO_DATABASE_URL=:memory:` (same pattern
 * as the G_B-1 anti-enum pairing). Auth.js runs end-to-end, the DrizzleAdapter
 * runs against an in-memory libsql, the JWT is encoded with the test
 * AUTH_SECRET. Cookie name is the Auth.js v5 dev default
 * `authjs.session-token` (no `__Secure-` prefix because the test request URL
 * is `http://localhost`).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

import { NextRequest } from 'next/server';

vi.hoisted(() => {
  for (const [k, v] of Object.entries({
    TURSO_DATABASE_URL: ':memory:',
    TURSO_AUTH_TOKEN: 'fixture-token',
    AUTH_SECRET: 'c'.repeat(48),
    AUTH_URL: 'http://localhost:3000',
    AUTH_RESEND_KEY: 're_fixture_session_test',
    RESEND_FROM: 'Astrologia de Luz <no-reply@session-test.test>',
    ADMIN_EMAILS: 'session@allowed.test',
    TELEGRAM_BOT_TOKEN: '1:session-token',
    TELEGRAM_BOT_USERNAME: 'SessionTestBot',
    TELEGRAM_WEBHOOK_SECRET: 'd'.repeat(48),
  })) {
    process.env[k] = v;
  }
});

const REPO_ROOT = resolve(__dirname, '..', '..');
const MIGRATION_FILES = ['0000_init.sql', '0001_authjs.sql', '0002_cp3_tables.sql'];

const splitStatements = (raw: string): string[] =>
  raw
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

// Auth.js v5 dev-mode cookie name for the JWT session. In production the
// prefix becomes `__Secure-` (only emitted over HTTPS); the test URL is
// `http://localhost:3000` so the dev name applies.
const SESSION_COOKIE_NAME = 'authjs.session-token';

type RouteHandler = (req: NextRequest) => Promise<Response>;
let routeGET: RouteHandler;
let dbClient: ReturnType<typeof import('@/db/client')['getClient']>;

async function craftSessionCookie(): Promise<string> {
  // Use the same encode() Auth.js uses internally so the route handler reads
  // back exactly what it would read in production. The `salt` parameter for
  // the JWT session strategy MUST be the cookie name (Auth.js v5 derives the
  // encryption key from {secret, salt} per `@auth/core/jwt`); using any other
  // value produces a cookie that fails to decrypt and the session resolves
  // to null — which would let this test silently pass via the no-cookie path.
  const { encode } = await import('@auth/core/jwt');
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET must be set for craftSessionCookie');
  return encode({
    salt: SESSION_COOKIE_NAME,
    secret,
    token: {
      sub: 'fixture-user-id',
      email: 'session@allowed.test',
      name: 'Fixture Admin',
      // Auth.js JWT default fields:
      iat: Math.floor(Date.now() / 1000),
      exp,
      jti: 'fixture-jti',
    },
    maxAge: 7 * 24 * 60 * 60,
  });
}

beforeAll(async () => {
  // Bootstrap the shared in-memory libsql client BEFORE auth.ts loads, so the
  // adapter has a real DB to attach to.
  const dbMod = await import('@/db/client');
  dbClient = dbMod.getClient();
  await dbClient.execute('PRAGMA foreign_keys = ON');
  for (const name of MIGRATION_FILES) {
    const text = readFileSync(resolve(REPO_ROOT, 'db', 'migrations', name), 'utf8');
    for (const stmt of splitStatements(text)) {
      await dbClient.execute(stmt);
    }
  }

  // Import via the route file's path — that's the surface the App Router
  // actually invokes in production, so the test exercises it directly.
  const routeMod = await import('@/app/api/auth/[...nextauth]/route');
  routeGET = routeMod.GET as unknown as RouteHandler;
});

afterAll(() => {
  // Nothing to tear down — the in-memory libsql GC-s with the test process.
});

describe('AC-2.4.6 — GET /api/auth/session contract', () => {
  test('returns 200 + empty session JSON when no cookie is present', async () => {
    const res = await routeGET(
      new NextRequest('http://localhost:3000/api/auth/session', {
        method: 'GET',
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);

    const body = (await res.json()) as Record<string, unknown> | null;
    // Auth.js v5 returns `null` OR `{}` here depending on the build; both
    // shapes are "no session". Asserting non-truthy `user` covers both.
    expect(body?.user).toBeUndefined();
  });

  test('returns 200 + populated session JSON when a valid JWT cookie is present', async () => {
    const token = await craftSessionCookie();
    const req = new NextRequest('http://localhost:3000/api/auth/session', {
      method: 'GET',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
    });

    const res = await routeGET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);

    const body = (await res.json()) as {
      user?: { email?: string; name?: string };
      expires?: string;
    };
    expect(body.user).toBeDefined();
    expect(body.user?.email).toBe('session@allowed.test');
    expect(body.expires).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('AC-2.4.6 — route file re-exports `@/auth` handlers', () => {
  test('route.GET === auth.handlers.GET (no parallel implementation)', async () => {
    const { handlers } = await import('@/auth');
    const routeMod = await import('@/app/api/auth/[...nextauth]/route');
    // Reference identity: the destructured `GET` in route.ts MUST be the
    // same function object Auth.js builds in auth.ts. If a future refactor
    // wraps it (logging, instrumentation, etc) — the identity check fails
    // here and the diff to the wrapper is visible.
    expect(routeMod.GET).toBe(handlers.GET);
    expect(routeMod.POST).toBe(handlers.POST);
  });

  test('route exports the Node runtime declaration', async () => {
    const routeMod = await import('@/app/api/auth/[...nextauth]/route');
    expect(routeMod.runtime).toBe('nodejs');
  });
});
