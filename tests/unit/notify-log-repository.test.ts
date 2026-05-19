// G_C-37 — NotifyLog adapter pairing.
//
// Spec anchors: S-2 §7.2.4 C (NotifyLog port) + AC-3.3.1 (failure-only
// telemetry).
//
// Typeshape/smoke pattern. persistFailures is also exercised end-to-end by
// tests/integration/notify-failure-logs.test.ts through the existing
// procedural call site in src/application/notify/shared.ts — that contract
// invariance is the safety net behind this lighter unit test.

import { assertType, describe, expect, it } from 'vitest';

import type { Db } from '@/infrastructure/db/client';
import { makeNotifyLogRepository } from '@/infrastructure/db/repositories/notify-log.repository';

import type { NotifyLog } from '@/domain/notifications/ports';

describe('makeNotifyLogRepository — factory contract', () => {
  const repo = makeNotifyLogRepository({} as Db);

  it('satisfies the NotifyLog port', () => {
    assertType<NotifyLog>(repo);
  });

  it('exposes persistFailures + findById', () => {
    expect(typeof repo.persistFailures).toBe('function');
    expect(typeof repo.findById).toBe('function');
  });

  it('persistFailures([]) is a no-op (early-return without DB call)', async () => {
    // Empty input path doesn't reach drizzle, so the stub `db` is safe.
    await expect(repo.persistFailures([])).resolves.toBeUndefined();
  });
});
