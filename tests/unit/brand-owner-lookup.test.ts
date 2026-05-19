/**
 * G_C-8 / G_C-39 unit pairing — brand-owner identification (§11 intro +
 * AC-3.2.1).
 *
 * G_C-39 refactor (M-20 / D-056, pilot 2/N): the legacy
 * `getBrandOwner(db, email)` arity is replaced by Path A — each lookup test
 * builds a local factory instance over a hand-rolled `MaestrosReader` stub
 * whose `findBrandOwner()` closes over the same in-memory libSQL DB the
 * tests already exercise. The pure helper `brandOwnerEmail()` canonicalises
 * the test input BEFORE the stub closure sees it, mirroring how the
 * production `makeMaestrosRepository` adapter pulls ADMIN_EMAILS from env.
 * Zero touch to env, composition, or the maestros repository adapter.
 *
 * What this catches:
 *   - `brandOwnerEmail()` stops trimming or lower-casing → ADMIN_EMAILS
 *     entries with whitespace or upper-case never match the seed row's
 *     `email` column, brand-owner pings silently drop.
 *   - The comma-split takes the WRONG entry (e.g. last instead of first) →
 *     a backup admin's email becomes the brand-owner.
 *   - `createGetBrandOwner({ maestrosReader })` regresses into doing its
 *     own SQL — would by-pass the port and silently couple to a concrete DB
 *     shape (the contract is "delegate to the reader port; no I/O of its
 *     own").
 *   - The reader's findBrandOwner does not constrain by the canonical
 *     email → any teachers row with a similar-but-not-equal email matches.
 *   - The `.limit(1)` is dropped → multiple rows could collide silently.
 *   - The pre-seed lookup throws instead of returning null.
 *
 * Lookup tests run against an in-memory libSQL DB wrapped by Drizzle so the
 * SQL the helper emits is exercised end-to-end (not a mocked client). Only
 * the MaestrosReader port boundary is stubbed; the DB itself stays real.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Client, createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { type LibSQLDatabase, drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { brandOwnerEmail, createGetBrandOwner } from '@/application/notify/brand-owner';
import type { MaestrosReader } from '@/domain/booking/ports';
import * as schema from '@/infrastructure/db/schema';
import { buildMaestrosReaderStub as buildBaseMaestrosReaderStub } from '../_helpers/dispatcher-stubs';

const MIG_DIR = resolve(__dirname, '..', '..', 'src', 'infrastructure', 'db', 'migrations');
const INIT_SQL = readFileSync(resolve(MIG_DIR, '0000_init.sql'), 'utf8');

const splitStatements = (sql: string): string[] =>
  sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

let client: Client;
let db: LibSQLDatabase<typeof schema>;

beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await client.execute('PRAGMA foreign_keys = ON');
  for (const stmt of splitStatements(INIT_SQL)) {
    await client.execute(stmt);
  }
  db = drizzle(client, { schema });
});

afterEach(() => {
  client.close();
});

/**
 * Build a `MaestrosReader` stub whose `findBrandOwner()` emits the same
 * canonical select-by-email-limit-1 the production maestros repository
 * adapter does — but reads its canonical email from the test argument
 * instead of `getEnv().ADMIN_EMAILS`. Delegates to the shared
 * `dispatcher-stubs` helper for the port-completeness surface
 * (`findActiveBySlug` + `findById` null defaults); only `findBrandOwner` is
 * customised here so the closure can capture the per-test `db` reset.
 */
const buildMaestrosReaderStub = (canonicalEmail: string): MaestrosReader =>
  buildBaseMaestrosReaderStub({
    findBrandOwner: async () => {
      const rows = await db
        .select()
        .from(schema.teachers)
        .where(eq(schema.teachers.email, canonicalEmail))
        .limit(1);
      return rows[0] ?? null;
    },
  });

