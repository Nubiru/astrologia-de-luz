/**
 * G_C-2a unit pairing — Drizzle schema introspection for `teachers` + `sessions`.
 *
 * The set of assertions below fails when:
 *   - A column is dropped, renamed, retyped, or its nullability/default flipped.
 *   - The partial-unique WHERE-clause is reverted from the raw `sql` literal back
 *     to `eq()` — the serialized DDL would contain a `?` placeholder instead of
 *     the literal `status = 'confirmed'`, regressing Drizzle bug #4790
 *     (see S-1 AC-2.2.2).
 *   - The 3 secondary indexes (AC-2.2.3) are dropped, renamed, or repointed.
 *   - The `teacher_id` FK's onDelete is weakened from `restrict` to `cascade`,
 *     `set null`, or no-action (AC-2.2.6 defense-in-depth).
 *   - A status / contact_pref CHECK-constraint enum value is added/removed.
 *
 * Pure-introspection — no DB connection. The behavioural side
 * (does the partial-unique actually fire on libSQL?) is verified by the sister
 * pairing `tests/integration/migration-0000-applies.test.ts`.
 */

import { SQLiteSyncDialect, getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, test } from 'vitest';

import { sessions, teachers } from '@/infrastructure/db/schema';

const dialect = new SQLiteSyncDialect();
const teachersConfig = getTableConfig(teachers);
const sessionsConfig = getTableConfig(sessions);

const colByName = (cfg: typeof teachersConfig, name: string) =>
  cfg.columns.find((c) => c.name === name);

const renderSql = (s: unknown): string => {
  // `s` is a Drizzle SQL chunk; the sqlite dialect's sqlToQuery() serializes it
  // to the literal DDL string the migrator would emit.
  const { sql } = dialect.sqlToQuery(s as Parameters<typeof dialect.sqlToQuery>[0]);
  return sql;
};

describe('AC-2.1.1 — `teachers` table contract', () => {
  test('table name is exactly `teachers`', () => {
    expect(teachersConfig.name).toBe('teachers');
  });

  test.each([
    ['id', 'string', true, false],
    ['slug', 'string', true, false],
    ['name', 'string', true, false],
    ['email', 'string', true, false],
    ['bio', 'string', false, false],
    ['telegram_chat_id', 'string', false, false],
    ['availability', 'string', true, true],
    ['avatar_url', 'string', false, false],
    ['timezone', 'string', true, true],
    ['active', 'boolean', true, true],
    ['created_at', 'number', true, false],
    ['updated_at', 'number', true, false],
  ])('column `%s` is %s, notNull=%s, hasDefault=%s', (name, dataType, notNull, hasDefault) => {
    const col = colByName(teachersConfig, name);
    expect(col, `column ${name} missing from teachers schema`).toBeDefined();
    expect(col?.dataType).toBe(dataType);
    expect(col?.notNull).toBe(notNull);
    expect(col?.hasDefault).toBe(hasDefault);
  });

  test('`id` is the primary key', () => {
    expect(colByName(teachersConfig, 'id')?.primary).toBe(true);
  });

  test('`slug` is declared UNIQUE', () => {
    expect(colByName(teachersConfig, 'slug')?.isUnique).toBe(true);
  });

  test('`email` is declared UNIQUE', () => {
    expect(colByName(teachersConfig, 'email')?.isUnique).toBe(true);
  });

  test('`availability` default is the locked empty-windows JSON (D-017)', () => {
    expect(colByName(teachersConfig, 'availability')?.default).toBe(
      '{"tz":null,"windows":[],"blackouts":[]}',
    );
  });

  test('`timezone` default is `America/Argentina/Buenos_Aires` (D-008)', () => {
    expect(colByName(teachersConfig, 'timezone')?.default).toBe('America/Argentina/Buenos_Aires');
  });

  test('`active` default is true', () => {
    expect(colByName(teachersConfig, 'active')?.default).toBe(true);
  });
});

describe('AC-2.2.1 — `sessions` table contract', () => {
  test('table name is exactly `sessions`', () => {
    expect(sessionsConfig.name).toBe('sessions');
  });

  test.each([
    ['id', 'string', true, false],
    ['teacher_id', 'string', true, false],
    ['starts_at_utc', 'number', true, false],
    ['duration_minutes', 'number', true, true],
    ['status', 'string', true, true],
    ['visitor_name', 'string', true, false],
    ['visitor_email', 'string', true, false],
    ['contact_pref', 'string', true, false],
    ['contact_value', 'string', true, false],
    ['visitor_intent', 'string', false, false],
    ['visitor_timezone', 'string', false, false],
    ['notes_internal', 'string', false, false],
    ['decided_at', 'number', false, false],
    ['created_at', 'number', true, false],
    ['updated_at', 'number', true, false],
  ])('column `%s` is %s, notNull=%s, hasDefault=%s', (name, dataType, notNull, hasDefault) => {
    const col = colByName(sessionsConfig, name);
    expect(col, `column ${name} missing from sessions schema`).toBeDefined();
    expect(col?.dataType).toBe(dataType);
    expect(col?.notNull).toBe(notNull);
    expect(col?.hasDefault).toBe(hasDefault);
  });

  test('`id` is the primary key', () => {
    expect(colByName(sessionsConfig, 'id')?.primary).toBe(true);
  });

  test('`duration_minutes` default is 60', () => {
    expect(colByName(sessionsConfig, 'duration_minutes')?.default).toBe(60);
  });

  test('`status` default is `pending`', () => {
    expect(colByName(sessionsConfig, 'status')?.default).toBe('pending');
  });
});

