/**
 * G_B-7 e2e pairing — `/panel/agenda/notificaciones-fallidas` Reenviar
 * button drives POST `/api/notify/[id]/retry` and renders the toast
 * outcome.
 *
 * Spec anchors: S-1 AC-3.3.5 (button label from
 * `CONTENT_PANEL.NOTIFY.reenviar_button`; success/failure toast from the
 * matching `reenviar_*_toast` slots; trail row persisted regardless of
 * outcome).
 *
 * Fails when:
 *   - GET `/panel/agenda/notificaciones-fallidas` does not render the
 *     seeded failed-log row OR omits the Reenviar button.
 *   - Clicking Reenviar does NOT issue a POST to
 *     `/api/notify/[id]/retry` (the spy assertion catches it).
 *   - No new `notify_log` row is written after the click (AC-3.3.5
 *     trail-row contract).
 *   - The success / failure toast slot from
 *     `CONTENT_PANEL.NOTIFY.reenviar_*_toast` does not appear in the
 *     DOM after the click.
 *
 * Runtime: Playwright + Next dev server + Turso creds + Resend env. The
 * test does NOT mock Resend at the dev-server boundary; whether the
 * retry succeeds or fails depends on the real Resend response. To stay
 * deterministic, the assertion checks for EITHER toast slot string
 * (success OR failure) since both flow through `kind: 'retry_ok' |
 * 'retry_failed'` in the route handler. The load-bearing claim is
 * "the button fired the retry AND wrote a trail row" — not the
 * deliverability decision Resend makes.
 */

import { encode } from '@auth/core/jwt';
import { type Client, createClient } from '@libsql/client';
import { expect, test } from '@playwright/test';

const SESSION_COOKIE_NAME = 'authjs.session-token';
const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@allowed.test';
const E2E_ADMIN_NAME = 'E2E Admin';

const SUCCESS_TOAST_HINT = 'reenviada correctamente';
const FAILURE_TOAST_HINT = 'no se pudo reenviar';

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
      jti: `e2e-G_B-7-reenviar-${Date.now()}`,
    },
    maxAge: 7 * 24 * 60 * 60,
  });
}

function openDb(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('reenviar-button.spec.ts: TURSO_DATABASE_URL must be set for e2e DB seeding.');
  }
  const authToken = process.env.TURSO_AUTH_TOKEN;
  return createClient({ url, authToken });
}

interface SeedHandle {
  sessionId: string;
  failedLogId: string;
  cleanup: () => Promise<void>;
}

