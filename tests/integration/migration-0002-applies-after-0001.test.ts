/**
 * G_C-2b integration pairing — apply `src/infrastructure/db/migrations/0000_init.sql` →
 * `0001_authjs.sql` → `0002_cp3_tables.sql` in order against an in-memory
 * libSQL database and exercise the load-bearing constraints end-to-end.
 *
 * BEHAVIOURAL counterpart to the introspection sister-test
 * `tests/unit/schema-cp3-tables.test.ts`.
 *
 * Fails when:
 *   - The 0002 migration is missing, unparseable, or any DDL statement is
 *     rejected by libSQL (regression-guard against `IF NOT EXISTS` drift, FK
 *     target rename, etc.).
 *   - notify_log.session_id FK weakens off CASCADE (deleting a session would
 *     leave orphan log rows — but the spec says the log is derivative).
 *   - teacher_onboarding_tokens.teacher_id FK weakens off CASCADE.
 *   - notify_log_event_kind_check is widened/loosened (a malformed dispatch
 *     kind would silently land in the log).
 *   - notify_log_channel_check admits a third value (silent dispatch-channel
 *     drift — would require an explicit migration to widen).
 *   - rate_limit_buckets PK is not composite — a second INSERT with the same
 *     (ip, hour_bucket) pair must conflict.
 *   - teacher_onboarding_tokens.created_at default does not auto-populate when
 *     omitted from the INSERT (AC-3.7.1 — the webhook handler relies on this).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Client, createClient } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const MIGRATIONS_DIR = resolve(__dirname, '..', '..', 'src', 'infrastructure', 'db', 'migrations');
const read = (name: string) => readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');

const ORDERED_MIGRATIONS = ['0000_init.sql', '0001_authjs.sql', '0002_cp3_tables.sql'];

const splitStatements = (sql: string): string[] =>
  sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const applyAllMigrations = async (client: Client) => {
  // FKs must be ON per-connection on libSQL — without this, the CASCADE
  // assertions below silently no-op and the test would falsely pass.
  await client.execute('PRAGMA foreign_keys = ON');
  for (const file of ORDERED_MIGRATIONS) {
    for (const statement of splitStatements(read(file))) {
      await client.execute(statement);
    }
  }
};

const TEACHER_ID = 't-augusto';
const SESSION_ID = 's-1';

const seedTeacherAndSession = async (client: Client) => {
  await client.execute({
    sql: `INSERT INTO teachers (id, slug, name, email, bio, telegram_chat_id,
            availability, avatar_url, timezone, active, created_at, updated_at)
          VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL, ?, 1, ?, ?)`,
    args: [
      TEACHER_ID,
      'augusto-rocha',
      'Augusto Rocha',
      'augusto@example.test',
      '{"tz":null,"windows":[],"blackouts":[]}',
      'America/Argentina/Buenos_Aires',
      1_700_000_000_000,
      1_700_000_000_000,
    ],
  });
  await client.execute({
    sql: `INSERT INTO sessions (id, teacher_id, starts_at_utc, duration_minutes, status,
            visitor_name, visitor_email, contact_pref, contact_value,
            visitor_intent, visitor_timezone, notes_internal, decided_at,
            created_at, updated_at)
          VALUES (?, ?, ?, 60, 'pending', ?, ?, 'email', ?, NULL, NULL, NULL, NULL, ?, ?)`,
    args: [
      SESSION_ID,
      TEACHER_ID,
      1_710_000_000_000,
      'Visitante de Prueba',
      'visitor@example.test',
      'visitor@example.test',
      1_700_000_000_000,
      1_700_000_000_000,
    ],
  });
};

const insertNotifyLog = (
  client: Client,
  overrides: Partial<{
    id: string;
    session_id: string;
    event_kind: string;
    channel: string;
    recipient: string;
    status: number;
    error_body: string | null;
    attempt_number: number;
    created_at: number;
  }> = {},
) => {
  const row = {
    id: 'log-1',
    session_id: SESSION_ID,
    event_kind: 'visitor_receipt',
    channel: 'resend',
    recipient: 'visitor@example.test',
    status: 500,
    error_body: 'upstream timeout',
    attempt_number: 1,
    created_at: 1_700_000_000_000,
    ...overrides,
  };
  return client.execute({
    sql: `INSERT INTO notify_log (id, session_id, event_kind, channel, recipient,
            status, error_body, attempt_number, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      row.id,
      row.session_id,
      row.event_kind,
      row.channel,
      row.recipient,
      row.status,
      row.error_body,
      row.attempt_number,
      row.created_at,
    ],
  });
};

let client: Client;

beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await applyAllMigrations(client);
});

afterEach(() => {
  client.close();
});

describe('migration 0002_cp3_tables.sql — table shape (sqlite_master)', () => {
  test('all 3 CP-3 tables exist alongside the prior CP-2/CP-2a/G_C-3 tables', async () => {
    const result = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const names = result.rows.map((r) => r.name as string);
    for (const t of [
      'teachers',
      'sessions',
      'user',
      'account',
      'session',
      'verificationToken',
      'notify_log',
      'teacher_onboarding_tokens',
      'rate_limit_buckets',
    ]) {
      expect(names).toContain(t);
    }
  });

  test('`notify_log` exposes all 9 columns from AC-3.3.1', async () => {
    const result = await client.execute('PRAGMA table_info(notify_log)');
    const names = result.rows.map((r) => r.name as string).sort();
    expect(names).toEqual(
      [
        'id',
        'session_id',
        'event_kind',
        'channel',
        'recipient',
        'status',
        'error_body',
        'attempt_number',
        'created_at',
      ].sort(),
    );
  });

  test('`teacher_onboarding_tokens` exposes all 5 columns from AC-3.7.1', async () => {
    const result = await client.execute('PRAGMA table_info(teacher_onboarding_tokens)');
    const names = result.rows.map((r) => r.name as string).sort();
    expect(names).toEqual(
      ['token', 'teacher_id', 'expires_at', 'consumed_at', 'created_at'].sort(),
    );
  });

  test('`rate_limit_buckets` exposes all 3 columns from AC-3.5.3', async () => {
    const result = await client.execute('PRAGMA table_info(rate_limit_buckets)');
    const names = result.rows.map((r) => r.name as string).sort();
    expect(names).toEqual(['ip', 'hour_bucket', 'count'].sort());
  });
});

describe('AC-3.3.1 — `notify_log` constraints + cascade behaviour', () => {
  test('a valid insert succeeds + the row is queryable', async () => {
    await seedTeacherAndSession(client);
    await insertNotifyLog(client);
    const result = await client.execute('SELECT id, event_kind, channel, status FROM notify_log');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.event_kind).toBe('visitor_receipt');
    expect(result.rows[0]?.channel).toBe('resend');
  });

  test('event_kind outside the AC-3.2.6 enum is rejected (CHECK constraint)', async () => {
    await seedTeacherAndSession(client);
    await expect(insertNotifyLog(client, { event_kind: 'visitor_reminder' })).rejects.toThrow(
      /CHECK|constraint/i,
    );
  });

  test('channel outside `telegram`/`resend` is rejected (CHECK constraint)', async () => {
    await seedTeacherAndSession(client);
    await expect(insertNotifyLog(client, { channel: 'whatsapp' })).rejects.toThrow(
      /CHECK|constraint/i,
    );
  });

  test('insert with an unknown session_id fails the FK', async () => {
    await seedTeacherAndSession(client);
    await expect(
      insertNotifyLog(client, { id: 'log-orphan', session_id: 's-does-not-exist' }),
    ).rejects.toThrow(/FOREIGN KEY|constraint/i);
  });

  test('DELETE on sessions CASCADES the log row away (AC-3.3.1 closing paragraph)', async () => {
    await seedTeacherAndSession(client);
    await insertNotifyLog(client);

    const before = await client.execute('SELECT count(*) AS n FROM notify_log');
    expect(before.rows[0]?.n).toBe(1);

    await client.execute({
      sql: 'DELETE FROM sessions WHERE id = ?',
      args: [SESSION_ID],
    });

    const after = await client.execute('SELECT count(*) AS n FROM notify_log');
    expect(after.rows[0]?.n).toBe(0);
  });

  test('error_body accepts NULL (the spec marks it NULLABLE for thrown-error cases)', async () => {
    await seedTeacherAndSession(client);
    await expect(
      insertNotifyLog(client, { id: 'log-thrown', error_body: null }),
    ).resolves.toBeDefined();
  });
});

describe('AC-3.7.1 — `teacher_onboarding_tokens` constraints + defaults', () => {
  test('insert without created_at populates it via the (unixepoch() * 1000) default', async () => {
    await seedTeacherAndSession(client);
    await client.execute({
      sql: `INSERT INTO teacher_onboarding_tokens (token, teacher_id, expires_at, consumed_at)
            VALUES (?, ?, ?, NULL)`,
      args: ['tok-1', TEACHER_ID, 1_710_086_400_000],
    });
    const result = await client.execute('SELECT created_at FROM teacher_onboarding_tokens');
    const createdAt = result.rows[0]?.created_at as number;
    // The default fires at INSERT time on libSQL via unixepoch() — value is
    // seconds-since-epoch × 1000 = ms-since-epoch. Sanity-bound: positive,
    // bigger than mid-2024 ms (1_700_000_000_000), smaller than year-3000.
    expect(typeof createdAt).toBe('number');
    expect(createdAt).toBeGreaterThan(1_700_000_000_000);
    expect(createdAt).toBeLessThan(3_000_000_000_000_000);
  });

  test('token PK collision is rejected (single-use enforcement is server-side)', async () => {
    await seedTeacherAndSession(client);
    await client.execute({
      sql: `INSERT INTO teacher_onboarding_tokens (token, teacher_id, expires_at)
            VALUES (?, ?, ?)`,
      args: ['tok-dup', TEACHER_ID, 1_710_086_400_000],
    });
    await expect(
      client.execute({
        sql: `INSERT INTO teacher_onboarding_tokens (token, teacher_id, expires_at)
              VALUES (?, ?, ?)`,
        args: ['tok-dup', TEACHER_ID, 1_710_086_400_000],
      }),
    ).rejects.toThrow(/UNIQUE|constraint/i);
  });

  test('DELETE on teachers CASCADES the onboarding tokens away', async () => {
    await seedTeacherAndSession(client);
    await client.execute({
      sql: `INSERT INTO teacher_onboarding_tokens (token, teacher_id, expires_at)
            VALUES (?, ?, ?)`,
      args: ['tok-2', TEACHER_ID, 1_710_086_400_000],
    });

    // teachers FK on sessions is RESTRICT — so the teacher cannot be deleted
    // while a session row exists. Clear the session first.
    await client.execute({ sql: 'DELETE FROM sessions WHERE id = ?', args: [SESSION_ID] });
    await client.execute({ sql: 'DELETE FROM teachers WHERE id = ?', args: [TEACHER_ID] });

    const result = await client.execute('SELECT count(*) AS n FROM teacher_onboarding_tokens');
    expect(result.rows[0]?.n).toBe(0);
  });

  test('insert with an unknown teacher_id fails the FK', async () => {
    await expect(
      client.execute({
        sql: `INSERT INTO teacher_onboarding_tokens (token, teacher_id, expires_at)
              VALUES (?, ?, ?)`,
        args: ['tok-orphan', 't-does-not-exist', 1_710_086_400_000],
      }),
    ).rejects.toThrow(/FOREIGN KEY|constraint/i);
  });
});

describe('AC-3.5.3 — `rate_limit_buckets` composite PK + count default', () => {
  test('a second INSERT on the same (ip, hour_bucket) conflicts', async () => {
    await client.execute({
      sql: 'INSERT INTO rate_limit_buckets (ip, hour_bucket) VALUES (?, ?)',
      args: ['1.2.3.4', 471_000],
    });
    await expect(
      client.execute({
        sql: 'INSERT INTO rate_limit_buckets (ip, hour_bucket) VALUES (?, ?)',
        args: ['1.2.3.4', 471_000],
      }),
    ).rejects.toThrow(/UNIQUE|constraint/i);
  });

  test('same IP, DIFFERENT hour_bucket is permitted (one bucket per hour)', async () => {
    await client.execute({
      sql: 'INSERT INTO rate_limit_buckets (ip, hour_bucket) VALUES (?, ?)',
      args: ['1.2.3.4', 471_000],
    });
    await expect(
      client.execute({
        sql: 'INSERT INTO rate_limit_buckets (ip, hour_bucket) VALUES (?, ?)',
        args: ['1.2.3.4', 471_001],
      }),
    ).resolves.toBeDefined();
  });

  test('count default is 1 on a fresh INSERT that omits the column', async () => {
    await client.execute({
      sql: 'INSERT INTO rate_limit_buckets (ip, hour_bucket) VALUES (?, ?)',
      args: ['9.9.9.9', 500_000],
    });
    const result = await client.execute(
      "SELECT count FROM rate_limit_buckets WHERE ip = '9.9.9.9'",
    );
    expect(result.rows[0]?.count).toBe(1);
  });

  test('INSERT ... ON CONFLICT DO UPDATE bumps the count (AC-3.5.3 dispatch path)', async () => {
    // libSQL upsert syntax — the rate-limit handler in G_C-17 uses this exact
    // shape against the production DB; this test verifies the table accepts
    // it. If the PK regressed to a single column, the upsert would no-op
    // and `count` would stay at 1.
    for (let i = 0; i < 3; i++) {
      await client.execute({
        sql: `INSERT INTO rate_limit_buckets (ip, hour_bucket) VALUES (?, ?)
              ON CONFLICT(ip, hour_bucket) DO UPDATE SET count = count + 1`,
        args: ['7.7.7.7', 600_000],
      });
    }
    const result = await client.execute(
      "SELECT count FROM rate_limit_buckets WHERE ip = '7.7.7.7'",
    );
    expect(result.rows[0]?.count).toBe(3);
  });
});
