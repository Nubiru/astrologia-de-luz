// Booking aggregate root + value types. Spec anchor: S-2 §7.3.1 G_C-32 row.
//
// W4-4 stub: re-exports Drizzle's inferred `Session` + `NewSession` types
// from the infrastructure schema (per CP-3 §3.3 row 28 anticipation) plus
// the SessionStatus literal-union — the canonical type for the lifecycle
// states. The application layer's existing parallel `SessionStatus` union
// in src/application/notify/dispatch-transition.ts will be reconciled at
// the cleanup-CP (G_C-35) by direct rewrite to import from here.

export type { Session, NewSession } from '@/infrastructure/db/schema';

export type SessionStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'rejected'
  | 'no_show'
  | 'completed';