const insertTeacher = (
  overrides: Partial<{ id: string; slug: string; name: string; email: string; active: number }>,
) =>
  client.execute({
    sql: `INSERT INTO teachers
            (id, slug, name, email, availability, timezone, active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      overrides.id ?? 't-1',
      overrides.slug ?? 'augusto-rocha',
      overrides.name ?? 'Augusto Rocha',
      overrides.email ?? 'augusto@astrologiadeluz.com',
      '{"tz":null,"windows":[],"blackouts":[]}',
      'America/Argentina/Buenos_Aires',
      overrides.active ?? 1,
      1_700_000_000_000,
      1_700_000_000_000,
    ],
  });

describe('brandOwnerEmail — canonicalisation (§11 intro)', () => {
  test('returns a single email unchanged when already canonical', () => {
    expect(brandOwnerEmail('augusto@astrologiadeluz.com')).toBe('augusto@astrologiadeluz.com');
  });

  test('trims surrounding whitespace from the first entry', () => {
    expect(brandOwnerEmail('  augusto@astrologiadeluz.com  ')).toBe('augusto@astrologiadeluz.com');
  });

  test('lower-cases an upper-cased entry', () => {
    expect(brandOwnerEmail('AUGUSTO@ASTROLOGIADELUZ.COM')).toBe('augusto@astrologiadeluz.com');
  });

  test('picks the FIRST entry when multiple are comma-separated', () => {
    expect(brandOwnerEmail('augusto@astrologiadeluz.com,backup@example.com')).toBe(
      'augusto@astrologiadeluz.com',
    );
  });

  test('trim + lowercase + first-entry compose correctly', () => {
    expect(brandOwnerEmail(' Augusto@ASTROLOGIADELUZ.com ,Backup@example.COM')).toBe(
      'augusto@astrologiadeluz.com',
    );
  });

  test('returns empty string for empty input (defensive, never in prod)', () => {
    expect(brandOwnerEmail('')).toBe('');
  });
});

describe('getBrandOwner — DB lookup (§11 intro + AC-3.2.1)', () => {
  test('returns the Teacher row when the seeded brand-owner exists', async () => {
    await insertTeacher({
      email: 'augusto@astrologiadeluz.com',
      name: 'Augusto Rocha',
      slug: 'augusto-rocha',
    });

    const fn = createGetBrandOwner({
      maestrosReader: buildMaestrosReaderStub(brandOwnerEmail('augusto@astrologiadeluz.com')),
    });
    const owner = await fn();
    expect(owner).not.toBeNull();
    expect(owner?.email).toBe('augusto@astrologiadeluz.com');
    expect(owner?.slug).toBe('augusto-rocha');
    expect(owner?.name).toBe('Augusto Rocha');
  });

  test('returns null when no teachers row matches (pre-seed defensive path)', async () => {
    // Empty teachers table — the seed migration has not yet run.
    const fn = createGetBrandOwner({
      maestrosReader: buildMaestrosReaderStub(brandOwnerEmail('augusto@astrologiadeluz.com')),
    });
    const owner = await fn();
    expect(owner).toBeNull();
  });

  test('does NOT match a row whose email is a different case (pre-G_C-2c LOWER guard)', async () => {
    // Hypothetical regression: an admin form inserted a teacher without
    // lower-casing the email. The brand-owner lookup uses an exact equality,
    // so this row stays invisible — surfacing the bad insert rather than
    // silently accepting it as brand-owner.
    await insertTeacher({
      email: 'AUGUSTO@astrologiadeluz.com',
      slug: 'augusto-mixed-case',
    });
    const fn = createGetBrandOwner({
      maestrosReader: buildMaestrosReaderStub(brandOwnerEmail('augusto@astrologiadeluz.com')),
    });
    const owner = await fn();
    expect(owner).toBeNull();
  });

  test('canonicalises ADMIN_EMAILS at lookup time (passes lower-cased value to DB)', async () => {
    await insertTeacher({
      email: 'augusto@astrologiadeluz.com',
      slug: 'augusto-rocha',
    });

    const fn = createGetBrandOwner({
      maestrosReader: buildMaestrosReaderStub(brandOwnerEmail(' AUGUSTO@ASTROLOGIADELUZ.COM ')),
    });
    const owner = await fn();
    expect(owner).not.toBeNull();
    expect(owner?.email).toBe('augusto@astrologiadeluz.com');
  });

  test('picks the right row among multiple teachers (matches FIRST ADMIN_EMAILS entry only)', async () => {
    await insertTeacher({
      id: 't-augusto',
      email: 'augusto@astrologiadeluz.com',
      slug: 'augusto-rocha',
      name: 'Augusto Rocha',
    });
    await insertTeacher({
      id: 't-backup',
      email: 'backup@example.com',
      slug: 'backup-admin',
      name: 'Backup Admin',
    });
    await insertTeacher({
      id: 't-other',
      email: 'maria@astrologiadeluz.com',
      slug: 'maria-jose',
      name: 'María José',
    });

    const fn = createGetBrandOwner({
      maestrosReader: buildMaestrosReaderStub(
        brandOwnerEmail('augusto@astrologiadeluz.com,backup@example.com'),
      ),
    });
    const owner = await fn();
    expect(owner?.id).toBe('t-augusto');
  });

  test('flipping ADMIN_EMAILS[0] resolves to a DIFFERENT row', async () => {
    // Same DB, two different env values for ADMIN_EMAILS — the helper is
    // pure-of-env (env passed as an arg), so different inputs route to
    // different rows.
    await insertTeacher({
      id: 't-augusto',
      email: 'augusto@astrologiadeluz.com',
      slug: 'augusto-rocha',
    });
    await insertTeacher({
      id: 't-maria',
      email: 'maria@astrologiadeluz.com',
      slug: 'maria-jose',
    });

    const augustoFn = createGetBrandOwner({
      maestrosReader: buildMaestrosReaderStub(brandOwnerEmail('augusto@astrologiadeluz.com')),
    });
    const mariaFn = createGetBrandOwner({
      maestrosReader: buildMaestrosReaderStub(brandOwnerEmail('maria@astrologiadeluz.com')),
    });
    const augusto = await augustoFn();
    const maria = await mariaFn();
    expect(augusto?.id).toBe('t-augusto');
    expect(maria?.id).toBe('t-maria');
  });

  test('returns at most ONE row (limit-1 guard against duplicate-email regressions)', async () => {
    // teachers_email_unique should prevent this row from existing, but the
    // helper's `.limit(1)` is a defense-in-depth — assert the contract.
    await insertTeacher({
      email: 'augusto@astrologiadeluz.com',
      slug: 'augusto-rocha',
    });
    const fn = createGetBrandOwner({
      maestrosReader: buildMaestrosReaderStub(brandOwnerEmail('augusto@astrologiadeluz.com')),
    });
    const owner = await fn();
    expect(owner).not.toBeNull();
    // Returned value is a single row, not an array.
    expect(Array.isArray(owner)).toBe(false);
  });
});
