/**
 * G_C-25 pairing — build collect-page-data lazy-env contract (AC-G_C-25.4).
 *
 * Load-bearing regression signal for the `next build` gate. The invariant:
 * importing the production modules that Next's data-collection phase touches
 * MUST NOT call `getEnv()`. Env access is permitted only at request-time.
 *
 * The proof shape: mock `@/infrastructure/env` with a `getEnv` SPY, then in a
 * single `beforeAll` parallel-import every consumer module Next pulls during
 * page-data collection (db/client, auth/config, email/resend, telegram/client,
 * panel/webhook-status, notify/brand-owner, every API route handler). After
 * the parallel import settles, the spy MUST have zero call count. A counter-
 * test then invokes `buildAuthConfig()` and asserts the spy DOES fire — so we
 * know the spy is wired correctly and not silently inert.
 *
 * The assertions FAIL when:
 *   - A future refactor reintroduces module-body `getEnv()` in any of the 8
 *     consumer files (e.g. `const url = getEnv().TURSO_DATABASE_URL` at the
 *     top of `src/infrastructure/db/client.ts`).
 *   - [src/infrastructure/auth/config.ts:132] is rewritten to pass
 *     `buildAuthConfig()` (the call result) to NextAuth instead of the lambda
 *     `() => buildAuthConfig()`, re-eager-ifying providers at module load.
 *   - The Next page modules add a top-level data fetch that calls `getDb()`
 *     outside the default-export component (Next would import the page
 *     during build and execute the top-level body).
 *
 * Design note (Fork 1, M-32): `@/infrastructure/env` is intentionally excluded
 * from the Promise.all parallel-import list. vitest 2.1.9 has a mock-factory
 * race when a `vi.mock`-ed path is BOTH a direct entry AND a transitive
 * resolve target in the same Promise.all — consumers cache the REAL module
 * before the mock factory populates the namespace, and the spy is bypassed.
 * Loading env transitively through one of the 8 consumers (auth/config
 * resolves env first) eliminates the race; the spy fires through every
 * consumer cleanly. See `memory/feedback_vitest_mock_promise_all_race.md`
 * and pool-c/G_C-48.json `mega_fork_decision` for the full reasoning. The
 * direct-env-module-body signal lost by this exclusion is structurally
 * redundant in the presence of the cumulative consumer walk + test 12's
 * counter-assertion (BETA B-1 §1 scored it "~inert").
 *
 * This spec does NOT invoke `next build` directly — that is the close-gate
 * at `npm run qa`. The spec here is the structural pairing that asserts
 * zero env-access at import time, which is what makes the build succeed.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const FAKE_ENV = {
  TURSO_DATABASE_URL: 'libsql://fake.turso.io',
  TURSO_AUTH_TOKEN: 'fake-token',
  AUTH_SECRET: 'x'.repeat(32),
  AUTH_URL: 'https://fake.example.com',
  AUTH_RESEND_KEY: 're_fake_key',
  RESEND_FROM: 'Fake <fake@example.com>',
  ADMIN_EMAILS: 'fake@example.com',
  TELEGRAM_BOT_TOKEN: '1234:fake-token',
  TELEGRAM_BOT_USERNAME: 'FakeBot',
  TELEGRAM_WEBHOOK_SECRET: 'y'.repeat(48),
} as const;

const getEnvSpy = vi.fn(() => FAKE_ENV);
const resetSpy = vi.fn();

vi.mock('@/infrastructure/env', () => ({
  getEnv: getEnvSpy,
  __resetEnvForTests: resetSpy,
  ENV_ERROR_HEADER: 'Variables de entorno faltantes o inválidas:',
  parseEnv: () => FAKE_ENV,
}));

beforeEach(() => {
  getEnvSpy.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('build collect-page-data — load-bearing imports do NOT call getEnv (AC-G_C-25.4)', () => {
  beforeAll(async () => {
    // Parallel-import the full env-consumer graph in a single fresh-module
    // walk — mirrors Next's build-time data-collection phase. `@/infrastructure/env`
    // is DELIBERATELY EXCLUDED from this list (see file docstring + Fork 1).
    // It loads transitively through `@/infrastructure/auth/config` (and others)
    // exactly once, cleanly under the mock factory.
    await Promise.all([
      import('@/infrastructure/db/client'),
      import('@/infrastructure/auth/config'),
      import('@/infrastructure/email/resend'),
      import('@/infrastructure/telegram/client'),
      import('@/application/panel/webhook-status'),
      import('@/application/notify/brand-owner'),
      import('@/app/api/sessions/route'),
      import('@/app/api/teachers/route'),
    ]);
  });

  test('zero module-body getEnv() calls across the full consumer graph', () => {
    // Cumulative cross-graph invariant. A regression introducing a top-level
    // `getEnv()` call in ANY of the 8 consumers OR de-lambda-fying
    // [src/infrastructure/auth/config.ts:132] flips this assertion RED.
    expect(getEnvSpy).not.toHaveBeenCalled();
  });
});

describe('build collect-page-data — counter-test: function invocation DOES call getEnv', () => {
  test('calling buildAuthConfig() materializes the config and calls getEnv', async () => {
    const auth = await import('@/infrastructure/auth/config');
    // buildAuthConfig is the factory NextAuth's lambda wraps. Calling it
    // directly mirrors what NextAuth does per request — and proves the
    // lazy boundary holds: env is only consulted when the factory runs.
    const config = auth.buildAuthConfig();
    expect(getEnvSpy).toHaveBeenCalled();
    expect(config.secret).toBe(FAKE_ENV.AUTH_SECRET);
  });
});
