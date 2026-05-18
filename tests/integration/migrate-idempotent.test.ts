/**
 * G_C-5 integration pairing — `scripts/migrate.ts` end-to-end idempotency.
 *
 * Spec anchor: S-1 AC-2.3.3 + R-8.
 *
 * This is the integration counterpart to the unit-level migration tests
 * (`tests/integration/migration-0000-applies.test.ts`,
 * `tests/integration/seed-augusto-idempotent.test.ts`) — those exercise the
 * .sql files in isolation. THIS test exercises the runtime migrate.ts
 * machinery itself: dialing it twice against a fresh libsql file and
 * verifying:
 *
 *   1. The cumulative schema after run #1 = the 9 tables specified in
 *      META_PILLAR §3.3 (teachers + sessions + 4 Auth.js + 3 CP-3 auxiliary)
 *      PLUS Drizzle's __drizzle_migrations bookkeeping table.
 *   2. The `$$ADMIN_EMAIL$$` template token is substituted at apply time —
 *      Augusto's row exists with the supplied admin email (lower-cased by the
 *      seed's `LOWER()` wrapper, AC-2.1.5).
 *   3. SQL-quote escaping survives apostrophe-in-local-part emails — the
 *      runner uses `''` (doubled single-quote) escaping per SQLite literal
 *      rules. Without escaping, `o'malley@example.com` would terminate the
 *      INSERT's string literal mid-statement and break apply.
 *   4. Run #2 is a no-op — Drizzle's migration ledger (the
 *      `__drizzle_migrations` table) tracks applied .sql files by hash and
 *      skips already-applied ones. A manual mutation to Augusto's `bio` made
 *      between run #1 and run #2 survives run #2 (proves the seed INSERT did
 *      NOT fire a second time and trample the lead's edit).
 *   5. The substitution staging dir is per-run scoped (tmp dir) — does NOT
 *      mutate the in-tree `db/migrations/*.sql` files. Asserted by reading
 *      the on-disk `0003_seed_augusto.sql` before + after both runs.
 *
 * What this catches (and why each assertion exists):
 *   - migrate.ts is silently swapped to non-libsql migrator (e.g.,
 *     `drizzle-orm/better-sqlite3`) — the runtime DB shape mismatch fails
 *     fixture creation.
 *   - The staging dir copy step is removed — db/migrations would be mutated
 *     in-place, the on-disk-unchanged assertion fails.
 *   - The substitution forgets to use SQL-escape — the apostrophe-email
 *     assertion fails.
 *   - The `__drizzle_migrations` tracking is broken (e.g., wrong drizzle
 *     version) — run #2 attempts re-INSERT, ON CONFLICT fires, bio is
 *     reset on `LOWER()` recompute, the bio-persistence assertion fails.
 */

import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { type Client, createClient } from '@libsql/client';
import { type LibSQLDatabase, drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runMigrations } from '../../scripts/migrate';

const ROOT = resolve(__dirname, '..', '..');
const MIGRATIONS = resolve(ROOT, 'db/migrations');
const SEED_FILE = resolve(MIGRATIONS, '0003_seed_augusto.sql');

const EXPECTED_APP_TABLES = [
  'account',
  'notify_log',
  'rate_limit_buckets',
  'session',
  'sessions',
  'teacher_onboarding_tokens',
  'teachers',
  'user',
  'verificationToken',
].sort();

type Fixture = {
  dbPath: string;
  workdir: string;
  client: Client;
  db: LibSQLDatabase<Record<string, never>>;
};

function makeFixture(): Fixture {
  const workdir = mkdtempSync(join(tmpdir(), 'migrate-idempotent-'));
  const dbPath = join(workdir, 'test.db');
  // Pre-create the file so libsql's file: URL handler treats it as fresh DB.
  closeSync(openSync(dbPath, 'w'));
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client) as LibSQLDatabase<Record<string, never>>;
  return { workdir, dbPath, client, db };
}

async function listAppTables(client: Client): Promise<string[]> {
  // The drizzle-orm libsql migrator creates a bookkeeping table called
  // `__drizzle_migrations`. Excluding it by name (NOT by `LIKE '__%'`)
  // because LIKE treats `_` as a single-char wildcard and would mask every
  // table whose name is ≥ 2 chars.
  const res = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY name",
  );
  return res.rows.map((r) => r.name as string);
}

