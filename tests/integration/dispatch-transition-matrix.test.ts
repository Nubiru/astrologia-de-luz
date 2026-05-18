/**
 * G_C-14 integration pairing — per-transition email matrix (AC-3.4.2).
 *
 * Iterates every (from, to) pair in the AC-2.2.4 allowed-transitions table
 * and asserts the AC-3.4.2 side-effect contract:
 *
 *   - 3 transitions DO fire a visitor email (with the right slot, subject,
 *     event_kind, interpolated tokens).
 *   - 3 transitions DO NOT fire any email (and the dispatcher returns
 *     `dispatched: false`).
 *
 * Also covers two illegal pairs as defense-in-depth — the API handler
 * G_C-11 will already reject them with 409, but a future regression that
 * lets one through must NOT silently send an unexpected email.
 *
 * What this catches:
 *   - A new status is added to the enum but the dispatcher's switch is
 *     never widened — the unknown-pair test would flip false to true.
 *   - The subject/event_kind mapping desyncs (e.g., a `pending→rejected`
 *     fires `visitor_confirm` event_kind by accident, which would make
 *     the Resend Idempotency-Key collide with the wrong dispatch on a
 *     subsequent confirm). Per-row event_kind assertion catches it.
 *   - `confirmed→cancelled` accidentally interpolates the slot for
 *     `pending→cancelled` (which has no email at all — would silently
 *     send no email). Subject string assertion catches it.
 */

import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { type Client, createClient } from '@libsql/client';
import { type LibSQLDatabase, drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const fx = vi.hoisted(() => ({
  tgCalls: [] as Array<{ chatId: string; text: string; parseMode?: string }>,
  emailCalls: [] as Array<{
    to: string;
    subject: string;
    html: string;
    text: string;
    sessionId: string;
    eventKind: string;
    attempt: number;
  }>,
}));

vi.mock('@/lib/env', () => ({
  getEnv: () => ({
    ADMIN_EMAILS: 'augusto@astrologiadeluz.com',
    TELEGRAM_BOT_TOKEN: '0000:test-token',
    AUTH_RESEND_KEY: 're_test',
    RESEND_FROM: 'no-reply@astrologiadeluz.com',
  }),
}));

vi.mock('@/lib/telegram', () => ({
  sendMessage: vi.fn(async (input: { chatId: string; text: string; parseMode?: string }) => {
    fx.tgCalls.push(input);
    return { ok: true as const, result: { message_id: fx.tgCalls.length, chat: { id: 1 } } };
  }),
}));

vi.mock('@/lib/resend', () => ({
  sendEmail: vi.fn(
    async (input: {
      to: string;
      subject: string;
      html: string;
      text: string;
      sessionId: string;
      eventKind: string;
      attempt: number;
    }) => {
      fx.emailCalls.push(input);
      return { data: { id: `mock-${fx.emailCalls.length}` }, error: null };
    },
  ),
  idempotencyKey: vi.fn(
    (input: { sessionId: string; eventKind: string; attempt: number }) =>
      `mock-${input.sessionId}:${input.eventKind}:${input.attempt}`,
  ),
}));

import { type Session, type Teacher, notifyLog, sessions } from '@/db/schema';
import {
  type SessionStatus,
  dispatchTransition,
  emailDescriptorFor,
} from '@/lib/notify/dispatch-transition';
import { runMigrations } from '../../scripts/migrate';

const ROOT = resolve(__dirname, '..', '..');
const MIGRATIONS = resolve(ROOT, 'db/migrations');
const REF_NOW = 1_779_789_600_000;
const AUGUSTO_CHAT_ID = '111222333';

type Fixture = {
  workdir: string;
  client: Client;
  db: LibSQLDatabase<Record<string, never>>;
};

async function makeFixture(): Promise<Fixture> {
  const workdir = mkdtempSync(join(tmpdir(), 'transition-matrix-'));
  const dbPath = join(workdir, 'test.db');
  closeSync(openSync(dbPath, 'w'));
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client) as LibSQLDatabase<Record<string, never>>;
  await runMigrations(db, 'augusto@astrologiadeluz.com', MIGRATIONS);
  await client.execute(
    `UPDATE teachers SET telegram_chat_id = '${AUGUSTO_CHAT_ID}' WHERE slug = 'augusto-rocha'`,
  );
  return { workdir, client, db };
}

