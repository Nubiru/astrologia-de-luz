/**
 * G_C-10 integration pairing #2 — 409 slot-taken with `availableSlots` body.
 *
 * Spec anchors: S-1 AC-3.1.2 step 4, AC-3.1.3, AC-3.6.1, R-5.
 *
 * What this catches:
 *   - The slot re-derive is dropped — a slot already confirmed by another
 *     visitor would silently succeed and trigger a SQLITE_CONSTRAINT on the
 *     partial-unique index at the next status transition. Visitors see a
 *     happy 201; the panel double-books.
 *   - The 409 body is a bare string / wrong shape — pool-a's G_A-9 client
 *     expects `{ kind: 'slot_taken', availableSlots: [...] }` to re-render
 *     the slot grid in-place per AC-3.6.1.
 *   - `availableSlots` accidentally includes the just-taken slot (means the
 *     subtraction is wrong, or the deriver ran against the pre-INSERT state).
 *   - The dispatcher fires on 409 — there is no session row, the side-effect
 *     would be a leak.
 *   - The body sneaks back-channel info (visitor PII of the existing
 *     confirmed booking). The shape is { availableSlots } only.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  const { closeSync, mkdtempSync, openSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const TMP = mkdtempSync(join(tmpdir(), 'gc10-409-'));
  const DB_PATH = join(TMP, 'test.db');
  closeSync(openSync(DB_PATH, 'w'));
  for (const [k, v] of Object.entries({
    TURSO_DATABASE_URL: `file:${DB_PATH}`,
    TURSO_AUTH_TOKEN: 'fixture-token',
    AUTH_SECRET: 'c'.repeat(48),
    AUTH_URL: 'http://localhost:3000',
    AUTH_RESEND_KEY: 're_fixture_409_test',
    RESEND_FROM: 'Astrologia de Luz <no-reply@409-test.test>',
    ADMIN_EMAILS: 'augusto@astrologiadeluz.com',
    TELEGRAM_BOT_TOKEN: '1:409-token',
    TELEGRAM_BOT_USERNAME: 'Conflict409Bot',
    TELEGRAM_WEBHOOK_SECRET: 'd'.repeat(48),
  })) {
    process.env[k] = v;
  }
});

const fx = vi.hoisted(() => ({ dispatchCalls: [] as unknown[] }));

vi.mock('@/lib/notify/dispatch-pending', () => ({
  dispatchPending: vi.fn(async (input: unknown) => {
    fx.dispatchCalls.push(input);
    return { outcomes: [], failures: [] };
  }),
}));

const REPO_ROOT = resolve(__dirname, '..', '..');
const MIGRATION_FILES = [
  '0000_init.sql',
  '0001_authjs.sql',
  '0002_cp3_tables.sql',
  '0003_seed_augusto.sql',
] as const;
const AUGUSTO_AVAIL = JSON.stringify({
  tz: 'America/Argentina/Buenos_Aires',
  windows: [
    // Every weekday from 12:00-15:00 BSAS so we have 3 slots per weekday.
    ...[0, 1, 2, 3, 4, 5, 6].map((w) => ({
      weekday: w,
      start: '12:00',
      end: '15:00',
    })),
  ],
  blackouts: [],
});

const renderSeed = (sql: string, email: string): string => sql.split('$$ADMIN_EMAIL$$').join(email);

const splitStatements = (raw: string): string[] =>
  raw
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

type RoutePOST = (request: NextRequest) => Promise<Response>;
let routePOST: RoutePOST;
let dbClient: ReturnType<typeof import('@/db/client')['getClient']>;

// Tomorrow at 12:00 BSAS = 15:00Z.
const tomorrowSlotUtc = (): Date => {
  const t = new Date(new Date().getTime() + 24 * 60 * 60 * 1000);
  t.setUTCHours(15, 0, 0, 0);
  return t;
};

const buildBody = (slotIso: string): Record<string, unknown> => ({
  teacherSlug: 'augusto-rocha',
  slotUtcIso: slotIso,
  visitorName: 'Visitante Conflicto',
  visitorEmail: 'visitante.conflicto@example.test',
  contactPref: 'email',
  contactValue: 'visitante.conflicto@example.test',
  visitorTimezone: 'America/Argentina/Buenos_Aires',
  acceptsPending: true,
  companyName: '',
  _t: 1500,
});

const callPost = (body: Record<string, unknown>) =>
  routePOST(
    new NextRequest('http://localhost:3000/api/sessions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.20',
      },
      body: JSON.stringify(body),
    }),
  );

beforeAll(async () => {
  const dbMod = await import('@/db/client');
  dbClient = dbMod.getClient();
  await dbClient.execute('PRAGMA foreign_keys = ON');
  for (const file of MIGRATION_FILES) {
    const raw = readFileSync(resolve(REPO_ROOT, 'db', 'migrations', file), 'utf8');
    const sql =
      file === '0003_seed_augusto.sql' ? renderSeed(raw, 'augusto@astrologiadeluz.com') : raw;
    for (const stmt of splitStatements(sql)) {
      await dbClient.execute(stmt);
    }
  }
  await dbClient.execute({
    sql: 'UPDATE teachers SET availability = ? WHERE slug = ?',
    args: [AUGUSTO_AVAIL, 'augusto-rocha'],
  });

  // Pre-seed a CONFIRMED session at tomorrow's 12:00 BSAS = 15:00Z slot. The
  // re-derive in the route must subtract this from the derivable set.
  const taken = tomorrowSlotUtc();
  await dbClient.execute({
    sql: `INSERT INTO sessions
            (id, teacher_id, starts_at_utc, duration_minutes, status,
             visitor_name, visitor_email, contact_pref, contact_value,
             created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      'taken-slot-session-id',
      'augusto-rocha-uuid-stable',
      taken.getTime(),
      60,
      'confirmed',
      'Booked Visitor',
      'booked@example.test',
      'email',
      'booked@example.test',
      Date.now(),
      Date.now(),
    ],
  });

  const routeMod = await import('@/app/api/sessions/route');
  routePOST = routeMod.POST as unknown as RoutePOST;
}, 30_000);

afterAll(() => {
  dbClient?.close();
});

describe('POST /api/sessions — 409 slot-taken (AC-3.1.2 step 4 + AC-3.1.3)', () => {
  test('returns 409 with kind=slot_taken when the slot is already confirmed', async () => {
    fx.dispatchCalls.length = 0;
    const slotIso = tomorrowSlotUtc().toISOString();
    const res = await callPost(buildBody(slotIso));

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      kind: string;
      error: string;
      availableSlots: string[];
    };
    expect(body.kind).toBe('slot_taken');
    expect(body.error).toMatch(/Ese horario/);
    expect(Array.isArray(body.availableSlots)).toBe(true);
  });

  test('the availableSlots array EXCLUDES the just-taken slot (subtraction works)', async () => {
    fx.dispatchCalls.length = 0;
    const slotIso = tomorrowSlotUtc().toISOString();
    const res = await callPost(buildBody(slotIso));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { availableSlots: string[] };
    expect(body.availableSlots).not.toContain(slotIso);
    // Sanity: with the BSAS 12:00-15:00 window, the OTHER two slots
    // tomorrow at 16:00Z (13:00 BSAS) and 17:00Z (14:00 BSAS) should be
    // listed.
    const tomorrowOtherSlot1 = (() => {
      const t = tomorrowSlotUtc();
      t.setUTCHours(16, 0, 0, 0);
      return t.toISOString();
    })();
    expect(body.availableSlots).toContain(tomorrowOtherSlot1);
  });

  test('does NOT fire the notification dispatcher on a 409', async () => {
    fx.dispatchCalls.length = 0;
    await callPost(buildBody(tomorrowSlotUtc().toISOString()));
    expect(fx.dispatchCalls).toHaveLength(0);
  });

  test('does NOT leak the booked visitor PII in the response body', async () => {
    fx.dispatchCalls.length = 0;
    const res = await callPost(buildBody(tomorrowSlotUtc().toISOString()));
    const raw = await res.text();
    expect(raw).not.toContain('Booked Visitor');
    expect(raw).not.toContain('booked@example.test');
  });

  test('does NOT INSERT a duplicate row on 409 (rollback invariant)', async () => {
    fx.dispatchCalls.length = 0;
    await callPost(buildBody(tomorrowSlotUtc().toISOString()));
    const count = await dbClient.execute({
      sql: 'SELECT COUNT(*) AS n FROM sessions WHERE starts_at_utc = ?',
      args: [tomorrowSlotUtc().getTime()],
    });
    expect(count.rows[0]?.n).toBe(1); // only the pre-seeded confirmed row
  });
});
