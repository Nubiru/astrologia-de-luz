/**
 * G_B-6 e2e pairing — `/panel/agenda` confirmed-calendar Completada /
 * No-show buttons honor the AC-2.2.5 time-guard.
 *
 * Spec anchors: S-1 AC-1.4.3 (per-row contents + time-guarded affordances
 * + past slots muted) + AC-2.2.5 (server-side time-guard contract:
 * `now >= startsAtUtc + durationMinutes * 60_000`) + AC-3.4.2 (no email
 * fires on confirmed→completed / confirmed→no_show).
 *
 * Fails when:
 *   - The `<h2>Agenda confirmada</h2>` section heading is missing.
 *   - A seeded future confirmed row's Completada / No-show buttons are
 *     NOT disabled (client-side time-guard regression).
 *   - A seeded past confirmed row's Completada button is disabled (the
 *     guard is supposed to satisfy when `now >= startsAtUtc + duration`).
 *   - Clicking Completada on a past row does NOT flip
 *     `sessions.status='completed'` within 10s.
 *   - The future row does NOT carry `data-past="false"`; the past row
 *     does NOT carry `data-past="true"`.
 *
 * Runtime: Playwright + Next dev server + Turso creds. Vitest excludes
 * `tests/e2e/**`; fires via `npm run test:e2e`.
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
      jti: `e2e-G_B-6-timeguard-${Date.now()}`,
    },
    maxAge: 7 * 24 * 60 * 60,
  });
}

function openDb(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error(
      'agenda-completada-time-guard.spec.ts: TURSO_DATABASE_URL must be set for e2e DB seeding.',
    );
  }
  const authToken = process.env.TURSO_AUTH_TOKEN;
  return createClient({ url, authToken });
}

interface SeedHandle {
  pastSessionId: string;
  futureSessionId: string;
  cleanup: () => Promise<void>;
}

async function seedConfirmedSessions(): Promise<SeedHandle> {
  const db = openDb();
  await db.execute('PRAGMA foreign_keys = ON');

  const teacherRows = await db.execute({
    sql: 'SELECT id FROM teachers WHERE active = 1 ORDER BY created_at ASC LIMIT 1',
    args: [],
  });
  const firstRow = teacherRows.rows[0];
  if (typeof firstRow === 'undefined') {
    throw new Error(
      'agenda-completada-time-guard.spec.ts: no active teacher row found — seed migration 0003 has not run.',
    );
  }
  const teacherId = String(firstRow.id);

  const baseId = `e2e-G_B-6-tg-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const pastSessionId = `${baseId}-past`;
  const futureSessionId = `${baseId}-future`;
  const now = Date.now();
  // Past slot: started 90 minutes ago. Duration 60 min → ended 30 min ago →
  // time-guard SATISFIED (now >= starts_at + 60min).
  const pastStartsAtUtc = now - 90 * 60 * 1000;
  // Future slot: starts in 12h → time-guard NOT satisfied.
  const futureStartsAtUtc = now + 12 * 60 * 60 * 1000;

  // The partial-unique index `sessions_teacher_slot_confirmed` enforces one
  // confirmed session per (teacher, starts_at_utc); both seeds use distinct
  // starts_at_utc to avoid that constraint.
  for (const [id, startsAt, name] of [
    [pastSessionId, pastStartsAtUtc, 'Pasado Visitante'],
    [futureSessionId, futureStartsAtUtc, 'Futuro Visitante'],
  ] as const) {
    await db.execute({
      sql: `INSERT INTO sessions
        (id, teacher_id, starts_at_utc, duration_minutes, status,
         visitor_name, visitor_email, contact_pref, contact_value,
         visitor_intent, visitor_timezone, decided_at, created_at, updated_at)
        VALUES (?, ?, ?, 60, 'confirmed', ?, ?, 'email', ?, ?, ?, ?, ?)`,
      args: [
        id,
        teacherId,
        startsAt,
        name,
        `${id}@example.test`,
        `${id}@example.test`,
        'Sesión confirmada de prueba.',
        'America/Argentina/Buenos_Aires',
        now,
        now,
        now,
      ],
    });
  }

  const cleanup = async (): Promise<void> => {
    const cleanupDb = openDb();
    for (const id of [pastSessionId, futureSessionId]) {
      await cleanupDb.execute({
        sql: 'DELETE FROM notify_log WHERE session_id = ?',
        args: [id],
      });
      await cleanupDb.execute({
        sql: 'DELETE FROM sessions WHERE id = ?',
        args: [id],
      });
    }
    cleanupDb.close();
  };

  db.close();
  return { pastSessionId, futureSessionId, cleanup };
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

test.describe('G_B-6 — confirmed-calendar time-guard surface (AC-1.4.3 + AC-2.2.5)', () => {
  let seed: SeedHandle | null = null;

  test.afterEach(async () => {
    if (seed !== null) {
      await seed.cleanup();
      seed = null;
    }
  });

  test('/panel/agenda renders <h2>Agenda confirmada</h2> with rows + time-guarded buttons', async ({
    page,
    context,
    baseURL,
  }) => {
    seed = await seedConfirmedSessions();

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

    // AC-1.4.1 — second section h2 is load-bearing.
    await expect(page.getByRole('heading', { level: 2, name: 'Agenda confirmada' })).toBeVisible();

    const pastRow = page.locator(`[data-confirmed-row][data-session-id="${seed.pastSessionId}"]`);
    const futureRow = page.locator(
      `[data-confirmed-row][data-session-id="${seed.futureSessionId}"]`,
    );

    await expect(pastRow).toBeVisible();
    await expect(futureRow).toBeVisible();

    // AC-1.4.3 — past=muted / future=normal via data-past attribute.
    await expect(pastRow).toHaveAttribute('data-past', 'true');
    await expect(futureRow).toHaveAttribute('data-past', 'false');

    // Time-guard surface — past row's buttons are enabled; future row's are
    // disabled. Both buttons (Completada + No-show) follow the same guard.
    const pastCompletada = pastRow.locator('button[data-action="completada"]');
    const pastNoShow = pastRow.locator('button[data-action="no-show"]');
    const futureCompletada = futureRow.locator('button[data-action="completada"]');
    const futureNoShow = futureRow.locator('button[data-action="no-show"]');

    await expect(pastCompletada).toBeEnabled();
    await expect(pastNoShow).toBeEnabled();
    await expect(futureCompletada).toBeDisabled();
    await expect(futureNoShow).toBeDisabled();
  });

  test('clicking Completada on a past confirmed row flips status to "completed"', async ({
    page,
    context,
    baseURL,
  }) => {
    seed = await seedConfirmedSessions();

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

    const pastRow = page.locator(`[data-confirmed-row][data-session-id="${seed.pastSessionId}"]`);
    await expect(pastRow).toBeVisible();

    await pastRow.locator('button[data-action="completada"]').click();

    // Server Component refetches → confirmed→completed leaves the row out
    // of the rolling window (status is no longer 'confirmed').
    await expect(pastRow).toHaveCount(0, { timeout: 10_000 });

    // Authoritative side-effect — DB row flipped to 'completed'.
    const finalStatus = await readSessionStatus(seed.pastSessionId);
    expect(finalStatus).toBe('completed');
  });
});
