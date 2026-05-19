/**
 * G_C-11 pairing — decided_at first-transition + note-only + auth-gate
 * (AC-2.2.5, AC-3.4.1, AC-3.4.4).
 *
 * Locks the three invariants the 6×6 matrix pairing doesn't cover:
 *
 *   1. **decided_at first-write** — populated on the FIRST non-pending
 *      transition, NEVER bumped on a subsequent transition. The spec is
 *      explicit: `Sets decided_at = Date.now() if currently NULL`. A
 *      regression that re-writes decided_at on every transition would
 *      destroy the "when did Augusto first respond" signal Augusto's
 *      SLA dashboard depends on.
 *
 *   2. **note-only variant** (AC-3.4.4) — body `{ note: string }` updates
 *      `notes_internal` without changing status and without firing any
 *      email side-effect. Returns 200 + `kind: 'note_updated'`.
 *
 *   3. **auth-gate** (AC-3.4.1) — unauthenticated callers get 401; on-list
 *      session emails get through; off-list session emails (which would
 *      only appear if `ADMIN_EMAILS` was rotated and an old cookie is
 *      still valid) get 401 as defense-in-depth.
 *
 * Assertions FAIL when:
 *   - The mutation layer drops the `decided_at = NULL` precondition and
 *     bumps the column on every transition.
 *   - The note-only branch starts firing the transition dispatcher.
 *   - The auth-gate accepts a session whose email is not in ADMIN_EMAILS.
 */

import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { type Client, createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { type LibSQLDatabase, drizzle } from 'drizzle-orm/libsql';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const fx = vi.hoisted(() => ({
  authResult: { user: { email: 'admin@allowed.test' } } as { user: { email: string } } | null,
  dispatchCalls: [] as Array<{ from: string; to: string; sessionId: string }>,
}));

vi.mock('@/infrastructure/env', () => ({
  getEnv: () => ({
    ADMIN_EMAILS: 'admin@allowed.test',
    TELEGRAM_BOT_TOKEN: '0000:test-token',
    AUTH_RESEND_KEY: 're_test',
    RESEND_FROM: 'no-reply@astrologiadeluz.com',
  }),
}));

vi.mock('@/infrastructure/auth/config', () => ({
  auth: vi.fn(async () => fx.authResult),
}));

vi.mock('@/application/notify/dispatch-transition', () => ({
  dispatchTransition: vi.fn(
    async (input: {
      session: { id: string; status: string };
      previousStatus: string;
    }) => {
      fx.dispatchCalls.push({
        from: input.previousStatus,
        to: input.session.status,
        sessionId: input.session.id,
      });
      return { outcomes: [], failures: [], dispatched: true };
    },
  ),
}));

vi.mock('@/infrastructure/telegram/client', () => ({
  sendMessage: vi.fn(async () => ({
    ok: true as const,
    result: { message_id: 1, chat: { id: 1 } },
  })),
}));
vi.mock('@/infrastructure/email/resend', () => ({
  sendEmail: vi.fn(async () => ({ data: { id: 'mock' }, error: null })),
  idempotencyKey: vi.fn(
    (i: { sessionId: string; eventKind: string; attempt: number }) =>
      `mock-${i.sessionId}:${i.eventKind}:${i.attempt}`,
  ),
}));

import { type Teacher, sessions } from '@/infrastructure/db/schema';
import { runMigrations } from '../../scripts/migrate';

const ROOT = resolve(__dirname, '..', '..');
const MIGRATIONS = resolve(ROOT, 'src/infrastructure/db/migrations');
const SESS_ID = 'sess-decided-at-1';

type Fixture = {
  workdir: string;
  client: Client;
  db: LibSQLDatabase<Record<string, never>>;
};

async function makeFixture(): Promise<Fixture> {
  const workdir = mkdtempSync(join(tmpdir(), 'patch-decided-at-'));
  const dbPath = join(workdir, 'test.db');
  closeSync(openSync(dbPath, 'w'));
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client) as LibSQLDatabase<Record<string, never>>;
  await runMigrations(db, 'admin@allowed.test', MIGRATIONS);
  return { workdir, client, db };
}

