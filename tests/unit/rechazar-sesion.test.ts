/**
 * G_C-31 unit pairing — rechazarSesion use case (S-2 §7.2.3 E / §7.2.7 B).
 *
 * Symmetric to aprobarSesion. What this catches:
 *   - The use case allows non-pending source states (regression on AC-2.2.4
 *     allow-list: only pending→rejected is permitted).
 *   - The use case skips the decline-email dispatch (regression on D-014
 *     lead-ratified: rejected sessions send a polite Spanish decline).
 *   - The use case dispatches with previousStatus other than 'pending' —
 *     dispatch-transition's email descriptor map would silently produce
 *     a no-op (no email for confirmed→rejected).
 */

import { describe, expect, test, vi } from 'vitest';

import { createRechazarSesion } from '@/application/booking/rechazar-sesion';
import type { DispatchTransitionFn } from '@/application/notify/dispatch-transition';
import type { MaestrosReader, SessionsRepository } from '@/domain/booking/ports';
import type { Teacher } from '@/domain/maestros/entities';
import type { Session } from '@/infrastructure/db/schema';

const seedSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'sess-2',
  teacherId: 't-1',
  startsAtUtc: 1_779_789_600_000,
  durationMinutes: 60,
  status: 'pending',
  visitorName: 'Pablo',
  visitorEmail: 'pablo@example.com',
  contactPref: 'email',
  contactValue: 'pablo@example.com',
  visitorIntent: null,
  visitorTimezone: 'America/Argentina/Buenos_Aires',
  notesInternal: null,
  decidedAt: null,
  createdAt: 1_779_789_000_000,
  updatedAt: 1_779_789_000_000,
  ...overrides,
});

const seedMaestro = (overrides: Partial<Teacher> = {}): Teacher => ({
  id: 't-1',
  slug: 'augusto',
  name: 'Augusto',
  email: 'augusto@example.com',
  bio: null,
  telegramChatId: null,
  availability: '{}',
  avatarUrl: null,
  timezone: 'America/Argentina/Buenos_Aires',
  active: true,
  createdAt: 1_779_789_000_000,
  updatedAt: 1_779_789_000_000,
  ...overrides,
});

function buildDeps(opts: {
  current?: Session | null;
  updated?: Session | null;
  maestro?: Teacher | null;
}): {
  deps: {
    sessions: SessionsRepository;
    maestrosReader: MaestrosReader;
    dispatch: DispatchTransitionFn;
  };
  dispatchSpy: ReturnType<typeof vi.fn>;
} {
  const sessions: SessionsRepository = {
    insertPending: vi.fn(),
    findById: vi.fn(async () => opts.current ?? null),
    updateStatus: vi.fn(async () => opts.updated ?? null),
    confirmedStartsForMaestroInRange: vi.fn(async () => []),
  };
  const maestrosReader: MaestrosReader = {
    findActiveBySlug: vi.fn(),
    findById: vi.fn(async () => opts.maestro ?? null),
    findBrandOwner: vi.fn(),
  };
  const dispatchSpy = vi.fn(async () => ({ outcomes: [], failures: [], dispatched: true }));
  const dispatch: DispatchTransitionFn = dispatchSpy as unknown as DispatchTransitionFn;
  return { deps: { sessions, maestrosReader, dispatch }, dispatchSpy };
}

describe('rechazarSesion', () => {
  test('returns not_found when session does not exist', async () => {
    const { deps, dispatchSpy } = buildDeps({ current: null });
    const fn = createRechazarSesion(deps);
    const outcome = await fn({ sessionId: 'missing', adminEmail: 'admin@x.com' });
    expect(outcome).toEqual({ kind: 'not_found' });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  test('returns illegal_transition when current.status is not pending', async () => {
    const { deps, dispatchSpy } = buildDeps({ current: seedSession({ status: 'cancelled' }) });
    const fn = createRechazarSesion(deps);
    const outcome = await fn({ sessionId: 'sess-2', adminEmail: 'admin@x.com' });
    expect(outcome).toEqual({ kind: 'illegal_transition', from: 'cancelled', to: 'rejected' });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  test('returns illegal_transition on updateStatus race (null)', async () => {
    const { deps, dispatchSpy } = buildDeps({
      current: seedSession({ status: 'pending' }),
      updated: null,
    });
    const fn = createRechazarSesion(deps);
    const outcome = await fn({ sessionId: 'sess-2', adminEmail: 'admin@x.com' });
    expect(outcome.kind).toBe('illegal_transition');
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  test('returns rejected + dispatches with previousStatus=pending (decline email path)', async () => {
    const updated = seedSession({ status: 'rejected' });
    const maestro = seedMaestro();
    const { deps, dispatchSpy } = buildDeps({
      current: seedSession({ status: 'pending' }),
      updated,
      maestro,
    });
    const fn = createRechazarSesion(deps);
    const outcome = await fn({ sessionId: 'sess-2', adminEmail: 'admin@x.com' });
    expect(outcome).toEqual({ kind: 'rejected', session: updated });
    expect(dispatchSpy).toHaveBeenCalledOnce();
    const callArg = dispatchSpy.mock.calls[0]?.[0] as {
      previousStatus: string;
      session: Session;
      assignedMaestro: Teacher;
    };
    expect(callArg.previousStatus).toBe('pending');
    expect(callArg.session.status).toBe('rejected');
    expect(callArg.assignedMaestro.id).toBe('t-1');
  });
});
