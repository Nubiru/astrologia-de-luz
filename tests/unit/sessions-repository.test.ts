// G_C-37 — SessionsRepository adapter pairing.
//
// Spec anchors: S-2 §7.2.4 A (port body) + §7.2.5 composition wiring.
//
// Strategy: typeshape compile-gate + structural-member smoke. The
// integration-level behavior of insertPending / updateStatus / etc. is
// already covered by tests/integration/post-sessions-*.test.ts +
// patch-sessions-*.test.ts against the procedural call-sites; this pairing
// asserts the FACTORY contract (returns an object whose member set
// matches the port verbatim).

import { assertType, describe, expect, it } from 'vitest';

import type { Db } from '@/infrastructure/db/client';
import { makeSessionsRepository } from '@/infrastructure/db/repositories/sessions.repository';

import type { SessionsRepository } from '@/domain/booking/ports';

describe('makeSessionsRepository — factory contract', () => {
  const repo = makeSessionsRepository({} as Db);

  it('returns an object that satisfies SessionsRepository', () => {
    assertType<SessionsRepository>(repo);
  });

  it('exposes the 4 port methods', () => {
    expect(typeof repo.insertPending).toBe('function');
    expect(typeof repo.findById).toBe('function');
    expect(typeof repo.updateStatus).toBe('function');
    expect(typeof repo.confirmedStartsForMaestroInRange).toBe('function');
  });
});
