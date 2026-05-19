// G_C-37 — MaestrosRepository + MaestrosReader adapter pairing.
//
// Spec anchors: S-2 §7.2.4 A + §7.2.4 B + §7.2.5 composition wiring.
//
// Same typeshape/smoke strategy as sessions-repository.test.ts. The
// dual-conformance (MaestrosRepository AND MaestrosReader on the same
// concrete object) is what makes `maestrosReader: maestros` in the
// composition root type-check — asserted here so a future port-shape
// drift fails fast.

import { assertType, describe, expect, it } from 'vitest';

import type { Db } from '@/infrastructure/db/client';
import { makeMaestrosRepository } from '@/infrastructure/db/repositories/maestros.repository';

import type { MaestrosReader } from '@/domain/booking/ports';
import type { MaestrosRepository } from '@/domain/maestros/ports';

describe('makeMaestrosRepository — factory contract', () => {
  const repo = makeMaestrosRepository({} as Db);

  it('satisfies MaestrosRepository (full read+write)', () => {
    assertType<MaestrosRepository>(repo);
  });

  it('also satisfies MaestrosReader (composition.maestrosReader: maestros)', () => {
    assertType<MaestrosReader>(repo);
  });

  it('exposes all 7 MaestrosRepository methods', () => {
    expect(typeof repo.list).toBe('function');
    expect(typeof repo.findBySlug).toBe('function');
    expect(typeof repo.findById).toBe('function');
    expect(typeof repo.insert).toBe('function');
    expect(typeof repo.updateAvailability).toBe('function');
    expect(typeof repo.updateTelegramChatId).toBe('function');
    expect(typeof repo.archive).toBe('function');
  });

  it('exposes all 3 MaestrosReader methods (findActiveBySlug + findById + findBrandOwner)', () => {
    expect(typeof repo.findActiveBySlug).toBe('function');
    expect(typeof repo.findById).toBe('function');
    expect(typeof repo.findBrandOwner).toBe('function');
  });
});
