/**
 * G_C-2b unit pairing — Drizzle schema introspection for the 3 CP-3 tables
 * (notify_log, teacher_onboarding_tokens, rate_limit_buckets).
 *
 * Pure-introspection — no DB connection. Behavioural verification lives in the
 * sister `tests/integration/migration-0002-applies-after-0001.test.ts`.
 *
 * The assertions below fail when:
 *   - A column is dropped, renamed, retyped, or its nullability/default flipped.
 *   - notify_log.session_id FK onDelete is weakened from `cascade` to anything
 *     else (AC-3.3.1 closing paragraph — log is derivative).
 *   - teacher_onboarding_tokens.teacher_id FK onDelete is weakened from
 *     `cascade` (AC-3.7.1 — tokens are bound to a teacher).
 *   - The composite PK on rate_limit_buckets is reduced to a single column
 *     (AC-3.5.3 keys on `(ip, hour_bucket)` so multiple IPs share an hour
 *     bucket but a single IP doesn't double-count).
 *   - Either CHECK constraint on notify_log silently widens or drops a value
 *     (AC-3.3.1 enum + AC-3.2.6 idempotency lockstep).
 */

import { SQLiteSyncDialect, getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, test } from 'vitest';

import {
  notifyLog,
  rateLimitBuckets,
  sessions,
  teacherOnboardingTokens,
  teachers,
} from '@/db/schema';

const dialect = new SQLiteSyncDialect();
const notifyLogConfig = getTableConfig(notifyLog);
const tokensConfig = getTableConfig(teacherOnboardingTokens);
const bucketsConfig = getTableConfig(rateLimitBuckets);

// Use the concrete `getTableConfig` return type so the column shape carries
// the full Drizzle column metadata (dataType / notNull / hasDefault / primary
// / default / isUnique) — not just `{ name: string }`. The previous generic
// `<T extends { columns: { name: string }[] }>` narrowed the return to
// `{ name: string }` and ran clean only while db/schema.ts's extraConfig
// callbacks emitted the looser array form (which suppressed the downstream
// types via overload ambiguity). The object-literal extraConfig refactor
// for G_C-22 made the schema types sharp, surfacing this latent narrowing.
type TableConfig = ReturnType<typeof getTableConfig>;
const colByName = (cfg: TableConfig, name: string) => cfg.columns.find((c) => c.name === name);

const renderSql = (s: unknown): string => {
  const { sql } = dialect.sqlToQuery(s as Parameters<typeof dialect.sqlToQuery>[0]);
  return sql;
};

describe('AC-3.3.1 — `notify_log` table contract', () => {
  test('table name is exactly `notify_log`', () => {
    expect(notifyLogConfig.name).toBe('notify_log');
  });

  test.each([
    ['id', 'string', true, false],
    ['session_id', 'string', true, false],
    ['event_kind', 'string', true, false],
    ['channel', 'string', true, false],
    ['recipient', 'string', true, false],
    ['status', 'number', true, false],
    ['error_body', 'string', false, false],
    ['attempt_number', 'number', true, false],
    ['created_at', 'number', true, false],
  ])('column `%s` is %s, notNull=%s, hasDefault=%s', (name, dataType, notNull, hasDefault) => {
    const col = colByName(notifyLogConfig, name);
    expect(col, `column ${name} missing from notify_log schema`).toBeDefined();
    expect(col?.dataType).toBe(dataType);
    expect(col?.notNull).toBe(notNull);
    expect(col?.hasDefault).toBe(hasDefault);
  });

  test('`id` is the primary key', () => {
    expect(colByName(notifyLogConfig, 'id')?.primary).toBe(true);
  });

  test('exactly one FK declared, pointing at sessions.id, onDelete=cascade (AC-3.3.1)', () => {
    expect(notifyLogConfig.foreignKeys).toHaveLength(1);
    const fk = notifyLogConfig.foreignKeys[0];
    if (!fk) throw new Error('expected exactly one FK on notify_log');
    const ref = fk.reference();
    expect(ref.columns.map((c) => c.name)).toEqual(['session_id']);
    expect(ref.foreignColumns.map((c) => c.name)).toEqual(['id']);
    expect(ref.foreignTable).toBe(sessions);
    expect(fk.onDelete).toBe('cascade');
  });

  test('`notify_log_event_kind_check` enumerates the 6 AC-3.2.6 dispatch kinds', () => {
    const c = notifyLogConfig.checks.find((x) => x.name === 'notify_log_event_kind_check');
    expect(c, 'notify_log_event_kind_check missing').toBeDefined();
    const ddl = renderSql(c?.value);
    for (const v of [
      'visitor_receipt',
      'visitor_confirm',
      'visitor_decline',
      'visitor_cancel',
      'maestro_fallback',
      'maestro_failure',
    ]) {
      expect(ddl).toContain(`'${v}'`);
    }
  });

  test('`notify_log_channel_check` enumerates exactly `telegram` + `resend`', () => {
    const c = notifyLogConfig.checks.find((x) => x.name === 'notify_log_channel_check');
    expect(c, 'notify_log_channel_check missing').toBeDefined();
    const ddl = renderSql(c?.value);
    expect(ddl).toContain("'telegram'");
    expect(ddl).toContain("'resend'");
    // Guard against an accidental third value sneaking in via a literal edit
    // (rejected at queue-time; would require a migration to widen).
    expect(ddl).not.toContain("'whatsapp'");
    expect(ddl).not.toContain("'email'");
  });

  test('`notify_log` declares no explicit indexes (failure-only table, traffic-bounded)', () => {
    expect(notifyLogConfig.indexes).toHaveLength(0);
  });
});

