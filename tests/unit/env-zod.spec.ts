/**
 * G_C-6 pairing — env zod boundary (AC-2.6.1 + AC-2.6.2 + AC-3.9).
 *
 * Asserts that parseEnv rejects every required key independently, that format
 * constraints (length, URL, prefix, regex, email-list) all fail with the
 * offending key cited in the Spanish-headed message, and that a fully-populated
 * env returns a narrowed string for every field.
 *
 * These assertions FAIL when:
 *   - A required env var is silently downgraded to optional in lib/env.ts.
 *   - A future "validation cleanup" PR drops a format constraint (e.g. removes
 *     the `re_` prefix check) and a malformed key slips through to runtime.
 *   - The error header is translated back to English or split into per-key
 *     throws (which would hide co-occurring failures).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ENV_ERROR_HEADER, parseEnv } from '@/infrastructure/env';

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

type EnvKey = keyof typeof VALID;
const REQUIRED_KEYS = Object.keys(VALID) as EnvKey[];

// vitest 2.1's `MockInstance<T>` generic is contravariant on `T`, so neither
// the default `ReturnType<typeof vi.spyOn>` nor the parameterised
// `vi.spyOn<typeof process.stderr, 'write'>` accepts the overloaded
// `write` signature cleanly (the `'write'` literal does not satisfy the
// constraint of `vi.spyOn`'s second generic — process.stderr's TS shape
// publishes the data-property keys, not the function-method keys, in that
// constraint). The minimal-friction workaround is a setup-helper whose
// inferred `ReturnType` IS the concrete mock — TS resolves the overload at
// the helper's call site rather than at the variable declaration.
function setupStderrSpy() {
  return vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
}
let stderrSpy: ReturnType<typeof setupStderrSpy>;

beforeEach(() => {
  stderrSpy = setupStderrSpy();
});

afterEach(() => {
  stderrSpy.mockRestore();
});

describe('lib/env parseEnv — happy path', () => {
  test('returns every required key as a narrowed string when input is valid', () => {
    const env = parseEnv({ ...VALID });
    for (const key of REQUIRED_KEYS) {
      expect(env[key]).toBe(VALID[key]);
      expect(typeof env[key]).toBe('string');
    }
    expect(Object.keys(env).sort()).toEqual([...REQUIRED_KEYS].sort());
  });

  test('extra unknown env vars are stripped from the parsed env object', () => {
    const env = parseEnv({ ...VALID, RANDOM_NOISE: 'ignored' });
    expect((env as Record<string, unknown>).RANDOM_NOISE).toBeUndefined();
  });
});

describe('lib/env parseEnv — every required key triggers its own narrowed error', () => {
  test.each(REQUIRED_KEYS)('missing %s is rejected with the key in the Spanish error', (key) => {
    const { [key]: _omitted, ...rest } = VALID;
    expect(() => parseEnv(rest)).toThrow(new RegExp(ENV_ERROR_HEADER));
    expect(() => parseEnv(rest)).toThrow(new RegExp(key));
  });

  test.each(REQUIRED_KEYS)('empty %s is rejected with the key in the Spanish error', (key) => {
    const broken = { ...VALID, [key]: '' };
    expect(() => parseEnv(broken)).toThrow(new RegExp(ENV_ERROR_HEADER));
    expect(() => parseEnv(broken)).toThrow(new RegExp(key));
  });
});

describe('lib/env parseEnv — format constraints', () => {
  test('AUTH_SECRET below 32 chars is rejected and key is cited', () => {
    expect(() => parseEnv({ ...VALID, AUTH_SECRET: 'x'.repeat(31) })).toThrow(/AUTH_SECRET/);
  });

  test('AUTH_URL non-URL is rejected and key is cited', () => {
    expect(() => parseEnv({ ...VALID, AUTH_URL: 'definitely-not-a-url' })).toThrow(/AUTH_URL/);
  });

  test('AUTH_RESEND_KEY without re_ prefix is rejected and key is cited', () => {
    expect(() => parseEnv({ ...VALID, AUTH_RESEND_KEY: 'abc_no_prefix' })).toThrow(
      /AUTH_RESEND_KEY/,
    );
  });

  test('TELEGRAM_BOT_TOKEN missing colon-segment is rejected and key is cited', () => {
    expect(() => parseEnv({ ...VALID, TELEGRAM_BOT_TOKEN: 'no-colon-here' })).toThrow(
      /TELEGRAM_BOT_TOKEN/,
    );
  });

  test('TELEGRAM_BOT_TOKEN with non-numeric prefix is rejected', () => {
    expect(() => parseEnv({ ...VALID, TELEGRAM_BOT_TOKEN: 'abc:token' })).toThrow(
      /TELEGRAM_BOT_TOKEN/,
    );
  });

  test('TELEGRAM_WEBHOOK_SECRET below 32 chars is rejected and key is cited', () => {
    expect(() => parseEnv({ ...VALID, TELEGRAM_WEBHOOK_SECRET: 'too-short' })).toThrow(
      /TELEGRAM_WEBHOOK_SECRET/,
    );
  });

  test('ADMIN_EMAILS with one malformed entry rejects the whole value', () => {
    expect(() => parseEnv({ ...VALID, ADMIN_EMAILS: 'gabi@example.com,not-an-email' })).toThrow(
      /ADMIN_EMAILS/,
    );
  });

  test('ADMIN_EMAILS with a single valid email is accepted', () => {
    const env = parseEnv({ ...VALID, ADMIN_EMAILS: 'only@example.com' });
    expect(env.ADMIN_EMAILS).toBe('only@example.com');
  });
});

describe('lib/env parseEnv — error aggregation + stderr side-effect', () => {
  test('multiple missing keys are all enumerated in a single throw', () => {
    const { TURSO_DATABASE_URL: _a, AUTH_SECRET: _b, ...rest } = VALID;
    expect(() => parseEnv(rest)).toThrow(/TURSO_DATABASE_URL/);
    expect(() => parseEnv(rest)).toThrow(/AUTH_SECRET/);
    expect(() => parseEnv(rest)).toThrow(new RegExp(ENV_ERROR_HEADER));
  });

  test('failure path writes the same Spanish message to stderr before throwing', () => {
    expect(() => parseEnv({})).toThrow();
    expect(stderrSpy).toHaveBeenCalled();
    const calls = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(calls).toContain(ENV_ERROR_HEADER);
    expect(calls).toContain('TURSO_DATABASE_URL');
    expect(calls).toContain('TELEGRAM_BOT_TOKEN');
  });

  test('success path does NOT write to stderr', () => {
    parseEnv({ ...VALID });
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