describe('AC-2.2.6 — `sessions.teacher_id` FK is ON DELETE RESTRICT', () => {
  test('exactly one FK declared, pointing at teachers.id, onDelete=restrict', () => {
    expect(sessionsConfig.foreignKeys).toHaveLength(1);
    const fk = sessionsConfig.foreignKeys[0];
    if (!fk) throw new Error('expected exactly one FK on sessions');
    const ref = fk.reference();
    expect(ref.columns.map((c) => c.name)).toEqual(['teacher_id']);
    expect(ref.foreignColumns.map((c) => c.name)).toEqual(['id']);
    expect(ref.foreignTable).toBe(teachers);
    expect(fk.onDelete).toBe('restrict');
  });
});

describe('AC-2.2.1 — `sessions` CHECK constraints', () => {
  test('`sessions_status_check` enumerates the 6 allowed status values', () => {
    const check = sessionsConfig.checks.find((c) => c.name === 'sessions_status_check');
    expect(check, 'sessions_status_check constraint missing').toBeDefined();
    const ddl = renderSql(check?.value);
    expect(ddl).toContain("'pending'");
    expect(ddl).toContain("'confirmed'");
    expect(ddl).toContain("'cancelled'");
    expect(ddl).toContain("'rejected'");
    expect(ddl).toContain("'no_show'");
    expect(ddl).toContain("'completed'");
  });

  test('`sessions_contact_pref_check` enumerates 3 contact-preference values', () => {
    const check = sessionsConfig.checks.find((c) => c.name === 'sessions_contact_pref_check');
    expect(check, 'sessions_contact_pref_check constraint missing').toBeDefined();
    const ddl = renderSql(check?.value);
    expect(ddl).toContain("'email'");
    expect(ddl).toContain("'whatsapp'");
    expect(ddl).toContain("'phone'");
  });
});

describe('AC-2.2.2 — partial-unique index (Drizzle bug #4790 footgun)', () => {
  const partial = sessionsConfig.indexes.find(
    (i) => i.config.name === 'sessions_teacher_slot_confirmed',
  );

  test('the index is declared', () => {
    expect(partial, 'sessions_teacher_slot_confirmed missing').toBeDefined();
  });

  test('the index is UNIQUE', () => {
    expect(partial?.config.unique).toBe(true);
  });

  test('the index columns are (teacher_id, starts_at_utc) in order', () => {
    const cols = partial?.config.columns.map((c) => ('name' in c ? (c.name as string) : ''));
    expect(cols).toEqual(['teacher_id', 'starts_at_utc']);
  });

  test("the WHERE clause is the literal `status = 'confirmed'` (bug #4790 guard)", () => {
    // If a future contributor "improves" the WHERE to .where(eq(sessions.status,
    // 'confirmed')), Drizzle serializes the `confirmed` literal as a `?`
    // placeholder bound parameter — the DDL would contain `status = ?` and
    // SQLite would create a NON-partial index on every row. This assertion
    // fails the moment that regression lands.
    const where = renderSql(partial?.config.where);
    expect(where).toBe("status = 'confirmed'");
  });
});

describe('AC-2.2.3 — secondary indexes', () => {
  test('`sessions_status_created_idx` exists, columns (status, created_at), partial WHERE pending', () => {
    const idx = sessionsConfig.indexes.find((i) => i.config.name === 'sessions_status_created_idx');
    expect(idx, 'sessions_status_created_idx missing').toBeDefined();
    expect(idx?.config.unique).toBeFalsy();
    const cols = idx?.config.columns.map((c) => ('name' in c ? (c.name as string) : ''));
    expect(cols).toEqual(['status', 'created_at']);
    const where = renderSql(idx?.config.where);
    expect(where).toBe("status = 'pending'");
  });

  test('`sessions_teacher_starts_idx` exists, columns (teacher_id, starts_at_utc)', () => {
    const idx = sessionsConfig.indexes.find((i) => i.config.name === 'sessions_teacher_starts_idx');
    expect(idx, 'sessions_teacher_starts_idx missing').toBeDefined();
    expect(idx?.config.unique).toBeFalsy();
    const cols = idx?.config.columns.map((c) => ('name' in c ? (c.name as string) : ''));
    expect(cols).toEqual(['teacher_id', 'starts_at_utc']);
    expect(idx?.config.where).toBeUndefined();
  });

  test('`sessions_starts_idx` exists, single column (starts_at_utc)', () => {
    const idx = sessionsConfig.indexes.find((i) => i.config.name === 'sessions_starts_idx');
    expect(idx, 'sessions_starts_idx missing').toBeDefined();
    expect(idx?.config.unique).toBeFalsy();
    const cols = idx?.config.columns.map((c) => ('name' in c ? (c.name as string) : ''));
    expect(cols).toEqual(['starts_at_utc']);
    expect(idx?.config.where).toBeUndefined();
  });
});

describe('coverage of the index set (no orphan + no shadow)', () => {
  test('`sessions` declares exactly the 4 indexes (1 partial-unique + 3 secondary)', () => {
    const names = sessionsConfig.indexes.map((i) => i.config.name).sort();
    expect(names).toEqual(
      [
        'sessions_starts_idx',
        'sessions_status_created_idx',
        'sessions_teacher_slot_confirmed',
        'sessions_teacher_starts_idx',
      ].sort(),
    );
  });

  test('`teachers` declares no explicit indexes (uniqueness via column constraints)', () => {
    expect(teachersConfig.indexes).toHaveLength(0);
  });
});
