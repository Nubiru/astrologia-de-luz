/**
 * G_C-31 unit pairing — aprobarSesion use case (S-2 §7.2.3 E / §7.2.7 B).
 *
 * What this catches:
 *   - The use case allows non-pending source states (regression on AC-2.2.4
 *     allow-list: only pending→confirmed is permitted).
 *   - The use case skips the dispatch fan-out after a successful flip
 *     (regression on AC-3.4.2 — post-commit notification invariant).
 *   - The use case mishandles the "concurrent transition raced us" return
 *     (when SessionsRepository.updateStatus returns null) — must surface
 *     as illegal_transition, not confirmed-with-null.
 *   - The use case dispatches when sessions.findById returns null — must
 *     surface as not_found, never reach dispatch.
 *
 * Tests use createAprobarSesion(fakeDeps) directly — the factory shape per
 * D-049 / D-050 (no composition root needed).
 */

import { describe, expect, test, vi } from 'vitest';

import { createAprobarSesion } from '@/application/booking/aprobar-sesion';
import type { DispatchTransitionFn } from '@/application/notify/dispatch-transition';
import type { MaestrosReader, SessionsRepository } from '@/domain/booking/ports';
import type { Teacher } from '@/domain/maestros/entities';
import type { Session } from '@/infrastructure/db/schema';

const seedSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'sess-1',
  teacherId: 't-1',
  startsAtUtc: 1_779_789_600_000,
  durationMinutes: 60,
  status: 'pending',
  visitorName: 'Mariana',
  visitorEmail: 'mariana@example.com',
  contactPref: 'email',
  contactValue: 'mariana@example.com',
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

describe('aprobarSesion', () => {
  test('returns not_found when sessions.findById returns null + does NOT dispatch', async () => {
    const { deps, dispatchSpy } = buildDeps({ current: null });
    const fn = createAprobarSesion(deps);
    const outcome = await fn({ sessionId: 'sess-1', adminEmail: 'admin@x.com' });
    expect(outcome).toEqual({ kind: 'not_found' });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  test('returns illegal_transition when current.status is not pending', async () => {
    const { deps, dispatchSpy } = buildDeps({ current: seedSession({ status: 'confirmed' }) });
    const fn = createAprobarSesion(deps);
    const outcome = await fn({ sessionId: 'sess-1', adminEmail: 'admin@x.com' });
    expect(outcome).toEqual({ kind: 'illegal_transition', from: 'confirmed', to: 'confirmed' });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  test('returns illegal_transition when updateStatus races (returns null)', async () => {
    const { deps, dispatchSpy } = buildDeps({
      current: seedSession({ status: 'pending' }),
      updated: null,
    });
    const fn = createAprobarSesion(deps);
    const outcome = await fn({ sessionId: 'sess-1', adminEmail: 'admin@x.com' });
    expect(outcome.kind).toBe('illegal_transition');
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  test('returns confirmed + dispatches AFTER successful flip', async () => {
    const updated = seedSession({ status: 'confirmed' });
    const maestro = seedMaestro();
    const { deps, dispatchSpy } = buildDeps({
      current: seedSession({ status: 'pending' }),
      updated,
      maestro,
    });
    const fn = createAprobarSesion(deps);
    const outcome = await fn({ sessionId: 'sess-1', adminEmail: 'admin@x.com' });
    expect(outcome).toEqual({ kind: 'confirmed', session: updated });
    expect(dispatchSpy).toHaveBeenCalledOnce();
    expect(dispatchSpy).toHaveBeenCalledWith({
      session: updated,
      previousStatus: 'pending',
      assignedMaestro: maestro,
    });
  });

  test('returns confirmed even when assigned maestro is missing (defensive)', async () => {
    const updated = seedSession({ status: 'confirmed' });
    const { deps, dispatchSpy } = buildDeps({
      current: seedSession({ status: 'pending' }),
      updated,
      maestro: null,
    });
    const fn = createAprobarSesion(deps);
    const outcome = await fn({ sessionId: 'sess-1', adminEmail: 'admin@x.com' });
    expect(outcome).toEqual({ kind: 'confirmed', session: updated });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});
