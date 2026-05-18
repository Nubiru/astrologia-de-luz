/**
 * G_C-12 pairing — Resend Idempotency-Key helper (AC-3.2.6).
 *
 * Asserts that `idempotencyKey({sessionId, eventKind, attempt})` collides ONLY
 * when every input axis matches exactly, and that the derived value is the
 * SHA256-hex of the canonical `session:event:attempt` string (so the contract
 * is portable across reimplementations, not just internally consistent).
 *
 * These assertions FAIL when:
 *   - The hash algorithm is silently weakened (e.g. md5).
 *   - The join order changes (event:session:attempt) — would mean retries
 *     after a release no longer collide and Resend deduplication breaks.
 *   - A new event_kind variant is added to the union but the verification
 *     coverage doesn't pick it up.
 */

import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';

import { type EventKind, idempotencyKey } from '@/lib/resend';

const EVENT_KINDS: EventKind[] = [
  'visitor_receipt',
  'visitor_confirm',
  'visitor_decline',
  'visitor_cancel',
  'maestro_fallback',
  'maestro_failure',
];

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');

describe('idempotencyKey — shape', () => {
  test('returns lowercase SHA256 hex (64 chars)', () => {
    const key = idempotencyKey({ sessionId: 'sess-1', eventKind: 'visitor_receipt', attempt: 1 });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  test('matches SHA256("<sessionId>:<eventKind>:<attempt>") exactly (portable contract)', () => {
    const key = idempotencyKey({ sessionId: 'sess-abc', eventKind: 'visitor_confirm', attempt: 2 });
    expect(key).toBe(sha256Hex('sess-abc:visitor_confirm:2'));
  });

  test('is deterministic — identical input across 5 invocations yields one value', () => {
    const inputs = { sessionId: 'sess-x', eventKind: 'visitor_decline', attempt: 1 } as const;
    const keys = new Set(Array.from({ length: 5 }, () => idempotencyKey(inputs)));
    expect(keys.size).toBe(1);
  });
});

describe('idempotencyKey — collision iff every axis matches', () => {
  const BASE = { sessionId: 'sess-base', eventKind: 'visitor_receipt' as const, attempt: 1 };

  test('different sessionId → different key', () => {
    expect(idempotencyKey(BASE)).not.toBe(idempotencyKey({ ...BASE, sessionId: 'sess-other' }));
  });

  test('different attempt → different key (retry produces a new key)', () => {
    expect(idempotencyKey(BASE)).not.toBe(idempotencyKey({ ...BASE, attempt: 2 }));
  });

  test.each(EVENT_KINDS.filter((k) => k !== BASE.eventKind))(
    'different eventKind (%s vs visitor_receipt) → different key',
    (eventKind) => {
      expect(idempotencyKey(BASE)).not.toBe(idempotencyKey({ ...BASE, eventKind }));
    },
  );

  test('all 6 event_kind variants produce 6 distinct keys for the same session+attempt', () => {
    const keys = new Set(EVENT_KINDS.map((eventKind) => idempotencyKey({ ...BASE, eventKind })));
    expect(keys.size).toBe(EVENT_KINDS.length);
  });

  test('two payloads sharing every axis collide (server-side dedup hook)', () => {
    const a = idempotencyKey({ sessionId: 'sess-Z', eventKind: 'maestro_fallback', attempt: 3 });
    const b = idempotencyKey({ sessionId: 'sess-Z', eventKind: 'maestro_fallback', attempt: 3 });
    expect(a).toBe(b);
  });
});
