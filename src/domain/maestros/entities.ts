// Maestros aggregate root + value types. Spec anchor: S-2 §7.3.1 G_C-32 row.
//
// W4-4 stub: re-exports Drizzle's inferred `Teacher` + `NewTeacher` from
// the infrastructure schema, plus the `Availability` zod-inferred type from
// the moved availability validator (G_C-32 moved lib/availability/schema.ts
// → src/domain/booking/availability.ts). Per CP-3 §3.3 row 28 anticipation
// the domain owns the type identity; adapters infer from Drizzle.

export type { Teacher, NewTeacher } from '@/infrastructure/db/schema';
export type { Availability } from '@/domain/booking/availability';
