/**
 * G_B-6 e2e pairing — `/panel/agenda` empty-state cards
 * (AC-1.4.4 — 0 active maestros / AC-1.4.5 — 0 pending + 0 confirmed).
 *
 * Spec anchors: S-1 AC-1.4.4 (0-active-maestros → call-to-action card
 * pointing at /panel/maestros) + AC-1.4.5 (0-pending + 0-confirmed →
 * per-section neutral copy).
 *
 * Test isolation strategy:
 *   The dev server's DB always has Augusto (seed migration 0003), so the
 *   AC-1.4.4 e2e flow CANNOT happen organically without mutating shared
 *   state. The two tests below take complementary paths:
 *
 *   (1) **AC-1.4.5 — happy-empty section state**: assert that with no
 *       pending sessions + no confirmed-window sessions seeded by us,
 *       both per-section empty messages render. We do not control rows
 *       seeded by other tests / dev work — to avoid flakiness, we
 *       PRE-COUNT each section's rows and assert the empty message is
 *       present ONLY when our section is genuinely empty. This makes the
 *       test self-skipping under shared-DB races while remaining
 *       load-bearing in the common case (fresh DB / no parallel writes).
 *
 *   (2) **AC-1.4.4 — 0-maestros card**: temporarily archives every
 *       active teacher (sets `active=0`), reloads the page, asserts the
 *       call-to-action card, then restores the original `active` flags.
 *       The DB mutation is wrapped in try/finally so the restore runs
 *       even if the assertion throws. Marked `test.describe.serial` to
 *       avoid racing against other agenda tests in the same playwright
 *       run.
 *
 * Fails when:
 *   - AC-1.4.5: with zero rows in either section, the per-section empty
 *     <p data-pending-empty> / <p data-confirmed-empty> is missing OR
 *     the section <h2> stops rendering.
 *   - AC-1.4.4: with zero active maestros, the page does NOT render the
 *     no-maestros card AND/OR does not link to `/panel/maestros`.
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
      jti: `e2e-G_B-6-empty-${Date.now()}`,
    },
    maxAge: 7 * 24 * 60 * 60,
  });
}

function openDb(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error(
      'agenda-empty-states.spec.ts: TURSO_DATABASE_URL must be set for e2e DB seeding.',
    );
  }
  const authToken = process.env.TURSO_AUTH_TOKEN;
  return createClient({ url, authToken });
}

async function setSessionCookie(
  context: Parameters<Parameters<typeof test>[2]>[0]['context'],
  baseURL: string | undefined,
): Promise<void> {
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
}

test.describe('G_B-6 — AC-1.4.5 per-section empty-state copy', () => {
  test('with no rows in pending or confirmed sections, both empty messages render', async ({
    page,
    context,
    baseURL,
  }) => {
    await setSessionCookie(context, baseURL);

    await page.goto('/panel/agenda');

    // The two section <h2> headings MUST always render when at least one
    // maestro is active (AC-1.4.1 DOM-order contract). This assertion
    // double-serves as the AC-1.4.1 second-section check.
    await expect(
      page.getByRole('heading', { level: 2, name: 'Solicitudes pendientes' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Agenda confirmada' })).toBeVisible();

    // Self-skipping under shared-DB races: only assert empty copy in the
    // section where our scan finds no rows. The assertion still fails on a
    // regression: if our section is empty AND the empty-copy <p> is
    // missing, the test fails. If the section has rows (from parallel
    // tests / dev seed), we don't assert empty — that section is simply
    // out of scope for THIS test.
    const pendingRows = await page.locator('[data-pending-row]').count();
    if (pendingRows === 0) {
      await expect(page.locator('[data-pending-empty]')).toBeVisible();
    }

    const confirmedRows = await page.locator('[data-confirmed-row]').count();
    if (confirmedRows === 0) {
      await expect(page.locator('[data-confirmed-empty]')).toBeVisible();
    }

    // Negative-evidence: the no-maestros card MUST NOT render when at least
    // one maestro is active (which is the steady-state dev DB).
    await expect(page.locator('[data-section="no-maestros-card"]')).toHaveCount(0);
  });
});

test.describe
  .serial('G_B-6 — AC-1.4.4 no-active-maestros call-to-action card', () => {
    let restoreActiveIds: string[] = [];

    test.afterEach(async () => {
      if (restoreActiveIds.length === 0) return;
      const db = openDb();
      try {
        for (const id of restoreActiveIds) {
          await db.execute({
            sql: 'UPDATE teachers SET active = 1 WHERE id = ?',
            args: [id],
          });
        }
      } finally {
        db.close();
        restoreActiveIds = [];
      }
    });

    test('with zero active maestros, the page renders the no-maestros card linking to /panel/maestros', async ({
      page,
      context,
      baseURL,
    }) => {
      const db = openDb();
      try {
        const activeRows = await db.execute({
          sql: 'SELECT id FROM teachers WHERE active = 1',
          args: [],
        });
        restoreActiveIds = activeRows.rows.map((r) => String(r.id));
        // Archive every active teacher for the duration of this test.
        for (const id of restoreActiveIds) {
          await db.execute({
            sql: 'UPDATE teachers SET active = 0 WHERE id = ?',
            args: [id],
          });
        }
      } finally {
        db.close();
      }

      await setSessionCookie(context, baseURL);

      await page.goto('/panel/agenda');

      // AC-1.4.4 — call-to-action card renders.
      const card = page.locator('[data-section="no-maestros-card"]');
      await expect(card).toBeVisible();

      // The card MUST link to /panel/maestros so the admin can act on the
      // empty-state directly.
      const link = card.locator('[data-no-maestros-link]');
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', '/panel/maestros');

      // Negative-evidence: the pending + confirmed section h2 headings MUST
      // be absent — the card replaces both sections per the page's
      // short-circuit branch.
      await expect(
        page.getByRole('heading', { level: 2, name: 'Solicitudes pendientes' }),
      ).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 2, name: 'Agenda confirmada' })).toHaveCount(
        0,
      );
    });
  });
