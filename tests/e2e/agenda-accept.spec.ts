/**
 * G_B-5 e2e pairing — `/panel/agenda` Aceptar button drives pending →
 * confirmed via PATCH `/api/sessions/[id]`.
 *
 * Spec anchors: S-1 AC-1.4.1 (pending section h2 + DOM order) +
 * AC-1.4.2 (per-row contents + Aceptar action triggers confirm dispatch) +
 * AC-3.4.2 (pending→confirmed dispatches visitorConfirmed via the
 * post-commit dispatcher).
 *
 * Fails when:
 *   - `/panel/agenda` no longer renders `<h2>Solicitudes pendientes</h2>`
 *     (AC-1.4.1 section heading regression).
 *   - A seeded pending row stops rendering its load-bearing fields:
 *     maestro name, slot in maestro TZ, visitor name + email, contact
 *     channel + value, intent. Each is asserted individually so the
 *     specific failure mode is visible.
 *   - The intent "Ver más" toggle no longer renders for an intent > 120
 *     chars (truncation contract).
 *   - Clicking Aceptar does NOT flip the seeded row's `sessions.status`
 *     to `'confirmed'` in the database within 10 seconds (the underlying
 *     PATCH route + post-commit dispatch are integration-tested at
 *     `tests/integration/patch-sessions-6x6.test.ts`; this spec verifies
 *     the UI → HTTP plumbing).
 *   - The Server Component does not refetch after the click → the just-
 *     actioned row stays visible (router.refresh() regression).
 *
 * Runtime: Playwright + Next dev server + AUTH_SECRET + ADMIN_EMAILS
 * (must include `E2E_ADMIN_EMAIL`) + Turso creds. Vitest excludes
 * `tests/e2e/**`; fires via `npm run test:e2e` per the G_B-4 / G_A-7
 * deferred-runtime convention.
 *
 * Seed isolation: each test seeds a pending row with a deterministic
 * `e2e-G_B-5-accept-<random>` id, runs the assertions, then deletes the
 * row + the row's notify_log children at afterEach. Cleanup is
 * idempotent — `DELETE WHERE id = ?` is a no-op if the row was already
 * removed (which it will be on the test that flips the row).
 */

import { encode } from '@auth/core/jwt';
import { type Client, createClient } from '@libsql/client';
import { expect, test } from '@playwright/test';

const SESSION_COOKIE_NAME = 'authjs.session-token';
const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@allowed.test';
const E2E_ADMIN_NAME = 'E2E Admin';

const LONG_INTENT =
  'Vengo buscando claridad sobre una transición laboral que me viene rondando hace varios meses, y siento que el cielo me puede ayudar a ver qué viene. Necesito hablarlo con alguien que sepa.';

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
      jti: `e2e-G_B-5-${Date.now()}`,
    },
    maxAge: 7 * 24 * 60 * 60,
  });
}

function openDb(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error(
      'agenda-accept.spec.ts: TURSO_DATABASE_URL must be set for e2e DB seeding. ' +
        'Run via `npm run test:e2e` with `.env.local` populated.',
    );
  }
  const authToken = process.env.TURSO_AUTH_TOKEN;
  return createClient({ url, authToken });
}

interface SeedHandle {
  sessionId: string;
  teacherId: string;
  cleanup: () => Promise<void>;
}

