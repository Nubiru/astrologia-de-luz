/**
 * G_B-5 e2e pairing — `/panel/agenda` Rechazar button drives pending →
 * rejected AND fires the polite Spanish decline email (AC-3.4.2 +
 * `CONTENT_EMAIL.PUBLIC.visitorDeclined`).
 *
 * Spec anchors: S-1 AC-1.4.2 (Rechazar action triggers decline email per
 * MEGA CP-1 review hook 3 — courteous decline, not silent drop) +
 * AC-3.4.2 (pending→rejected dispatches `visitor_decline`) +
 * AC-3.3.1 (notify_log row written for every dispatch outcome).
 *
 * Fails when:
 *   - Clicking Rechazar does NOT flip the seeded row's `sessions.status`
 *     to `'rejected'` within 10 seconds.
 *   - The post-commit dispatcher does NOT write a `notify_log` row with
 *     `event_kind='visitor_decline'` + `session_id` matching the seeded
 *     row. The row's `outcome` may be `success` or `failure` depending on
 *     Resend env config — either is acceptable: what matters is the
 *     dispatcher actually ran the decline path (regression catches a
 *     mis-routed transition that picks the wrong CONTENT_EMAIL slot or
 *     skips the dispatcher entirely).
 *   - The Server Component fails to refetch → the just-rejected row stays
 *     visible in the pending list (router.refresh() regression).
 *
 * Runtime: Playwright + Next dev server + Turso creds. Same deferred-
 * runtime convention as `agenda-accept.spec.ts`.
 */

import { encode } from '@auth/core/jwt';
import { type Client, createClient } from '@libsql/client';
import { expect, test } from '@playwright/test';

const SESSION_COOKIE_NAME = 'authjs.session-token';
const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@allowed.test';
const E2E_ADMIN_NAME = 'E2E Admin';

async function craftSessionCookie(): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  return encode({
    salt: SESSION_COOKIE_NAME,
    secret: process.env.AUTH_SECRET ?? '',
    token: {
      sub: 'e2e-fixture-admin-id',
      email: E2E_ADMIN_EMAIL,
      name: E2E_ADMIN_NAME,
      iat: Math.floor(Date.now() / 1000),
      exp,
      jti: `e2e-G_B-5-reject-${Date.now()}`,
    },
    maxAge: 7 * 24 * 60 * 60,
  });
}

function openDb(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error(
      'agenda-reject-decline-email.spec.ts: TURSO_DATABASE_URL must be set for e2e DB seeding.',
    );
  }
  const authToken = process.env.TURSO_AUTH_TOKEN;
  return createClient({ url, authToken });
}

interface SeedHandle {
  sessionId: string;
  cleanup: () => Promise<void>;
}

async function seedPendingSession(): Promise<SeedHandle> {
  const db = openDb();
  await db.execute('PRAGMA foreign_keys = ON');

  const teacherRows = await db.execute({
    sql: 'SELECT id FROM teachers WHERE active = 1 ORDER BY created_at ASC LIMIT 1',
    args: [],
  });
  const firstRow = teacherRows.rows[0];
  if (typeof firstRow === 'undefined') {
    throw new Error(
      'agenda-reject-decline-email.spec.ts: no active teacher row found — seed migration 0003 has not run.',
    );
  }
  const teacherId = String(firstRow.id);

  const sessionId = `e2e-G_B-5-reject-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const startsAtUtc = Date.now() + 24 * 60 * 60 * 1000;
  const now = Date.now();

  await db.execute({
    sql: `INSERT INTO sessions
      (id, teacher_id, starts_at_utc, duration_minutes, status,
       visitor_name, visitor_email, contact_pref, contact_value,
       visitor_intent, visitor_timezone, created_at, updated_at)
      VALUES (?, ?, ?, 60, 'pending', ?, ?, 'email', ?, ?, ?, ?, ?)`,
    args: [
      sessionId,
      teacherId,
      startsAtUtc,
      'Mateo Suárez',
      'mateo+e2e-G_B-5@example.test',
      'mateo+e2e-G_B-5@example.test',
      'Quería preguntarle algo a Augusto.',
      'America/Argentina/Buenos_Aires',
      now,
      now,
    ],
  });

  const cleanup = async (): Promise<void> => {
    const cleanupDb = openDb();
    await cleanupDb.execute({
      sql: 'DELETE FROM notify_log WHERE session_id = ?',
      args: [sessionId],
    });
    await cleanupDb.execute({
      sql: 'DELETE FROM sessions WHERE id = ?',
      args: [sessionId],
    });
    cleanupDb.close();
  };

  db.close();
  return { sessionId, cleanup };
}

async function readSessionStatus(sessionId: string): Promise<string | null> {
  const db = openDb();
  try {
    const rows = await db.execute({
      sql: 'SELECT status FROM sessions WHERE id = ?',
      args: [sessionId],
    });
    const firstRow = rows.rows[0];
    if (typeof firstRow === 'undefined') return null;
    return String(firstRow.status);
  } finally {
    db.close();
  }
}

async function readDeclineLogCount(sessionId: string): Promise<number> {
  const db = openDb();
  try {
    const rows = await db.execute({
      sql: "SELECT COUNT(*) AS n FROM notify_log WHERE session_id = ? AND event_kind = 'visitor_decline'",
      args: [sessionId],
    });
    const firstRow = rows.rows[0];
    if (typeof firstRow === 'undefined') return 0;
    return Number(firstRow.n);
  } finally {
    db.close();
  }
}

test.describe('G_B-5 — Rechazar button drives pending→rejected + decline-email dispatch', () => {
  let seed: SeedHandle | null = null;

  test.afterEach(async () => {
    if (seed !== null) {
      await seed.cleanup();
      seed = null;
    }
  });

  test('clicking Rechazar flips status to rejected AND writes a visitor_decline notify_log row', async ({
    page,
    context,
    baseURL,
  }) => {
    seed = await seedPendingSession();

    const token = await craftSessionCookie();
    const url = new URL(baseURL ?? 'http://localhost:3000');
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: token,
        domain: url.hostname,
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    await page.goto('/panel/agenda');

    const row = page.locator(`[data-pending-row][data-session-id="${seed.sessionId}"]`);
    await expect(row).toBeVisible();

    await row.locator('button[data-action="rechazar"]').click();

    // The pending row drops out of the section after Server Component
    // refetches.
    await expect(row).toHaveCount(0, { timeout: 10_000 });

    // Authoritative side-effects:
    const finalStatus = await readSessionStatus(seed.sessionId);
    expect(finalStatus).toBe('rejected');

    // AC-3.3.1 + AC-3.4.2: pending→rejected MUST traverse the dispatcher's
    // visitor_decline branch and write at least one notify_log row tagged
    // with that event_kind. Success or failure outcome is acceptable — the
    // dispatcher writes EITHER way (see G_C-14 dispatch-transition).
    const declineLogCount = await readDeclineLogCount(seed.sessionId);
    expect(declineLogCount).toBeGreaterThan(0);
  });
});