async function loadAugusto(client: Client): Promise<Teacher> {
  const rows = await client.execute("SELECT * FROM teachers WHERE slug = 'augusto-rocha'");
  const r = rows.rows[0];
  if (!r) throw new Error('Augusto seed row not found');
  return {
    id: r.id as string,
    slug: r.slug as string,
    name: r.name as string,
    email: r.email as string,
    bio: (r.bio as string | null) ?? null,
    telegramChatId: (r.telegram_chat_id as string | null) ?? null,
    availability: r.availability as string,
    avatarUrl: (r.avatar_url as string | null) ?? null,
    timezone: r.timezone as string,
    active: Boolean(r.active),
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

async function seedPending(
  db: LibSQLDatabase<Record<string, never>>,
  augusto: Teacher,
): Promise<void> {
  // starts_at_utc set 1 day in the past — the time-guard on the
  // confirmed → completed transition needs `now >= starts_at_utc + duration`
  // to be true; we drive the test through pending → confirmed → completed
  // in this fixture so the guard must hold.
  const startsAtUtc = Date.now() - 24 * 60 * 60 * 1000;
  await db.insert(sessions).values({
    id: SESS_ID,
    teacherId: augusto.id,
    startsAtUtc,
    durationMinutes: 60,
    status: 'pending',
    visitorName: 'Visitante Decided',
    visitorEmail: 'visitante.decided@example.test',
    contactPref: 'email',
    contactValue: 'visitante.decided@example.test',
    visitorIntent: null,
    visitorTimezone: 'America/Argentina/Buenos_Aires',
    createdAt: startsAtUtc,
    updatedAt: startsAtUtc,
  });
}

async function callPatch(id: string, body: unknown): Promise<Response> {
  const { PATCH } = await import('@/app/api/sessions/[id]/route');
  const req = new NextRequest(`http://localhost:3000/api/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ id }) });
}

async function readSession(db: LibSQLDatabase<Record<string, never>>) {
  const rows = await db.select().from(sessions).where(eq(sessions.id, SESS_ID)).limit(1);
  return rows[0];
}

describe('G_C-11 — decided_at first-write + AC-3.4.4 note-only + AC-3.4.1 auth', () => {
  let f: Fixture;
  let augusto: Teacher;

  beforeEach(async () => {
    fx.dispatchCalls.length = 0;
    fx.authResult = { user: { email: 'admin@allowed.test' } };
    f = await makeFixture();
    augusto = await loadAugusto(f.client);
    await seedPending(f.db, augusto);

    const dbClientMod = await import('@/infrastructure/db/client');
    vi.spyOn(dbClientMod, 'getDb').mockReturnValue(
      f.db as unknown as ReturnType<typeof dbClientMod.getDb>,
    );
  });

  afterEach(() => {
    f.client.close();
    rmSync(f.workdir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test('decided_at is NULL on a fresh pending row', async () => {
    const row = await readSession(f.db);
    expect(row?.decidedAt).toBeNull();
  });

  test('pending → confirmed sets decided_at; confirmed → completed leaves it unchanged', async () => {
    // Step 1: pending → confirmed.
    const r1 = await callPatch(SESS_ID, { status: 'confirmed' });
    expect(r1.status).toBe(200);
    const afterConfirm = await readSession(f.db);
    expect(afterConfirm?.status).toBe('confirmed');
    expect(afterConfirm?.decidedAt).not.toBeNull();
    const firstDecidedAt = afterConfirm?.decidedAt as number;
    expect(typeof firstDecidedAt).toBe('number');

    // Make sure any subsequent Date.now() call would differ — sleep is
    // unreliable in vitest, so the strongest invariant is "we re-read
    // and the value is the same as the first transition's stamp".
    // Step 2: confirmed → completed.
    const r2 = await callPatch(SESS_ID, { status: 'completed' });
    expect(r2.status).toBe(200);
    const afterComplete = await readSession(f.db);
    expect(afterComplete?.status).toBe('completed');
    // The load-bearing assertion: decided_at is IDENTICAL to the first
    // transition's stamp. If a regression bumps it on every transition,
    // these two values differ (typically by a few ms).
    expect(afterComplete?.decidedAt).toBe(firstDecidedAt);
    // updated_at, by contrast, MUST move forward on every flip.
    expect(afterComplete?.updatedAt).toBeGreaterThanOrEqual(afterConfirm?.updatedAt ?? 0);
  });

  test('AC-3.4.4 note-only: { note } without status returns kind=note_updated and skips dispatch', async () => {
    const NOTE = 'Sólo nota interna — no flipa el estado.';
    const res = await callPatch(SESS_ID, { note: NOTE });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: string; session: { notesInternal: string } };
    expect(body.kind).toBe('note_updated');
    expect(body.session.notesInternal).toBe(NOTE);

    // No dispatch fired — note-only is the no-email path.
    expect(fx.dispatchCalls).toHaveLength(0);

    // decided_at remains NULL (no status flip).
    const row = await readSession(f.db);
    expect(row?.decidedAt).toBeNull();
    expect(row?.status).toBe('pending');
    expect(row?.notesInternal).toBe(NOTE);
  });

  test('status flip carrying a note updates BOTH status and notes_internal', async () => {
    const NOTE = 'Aceptado tras corroborar disponibilidad.';
    const res = await callPatch(SESS_ID, { status: 'confirmed', note: NOTE });
    expect(res.status).toBe(200);
    const row = await readSession(f.db);
    expect(row?.status).toBe('confirmed');
    expect(row?.notesInternal).toBe(NOTE);
    expect(row?.decidedAt).not.toBeNull();
    expect(fx.dispatchCalls).toHaveLength(1);
  });

  test('AC-3.4.1 auth-gate: no session → 401, no DB write, no dispatch', async () => {
    fx.authResult = null;
    const res = await callPatch(SESS_ID, { status: 'confirmed' });
    expect(res.status).toBe(401);
    expect(fx.dispatchCalls).toHaveLength(0);
    const row = await readSession(f.db);
    expect(row?.status).toBe('pending');
    expect(row?.decidedAt).toBeNull();
  });

  test('AC-3.4.1 auth-gate: session for off-list email → 401 (defense-in-depth)', async () => {
    // Cookie persists past ADMIN_EMAILS rotation — the route MUST still
    // re-validate the email against the live allowlist.
    fx.authResult = { user: { email: 'former-admin@removed.test' } };
    const res = await callPatch(SESS_ID, { status: 'confirmed' });
    expect(res.status).toBe(401);
    expect(fx.dispatchCalls).toHaveLength(0);
    const row = await readSession(f.db);
    expect(row?.status).toBe('pending');
  });

  test('PATCH on missing id → 404 with no DB write', async () => {
    const res = await callPatch('does-not-exist', { status: 'confirmed' });
    expect(res.status).toBe(404);
    expect(fx.dispatchCalls).toHaveLength(0);
    const row = await readSession(f.db);
    expect(row?.status).toBe('pending');
  });

  test('PATCH with empty body → 422', async () => {
    const res = await callPatch(SESS_ID, {});
    expect(res.status).toBe(422);
    const row = await readSession(f.db);
    expect(row?.status).toBe('pending');
    expect(row?.decidedAt).toBeNull();
  });
});
