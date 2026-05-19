// G_C-37 — Clock adapter pairing. Spec anchor: S-2 §7.2.4 row 1316.
//
// Two assertions:
//   1. systemClock satisfies the Clock port (compile-gate via assertType).
//   2. systemClock.now() returns a Date close to the current wall clock,
//      and tests can substitute a deterministic clock for time-sensitive
//      use cases (the substitution is what makes the port valuable).

import { assertType, describe, expect, it } from 'vitest';

import type { Clock } from '@/domain/booking/ports';
import { systemClock } from '@/infrastructure/clock';

describe('systemClock', () => {
  it('satisfies the Clock port shape (compile gate)', () => {
    assertType<Clock>(systemClock);
  });

  it('now() returns a Date within ±2s of wall clock', () => {
    const before = Date.now();
    const ts = systemClock.now().getTime();
    const after = Date.now();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('is substitutable: a fixed-time Clock implementation type-checks', () => {
    const fixed: Clock = { now: () => new Date('2026-05-20T12:00:00Z') };
    assertType<Clock>(fixed);
    expect(fixed.now().toISOString()).toBe('2026-05-20T12:00:00.000Z');
  });
});
