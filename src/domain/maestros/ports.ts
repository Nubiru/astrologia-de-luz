// Maestros bounded-context ports. Spec anchor: S-2 §7.2.4 B (verbatim body).
//
// W4-4 stub: pure TS interface. Adapter at src/infrastructure/db/repositories/
// maestros.repository.ts (authored at a later wave).

import type { Availability, NewTeacher, Teacher } from '@/domain/maestros/entities';

/**
 * MaestrosRepository — Vernon Ch.12 row 30. Aggregate Root: Maestro.
 * Full read+write; admin CRUD lives here.
 */
export interface MaestrosRepository {
  list(args?: { activeOnly?: boolean }): Promise<Teacher[]>;
  findBySlug(slug: string): Promise<Teacher | null>;
  findById(id: string): Promise<Teacher | null>;
  insert(input: NewTeacher): Promise<Teacher>;
  updateAvailability(id: string, availability: Availability): Promise<Teacher | null>;
  updateTelegramChatId(id: string, chatId: number | null): Promise<Teacher | null>;
  archive(id: string): Promise<Teacher | null>; // soft-delete (active=false), D-019
}
