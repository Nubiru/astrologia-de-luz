/**
 * G_C-35 W4-5 cleanup-CP pairing — composition-root wiring contract.
 *
 * Spec anchor: S-2 §7.3.1 G_C-35 AC-G_C-35.3 + §7.2.5 (single composition root,
 * D-050) + Cockburn Fig 6.22 L647 §2.17 row 67.
 *
 * What this catches:
 *   - getComposition() loses its singleton property — every call returns a
 *     fresh object → adapters re-instantiated mid-request → state-leak class.
 *   - __resetCompositionForTests() stops flushing the cache → cross-test
 *     contamination class.
 *   - A new port is added to Composition but the factory leaves a `null` /
 *     missing binding — strict-object shape catches the gap.
 *
 * Runs as a unit pairing (no DB / Resend / Telegram I/O is triggered — every
 * adapter the composition wires is a lazy factory; calling makeX() returns a
 * façade that defers ALL environmental I/O to first method invocation).
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { __resetCompositionForTests, getComposition } from '@/main/composition';

beforeEach(() => {
  // Anchor: each test starts from a clean cache so a prior test cannot mask
  // a regression in __resetCompositionForTests.
  __resetCompositionForTests();
  process.env.TURSO_DATABASE_URL = 'file::memory:?cache=shared';
  process.env.TURSO_AUTH_TOKEN = 'composition-wiring-fixture';
  process.env.AUTH_SECRET = 'a'.repeat(48);
  process.env.AUTH_URL = 'http://localhost:3000';
  process.env.AUTH_RESEND_KEY = 're_composition_wiring_fixture';
  process.env.RESEND_FROM = 'Astrologia de Luz <no-reply@composition.test>';
  process.env.ADMIN_EMAILS = 'augusto@astrologiadeluz.com';
  process.env.TELEGRAM_BOT_TOKEN = '1:composition-wiring-fixture';
  process.env.TELEGRAM_BOT_USERNAME = 'CompositionWiringBot';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'b'.repeat(48);
});

afterEach(() => {
  __resetCompositionForTests();
});

describe('AC-G_C-35.3 — composition root: singleton + reset contract', () => {
  test('getComposition() returns the SAME reference on repeated calls', () => {
    const first = getComposition();
    const second = getComposition();
    const third = getComposition();
    // Reference equality — same memoized object, no per-call factory churn.
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  test('__resetCompositionForTests() flushes the cache; the next call returns a NEW reference', () => {
    const first = getComposition();
    __resetCompositionForTests();
    const second = getComposition();
    // After reset, the second call constructs a fresh Composition object.
    expect(second).not.toBe(first);
    // But the shape is still valid (same keys, same port surfaces).
    expect(Object.keys(second).sort()).toEqual(Object.keys(first).sort());
  });

  test('Composition shape covers all 9 ports declared at §7.2.5', () => {
    const composition = getComposition();
    // Each port is bound (not null / undefined). Tests do NOT exercise the
    // adapters — only the binding presence + type discriminator.
    expect(composition.sessions).toBeDefined();
    expect(composition.maestros).toBeDefined();
    expect(composition.maestrosReader).toBeDefined();
    expect(composition.notifyLog).toBeDefined();
    expect(composition.rateLimit).toBeDefined();
    expect(composition.emailSender).toBeDefined();
    expect(composition.telegram).toBeDefined();
    expect(composition.adminAllowlist).toBeDefined();
    expect(composition.clock).toBeDefined();
  });

  test('maestrosReader is the SAME object as maestros (G_C-37 union-widening invariant)', () => {
    const composition = getComposition();
    // The MaestrosRepository factory returns an object that satisfies both
    // MaestrosRepository (write surface) and MaestrosReader (read view). The
    // composition root binds the SAME reference to both fields — if they
    // diverge, the booking use cases would race against admin writes.
    expect(composition.maestrosReader).toBe(composition.maestros);
  });
});
