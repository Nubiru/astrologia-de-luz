/**
 * G_B-1 integration pairing — anti-enumeration end-to-end (AC-1.3.2 +
 * AC-2.4.3 + AC-2.5.4).
 *
 * Drives Auth.js v5's POST `/api/auth/signin/resend` route handler (via the
 * `handlers` export of `@/auth`) twice — once with an on-list email and once
 * with an off-list email — and asserts:
 *
 *   1. **Byte-identical observable response**: same HTTP status code AND
 *      same `Location` header. An off-list visitor sees exactly the same
 *      "check your inbox" redirect a legitimate admin sees — the
 *      framework-level anti-enum gate Auth.js v5 documents for the Email
 *      provider when `signIn` returns false.
 *   2. **Adapter write occurs only for on-list**: exactly ONE
 *      `verificationToken` row exists after the two POSTs, and it belongs
 *      to the on-list identifier — the DB-evidence side of AC-2.5.4.
 *   3. **Resend HTTP is fired only for on-list**: the captured fetch list
 *      shows exactly ONE call to `api.resend.com`, and its body contains
 *      the on-list email — anti-enum at the side-effect layer (no email
 *      ever reaches an off-list address).
 *
 * Fails when:
 *   - The `signIn` callback is removed or weakened so off-list emails create
 *     a verificationToken row (allowlist bypass).
 *   - Auth.js's Resend integration is reconfigured to call sendVerification
 *     before signIn (would leak which addresses are off-list via Resend logs).
 *   - The DrizzleAdapter is dropped or rewired against the wrong DB instance
 *     (createVerificationToken would silently no-op and the magic-link flow
 *     would break for legitimate admins — the on-list-row assertion catches
 *     this even though the integration response would still LOOK OK).
 *   - Auth.js's default anti-enum redirect regresses to a different page for
 *     the off-list path (status / Location divergence between the two POSTs).
 *
 * The pairing is deliberately ASYMMETRIC across the two cases: same observable
 * surface, different internal side-effects. That asymmetry IS the anti-enum
 * invariant — and the test fails if either half of it breaks.
 *
 * Mocking strategy: zero. Setting `TURSO_DATABASE_URL` to `:memory:` in the
 * hoisted env block makes the real `db/client.ts` build the in-memory libsql
 * client that the rest of the suite shares. Auth.js, DrizzleAdapter, the
 * adapter tables, the migrations — every piece runs end-to-end on a fresh
 * SQLite memory file applied for this test.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// `next/server` lives at `next/server.js` (Next 16 has no package.json#exports
// for it); the project-wide vitest alias rewrites the bare specifier. Auth.js
// v5's handler reads `req.nextUrl.href` (see `next-auth/lib/env.js:11`) so the
// plain Request constructed below MUST be wrapped in NextRequest for the
// signin handler to even start.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  for (const [k, v] of Object.entries({
    // `:memory:` is honoured verbatim by @libsql/client — same code path the
    // wave-1 migration integration tests rely on. The zod boundary in
    // `lib/env.ts` only requires `min(1)` on TURSO_DATABASE_URL, so this
    // satisfies the validator without bypassing it.
    TURSO_DATABASE_URL: ':memory:',
    TURSO_AUTH_TOKEN: 'fixture-token',
    AUTH_SECRET: 'a'.repeat(48),
    AUTH_URL: 'http://localhost:3000',
    AUTH_RESEND_KEY: 're_fixture_anti_enum',
    RESEND_FROM: 'Astrologia de Luz <no-reply@anti-enum.test>',
    ADMIN_EMAILS: 'admin@allowed.test',
    TELEGRAM_BOT_TOKEN: '1:anti-enum-token',
    TELEGRAM_BOT_USERNAME: 'AntiEnumBot',
    TELEGRAM_WEBHOOK_SECRET: 'b'.repeat(48),
  })) {
    process.env[k] = v;
  }
});

// `next/server` ↔ `next/server.js` resolution + the next-auth/@auth inlining
// are configured project-wide in vitest.config.ts so this file can stay
// declarative about Auth.js — no module-level shims required.

const REPO_ROOT = resolve(__dirname, '..', '..');
const MIGRATION_FILES = ['0000_init.sql', '0001_authjs.sql', '0002_cp3_tables.sql'];

const splitStatements = (raw: string): string[] =>
  raw
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

// ---------------------------------------------------------------------------
// Fetch capture — Auth.js v5's Resend provider posts to api.resend.com via
// global fetch. Stub it so no real HTTP fires; record every call for the
// "Resend called only for on-list" assertion.
// ---------------------------------------------------------------------------

interface FetchCall {
  url: string;
  method: string;
  body: string;
}

const fetchCalls: FetchCall[] = [];

function isResendCall(call: FetchCall): boolean {
  return call.url.includes('api.resend.com');
}

function installFetchStub(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : init?.body ? String(init.body) : '';
      fetchCalls.push({ url, method, body });
      return new Response(JSON.stringify({ id: 'mocked-resend-response-id' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  );
}

// ---------------------------------------------------------------------------
// Auth.js v5 CSRF helper — drives GET /api/auth/csrf, then formats the body
// + Cookie header for the POST /api/auth/signin/resend call.
// ---------------------------------------------------------------------------

// Auth.js v5 types `handlers` against `NextRequest` (a Web-Fetch subclass that
// adds `nextUrl`). The plain `Request` we construct in tests is a valid runtime
// input — the handler reads only `url` + `method` + `headers` + `body`, all
// standard Fetch surface — but TypeScript can't prove substitutability, so we
// cast at the boundary.
type Handlers = typeof import('@/auth')['handlers'];
type HandlerInput = Parameters<Handlers['GET']>[0];

async function fetchCsrf(handlers: Handlers) {
  const res = await handlers.GET(
    new NextRequest('http://localhost:3000/api/auth/csrf', { method: 'GET' }) as HandlerInput,
  );
  const json = (await res.json()) as { csrfToken: string };
  const rawSetCookie = res.headers.get('set-cookie') ?? '';
  // Multiple cookies can collapse into a single header — split on commas that
  // precede a name=value pair, then keep only the name=value portion of each.
  const cookieHeader = rawSetCookie
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
  return { csrfToken: json.csrfToken, cookie: cookieHeader };
}

async function postSignin(
  handlers: Handlers,
  csrf: { csrfToken: string; cookie: string },
  email: string,
): Promise<Response> {
  const form = new URLSearchParams();
  form.set('email', email);
  form.set('csrfToken', csrf.csrfToken);
  form.set('callbackUrl', 'http://localhost:3000/panel/agenda');
  return handlers.POST(
    new NextRequest('http://localhost:3000/api/auth/signin/resend', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: csrf.cookie,
      },
      body: form.toString(),
    }) as HandlerInput,
  );
}

// ---------------------------------------------------------------------------
// Lifecycle — dynamic-import keeps the module load order explicit so the
// libsql client + migrations exist before any Auth.js handler runs.
// ---------------------------------------------------------------------------

let handlers: Handlers;
let dbClient: ReturnType<typeof import('@/db/client')['getClient']>;

beforeAll(async () => {
  // Resolve `@/db/client` first — that triggers the real client construction
  // against `:memory:`. Then apply every migration to that client so the
  // adapter tables (G_C-3) exist before Auth.js's first adapter call.
  const dbMod = await import('@/db/client');
  dbClient = dbMod.getClient();

  await dbClient.execute('PRAGMA foreign_keys = ON');
  for (const name of MIGRATION_FILES) {
    const text = readFileSync(resolve(REPO_ROOT, 'db', 'migrations', name), 'utf8');
    for (const stmt of splitStatements(text)) {
      await dbClient.execute(stmt);
    }
  }

  ({ handlers } = await import('@/auth'));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  fetchCalls.length = 0;
  installFetchStub();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AC-2.4.3 + AC-2.5.4 — anti-enumeration end-to-end', () => {
  test('off-list email gets byte-identical observable response + no DB write + no Resend call', async () => {
    // Fresh state per test: clear the verificationToken table so the row
    // count below is interpretable independent of prior test ordering.
    await dbClient.execute('DELETE FROM verificationToken');

    const csrf = await fetchCsrf(handlers);

    const onListRes = await postSignin(handlers, csrf, 'admin@allowed.test');
    const offListRes = await postSignin(handlers, csrf, 'attacker@blocked.test');

    // (1) Identical status + Location header — the framework anti-enum gate.
    expect(offListRes.status).toBe(onListRes.status);
    expect(offListRes.headers.get('location')).toBe(onListRes.headers.get('location'));

    // (2) DB-side asymmetry: only ONE verificationToken row, for on-list.
    const tokens = await dbClient.execute('SELECT identifier FROM verificationToken');
    expect(tokens.rows).toHaveLength(1);
    expect(String(tokens.rows[0]?.identifier).toLowerCase()).toBe('admin@allowed.test');

    // (3) Resend-side asymmetry: exactly ONE fetch to api.resend.com, with the
    //     on-list email in the body. The off-list path never hits Resend.
    const resendCalls = fetchCalls.filter(isResendCall);
    expect(resendCalls).toHaveLength(1);
    expect(resendCalls[0]?.body.toLowerCase()).toContain('admin@allowed.test');
    expect(resendCalls[0]?.body.toLowerCase()).not.toContain('attacker@blocked.test');
  });

  test('two off-list emails produce zero verificationToken rows + zero Resend calls', async () => {
    await dbClient.execute('DELETE FROM verificationToken');

    const csrf = await fetchCsrf(handlers);
    await postSignin(handlers, csrf, 'attacker-1@blocked.test');
    await postSignin(handlers, csrf, 'attacker-2@blocked.test');

    const tokens = await dbClient.execute('SELECT identifier FROM verificationToken');
    expect(tokens.rows).toHaveLength(0);

    const resendCalls = fetchCalls.filter(isResendCall);
    expect(resendCalls).toHaveLength(0);
  });
});

describe('AC-2.4.2 — JWT session strategy + 7-day cookie maxAge', () => {
  test('imported config exposes JWT strategy with 7-day maxAge (no DB-session lookups)', async () => {
    // Pulling the config independently of NextAuth() keeps the assertion
    // pure-structural — if the JWT strategy regresses to "database", an
    // unrelated Edge route would silently break at deploy time. Catch it here.
    const { buildAuthConfig, SESSION_MAX_AGE_SECONDS } = await import('@/auth');
    const authConfig = buildAuthConfig();
    expect(authConfig.session?.strategy).toBe('jwt');
    expect(authConfig.session?.maxAge).toBe(SESSION_MAX_AGE_SECONDS);
    expect(SESSION_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 7);
  });
});