async function seedPendingSession(intent: string): Promise<SeedHandle> {
  const db = openDb();
  await db.execute('PRAGMA foreign_keys = ON');

  // Reuse Augusto's seeded row from migration 0003 — every fresh DB has it.
  // Tests stay decoupled from a specific id by looking up the brand-owner row.
  const teacherRows = await db.execute({
    sql: 'SELECT id FROM teachers WHERE active = 1 ORDER BY created_at ASC LIMIT 1',
    args: [],
  });
  const firstRow = teacherRows.rows[0];
  if (typeof firstRow === 'undefined') {
    throw new Error(
      'agenda-accept.spec.ts: no active teacher row found — seed migration 0003 has not run.',
    );
  }
  const teacherId = String(firstRow.id);

  const sessionId = `e2e-G_B-5-accept-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  // Slot 24h in the future — pending sessions don't trigger the time guard
  // (only confirmed→completed / no_show do).
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
      'Carolina Estévez',
      'carolina+e2e-G_B-5@example.test',
      'carolina+e2e-G_B-5@example.test',
      intent,
      'America/Argentina/Cordoba',
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
  return { sessionId, teacherId, cleanup };
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

test.describe('G_B-5 — /panel/agenda renders pending row with required fields (AC-1.4.1 + AC-1.4.2)', () => {
  let seed: SeedHandle | null = null;

  test.afterEach(async () => {
    if (seed !== null) {
      await seed.cleanup();
      seed = null;
    }
  });

  test('GET /panel/agenda renders <h2>Solicitudes pendientes</h2> for an authed admin', async ({
    page,
    context,
    baseURL,
  }) => {
    seed = await seedPendingSession(LONG_INTENT);

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

    const response = await page.goto('/panel/agenda');
    expect(response?.status()).toBe(200);

    // AC-1.4.1 — section h2 is load-bearing.
    await expect(
      page.getByRole('heading', { level: 2, name: 'Solicitudes pendientes' }),
    ).toBeVisible();
  });

  test('the seeded pending row renders maestro name + slot + visitor + contact + intent', async ({
    page,
    context,
    baseURL,
  }) => {
    seed = await seedPendingSession(LONG_INTENT);

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

    // AC-1.4.2 per-row field assertions — each load-bearing, each its own
    // assertion so the precise failure mode surfaces.
    await expect(row.locator('[data-field="maestro"]')).not.toBeEmpty();
    await expect(row.locator('[data-field="slot-maestro"]')).not.toBeEmpty();
    // Seed uses America/Argentina/Cordoba for visitor; maestro defaults to
    // America/Argentina/Buenos_Aires. Both are -03 in 2026; visitor TZ
    // string differs from maestro, so the dual-TZ second line MUST render.
    await expect(row.locator('[data-field="slot-visitor"]')).toHaveAttribute(
      'data-tz',
      'America/Argentina/Cordoba',
    );
    await expect(row.locator('[data-field="visitor-name"]')).toHaveText('Carolina Estévez');
    await expect(row.locator('[data-field="visitor-email"]')).toHaveText(
      'carolina+e2e-G_B-5@example.test',
    );
    await expect(row.locator('[data-field="contact-channel"]')).toHaveText('email');
    await expect(row.locator('[data-field="contact-value"]')).toHaveText(
      'carolina+e2e-G_B-5@example.test',
    );

    // AC-1.4.2 — intent > 120 chars MUST collapse into a <details> toggle
    // with the literal "Ver más" affordance.
    const details = row.locator('details[data-field="intent-details"]');
    await expect(details).toBeVisible();
    await expect(row.locator('[data-field="intent-vermas"]')).toHaveText('Ver más');
    // Preview is truncated; full text is hidden under <details> until open.
    const preview = await row.locator('[data-field="intent-preview"]').textContent();
    expect(preview?.length ?? 0).toBeLessThanOrEqual(120);
    expect(preview?.endsWith('…') ?? false).toBe(true);
  });
});

test.describe('G_B-5 — Aceptar button flips status to confirmed (AC-1.4.2 + AC-3.4.2)', () => {
  let seed: SeedHandle | null = null;

  test.afterEach(async () => {
    if (seed !== null) {
      await seed.cleanup();
      seed = null;
    }
  });

  test('clicking Aceptar drives the seeded pending row to status=confirmed in the DB', async ({
    page,
    context,
    baseURL,
  }) => {
    seed = await seedPendingSession('Quiero claridad sobre un cambio.');

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

    // Click the Aceptar button scoped to THIS row — the page may show many
    // pending rows in production; this assertion stays valid in either case.
    await row.locator('button[data-action="aceptar"]').click();

    // The Server Component re-fetches after router.refresh(); the row drops
    // out of the pending list. Negative-evidence assertion: the row is gone.
    await expect(row).toHaveCount(0, { timeout: 10_000 });

    // Authoritative side-effect — the DB row flipped.
    const finalStatus = await readSessionStatus(seed.sessionId);
    expect(finalStatus).toBe('confirmed');
  });
});
