// Booking bounded-context ports. Spec anchor: S-2 §7.2.4 A (verbatim bodies).
//
// W4-4 stub: pure TS `interface` bodies. No runtime. Adapters live in
// src/infrastructure/* (db repositories, rate-limit token-bucket, etc.);
// composition root wires them at startup (per §7.2.5).

import type { NewSession, Session, SessionStatus } from '@/domain/booking/entities';
import type { Teacher } from '@/domain/maestros/entities';

/**
 * SessionsRepository — Vernon Ch.12 §2.16 row 30: "Repository 1:1 with Aggregate."
 * The Session aggregate's persistence port. Reads + writes; implementation handles
 * the partial-unique-index discipline (Drizzle raw `sql` per O-7).
 */
export interface SessionsRepository {
  insertPending(input: NewSession): Promise<Session>;
  findById(id: string): Promise<Session | null>;
  updateStatus(id: string, from: SessionStatus, to: SessionStatus): Promise<Session | null>;
  /** confirmedStarts: needed by deriveAvailability + slot-collision check. */
  confirmedStartsForMaestroInRange(args: {
    maestroId: string;
    rangeStartUtc: Date;
    rangeEndUtc: Date;
  }): Promise<Date[]>;
}

/**
 * MaestrosReader — read-only view of the Maestro aggregate from booking's perspective.
 * Booking needs to look up the brand-owner + the assigned maestro; it does NOT mutate.
 * Vernon Ch.10 §2.16 row 26 — "Reference by identity" — keeps booking from depending
 * on the MaestrosRepository write side.
 */
export interface MaestrosReader {
  findActiveBySlug(slug: string): Promise<Teacher | null>;
  findById(id: string): Promise<Teacher | null>;
  findBrandOwner(): Promise<Teacher | null>;
}

/**
 * RateLimitGate — the IP rate-limit check.
 * Cockburn Fig 4.6 §2.17 row 7 — port-vs-adapter folder separation;
 * implementation in src/infrastructure/rate-limit/token-bucket.ts.
 */
export interface RateLimitGate {
  check(ip: string): Promise<{ allowed: boolean; retryAfterSeconds: number; count: number }>;
}

/**
 * Clock — testability port (Vernon Ch.7 row 18 — Domain Service stateless;
 * here a tiny side-effect port for `new Date()`).
 */
export interface Clock {
  now(): Date;
}
