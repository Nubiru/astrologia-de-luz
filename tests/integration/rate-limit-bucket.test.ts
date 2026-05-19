/**
 * G_C-17 integration pairing — `checkRateLimit` + `pruneOlderThan` against
 * a real libsql instance (AC-3.5.3 + AC-3.5.5).
 *
 * The pairing exercises the actual `INSERT ... ON CONFLICT(ip, hour_bucket)
 * DO UPDATE SET count = count + 1 RETURNING count` path — Drizzle's
 * `onConflictDoUpdate` typings have shipped at least one regression in the
 * 0.30.x line that compiled cleanly but silently emitted a non-conflict
 * INSERT (the unique-violation then 500s). The contract that matters here
 * is: row #4 from the same IP sees `allowed === false` AND the database
 * agrees (one row, `count = 4`). Both assertions live in this file.
 *
 * What this catches:
 *   1. The atomic INSERT-or-UPDATE pattern regresses to a non-atomic
 *      SELECT-then-INSERT — concurrent requests from the same IP race and
 *      the bucket undercounts (parallel call test simulates this).
 *   2. The `count` returned by RETURNING is incorrectly typed (e.g.,
 *      number coerced from text) — every assertion that compares to a
 *      literal integer fails.
 *   3. The `retryAfterSeconds` field is computed against a stale `now`
 *      (e.g., uses Date.now() inside the function instead of the passed-in
 *      `now`) — the boundary test that increments now ACROSS an hour
 *      boundary fails (bucket would not reset).
 *   4. The prune logic forgets the strict-less-than predicate and uses
 *      `<=` instead — the current bucket would be wiped at every prune,
 *      breaking every in-flight counter.
 */

import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { type Client, createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { type LibSQLDatabase, drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  HOUR_MS,
  MAX_REQUESTS_PER_HOUR,
  checkRateLimit,
  pruneOlderThan,
} from '@/infrastructure/rate-limit/token-bucket';
import { runMigrations } from '../../scripts/migrate';

const ROOT = resolve(__dirname, '..', '..');
const MIGRATIONS = resolve(ROOT, 'src/infrastructure/db/migrations');

// Pinned reference time so the hour-bucket math is deterministic across runs.
// 2026-05-18T10:00:00Z → bucket = floor(1779789600000 / 3_600_000) = 494386.
const REF_NOW = 1_779_789_600_000;

type Fixture = {
  workdir: string;
  client: Client;
  db: LibSQLDatabase<Record<string, never>>;
};

async function makeFixture(): Promise<Fixture> {
  const workdir = mkdtempSync(join(tmpdir(), 'rate-limit-'));
  const dbPath = join(workdir, 'test.db');
  closeSync(openSync(dbPath, 'w'));
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client) as LibSQLDatabase<Record<string, never>>;
  await runMigrations(db, 'admin@example.com', MIGRATIONS);
  return { workdir, client, db };
}

