/**
 * G_B-1 unit pairing — `signIn` callback allowlist semantics (AC-2.4.3 +
 * AC-1.3.2).
 *
 * The callback is the load-bearing predicate keeping the admin panel
 * single-tenant: on-list emails sign in, off-list emails are bounced
 * (anti-enumeration is then preserved by Auth.js's framework default — that
 * leg is covered by the integration sister-test). This file asserts the
 * predicate is correct in isolation, across every input axis that could let
 * an attacker either smuggle past the gate OR get a different response than
 * a legitimate user.
 *
 * Fails when:
 *   - `parseAdminAllowlist` drops the lowercase fold and a `User@Example.com`
 *     entry stops matching `user@example.com` (case-mismatch bypass).
 *   - Whitespace handling regresses and `" admin@a.com "` no longer matches
 *     `admin@a.com` (env-var copy-paste accidents).
 *   - `filter(Boolean)` is removed and the empty string slips into the list —
 *     a `""` entry would then match `isAdminEmail("", "")` and grant access
 *     to a no-email caller (catastrophic regression).
 *   - `isAdminEmail(null/undefined/"", anything)` ever returns true (the
 *     empty-email defence has to come before the allowlist lookup).
 *   - A future "simplification" inlines the helpers + breaks the contract.
 */

import { describe, expect, test } from 'vitest';

import { isAdminEmail, parseAdminAllowlist } from '@/lib/auth/allowlist';

describe('parseAdminAllowlist — env-string → normalized list', () => {
  test('returns [] for nullish input (defensive default)', () => {
    expect(parseAdminAllowlist(null)).toEqual([]);
    expect(parseAdminAllowlist(undefined)).toEqual([]);
  });

  test('returns [] for an empty string + a whitespace-only string', () => {
    expect(parseAdminAllowlist('')).toEqual([]);
    expect(parseAdminAllowlist('   ')).toEqual([]);
    expect(parseAdminAllowlist(',,,')).toEqual([]);
  });

  test('lowercases every entry (case-mismatch bypass guard)', () => {
    expect(parseAdminAllowlist('Admin@Example.COM,SECOND@example.com')).toEqual([
      'admin@example.com',
      'second@example.com',
    ]);
  });

  test('trims surrounding whitespace on each entry', () => {
    expect(parseAdminAllowlist(' a@x.test , b@y.test ,c@z.test  ')).toEqual([
      'a@x.test',
      'b@y.test',
      'c@z.test',
    ]);
  });

  test('drops empty segments — no `""` entry can leak into the allowlist', () => {
    expect(parseAdminAllowlist(',admin@a.test,,gabi@b.test,')).toEqual([
      'admin@a.test',
      'gabi@b.test',
    ]);
    // The catastrophic case: a `""` entry in the list would make
    // isAdminEmail("", ",,,") return true. The filter(Boolean) closes it.
    expect(parseAdminAllowlist(',,,').includes('')).toBe(false);
  });

  test('preserves order from the env-var (auditable: first email = brand owner)', () => {
    expect(parseAdminAllowlist('augusto@a.test,gabi@b.test,visitor@c.test')).toEqual([
      'augusto@a.test',
      'gabi@b.test',
      'visitor@c.test',
    ]);
  });
});

describe('isAdminEmail — allowlist predicate', () => {
  const ALLOW = 'augusto@a.test, gabi@b.test , Third@C.Test';

  test('returns true for an exact on-list match', () => {
    expect(isAdminEmail('augusto@a.test', ALLOW)).toBe(true);
    expect(isAdminEmail('gabi@b.test', ALLOW)).toBe(true);
  });

  test('returns true for case-folded matches in both axes', () => {
    expect(isAdminEmail('Augusto@A.Test', ALLOW)).toBe(true);
    // The third entry already has uppercase chars in the allowlist string —
    // confirms the fold runs on both sides.
    expect(isAdminEmail('third@c.test', ALLOW)).toBe(true);
    expect(isAdminEmail('THIRD@C.TEST', ALLOW)).toBe(true);
  });

  test('returns false for an off-list address (anti-enum gate)', () => {
    expect(isAdminEmail('attacker@evil.test', ALLOW)).toBe(false);
    // A near-miss — substring of an on-list address must NOT match.
    expect(isAdminEmail('augusto@a.tes', ALLOW)).toBe(false);
    expect(isAdminEmail('augusto@a.testx', ALLOW)).toBe(false);
  });

  test('returns false for an empty / nullish email (regardless of allowlist)', () => {
    expect(isAdminEmail('', ALLOW)).toBe(false);
    expect(isAdminEmail(null, ALLOW)).toBe(false);
    expect(isAdminEmail(undefined, ALLOW)).toBe(false);
    // The catastrophic case: even an allowlist that happens to contain an
    // empty segment (which parseAdminAllowlist already strips) MUST NOT
    // grant access to an empty-email caller.
    expect(isAdminEmail('', ',,,')).toBe(false);
    expect(isAdminEmail(null, ',,,')).toBe(false);
  });

  test('returns false when the allowlist is empty / nullish', () => {
    expect(isAdminEmail('augusto@a.test', '')).toBe(false);
    expect(isAdminEmail('augusto@a.test', null)).toBe(false);
    expect(isAdminEmail('augusto@a.test', undefined)).toBe(false);
  });

  test('single-entry allowlist works exactly like a multi-entry one', () => {
    expect(isAdminEmail('only@admin.test', 'only@admin.test')).toBe(true);
    expect(isAdminEmail('other@admin.test', 'only@admin.test')).toBe(false);
  });
});
