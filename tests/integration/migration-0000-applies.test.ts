/**
 * G_C-2a integration pairing — apply `src/infrastructure/db/migrations/0000_init.sql` against an
 * in-memory libSQL database and exercise the load-bearing constraints
 * end-to-end.
 *
 * This is the BEHAVIOURAL counterpart to the introspection sister-test
 * `tests/unit/schema-teachers-sessions.test.ts`. The sister test catches schema
 * drift at the Drizzle TS layer; this one catches it at the actual SQLite DDL
 * layer — including the class of bug (#4790) where a partial index silently
 * becomes a full index due to a placeholder substitution failure.
 *
 * Fails when:
 *   - The 0000_init.sql file is missing, unparseable, or any statement is
 *     rejected by libSQL.
 *   - The partial-unique index `sessions_teacher_slot_confirmed` was emitted
 *     as a full unique index (#4790 regression) — both pending rows would be
 *     refused on insert, but the spec permits any number of `pending` rows for
 *     the same slot. Only one `confirmed` is permitted.
 *   - The `teacher_id` FK is not `ON DELETE RESTRICT` (allowing the dependent
 *     teacher to be deleted while sessions exist).
 *   - The `sessions_status_check` CHECK constraint admits a value outside the
 *     6-element enum.
 *   - A secondary index promised by AC-2.2.3 is missing from sqlite_master.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Client, createClient } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const MIGRATION_PATH = resolve(
  __dirname,
  '..',
  '..',
  'src',
  'infrastructure',
  'db',
  'migrations',
  '0000_init.sql',
);
const MIGRATION_SQL = readFileSync(MIGRATION_PATH, 'utf8');

const splitStatements = (sql: string): string[] =>
  sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const applyMigration = async (client: Client) => {
  // libSQL requires PRAGMA foreign_keys = ON per-connection for FK enforcement
  // (SQLite legacy default is OFF). The application bootstraps this in the
  // Drizzle client factory; we replicate it here so the FK RESTRICT test is
  // meaningful.
  await client.execute('PRAGMA foreign_keys = ON');
  for (const statement of splitStatements(MIGRATION_SQL)) {
    await client.execute(statement);
  }
};

const TEACHER_ROW = {
  id: 't-augusto',
  slug: 'augusto-rocha',
  name: 'Augusto Rocha',
  email: 'augusto@example.test',
  bio: null as string | null,
  telegram_chat_id: null as string | null,
  availability: '{"tz":null,"windows":[],"blackouts":[]}',
  avatar_url: null as string | null,
  timezone: 'America/Argentina/Buenos_Aires',
  active: 1,
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
};

const insertTeacher = (client: Client, overrides: Partial<typeof TEACHER_ROW> = {}) => {
  const row = { ...TEACHER_ROW, ...overrides };
  return client.execute({
    sql: `INSERT INTO teachers
            (id, slug, name, email, bio, telegram_chat_id, availability,
             avatar_url, timezone, active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      row.id,
      row.slug,
      row.name,
      row.email,
      row.bio,
      row.telegram_chat_id,
      row.availability,
      row.avatar_url,
      row.timezone,
      row.active,
      row.created_at,
      row.updated_at,
    ],
  });
};

const SESSION_BASE = {
  duration_minutes: 60,
  status: 'pending',
  visitor_name: 'Visitante de Prueba',
  visitor_email: 'visitor@example.test',
  contact_pref: 'email',
  contact_value: 'visitor@example.test',
  visitor_intent: null as string | null,
  visitor_timezone: null as string | null,
  notes_internal: null as string | null,
  decided_at: null as number | null,
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
};

const insertSession = (
  client: Client,
  args: {
    id: string;
    teacher_id: string;
    starts_at_utc: number;
    status?: string;
  },
) => {
  const row = { ...SESSION_BASE, ...args };
  return client.execute({
    sql: `INSERT INTO sessions
            (id, teacher_id, starts_at_utc, duration_minutes, status,
             visitor_name, visitor_email, contact_pref, contact_value,
             visitor_intent, visitor_timezone, notes_internal, decided_at,
             created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      row.id,
      row.teacher_id,
      row.starts_at_utc,
      row.duration_minutes,
      row.status,
      row.visitor_name,
      row.visitor_email,
      row.contact_pref,
      row.contact_value,
      row.visitor_intent,
      row.visitor_timezone,
      row.notes_internal,
      row.decided_at,
      row.created_at,
      row.updated_at,
    ],
  });
};

let client: Client;

beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await applyMigration(client);
});

afterEach(() => {
  client.close();
});

describe('migration 0000_init.sql — table shape (sqlite_master)', () => {
  test('both business tables are created', async () => {
    const result = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('teachers','sessions') ORDER BY name",
    );
    expect(result.rows.map((r) => r.name)).toEqual(['sessions', 'teachers']);
  });

  test('`teachers` exposes all 12 columns from AC-2.1.1', async () => {
    const result = await client.execute('PRAGMA table_info(teachers)');
    const names = result.rows.map((r) => r.name as string).sort();
    expect(names).toEqual(
      [
        'id',
        'slug',
        'name',
        'email',
        'bio',
        'telegram_chat_id',
        'availability',
        'avatar_url',
        'timezone',
        'active',
        'created_at',
        'updated_at',
      ].sort(),
    );
  });

  test('`sessions` exposes all 15 columns from AC-2.2.1', async () => {
    const result = await client.execute('PRAGMA table_info(sessions)');
    const names = result.rows.map((r) => r.name as string).sort();
    expect(names).toEqual(
      [
        'id',
        'teacher_id',
        'starts_at_utc',
        'duration_minutes',
        'status',
        'visitor_name',
        'visitor_email',
        'contact_pref',
        'contact_value',
        'visitor_intent',
        'visitor_timezone',
        'notes_internal',
        'decided_at',
        'created_at',
        'updated_at',
      ].sort(),
    );
  });
});

describe('AC-2.2.2 — partial-unique index BEHAVIOUR (bug #4790 regression guard)', () => {
  test('two PENDING rows can coexist on the same (teacher_id, starts_at_utc)', async () => {
    // If the partial-unique WHERE clause regressed to a no-op (full unique
    // index) because of bug #4790, the SECOND insert below would fail with a
    // UNIQUE-constraint error. The spec requires unrestricted `pending` rows
    // (e.g. a busy slot waitlist) and rejection only at confirm-time.
    await insertTeacher(client);
    await insertSession(client, {
      id: 's-1',
      teacher_id: TEACHER_ROW.id,
      starts_at_utc: 1_710_000_000_000,
    });
    await expect(
      insertSession(client, {
        id: 's-2',
        teacher_id: TEACHER_ROW.id,
        starts_at_utc: 1_710_000_000_000,
      }),
    ).resolves.toBeDefined();
  });

  test('only ONE row can hold status=confirmed for the same slot', async () => {
    await insertTeacher(client);
    await insertSession(client, {
      id: 's-1',
      teacher_id: TEACHER_ROW.id,
      starts_at_utc: 1_710_000_000_000,
    });
    await insertSession(client, {
      id: 's-2',
      teacher_id: TEACHER_ROW.id,
      starts_at_utc: 1_710_000_000_000,
    });

    // Confirm the first request — admitted by the partial-unique.
    await expect(
      client.execute({
        sql: "UPDATE sessions SET status = 'confirmed' WHERE id = ?",
        args: ['s-1'],
      }),
    ).resolves.toBeDefined();

    // Try to confirm the second — partial-unique now refuses the write.
    await expect(
      client.execute({
        sql: "UPDATE sessions SET status = 'confirmed' WHERE id = ?",
        args: ['s-2'],
      }),
    ).rejects.toThrow(/UNIQUE|constraint/i);
  });

  test('a confirmed row can coexist with a confirmed row on a DIFFERENT slot', async () => {
    await insertTeacher(client);
    await insertSession(client, {
      id: 's-1',
      teacher_id: TEACHER_ROW.id,
      starts_at_utc: 1_710_000_000_000,
      status: 'confirmed',
    });
    await expect(
      insertSession(client, {
        id: 's-2',
        teacher_id: TEACHER_ROW.id,
        starts_at_utc: 1_710_003_600_000, // +1h
        status: 'confirmed',
      }),
    ).resolves.toBeDefined();
  });
});

describe('AC-2.2.6 — FK `teacher_id` is ON DELETE RESTRICT', () => {
  test('cannot DELETE a teacher with a live session', async () => {
    await insertTeacher(client);
    await insertSession(client, {
      id: 's-1',
      teacher_id: TEACHER_ROW.id,
      starts_at_utc: 1_710_000_000_000,
    });
    await expect(
      client.execute({
        sql: 'DELETE FROM teachers WHERE id = ?',
        args: [TEACHER_ROW.id],
      }),
    ).rejects.toThrow(/FOREIGN KEY|constraint/i);
  });

  test('CAN delete a teacher when no sessions reference them', async () => {
    await insertTeacher(client);
    await expect(
      client.execute({
        sql: 'DELETE FROM teachers WHERE id = ?',
        args: [TEACHER_ROW.id],
      }),
    ).resolves.toBeDefined();
  });
});

describe('AC-2.2.1 — CHECK constraints', () => {
  test('inserting `status` outside the 6-value enum is rejected', async () => {
    await insertTeacher(client);
    await expect(
      insertSession(client, {
        id: 's-bad',
        teacher_id: TEACHER_ROW.id,
        starts_at_utc: 1_710_000_000_000,
        status: 'not_a_real_status',
      }),
    ).rejects.toThrow(/CHECK|constraint/i);
  });

  test('inserting `contact_pref` outside the 3-value enum is rejected', async () => {
    await insertTeacher(client);
    await expect(
      client.execute({
        sql: `INSERT INTO sessions
                (id, teacher_id, starts_at_utc, duration_minutes, status,
                 visitor_name, visitor_email, contact_pref, contact_value,
                 created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          's-bad-pref',
          TEACHER_ROW.id,
          1_710_000_000_000,
          60,
          'pending',
          'Visitante',
          'v@example.test',
          'carrier-pigeon',
          'v@example.test',
          1_700_000_000_000,
          1_700_000_000_000,
        ],
      }),
    ).rejects.toThrow(/CHECK|constraint/i);
  });
});

describe('AC-2.1.1 — UNIQUE constraints on `teachers`', () => {
  test('duplicate `slug` is rejected', async () => {
    await insertTeacher(client);
    await expect(
      insertTeacher(client, {
        id: 't-other',
        email: 'other@example.test',
        // same slug as the seeded row
      }),
    ).rejects.toThrow(/UNIQUE|constraint/i);
  });

  test('duplicate `email` is rejected', async () => {
    await insertTeacher(client);
    await expect(
      insertTeacher(client, {
        id: 't-other',
        slug: 'other-slug',
        // same email as the seeded row
      }),
    ).rejects.toThrow(/UNIQUE|constraint/i);
  });
});

describe('AC-2.2.3 — secondary indexes exist in sqlite_master', () => {
  test.each([
    'sessions_teacher_slot_confirmed',
    'sessions_status_created_idx',
    'sessions_teacher_starts_idx',
    'sessions_starts_idx',
  ])('index `%s` is present', async (name) => {
    const result = await client.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='index' AND name = ?",
      args: [name],
    });
    expect(result.rows.length, `index ${name} was not created by 0000_init.sql`).toBe(1);
  });

  test('`teachers_slug_unique` + `teachers_email_unique` are present', async () => {
    const result = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('teachers_slug_unique','teachers_email_unique') ORDER BY name",
    );
    expect(result.rows.map((r) => r.name)).toEqual([
      'teachers_email_unique',
      'teachers_slug_unique',
    ]);
  });
});

describe('column defaults populate on minimal INSERT', () => {
  test('`teachers` defaults fire when only required-not-defaulted columns are provided', async () => {
    await client.execute({
      sql: `INSERT INTO teachers (id, slug, name, email, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        't-min',
        'minimal',
        'Minimal Teacher',
        'minimal@example.test',
        1_700_000_000_000,
        1_700_000_000_000,
      ],
    });
    const result = await client.execute({
      sql: 'SELECT availability, timezone, active FROM teachers WHERE id = ?',
      args: ['t-min'],
    });
    expect(result.rows[0]?.availability).toBe('{"tz":null,"windows":[],"blackouts":[]}');
    expect(result.rows[0]?.timezone).toBe('America/Argentina/Buenos_Aires');
    expect(result.rows[0]?.active).toBe(1);
  });

  test('`sessions` defaults fire for duration_minutes + status', async () => {
    await insertTeacher(client);
    await client.execute({
      sql: `INSERT INTO sessions
              (id, teacher_id, starts_at_utc, visitor_name, visitor_email,
               contact_pref, contact_value, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        's-min',
        TEACHER_ROW.id,
        1_710_000_000_000,
        'Visitante',
        'v@example.test',
        'email',
        'v@example.test',
        1_700_000_000_000,
        1_700_000_000_000,
      ],
    });
    const result = await client.execute({
      sql: 'SELECT duration_minutes, status FROM sessions WHERE id = ?',
      args: ['s-min'],
    });
    expect(result.rows[0]?.duration_minutes).toBe(60);
    expect(result.rows[0]?.status).toBe('pending');
  });
});