describe('G_C-17 — checkRateLimit (AC-3.5.3)', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(() => {
    fx.client.close();
    rmSync(fx.workdir, { recursive: true, force: true });
  });

  test('4 sequential requests from the same IP: 1..3 allowed, 4th denied with Retry-After', async () => {
    const ip = '203.0.113.42';
    const r1 = await checkRateLimit(fx.db, ip, REF_NOW);
    const r2 = await checkRateLimit(fx.db, ip, REF_NOW);
    const r3 = await checkRateLimit(fx.db, ip, REF_NOW);
    const r4 = await checkRateLimit(fx.db, ip, REF_NOW);

    expect(r1).toMatchObject({ allowed: true, count: 1, retryAfterSeconds: 0 });
    expect(r2).toMatchObject({ allowed: true, count: 2, retryAfterSeconds: 0 });
    expect(r3).toMatchObject({
      allowed: true,
      count: MAX_REQUESTS_PER_HOUR,
      retryAfterSeconds: 0,
    });

    expect(r4.allowed).toBe(false);
    expect(r4.count).toBe(MAX_REQUESTS_PER_HOUR + 1);
    expect(r4.retryAfterSeconds).toBeGreaterThan(0);
    expect(r4.retryAfterSeconds).toBeLessThanOrEqual(HOUR_MS / 1000);

    // DB row count: exactly 1 (same IP + same bucket → ON CONFLICT path).
    const rows = await fx.client.execute(
      "SELECT count FROM rate_limit_buckets WHERE ip = '203.0.113.42'",
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.count).toBe(MAX_REQUESTS_PER_HOUR + 1);
  });

  test('different IPs are isolated — exhausting one does not affect the other', async () => {
    const ip1 = '10.0.0.1';
    const ip2 = '10.0.0.2';
    for (let i = 0; i < MAX_REQUESTS_PER_HOUR + 1; i += 1) {
      await checkRateLimit(fx.db, ip1, REF_NOW);
    }
    const denied = await checkRateLimit(fx.db, ip1, REF_NOW);
    expect(denied.allowed).toBe(false);

    const r1_other = await checkRateLimit(fx.db, ip2, REF_NOW);
    expect(r1_other).toMatchObject({ allowed: true, count: 1 });
  });

  test('hour-bucket rollover resets the counter for the same IP', async () => {
    const ip = '198.51.100.1';
    const nextHour = REF_NOW + HOUR_MS + 1;

    for (let i = 0; i < MAX_REQUESTS_PER_HOUR + 1; i += 1) {
      await checkRateLimit(fx.db, ip, REF_NOW);
    }
    const denied = await checkRateLimit(fx.db, ip, REF_NOW);
    expect(denied.allowed).toBe(false);

    const r1_next = await checkRateLimit(fx.db, ip, nextHour);
    expect(r1_next).toMatchObject({ allowed: true, count: 1 });
    // Bucket landed in the NEXT hour.
    expect(r1_next.hourBucket).toBe(Math.floor(nextHour / HOUR_MS));

    // Two distinct rows now exist for the same IP — one per bucket.
    const rows = await fx.client.execute(
      `SELECT count(*) AS c FROM rate_limit_buckets WHERE ip = '198.51.100.1'`,
    );
    expect(rows.rows[0]?.c).toBe(2);
  });

  test('retryAfterSeconds shrinks as time approaches the next bucket', async () => {
    const ip = '192.0.2.50';
    const currentBucket = Math.floor(REF_NOW / HOUR_MS);
    const nextBucketStart = (currentBucket + 1) * HOUR_MS;
    const oneSecondBefore = nextBucketStart - 1_000;

    // Saturate the bucket so the denial path is reachable.
    for (let i = 0; i < MAX_REQUESTS_PER_HOUR; i += 1) {
      await checkRateLimit(fx.db, ip, REF_NOW);
    }

    const denied = await checkRateLimit(fx.db, ip, oneSecondBefore);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(1);
  });

  test('pruneOlderThan deletes only rows with hour_bucket < cutoff (strict inequality)', async () => {
    const ip = '203.0.113.99';
    const currentBucket = Math.floor(REF_NOW / HOUR_MS);

    // Insert a current row.
    await checkRateLimit(fx.db, ip, REF_NOW);
    // Inject 3 stale rows with progressively older buckets.
    for (let offset = 1; offset <= 3; offset += 1) {
      await fx.db.run(
        sql`INSERT INTO rate_limit_buckets (ip, hour_bucket, count) VALUES (${`stale-${offset}`}, ${currentBucket - offset}, ${5})`,
      );
    }

    const before = await fx.client.execute('SELECT count(*) AS c FROM rate_limit_buckets');
    expect(before.rows[0]?.c).toBe(4);

    // cutoff = currentBucket. Strict < means everything below current is gone,
    // the current bucket itself survives.
    const deleted = await pruneOlderThan(fx.db, currentBucket);
    expect(deleted).toBe(3);

    const after = await fx.client.execute('SELECT count(*) AS c FROM rate_limit_buckets');
    expect(after.rows[0]?.c).toBe(1);

    const surviving = await fx.client.execute('SELECT ip FROM rate_limit_buckets');
    expect(surviving.rows[0]?.ip).toBe('203.0.113.99');
  });

  test('concurrent same-IP calls (Promise.all of 4) all converge on count semantics', async () => {
    const ip = '198.51.100.99';
    const results = await Promise.all(
      Array.from({ length: 4 }, () => checkRateLimit(fx.db, ip, REF_NOW)),
    );
    const counts = results.map((r) => r.count).sort((a, b) => a - b);
    expect(counts).toEqual([1, 2, 3, 4]);
    expect(results.filter((r) => r.allowed)).toHaveLength(MAX_REQUESTS_PER_HOUR);
    expect(results.filter((r) => !r.allowed)).toHaveLength(1);
  });
});
