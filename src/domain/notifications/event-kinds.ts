// Notifications event-kind enum. Spec anchor: S-2 §7.2.4 C (NotifyLog port).
//
// W4-4 stub: the canonical EventKind union currently lives in the resend
// adapter (src/infrastructure/email/resend.ts). Re-exported here so domain
// ports can depend on a domain-owned identity without inverting the layer
// direction. The cleanup-CP (G_C-35) will flip the ownership — moving the
// literal union to this file and re-exporting from the adapter — once the
// domain layer is fully established.

export type { EventKind } from '@/infrastructure/email/resend';