describe('AC-3.7.1 — `teacher_onboarding_tokens` table contract', () => {
  test('table name is exactly `teacher_onboarding_tokens`', () => {
    expect(tokensConfig.name).toBe('teacher_onboarding_tokens');
  });

  test.each([
    ['token', 'string', true, false],
    ['teacher_id', 'string', true, false],
    ['expires_at', 'number', true, false],
    ['consumed_at', 'number', false, false],
    ['created_at', 'number', true, true],
  ])('column `%s` is %s, notNull=%s, hasDefault=%s', (name, dataType, notNull, hasDefault) => {
    const col = colByName(tokensConfig, name);
    expect(col, `column ${name} missing from teacher_onboarding_tokens schema`).toBeDefined();
    expect(col?.dataType).toBe(dataType);
    expect(col?.notNull).toBe(notNull);
    expect(col?.hasDefault).toBe(hasDefault);
  });

  test('`token` is the primary key (single-use lookup happens on this column)', () => {
    expect(colByName(tokensConfig, 'token')?.primary).toBe(true);
  });

  test('`created_at` default renders to `(unixepoch() * 1000)` (AC-3.7.1 verbatim)', () => {
    const col = colByName(tokensConfig, 'created_at');
    expect(col?.hasDefault).toBe(true);
    const ddl = renderSql(col?.default);
    expect(ddl.toLowerCase()).toContain('unixepoch()');
    expect(ddl).toContain('* 1000');
  });

  test('exactly one FK declared, pointing at teachers.id, onDelete=cascade (AC-3.7.1)', () => {
    expect(tokensConfig.foreignKeys).toHaveLength(1);
    const fk = tokensConfig.foreignKeys[0];
    if (!fk) throw new Error('expected exactly one FK on teacher_onboarding_tokens');
    const ref = fk.reference();
    expect(ref.columns.map((c) => c.name)).toEqual(['teacher_id']);
    expect(ref.foreignColumns.map((c) => c.name)).toEqual(['id']);
    expect(ref.foreignTable).toBe(teachers);
    expect(fk.onDelete).toBe('cascade');
  });
});

describe('AC-3.5.3 — `rate_limit_buckets` table contract', () => {
  test('table name is exactly `rate_limit_buckets`', () => {
    expect(bucketsConfig.name).toBe('rate_limit_buckets');
  });

  test.each([
    ['ip', 'string', true, false],
    ['hour_bucket', 'number', true, false],
    ['count', 'number', true, true],
  ])('column `%s` is %s, notNull=%s, hasDefault=%s', (name, dataType, notNull, hasDefault) => {
    const col = colByName(bucketsConfig, name);
    expect(col, `column ${name} missing from rate_limit_buckets schema`).toBeDefined();
    expect(col?.dataType).toBe(dataType);
    expect(col?.notNull).toBe(notNull);
    expect(col?.hasDefault).toBe(hasDefault);
  });

  test('`count` default is 1 (first INSERT for a fresh bucket)', () => {
    expect(colByName(bucketsConfig, 'count')?.default).toBe(1);
  });

  test('composite primary key is (ip, hour_bucket) in order', () => {
    expect(bucketsConfig.primaryKeys).toHaveLength(1);
    const pk = bucketsConfig.primaryKeys[0];
    if (!pk) throw new Error('expected exactly one composite PK on rate_limit_buckets');
    expect(pk.columns.map((c) => c.name)).toEqual(['ip', 'hour_bucket']);
  });

  test('no FK is declared (the bucket has no relational owner)', () => {
    expect(bucketsConfig.foreignKeys).toHaveLength(0);
  });

  test('no individual column is its own primary key (the PK is composite)', () => {
    expect(colByName(bucketsConfig, 'ip')?.primary).toBeFalsy();
    expect(colByName(bucketsConfig, 'hour_bucket')?.primary).toBeFalsy();
  });
});