async function seedFailedLog(): Promise<SeedHandle> {
  const db = openDb();
  await db.execute('PRAGMA foreign_keys = ON');

  const teacherRows = await db.execute({
    sql: 'SELECT id FROM teachers WHERE active = 1 ORDER BY created_at ASC LIMIT 1',
    args: [],
  });
  const firstRow = teacherRows.rows[0];
  if (typeof firstRow === 'undefined') {
    throw new Error('reenviar-button.spec.ts: no active teacher row found.');
  }
  const teacherId = String(firstRow.id);

  const baseId = `e2e-G_B-7-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const sessionId = `${baseId}-session`;
  const failedLogId = `${baseId}-log`;
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
      now + 24 * 60 * 60 * 1000,
      'Reenviar Visitante',
      `${baseId}@example.test`,
      `${baseId}@example.test`,
      'Solicitud para test e2e.',
      'America/Argentina/Buenos_Aires',
      now,
      now,
    ],
  });

  // Seed a status=503 visitor_confirm failure — the dispatcher would have
  // produced this if Resend returned 503 on the original send.
  await db.execute({
    sql: `INSERT INTO notify_log
      (id, session_id, event_kind, channel, recipient, status, error_body, attempt_number, created_at)
      VALUES (?, ?, ?, 'resend', ?, 503, ?, 1, ?)`,
    args: [
      failedLogId,
      sessionId,
      'visitor_confirm',
      `${baseId}@example.test`,
      'Seeded failure for e2e reenviar test.',
      now - 60_000,
    ],
  });

  const cleanup = async (): Promise<void> => {
    const cleanupDb = openDb();
    // ON DELETE CASCADE on notify_log.session_id → DELETE FROM sessions
    // takes the log rows with it. Explicit delete first keeps the test
    // independent of FK cascade ordering across libsql versions.
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
  return { sessionId, failedLogId, cleanup };
}

async function countNotifyLogRowsForSession(sessionId: string): Promise<number> {
  const db = openDb();
  try {
    const rows = await db.execute({
      sql: 'SELECT COUNT(*) AS n FROM notify_log WHERE session_id = ?',
      args: [sessionId],
    });
    const firstRow = rows.rows[0];
    if (typeof firstRow === 'undefined') return 0;
    return Number(firstRow.n);
  } finally {
    db.close();
  }
}

test.describe('G_B-7 — Reenviar button drives /api/notify/[id]/retry + writes trail row', () => {
  let seed: SeedHandle | null = null;

  test.afterEach(async () => {
    if (seed !== null) {
      await seed.cleanup();
      seed = null;
    }
  });

  test('GET /panel/agenda/notificaciones-fallidas renders seeded failed-log row with Reenviar button', async ({
    page,
    context,
    baseURL,
  }) => {
    seed = await seedFailedLog();

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

    const response = await page.goto('/panel/agenda/notificaciones-fallidas');
    expect(response?.status()).toBe(200);

    // Page heading is the load-bearing AC-3.3.5 surface.
    await expect(
      page.getByRole('heading', { level: 1, name: 'Notificaciones fallidas' }),
    ).toBeVisible();

    const row = page.locator(`[data-failed-row][data-log-id="${seed.failedLogId}"]`);
    await expect(row).toBeVisible();

    // Row contents — event + channel + status + Reenviar button.
    await expect(row.locator('[data-field="event"]')).toHaveText('visitor_confirm');
    await expect(row.locator('[data-field="channel"]')).toHaveText('resend');
    await expect(row.locator('[data-field="status"]')).toHaveText('503');
    await expect(row.locator('button[data-action="reenviar"]')).toBeVisible();
    await expect(row.locator('button[data-action="reenviar"]')).toHaveText('Reenviar');
  });

  test('clicking Reenviar issues POST /api/notify/[id]/retry, writes a trail row, and renders a toast', async ({
    page,
    context,
    baseURL,
  }) => {
    seed = await seedFailedLog();

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

    // Spy on the outgoing POST so we get evidence the click reached the
    // endpoint REGARDLESS of the eventual toast colour.
    const retryRequestPromise = page.waitForRequest(
      (req) =>
        req.method() === 'POST' && req.url().endsWith(`/api/notify/${seed?.failedLogId}/retry`),
      { timeout: 10_000 },
    );

    await page.goto('/panel/agenda/notificaciones-fallidas');

    const row = page.locator(`[data-failed-row][data-log-id="${seed.failedLogId}"]`);
    await expect(row).toBeVisible();

    const preCount = await countNotifyLogRowsForSession(seed.sessionId);
    await row.locator('button[data-action="reenviar"]').click();
    await retryRequestPromise;

    // The toast renders one of the two AC-3.3.5 outcomes. Both are valid
    // signals that the button → endpoint → trail-row pipeline ran end-to-end.
    const toast = row.locator('[data-toast]');
    await expect(toast).toBeVisible({ timeout: 10_000 });
    const toastText = ((await toast.textContent()) ?? '').toLowerCase();
    expect(toastText.includes(SUCCESS_TOAST_HINT) || toastText.includes(FAILURE_TOAST_HINT)).toBe(
      true,
    );

    // Trail-row contract — AC-3.3.5: every retry inserts a new notify_log
    // row regardless of outcome. Count grew by exactly 1.
    const postCount = await countNotifyLogRowsForSession(seed.sessionId);
    expect(postCount).toBe(preCount + 1);
  });
});