async function loadAugusto(client: Client): Promise<Teacher> {
  const rows = await client.execute("SELECT * FROM teachers WHERE slug = 'augusto-rocha'");
  const r = rows.rows[0];
  if (!r) throw new Error('Augusto seed missing');
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

async function insertSession(
  db: LibSQLDatabase<Record<string, never>>,
  augusto: Teacher,
  id: string,
  status: SessionStatus,
): Promise<Session> {
  const inserted = await db
    .insert(sessions)
    .values({
      id,
      teacherId: augusto.id,
      startsAtUtc: REF_NOW,
      durationMinutes: 60,
      status,
      visitorName: 'Visitante Transición',
      visitorEmail: 'transicion@example.com',
      contactPref: 'email',
      contactValue: 'transicion@example.com',
      visitorIntent: 'Probar el flujo de transiciones.',
      visitorTimezone: 'America/Argentina/Buenos_Aires',
      createdAt: REF_NOW,
      updatedAt: REF_NOW,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error('session insert returned no row');
  return row as Session;
}

type MatrixCase = {
  from: SessionStatus;
  to: SessionStatus;
  expectsEmail: boolean;
  eventKind?: string;
  subjectExact?: string;
};

// AC-2.2.4 + AC-3.4.2 — the 6 ALLOWED transitions.
const ALLOWED: MatrixCase[] = [
  {
    from: 'pending',
    to: 'confirmed',
    expectsEmail: true,
    eventKind: 'visitor_confirm',
    subjectExact: 'Sesión confirmada — Astrologia de Luz',
  },
  {
    from: 'pending',
    to: 'rejected',
    expectsEmail: true,
    eventKind: 'visitor_decline',
    subjectExact: 'Sobre tu solicitud — Astrologia de Luz',
  },
  { from: 'pending', to: 'cancelled', expectsEmail: false },
  {
    from: 'confirmed',
    to: 'cancelled',
    expectsEmail: true,
    eventKind: 'visitor_cancel',
    subjectExact: 'Cambio en tu sesión — Astrologia de Luz',
  },
  { from: 'confirmed', to: 'completed', expectsEmail: false },
  { from: 'confirmed', to: 'no_show', expectsEmail: false },
];

// AC-2.2.4 — a sample of illegal pairs. The API handler (G_C-11) rejects
// these at 409; this dispatcher's defense-in-depth job is to return a
// no-op if one slips through.
const ILLEGAL_SAMPLE: Array<{ from: SessionStatus; to: SessionStatus }> = [
  { from: 'pending', to: 'completed' },
  { from: 'pending', to: 'no_show' },
  { from: 'confirmed', to: 'pending' },
  { from: 'cancelled', to: 'confirmed' },
  { from: 'rejected', to: 'confirmed' },
  { from: 'completed', to: 'cancelled' },
];

describe('G_C-14 — transition email matrix (AC-3.4.2)', () => {
  let f: Fixture;
  let augusto: Teacher;

  beforeEach(async () => {
    fx.tgCalls.length = 0;
    fx.emailCalls.length = 0;
    f = await makeFixture();
    augusto = await loadAugusto(f.client);
  });

  afterEach(() => {
    f.client.close();
    rmSync(f.workdir, { recursive: true, force: true });
  });

  describe('emailDescriptorFor — pure mapping', () => {
    test.each(ALLOWED)(
      'descriptor for %s → %s: expectsEmail=$expectsEmail',
      ({ from, to, expectsEmail, eventKind }) => {
        const descriptor = emailDescriptorFor(from, to);
        if (expectsEmail) {
          expect(descriptor).not.toBeNull();
          expect(descriptor?.eventKind).toBe(eventKind);
        } else {
          expect(descriptor).toBeNull();
        }
      },
    );

    test.each(ILLEGAL_SAMPLE)('descriptor for illegal %s → %s returns null', ({ from, to }) => {
      expect(emailDescriptorFor(from, to)).toBeNull();
    });
  });

  describe('dispatchTransition — end-to-end against real libsql + mocked clients', () => {
    test.each(ALLOWED.filter((c) => c.expectsEmail))(
      '$from → $to fires email with subject "$subjectExact" + event_kind "$eventKind"',
      async ({ from, to, eventKind, subjectExact }) => {
        const session = await insertSession(f.db, augusto, `sess-${from}-${to}`, to);
        const result = await dispatchTransition({
          db: f.db,
          session,
          previousStatus: from,
          assignedMaestro: augusto,
        });

        expect(result.dispatched).toBe(true);
        expect(result.outcomes).toHaveLength(1);
        expect(result.failures).toHaveLength(0);
        expect(fx.emailCalls).toHaveLength(1);
        expect(fx.tgCalls).toHaveLength(0); // success path: no warning

        const email = fx.emailCalls[0];
        expect(email?.to).toBe('transicion@example.com');
        expect(email?.subject).toBe(subjectExact);
        expect(email?.eventKind).toBe(eventKind);
        expect(email?.attempt).toBe(1);
        expect(email?.text).toContain('Visitante Transición');
        expect(email?.text).toContain(augusto.name); // signs off with brandOwnerName
      },
    );

    test.each(ALLOWED.filter((c) => !c.expectsEmail))(
      '$from → $to fires NO email (no-op)',
      async ({ from, to }) => {
        const session = await insertSession(f.db, augusto, `sess-noemail-${from}-${to}`, to);
        const result = await dispatchTransition({
          db: f.db,
          session,
          previousStatus: from,
          assignedMaestro: augusto,
        });

        expect(result.dispatched).toBe(false);
        expect(result.outcomes).toHaveLength(0);
        expect(result.failures).toHaveLength(0);
        expect(fx.emailCalls).toHaveLength(0);
        expect(fx.tgCalls).toHaveLength(0);
      },
    );

    test.each(ILLEGAL_SAMPLE)(
      'illegal $from → $to: dispatcher returns no-op (defense-in-depth)',
      async ({ from, to }) => {
        const session = await insertSession(f.db, augusto, `sess-illegal-${from}-${to}`, to);
        const result = await dispatchTransition({
          db: f.db,
          session,
          previousStatus: from,
          assignedMaestro: augusto,
        });

        expect(result.dispatched).toBe(false);
        expect(fx.emailCalls).toHaveLength(0);
      },
    );

    test('notify_log stays empty on the all-success matrix sweep', async () => {
      for (const [i, c] of ALLOWED.filter((c) => c.expectsEmail).entries()) {
        const session = await insertSession(f.db, augusto, `sess-sweep-${i}`, c.to);
        await dispatchTransition({
          db: f.db,
          session,
          previousStatus: c.from,
          assignedMaestro: augusto,
        });
      }
      const rows = await f.db.select().from(notifyLog);
      expect(rows).toHaveLength(0);
    });

    test('attempt parameter flows to sendEmail call', async () => {
      const session = await insertSession(f.db, augusto, 'sess-attempt-3', 'confirmed');
      await dispatchTransition({
        db: f.db,
        session,
        previousStatus: 'pending',
        assignedMaestro: augusto,
        attempt: 3,
      });
      expect(fx.emailCalls[0]?.attempt).toBe(3);
    });
  });
});
