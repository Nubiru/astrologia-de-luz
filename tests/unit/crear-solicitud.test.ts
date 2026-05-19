/**
 * G_C-31 unit pairing — crearSolicitud use case (S-2 §7.2.3 D / §7.2.7 B).
 *
 * Spec close gate: "Each CrearSolicitudOutcome kind has at least one
 * passing assertion path."
 *
 * What this catches:
 *   - Honeypot drops silently regress to 'invalid_body' or worse, leak the
 *     booking shape to bots.
 *   - Min-fill-time threshold drifts away from the 800ms ratified at D-023.
 *   - Rate-limit verdict isn't propagated (retryAfterSeconds dropped).
 *   - zod validation regresses; field-keyed Spanish errors missing.
 *   - Maestro lookup returns inactive rows (regression on AC-3.1.2 step 3).
 *   - Slot re-derive accepts a slot not in the derived set (R-5 violation —
 *     visitor could double-book a confirmed slot).
 *   - The use case dispatches BEFORE INSERT (AC-3.1.2 rollback invariant).
 *   - INSERT failure path still reaches the dispatcher (rollback breach).
 *
 * Tests use createCrearSolicitud(fakeDeps) directly.
 */

import { describe, expect, test, vi } from 'vitest';

import { createCrearSolicitud } from '@/application/booking/crear-solicitud';
import type { DispatchPendingFn } from '@/application/notify/dispatch-pending';
import type {
  Clock,
  MaestrosReader,
  RateLimitGate,
  SessionsRepository,
} from '@/domain/booking/ports';
import type { Teacher } from '@/domain/maestros/entities';
import type { Session } from '@/infrastructure/db/schema';

// Reference clock — Sunday 2026-05-17 18:00:00 UTC (matches the integration-
// test fixture; weekday=0 = Sunday in date-fns-tz; Monday=1, Tuesday=2, etc.).
const REF_MS = 1_779_811_200_000;

const refMaestroSlot = new Date(REF_MS + 24 * 60 * 60 * 1000); // Mon +24h
refMaestroSlot.setUTCHours(15, 0, 0, 0); // 15:00 UTC → 12:00 ARG (TZ -3)

const seedMaestro = (overrides: Partial<Teacher> = {}): Teacher => ({
  id: 't-1',
  slug: 'augusto',
  name: 'Augusto',
  email: 'augusto@example.com',
  bio: null,
  telegramChatId: null,
  availability: JSON.stringify({
    tz: 'America/Argentina/Buenos_Aires',
    windows: [
      // 0=Sun … 6=Sat. ARG local 09:00→18:00 Mon-Fri (weekdays 1-5).
      { weekday: 1, start: '09:00', end: '18:00' },
      { weekday: 2, start: '09:00', end: '18:00' },
      { weekday: 3, start: '09:00', end: '18:00' },
      { weekday: 4, start: '09:00', end: '18:00' },
      { weekday: 5, start: '09:00', end: '18:00' },
    ],
    blackouts: [],
  }),
  avatarUrl: null,
  timezone: 'America/Argentina/Buenos_Aires',
  active: true,
  createdAt: 1_779_789_000_000,
  updatedAt: 1_779_789_000_000,
  ...overrides,
});

const baseBody = {
  teacherSlug: 'augusto',
  slotUtcIso: refMaestroSlot.toISOString(),
  visitorName: 'Mariana López',
  visitorEmail: 'mariana@example.com',
  contactPref: 'email',
  contactValue: 'mariana@example.com',
  visitorTimezone: 'America/Argentina/Buenos_Aires',
  acceptsPending: true,
};

interface BuildOpts {
  maestro?: Teacher | null;
  rateLimit?: { allowed: boolean; retryAfterSeconds: number; count: number };
  insertThrows?: boolean;
  confirmed?: Date[];
  insertedSession?: Session | null;
}

function buildDeps(opts: BuildOpts = {}): {
  deps: {
    sessions: SessionsRepository;
    maestrosReader: MaestrosReader;
    rateLimit: RateLimitGate;
    dispatch: DispatchPendingFn;
    clock: Clock;
  };
  dispatchSpy: ReturnType<typeof vi.fn>;
  insertSpy: ReturnType<typeof vi.fn>;
} {
  const clock: Clock = { now: () => new Date(REF_MS) };
  const insertSpy = vi.fn(async (input: { id: string; teacherId: string; startsAtUtc: number }) => {
    if (opts.insertThrows) throw new Error('INSERT failed');
    if (opts.insertedSession) return opts.insertedSession;
    return {
      ...seedSession(),
      id: input.id,
      teacherId: input.teacherId,
      startsAtUtc: input.startsAtUtc,
    };
  });
  const sessions: SessionsRepository = {
    insertPending: insertSpy as unknown as SessionsRepository['insertPending'],
    findById: vi.fn(),
    updateStatus: vi.fn(),
    confirmedStartsForMaestroInRange: vi.fn(async () => opts.confirmed ?? []),
  };
  const maestrosReader: MaestrosReader = {
    findActiveBySlug: vi.fn(async () => opts.maestro ?? null),
    findById: vi.fn(),
    findBrandOwner: vi.fn(),
  };
  const rateLimit: RateLimitGate = {
    check: vi.fn(async () => opts.rateLimit ?? { allowed: true, retryAfterSeconds: 0, count: 1 }),
  };
  const dispatchSpy = vi.fn(async () => ({ outcomes: [], failures: [] }));
  const dispatch: DispatchPendingFn = dispatchSpy as unknown as DispatchPendingFn;
  return {
    deps: { sessions, maestrosReader, rateLimit, dispatch, clock },
    dispatchSpy,
    insertSpy,
  };
}

const seedSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'sess-1',
  teacherId: 't-1',
  startsAtUtc: refMaestroSlot.getTime(),
  durationMinutes: 60,
  status: 'pending',
  visitorName: 'Mariana López',
  visitorEmail: 'mariana@example.com',
  contactPref: 'email',
  contactValue: 'mariana@example.com',
  visitorIntent: null,
  visitorTimezone: 'America/Argentina/Buenos_Aires',
  notesInternal: null,
  decidedAt: null,
  createdAt: REF_MS,
  updatedAt: REF_MS,
  ...overrides,
});

const baseInput = (overrides: Partial<typeof baseBody> = {}) => ({
  rawBody: { ...baseBody, ...overrides, companyName: '', _t: 1500 },
  requestHeaders: new Headers({ 'x-forwarded-for': '1.2.3.4' }),
  honeypotCompany: '',
  honeypotT: 1500,
});

describe('crearSolicitud — outcome kinds', () => {
  test("'received' when honeypot field has any non-empty value", async () => {
    const { deps, dispatchSpy, insertSpy } = buildDeps();
    const fn = createCrearSolicitud(deps);
    const outcome = await fn({
      ...baseInput(),
      honeypotCompany: 'bot inc',
    });
    expect(outcome).toEqual({ kind: 'received' });
    expect(insertSpy).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  test("'received' when min-fill-time < 800ms", async () => {
    const { deps } = buildDeps();
    const fn = createCrearSolicitud(deps);
    const outcome = await fn({
      ...baseInput(),
      honeypotT: 500,
    });
    expect(outcome).toEqual({ kind: 'received' });
  });

  test("'received' when min-fill-time is null", async () => {
    const { deps } = buildDeps();
    const fn = createCrearSolicitud(deps);
    const outcome = await fn({
      ...baseInput(),
      honeypotT: null,
    });
    expect(outcome).toEqual({ kind: 'received' });
  });

  test("'invalid_body' when rawBody is not an object", async () => {
    const { deps } = buildDeps();
    const fn = createCrearSolicitud(deps);
    const outcome = await fn({
      ...baseInput(),
      rawBody: 'not-an-object',
    });
    expect(outcome.kind).toBe('invalid_body');
  });

  test("'rate_limited' propagates retryAfterSeconds from gate", async () => {
    const { deps, dispatchSpy, insertSpy } = buildDeps({
      rateLimit: { allowed: false, retryAfterSeconds: 1234, count: 5 },
    });
    const fn = createCrearSolicitud(deps);
    const outcome = await fn(baseInput());
    expect(outcome).toEqual({ kind: 'rate_limited', retryAfterSeconds: 1234 });
    expect(insertSpy).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  test("'invalid' when body misses required fields", async () => {
    const { deps } = buildDeps();
    const fn = createCrearSolicitud(deps);
    const outcome = await fn({
      ...baseInput(),
      rawBody: { companyName: '', _t: 1500, visitorEmail: 'not-an-email' },
    });
    expect(outcome.kind).toBe('invalid');
    if (outcome.kind === 'invalid') {
      // At least visitorEmail OR teacherSlug should error.
      expect(Object.keys(outcome.fieldErrors).length).toBeGreaterThan(0);
    }
  });

  test("'maestro_gone' when slug lookup misses (archived/missing)", async () => {
    const { deps, dispatchSpy, insertSpy } = buildDeps({ maestro: null });
    const fn = createCrearSolicitud(deps);
    const outcome = await fn(baseInput());
    expect(outcome).toEqual({ kind: 'maestro_gone' });
    expect(insertSpy).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  test("'slot_taken' when slot is not in the derived set", async () => {
    // The chosen slot (15:00 UTC = 12:00 ARG Mon) is valid; supply confirmed
    // that covers EXACTLY this slot to push it out of the derived set.
    const { deps, dispatchSpy, insertSpy } = buildDeps({
      maestro: seedMaestro(),
      confirmed: [refMaestroSlot],
    });
    const fn = createCrearSolicitud(deps);
    const outcome = await fn(baseInput());
    expect(outcome.kind).toBe('slot_taken');
    expect(insertSpy).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  test("'insert_failed' when sessions.insertPending throws", async () => {
    const { deps, dispatchSpy } = buildDeps({
      maestro: seedMaestro(),
      insertThrows: true,
    });
    const fn = createCrearSolicitud(deps);
    const outcome = await fn(baseInput());
    expect(outcome).toEqual({ kind: 'insert_failed' });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  test("'created' on happy path + dispatches AFTER insert", async () => {
    const maestro = seedMaestro();
    const insertedSession = seedSession();
    const { deps, dispatchSpy, insertSpy } = buildDeps({
      maestro,
      insertedSession,
    });
    const fn = createCrearSolicitud(deps);
    const outcome = await fn(baseInput());
    expect(outcome.kind).toBe('created');
    if (outcome.kind === 'created') {
      expect(outcome.session).toEqual(insertedSession);
      expect(outcome.assignedMaestro).toEqual(maestro);
    }
    expect(insertSpy).toHaveBeenCalledOnce();
    expect(dispatchSpy).toHaveBeenCalledOnce();
    expect(dispatchSpy).toHaveBeenCalledWith({
      session: insertedSession,
      assignedMaestro: maestro,
    });
    // Persistence-before-notify invariant: insert MUST precede dispatch.
    const insertOrder = insertSpy.mock.invocationCallOrder[0] ?? 0;
    const dispatchOrder = dispatchSpy.mock.invocationCallOrder[0] ?? 0;
    expect(insertOrder).toBeLessThan(dispatchOrder);
  });
});