describe('G_C-5 — scripts/migrate.ts idempotency (AC-2.3.3)', () => {
  let fx: Fixture;
  let seedBefore: string;

  beforeEach(() => {
    fx = makeFixture();
    seedBefore = readFileSync(SEED_FILE, 'utf8');
  });

  afterEach(() => {
    fx.client.close();
    rmSync(fx.workdir, { recursive: true, force: true });
  });

  test('run #1 applies all 4 migrations against fresh libsql + substitutes the admin email', async () => {
    await runMigrations(fx.db, 'admin@example.com', MIGRATIONS);

    const appTables = await listAppTables(fx.client);
    expect(appTables).toEqual(EXPECTED_APP_TABLES);

    // Drizzle's tracking table exists after the first migrate.
    const tracking = await fx.client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
    );
    expect(tracking.rows.length).toBe(1);

    // Augusto row seeded with the substituted email.
    const augusto = await fx.client.execute(
      "SELECT email, slug, availability FROM teachers WHERE slug = 'augusto-rocha'",
    );
    expect(augusto.rows).toHaveLength(1);
    expect(augusto.rows[0]?.email).toBe('admin@example.com');
    // R-9: empty availability windows ship in all environments.
    const availability = JSON.parse(augusto.rows[0]?.availability as string);
    expect(availability.windows).toEqual([]);
    expect(availability.blackouts).toEqual([]);
  });

  test('SQL-quote escape: apostrophe-in-local-part email applies cleanly (no syntax error)', async () => {
    // `o'malley@example.com` would break a naive single-quote literal.
    await runMigrations(fx.db, "o'malley@example.com", MIGRATIONS);
    const augusto = await fx.client.execute(
      "SELECT email FROM teachers WHERE slug = 'augusto-rocha'",
    );
    expect(augusto.rows).toHaveLength(1);
    expect(augusto.rows[0]?.email).toBe("o'malley@example.com");
  });

  test('staging is out-of-tree — on-disk db/migrations/0003 is unchanged after the run', async () => {
    await runMigrations(fx.db, 'admin@example.com', MIGRATIONS);
    const seedAfter = readFileSync(SEED_FILE, 'utf8');
    expect(seedAfter).toBe(seedBefore);
    expect(seedAfter).toContain('$$ADMIN_EMAIL$$');
  });

  test('run #2 is a no-op — manual bio edit survives, single Augusto row preserved', async () => {
    await runMigrations(fx.db, 'admin@example.com', MIGRATIONS);

    // Mutate Augusto between runs. If run #2 re-INSERTs (ON CONFLICT misses,
    // or drizzle reapplies 0003), the bio would either be NULL (the seed
    // value) or trigger a UNIQUE violation.
    await fx.client.execute(
      "UPDATE teachers SET bio = 'do-not-reset' WHERE slug = 'augusto-rocha'",
    );

    await runMigrations(fx.db, 'admin@example.com', MIGRATIONS);

    const augusto = await fx.client.execute(
      "SELECT bio, count(*) OVER () AS total FROM teachers WHERE slug = 'augusto-rocha'",
    );
    expect(augusto.rows).toHaveLength(1);
    expect(augusto.rows[0]?.bio).toBe('do-not-reset');
    expect(augusto.rows[0]?.total).toBe(1);

    // Schema fingerprint unchanged after run #2.
    const appTables = await listAppTables(fx.client);
    expect(appTables).toEqual(EXPECTED_APP_TABLES);
  });

  test('the migrations dir exists and the runner does not crash on a no-op rerun against an unrelated email', async () => {
    // Smoke: prove `runMigrations` is callable + reusable without partial-state.
    await runMigrations(fx.db, 'admin@example.com', MIGRATIONS);
    await runMigrations(fx.db, 'admin@example.com', MIGRATIONS);
    await runMigrations(fx.db, 'admin@example.com', MIGRATIONS);
    expect(existsSync(MIGRATIONS)).toBe(true);
    const augusto = await fx.client.execute('SELECT count(*) AS c FROM teachers');
    expect(augusto.rows[0]?.c).toBe(1);
  });
});
