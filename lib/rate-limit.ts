/**
 * lib/rate-limit.ts — IP rate-limit + IP-resolution helpers.
 *
 * Spec anchors: S-1 AC-3.5.3 (≤ 3 requests / IP / rolling 1-hour window),
 * AC-3.5.4 (`x-forwarded-for` first entry → `x-real-ip` → `'unknown'`),
 * AC-3.5.5 (opportunistic prune every ~100th call instead of cron infra —
 * D-024 locked the prune approach in lieu of scheduling overhead).
 *
 * Implementation choice — Simplicity Test rationale: one column on one tiny
 * `rate_limit_buckets` table (PK `(ip, hour_bucket)`) replaces an entire
 * Vercel KV / Upstash provisioning step. The UTC-hour bucket scheme means
 * the "rolling window" is an approximation — a single IP that fires 3
 * requests at 12:59 then 3 more at 13:00 sees 6 in ~1 minute — but the
 * anti-abuse layer's job is to defeat scripts that pound the form at
 * volume, NOT to enforce a strict sliding window. The honeypot + 800ms
 * min-fill-time gates (AC-3.5.1 / AC-3.5.2) handle the timing dimension.
 *
 * The mutation uses libsql's `INSERT ... ON CONFLICT(ip, hour_bucket) DO
 * UPDATE SET count = count + 1 RETURNING count` so the read-after-write is
 * atomic — no TOCTOU window between SELECT and UPDATE under concurrent
 * fan-out from the same IP.
 */

import { sql } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';

import { rateLimitBuckets } from '@/db/schema';

export const MAX_REQUESTS_PER_HOUR = 3;
export const HOUR_MS = 3_600_000;
export const RETENTION_HOURS = 24;
const PRUNE_PROBABILITY = 1 / 100;

export type RateLimitResult = {
  /** `true` when the request is within budget (`count ≤ MAX_REQUESTS_PER_HOUR`). */
  allowed: boolean;
  /** Cumulative request count in the current hour bucket, including this one. */
  count: number;
  /**
   * Seconds until the next hour bucket starts. 0 when `allowed === true`;
   * > 0 (and ≤ 3600) when `allowed === false`. Wire this to the 429
   * response's `Retry-After` header per AC-3.5.3.
   */
  retryAfterSeconds: number;
  /** The hour bucket the request landed in — exposed for telemetry. */
  hourBucket: number;
};

/**
 * Resolve the caller IP from request headers per AC-3.5.4.
 *
 * Order: first comma-separated entry of `x-forwarded-for` (Vercel's edge
 * sets this; the first entry is the original client) → `x-real-ip` (some
 * proxies set this instead) → literal string `'unknown'` (final fallback;
 * all unknown-IP callers then share one rate-limit bucket — acceptable
 * degraded mode per the spec).
 *
 * Pure function — no I/O, no globals. Safe for the unit pairing to drive
 * with handcrafted `Headers` instances.
 */
export function resolveIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const xri = headers.get('x-real-ip')?.trim();
  if (xri) return xri;
  return 'unknown';
}

/**
 * Increment the (ip, hour_bucket) counter and return the rate-limit verdict.
 *
 * Side effects:
 *   - INSERT-or-UPDATE on `rate_limit_buckets` (always — every call
 *     increments the bucket).
 *   - On ~1% of calls, DELETEs rows older than 24h (opportunistic prune,
 *     AC-3.5.5). The prune is fire-and-forget within the same function —
 *     a stale-row DELETE failure does NOT propagate as a rate-limit error
 *     (caught locally; the bucket increment is the load-bearing side
 *     effect).
 *
 * The `now` parameter exists so the integration pairing can pin time at a
 * fixed reference and exercise the hour-bucket boundary without `vi.useFakeTimers()`
 * (which interacts poorly with libsql's internal timers).
 */
export async function checkRateLimit<TSchema extends Record<string, unknown>>(
  db: LibSQLDatabase<TSchema>,
  ip: string,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const hourBucket = Math.floor(now / HOUR_MS);
  const rows = await db
    .insert(rateLimitBuckets)
    .values({ ip, hourBucket, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimitBuckets.ip, rateLimitBuckets.hourBucket],
      set: { count: sql`${rateLimitBuckets.count} + 1` },
    })
    .returning({ count: rateLimitBuckets.count });
  const count = rows[0]?.count ?? 1;

  if (Math.random() < PRUNE_PROBABILITY) {
    // Opportunistic prune. Errors here MUST NOT bubble — a stale-row DELETE
    // failure is strictly cosmetic and the caller still needs the verdict.
    try {
      await pruneOlderThan(db, hourBucket - RETENTION_HOURS);
    } catch {
      /* swallow — see comment above */
    }
  }

  if (count <= MAX_REQUESTS_PER_HOUR) {
    return { allowed: true, count, retryAfterSeconds: 0, hourBucket };
  }
  const msToNextBucket = (hourBucket + 1) * HOUR_MS - now;
  return {
    allowed: false,
    count,
    retryAfterSeconds: Math.max(1, Math.ceil(msToNextBucket / 1000)),
    hourBucket,
  };
}

/**
 * Delete `rate_limit_buckets` rows whose `hour_bucket` is strictly less
 * than `cutoffHourBucket`. Exposed for the integration pairing AND as the
 * primitive the opportunistic prune calls internally.
 *
 * Returns the number of rows removed (libsql `rowsAffected`); useful as an
 * assertion target in the pairing.
 */
export async function pruneOlderThan<TSchema extends Record<string, unknown>>(
  db: LibSQLDatabase<TSchema>,
  cutoffHourBucket: number,
): Promise<number> {
  const result = await db.delete(rateLimitBuckets).where(sql`hour_bucket < ${cutoffHourBucket}`);
  return result.rowsAffected ?? 0;
}
