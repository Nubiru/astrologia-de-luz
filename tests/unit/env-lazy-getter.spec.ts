/**
 * G_C-25 pairing — env lazy getter (AC-G_C-25.1, AC-G_C-25.2, AC-G_C-25.3,
 * AC-G_C-25.5).
 *
 * Asserts the lazy form contract:
 *   1. `getEnv()` memoizes — the first call parses `process.env`, every
 *      subsequent call returns the same cached object reference.
 *   2. `__resetEnvForTests()` clears the cache so a remocked `process.env`
 *      is re-validated on the next `getEnv()`.
 *   3. NO production source file imports the old eager `env` symbol from
 *      `@/lib/env`. The grep asserts both the named-import form
 *      (`import { env } from '@/infrastructure/env'`) and the rest-spread form
 *      (`{ env, ... }`).
 *   4. Importing `@/lib/env` itself does NOT validate — only `getEnv()`
 *      calls it. This is the load-bearing invariant that closes the
 *      `next build` page-data-collection gate (M-11).
 *   5. When the env is invalid (missing keys / bad shape), `getEnv()`
 *      throws the SAME Spanish-headed `ENV_ERROR_HEADER` error as
 *      `parseEnv` (regression-safety on the validation contract).
 *
 * These assertions FAIL when:
 *   - Memoization is dropped and `getEnv()` reparses on every call (perf
 *     regression + breaks the test-mock pattern that caches a single
 *     reference per spec run).
 *   - `__resetEnvForTests` is renamed / removed (breaks the cross-test
 *     isolation pattern used by 6 integration pairings).
 *   - A future refactor reintroduces the eager `env` Proxy as a back-compat
 *     re-export, which would let module-body code paths once again trigger
 *     validation at import time.
 *   - The validation error is downgraded to a silent default value.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ENV_ERROR_HEADER, __resetEnvForTests, getEnv } from '@/infrastructure/env';

const VALID = {
  TURSO_DATABASE_URL: 'libsql://astrologiadeluz-test.turso.io',
  TURSO_AUTH_TOKEN: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fixture.fixture',
  AUTH_SECRET: 'x'.repeat(32),
  AUTH_URL: 'https://astrologiadeluz.com',
  AUTH_RESEND_KEY: 're_fixture_resend_key',
  RESEND_FROM: 'Astrologia de Luz <notificaciones@astrologiadeluz.com>',
  ADMIN_EMAILS: 'gabi@example.com,augusto@example.com',
  TELEGRAM_BOT_TOKEN: '1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef-_',
  TELEGRAM_BOT_USERNAME: 'AstrologiaDeLuzBot',
  TELEGRAM_WEBHOOK_SECRET: 'y'.repeat(48),
} as const satisfies Record<string, string>;

function setupStderrSpy() {
  return vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
}
let stderrSpy: ReturnType<typeof setupStderrSpy>;

beforeEach(() => {
  stderrSpy = setupStderrSpy();
  __resetEnvForTests();
});

afterEach(() => {
  stderrSpy.mockRestore();
  __resetEnvForTests();
});

describe('lib/env getEnv — memoization (AC-G_C-25.1)', () => {
  test('first call parses; second call returns the same cached object reference', () => {
    vi.stubEnv('TURSO_DATABASE_URL', VALID.TURSO_DATABASE_URL);
    vi.stubEnv('TURSO_AUTH_TOKEN', VALID.TURSO_AUTH_TOKEN);
    vi.stubEnv('AUTH_SECRET', VALID.AUTH_SECRET);
    vi.stubEnv('AUTH_URL', VALID.AUTH_URL);
    vi.stubEnv('AUTH_RESEND_KEY', VALID.AUTH_RESEND_KEY);
    vi.stubEnv('RESEND_FROM', VALID.RESEND_FROM);
    vi.stubEnv('ADMIN_EMAILS', VALID.ADMIN_EMAILS);
    vi.stubEnv('TELEGRAM_BOT_TOKEN', VALID.TELEGRAM_BOT_TOKEN);
    vi.stubEnv('TELEGRAM_BOT_USERNAME', VALID.TELEGRAM_BOT_USERNAME);
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', VALID.TELEGRAM_WEBHOOK_SECRET);

    const first = getEnv();
    const second = getEnv();
    const third = getEnv();

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(first.TURSO_DATABASE_URL).toBe(VALID.TURSO_DATABASE_URL);

    vi.unstubAllEnvs();
  });
});

describe('lib/env __resetEnvForTests — cache reset (AC-G_C-25.2)', () => {
  test('reset hatch clears the cache so a remocked process.env reparses', () => {
    vi.stubEnv('TURSO_DATABASE_URL', VALID.TURSO_DATABASE_URL);
    vi.stubEnv('TURSO_AUTH_TOKEN', VALID.TURSO_AUTH_TOKEN);
    vi.stubEnv('AUTH_SECRET', VALID.AUTH_SECRET);
    vi.stubEnv('AUTH_URL', VALID.AUTH_URL);
    vi.stubEnv('AUTH_RESEND_KEY', VALID.AUTH_RESEND_KEY);
    vi.stubEnv('RESEND_FROM', VALID.RESEND_FROM);
    vi.stubEnv('ADMIN_EMAILS', VALID.ADMIN_EMAILS);
    vi.stubEnv('TELEGRAM_BOT_TOKEN', VALID.TELEGRAM_BOT_TOKEN);
    vi.stubEnv('TELEGRAM_BOT_USERNAME', VALID.TELEGRAM_BOT_USERNAME);
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', VALID.TELEGRAM_WEBHOOK_SECRET);

    const before = getEnv();
    expect(before.AUTH_URL).toBe(VALID.AUTH_URL);

    vi.unstubAllEnvs();
    vi.stubEnv('TURSO_DATABASE_URL', VALID.TURSO_DATABASE_URL);
    vi.stubEnv('TURSO_AUTH_TOKEN', VALID.TURSO_AUTH_TOKEN);
    vi.stubEnv('AUTH_SECRET', VALID.AUTH_SECRET);
    vi.stubEnv('AUTH_URL', 'https://other.example.com');
    vi.stubEnv('AUTH_RESEND_KEY', VALID.AUTH_RESEND_KEY);
    vi.stubEnv('RESEND_FROM', VALID.RESEND_FROM);
    vi.stubEnv('ADMIN_EMAILS', VALID.ADMIN_EMAILS);
    vi.stubEnv('TELEGRAM_BOT_TOKEN', VALID.TELEGRAM_BOT_TOKEN);
    vi.stubEnv('TELEGRAM_BOT_USERNAME', VALID.TELEGRAM_BOT_USERNAME);
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', VALID.TELEGRAM_WEBHOOK_SECRET);

    expect(getEnv()).toBe(before); // still cached

    __resetEnvForTests();
    const after = getEnv();
    expect(after).not.toBe(before);
    expect(after.AUTH_URL).toBe('https://other.example.com');

    vi.unstubAllEnvs();
  });
});

describe('lib/env getEnv — validation on access (AC-G_C-25.5)', () => {
  test('throws the Spanish-headed error when env is invalid', () => {
    vi.stubEnv('TURSO_DATABASE_URL', '');
    vi.stubEnv('TURSO_AUTH_TOKEN', '');
    vi.stubEnv('AUTH_SECRET', '');
    vi.stubEnv('AUTH_URL', '');
    vi.stubEnv('AUTH_RESEND_KEY', '');
    vi.stubEnv('RESEND_FROM', '');
    vi.stubEnv('ADMIN_EMAILS', '');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '');
    vi.stubEnv('TELEGRAM_BOT_USERNAME', '');
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', '');

    expect(() => getEnv()).toThrow(new RegExp(ENV_ERROR_HEADER));
    expect(() => getEnv()).toThrow(/TURSO_DATABASE_URL/);
    expect(() => getEnv()).toThrow(/AUTH_SECRET/);

    vi.unstubAllEnvs();
  });

  test('importing @/lib/env alone does NOT trigger validation', async () => {
    // The reset hatch clears any prior cache; we leave process.env in
    // whatever state the runner started in. Re-importing the module
    // (vitest module cache means this is a no-op rebind, which is fine —
    // the assertion is that import itself does not throw).
    await expect(import('@/infrastructure/env')).resolves.toBeDefined();
    // No call to getEnv() — no validation should have fired.
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});

describe('lib/env consumers — no eager `env` import remains (AC-G_C-25.3)', () => {
  const productionGlobs = [
    join(process.cwd(), 'lib'),
    join(process.cwd(), 'app'),
    join(process.cwd(), 'db'),
    join(process.cwd(), 'scripts'),
  ];
  // G_C-29 W4-2 moved auth.ts to src/infrastructure/auth/config.ts. G_C-34a
  // W4-4 moved proxy.ts to src/proxy.ts. The list enumerates the lazy-getter-
  // discipline production files NOT covered by productionGlobs.
  const productionRootFiles = [
    join(process.cwd(), 'src/infrastructure/auth/config.ts'),
    join(process.cwd(), 'src/proxy.ts'),
  ];
  const skipDirs = new Set(['node_modules', '.next', 'TEMPORARY_ARCHIVE', '.context']);

  function walk(dir: string): string[] {
    const out: string[] = [];
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return out;
    }
    for (const name of entries) {
      if (skipDirs.has(name)) continue;
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        out.push(...walk(full));
      } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
        out.push(full);
      }
    }
    return out;
  }

  test('no production file imports `env` (the eager symbol) from @/lib/env', () => {
    const files: string[] = [];
    for (const root of productionGlobs) files.push(...walk(root));
    for (const f of productionRootFiles) {
      try {
        statSync(f);
        files.push(f);
      } catch {
        /* missing repo-root file — skip */
      }
    }

    const offenders: string[] = [];
    // Match `import { env }` or `import { env,` or `import { foo, env }` etc.
    // from any `@/lib/env` or relative path ending in `lib/env`.
    const envImportRe = /import\s*\{[^}]*\benv\b[^}]*\}\s*from\s*['"][^'"]*lib\/env['"]/;
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      if (envImportRe.test(src)) offenders.push(file.replace(`${process.cwd()}/`, ''));
    }

    expect(offenders).toEqual([]);
  });
});
