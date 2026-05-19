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
 * G_C-44 refactor (M-20 / D-056, pilot 7/N, concern C.5 — last concern-C
 * file): G_C-43's 4-port Path A playbook applied verbatim to the
 * `dispatchTransition — end-to-end` describe block. The
 * `emailDescriptorFor — pure mapping` describe stays UNCHANGED (pure
 * function, no factory, no DB, no port — same exception G_C-39 made for
 * brandOwnerEmail canonicalisation). Stub builders are copied
 * byte-identical from tests/integration/visitor-email-failure-warning.test.ts
 * (post-G_C-43); shared-helper extraction to tests/_helpers/dispatcher-stubs.ts
 * is queued as a follow-up after concern D closes.
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
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  type SessionStatus,
  createDispatchTransition,
  emailDescriptorFor,
} from '@/application/notify/dispatch-transition';
import { makeNotifyLogRepository } from '@/infrastructure/db/repositories/notify-log.repository';
import { type Session, type Teacher, notifyLog, sessions } from '@/infrastructure/db/schema';
import * as schema from '@/infrastructure/db/schema';
import { runMigrations } from '../../scripts/migrate';
import {
  type EmailSenderStub,
  type TelegramBotStub,
  buildEmailSenderStub,
  buildMaestrosReaderStub,
  buildTelegramStub,
} from '../_helpers/dispatcher-stubs';

const ROOT = resolve(__dirname, '..', '..');
const MIGRATIONS = resolve(ROOT, 'src/infrastructure/db/migrations');
const REF_NOW = 1_779_789_600_000;
const AUGUSTO_CHAT_ID = '111222333';

type Fixture = {
  workdir: string;
  client: Client;
  db: LibSQLDatabase<typeof schema>;
};

async function makeFixture(): Promise<Fixture> {
  const workdir = mkdtempSync(join(tmpdir(), 'transition-matrix-'));
  const dbPath = join(workdir, 'test.db');
  closeSync(openSync(dbPath, 'w'));
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client, { schema });
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
  db: LibSQLDatabase<typeof schema>,
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
    let emailSender: EmailSenderStub;
    let telegram: TelegramBotStub;

    beforeEach(() => {
      emailSender = buildEmailSenderStub();
      telegram = buildTelegramStub();
    });

    test.each(ALLOWED.filter((c) => c.expectsEmail))(
      '$from → $to fires email with subject "$subjectExact" + event_kind "$eventKind"',
      async ({ from, to, eventKind, subjectExact }) => {
        const session = await insertSession(f.db, augusto, `sess-${from}-${to}`, to);
        const dispatch = createDispatchTransition({
          emailSender,
          telegram,
          notifyLog: makeNotifyLogRepository(f.db),
          maestrosReader: buildMaestrosReaderStub({ brandOwner: augusto }),
        });
        const result = await dispatch({
          session,
          previousStatus: from,
          assignedMaestro: augusto,
        });

        expect(result.dispatched).toBe(true);
        expect(result.outcomes).toHaveLength(1);
        expect(result.failures).toHaveLength(0);
        expect(emailSender.calls).toHaveLength(1);
        expect(telegram.calls).toHaveLength(0); // success path: no warning

        const email = emailSender.calls[0];
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
        const dispatch = createDispatchTransition({
          emailSender,
          telegram,
          notifyLog: makeNotifyLogRepository(f.db),
          maestrosReader: buildMaestrosReaderStub({ brandOwner: augusto }),
        });
        const result = await dispatch({
          session,
          previousStatus: from,
          assignedMaestro: augusto,
        });

        expect(result.dispatched).toBe(false);
        expect(result.outcomes).toHaveLength(0);
        expect(result.failures).toHaveLength(0);
        expect(emailSender.calls).toHaveLength(0);
        expect(telegram.calls).toHaveLength(0);
      },
    );

    test.each(ILLEGAL_SAMPLE)(
      'illegal $from → $to: dispatcher returns no-op (defense-in-depth)',
      async ({ from, to }) => {
        const session = await insertSession(f.db, augusto, `sess-illegal-${from}-${to}`, to);
        const dispatch = createDispatchTransition({
          emailSender,
          telegram,
          notifyLog: makeNotifyLogRepository(f.db),
          maestrosReader: buildMaestrosReaderStub({ brandOwner: augusto }),
        });
        const result = await dispatch({
          session,
          previousStatus: from,
          assignedMaestro: augusto,
        });

        expect(result.dispatched).toBe(false);
        expect(emailSender.calls).toHaveLength(0);
      },
    );

    test('notify_log stays empty on the all-success matrix sweep', async () => {
      const dispatch = createDispatchTransition({
        emailSender,
        telegram,
        notifyLog: makeNotifyLogRepository(f.db),
        maestrosReader: buildMaestrosReaderStub({ brandOwner: augusto }),
      });
      for (const [i, c] of ALLOWED.filter((c) => c.expectsEmail).entries()) {
        const session = await insertSession(f.db, augusto, `sess-sweep-${i}`, c.to);
        await dispatch({
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
      const dispatch = createDispatchTransition({
        emailSender,
        telegram,
        notifyLog: makeNotifyLogRepository(f.db),
        maestrosReader: buildMaestrosReaderStub({ brandOwner: augusto }),
      });
      await dispatch({
        session,
        previousStatus: 'pending',
        assignedMaestro: augusto,
        attempt: 3,
      });
      expect(emailSender.calls[0]?.attempt).toBe(3);
    });
  });
});
