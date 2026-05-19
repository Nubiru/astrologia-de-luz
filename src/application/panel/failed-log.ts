/**
 * Failed-notification log queries (G_B-7).
 *
 * Spec anchors: S-1 AC-3.3.1 (notify_log row contract) + AC-3.3.2
 * (`/panel/agenda` banner threshold) + AC-3.3.5 (`/panel/agenda/
 * notificaciones-fallidas` read-only listing).
 *
 * Both helpers are pure DI — caller passes the libSQL database handle.
 * Production wires `getDb()` from `@/infrastructure/db/client`; tests
 * pass an in-memory libsql created via `drizzle(createClient({url:
 * 'file:...'}))`. No reads of `process.env` or composition state here —
 * the integration pairing exercises the SELECT shapes directly.
 *
 * "Failed" semantics:
 *   notify_log accumulates two row classes:
 *     (a) Original failures written by `dispatch-pending` /
 *         `dispatch-transition` via `NotifyLog.persistFailures()` —
 *         these are by construction non-2xx (status===0 OR status>=400).
 *     (b) Retry trail rows written by `retry-failed` regardless of
 *         outcome — these can have status===200 (successful retry).
 *   The list / banner surface MUST exclude the successful-retry trail
 *   rows so Augusto sees only what still needs his attention.
 *
 *   Failure filter: `status === 0 OR status >= 400`. Equivalent to
 *   "not in 2xx range" — the dispatcher writes 200 on success and the
 *   actual upstream HTTP status (or 0 for synchronous throws) otherwise.
 *   Tests probe both edges of the filter (status=0 + status=503).
 */

import { and, desc, eq, gte, or, sql } from 'drizzle-orm';

import type { Db } from '@/infrastructure/db/client';
import { notifyLog } from '@/infrastructure/db/schema';

export interface FailedNotifyRow {
  id: string;
  sessionId: string;
  eventKind: string;
  channel: string;
  recipient: string;
  status: number;
  errorBody: string | null;
  attemptNumber: number;
  createdAt: number;
}

export const FAILED_LOG_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Returns the count of failed notify_log rows whose `created_at` is at
 * or after `sinceMs`. Drives the AC-3.3.2 banner on `/panel/agenda`.
 */
export async function countFailedNotifyLogs(db: Db, sinceMs: number): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifyLog)
    .where(
      and(
        gte(notifyLog.createdAt, sinceMs),
        // Failure: status outside 2xx. SQLite has no native "between" for
        // negation; explicit OR is the cheapest correct shape.
        or(eq(notifyLog.status, 0), gte(notifyLog.status, 400)),
      ),
    );
  const firstRow = rows[0];
  return firstRow ? Number(firstRow.count) : 0;
}

/**
 * Returns failed notify_log rows whose `created_at` is at or after
 * `sinceMs`, ordered most-recent first. Drives the AC-3.3.5 listing
 * surface at `/panel/agenda/notificaciones-fallidas`.
 *
 * Caller is responsible for any UI-side projection (e.g., truncating
 * `error_body`); this function returns the raw column values so the
 * integration pairing can assert per-row shapes without first
 * round-tripping through React.
 */
export async function selectFailedNotifyLogs(db: Db, sinceMs: number): Promise<FailedNotifyRow[]> {
  const rows = await db
    .select({
      id: notifyLog.id,
      sessionId: notifyLog.sessionId,
      eventKind: notifyLog.eventKind,
      channel: notifyLog.channel,
      recipient: notifyLog.recipient,
      status: notifyLog.status,
      errorBody: notifyLog.errorBody,
      attemptNumber: notifyLog.attemptNumber,
      createdAt: notifyLog.createdAt,
    })
    .from(notifyLog)
    .where(
      and(
        gte(notifyLog.createdAt, sinceMs),
        or(eq(notifyLog.status, 0), gte(notifyLog.status, 400)),
      ),
    )
    .orderBy(desc(notifyLog.createdAt));
  return rows;
}
