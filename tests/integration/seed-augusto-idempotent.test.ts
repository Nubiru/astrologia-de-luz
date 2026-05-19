/**
 * G_C-2c integration pairing — Augusto seed migration apply + idempotency.
 *
 * Spec anchors: S-1 AC-2.1.5 + R-9.
 *
 * What this test catches:
 *   - The 0003 seed SQL drops the $$ADMIN_EMAIL$$ template token (the
 *     migrate.ts substitution contract is then broken at apply time).
 *   - The ON CONFLICT(email) DO NOTHING clause regresses to an unconditional
 *     INSERT (re-running the seed would create duplicate rows or hard-fail).
 *   - The empty-availability windows R-9 protection is replaced with a
 *     synthetic-hours placeholder (the production-refuses-slots invariant
 *     breaks; visitors see a fake calendar before Augusto configures).
 *   - The SQL LOWER() wrapper is removed (a future-self upper-cases the env
 *     value in ADMIN_EMAILS, the unique index lets both rows coexist).
 *
 * Apply strategy mirrors `tests/integration/migration-0000-applies.test.ts`:
 * libSQL `:memory:` + PRAGMA foreign_keys=ON + statement-breakpoint splitter.
 * The seed file alone is renderable; the four-step ORDER applies all prior
 * migrations so the FK + unique-index machinery is in place when the seed
 * inserts.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Client, createClient } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const MIG_DIR = resolve(__dirname, '..', '..', 'src', 'infrastructure', 'db', 'migrations');
const APPLY_ORDER = [
  '0000_init.sql',
  '0001_authjs.sql',
  '0002_cp3_tables.sql',
  '0003_seed_augusto.sql',
] as const;

const SEED_FILE = '0003_seed_augusto.sql';
const SEED_TEMPLATE_TOKEN = '$$ADMIN_EMAIL$$';
const SEED_RAW = readFileSync(resolve(MIG_DIR, SEED_FILE), 'utf8');

const splitStatements = (sql: string): string[] =>
  sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

// Mirrors scripts/migrate.ts (G_C-5, AC-2.3.3) at apply time.
const renderSeed = (sql: string, email: string): string =>
  sql.split(SEED_TEMPLATE_TOKEN).join(email);

const applySeedOnly = async (client: Client, email: string) => {
  const rendered = renderSeed(SEED_RAW, email);
  for (const stmt of splitStatements(rendered)) {
    await client.execute(stmt);
  }
};

const applyAllMigrations = async (client: Client, opts: { adminEmail: string }) => {
  await client.execute('PRAGMA foreign_keys = ON');
  for (const file of APPLY_ORDER) {
    const raw = readFileSync(resolve(MIG_DIR, file), 'utf8');
    const sql = file === SEED_FILE ? renderSeed(raw, opts.adminEmail) : raw;
    for (const stmt of splitStatements(sql)) {
      await client.execute(stmt);
    }
  }
};

let client: Client;

beforeEach(() => {
  client = createClient({ url: ':memory:' });
});

afterEach(() => {
  client.close();
});

describe('0003_seed_augusto.sql — template shape (AC-2.1.5)', () => {
  test('declares the $$ADMIN_EMAIL$$ substitution token inside LOWER()', () => {
    expect(SEED_RAW).toContain(SEED_TEMPLATE_TOKEN);
    expect(SEED_RAW).toMatch(/LOWER\(\s*'\$\$ADMIN_EMAIL\$\$'\s*\)/);
  });

  test('uses ON CONFLICT(email) DO NOTHING for idempotency', () => {
    expect(SEED_RAW).toMatch(/ON\s+CONFLICT\s*\(\s*email\s*\)\s+DO\s+NOTHING/i);
  });

  test('inserts the stable deterministic id (idempotent re-runs)', () => {
    expect(SEED_RAW).toContain("'augusto-rocha-uuid-stable'");
  });

  test('R-9 protection: availability ships with empty windows + blackouts', () => {
    expect(SEED_RAW).toContain('"windows":[]');
    expect(SEED_RAW).toContain('"blackouts":[]');
  });

  test('default timezone is America/Argentina/Buenos_Aires (D-008)', () => {
    expect(SEED_RAW).toContain("'America/Argentina/Buenos_Aires'");
  });

  test('created_at + updated_at use unixepoch() * 1000 (ms-epoch convention)', () => {
    const occurrences = SEED_RAW.match(/unixepoch\(\)\s*\*\s*1000/g) ?? [];
    expect(occurrences).toHaveLength(2);
  });
});

describe('seed apply against fresh DB (AC-2.1.5)', () => {
  test('inserts exactly one row with the rendered email', async () => {
    await applyAllMigrations(client, { adminEmail: 'augusto@astrologiadeluz.com' });
    const result = await client.execute(
      "SELECT id, slug, name, email, bio, timezone, active FROM teachers WHERE slug = 'augusto-rocha'",
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      id: 'augusto-rocha-uuid-stable',
      slug: 'augusto-rocha',
      name: 'Augusto Rocha',
      email: 'augusto@astrologiadeluz.com',
      bio: null,
      timezone: 'America/Argentina/Buenos_Aires',
      active: 1,
    });
  });

  test('availability JSON parses with empty windows + blackouts (R-9)', async () => {
    await applyAllMigrations(client, { adminEmail: 'augusto@example.test' });
    const result = await client.execute(
      "SELECT availability FROM teachers WHERE slug = 'augusto-rocha'",
    );
    const availability = JSON.parse(result.rows[0]?.availability as string) as {
      tz: string;
      windows: unknown[];
      blackouts: unknown[];
    };
    expect(availability.tz).toBe('America/Argentina/Buenos_Aires');
    expect(availability.windows).toEqual([]);
    expect(availability.blackouts).toEqual([]);
  });

  test('SQL LOWER() normalises an upper-cased ADMIN_EMAILS entry', async () => {
    await applyAllMigrations(client, { adminEmail: 'Augusto@ASTROLOGIADELUZ.com' });
    const result = await client.execute("SELECT email FROM teachers WHERE slug = 'augusto-rocha'");
    expect(result.rows[0]?.email).toBe('augusto@astrologiadeluz.com');
  });

  test('created_at + updated_at are populated with the same epoch-ms instant', async () => {
    const beforeMs = Date.now();
    await applyAllMigrations(client, { adminEmail: 'augusto@example.test' });
    const afterMs = Date.now();
    const result = await client.execute(
      "SELECT created_at, updated_at FROM teachers WHERE slug = 'augusto-rocha'",
    );
    const createdAt = result.rows[0]?.created_at as number;
    const updatedAt = result.rows[0]?.updated_at as number;
    expect(createdAt).toBe(updatedAt);
    // unixepoch() truncates to seconds → *1000 lives in [beforeSec, afterSec] window.
    expect(createdAt).toBeGreaterThanOrEqual(Math.floor(beforeMs / 1000) * 1000);
    expect(createdAt).toBeLessThanOrEqual(afterMs);
  });
});

describe('idempotency — re-running the seed is a no-op (AC-2.1.5)', () => {
  test('applying the seed twice leaves count = 1 (ON CONFLICT path)', async () => {
    await applyAllMigrations(client, { adminEmail: 'augusto@example.test' });
    await applySeedOnly(client, 'augusto@example.test');

    const result = await client.execute(
      "SELECT COUNT(*) AS n FROM teachers WHERE slug = 'augusto-rocha'",
    );
    expect(result.rows[0]?.n).toBe(1);
  });

  test('second apply does NOT mutate the existing row (updated_at preserved)', async () => {
    await applyAllMigrations(client, { adminEmail: 'augusto@example.test' });
    const first = await client.execute(
      "SELECT updated_at FROM teachers WHERE slug = 'augusto-rocha'",
    );
    const firstUpdatedAt = first.rows[0]?.updated_at as number;

    // unixepoch() truncates to whole seconds — sleep long enough that a re-run
    // would emit a strictly later value if the row were re-inserted.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    await applySeedOnly(client, 'augusto@example.test');
    const second = await client.execute(
      "SELECT updated_at FROM teachers WHERE slug = 'augusto-rocha'",
    );
    expect(second.rows[0]?.updated_at).toBe(firstUpdatedAt);
  });

  test('second apply with a DIFFERENT cased input still no-ops (LOWER converges)', async () => {
    await applyAllMigrations(client, { adminEmail: 'augusto@example.test' });
    // Same email, just upper-cased — LOWER() collapses to the existing row's email,
    // ON CONFLICT(email) DO NOTHING fires.
    await applySeedOnly(client, 'AUGUSTO@EXAMPLE.TEST');

    const result = await client.execute(
      "SELECT COUNT(*) AS n, email FROM teachers WHERE slug = 'augusto-rocha'",
    );
    expect(result.rows[0]?.n).toBe(1);
    expect(result.rows[0]?.email).toBe('augusto@example.test');
  });

  test('the only Augusto row is single-instance even across 3 consecutive applies', async () => {
    await applyAllMigrations(client, { adminEmail: 'augusto@example.test' });
    await applySeedOnly(client, 'augusto@example.test');
    await applySeedOnly(client, 'augusto@example.test');

    const total = await client.execute('SELECT COUNT(*) AS n FROM teachers');
    expect(total.rows[0]?.n).toBe(1);
  });
});

describe('R-9 launch gate — empty availability blocks slot derivation', () => {
  test('active=1 (the maestro is listable on /reservar)', async () => {
    await applyAllMigrations(client, { adminEmail: 'augusto@example.test' });
    const result = await client.execute("SELECT active FROM teachers WHERE slug = 'augusto-rocha'");
    expect(result.rows[0]?.active).toBe(1);
  });

  test('windows.length === 0 → G_C-7 availability/derive.ts returns zero slots', async () => {
    // Behavioural invariant: a maestro with empty windows is listable but
    // contributes NO slots until availability is added via the admin UI.
    // The derive function is shipped by G_C-7; here we assert the DB state
    // that feeds it.
    await applyAllMigrations(client, { adminEmail: 'augusto@example.test' });
    const result = await client.execute(
      "SELECT availability FROM teachers WHERE slug = 'augusto-rocha'",
    );
    const availability = JSON.parse(result.rows[0]?.availability as string) as {
      windows: unknown[];
    };
    expect(availability.windows).toHaveLength(0);
  });
});
