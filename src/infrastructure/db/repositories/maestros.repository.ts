// MaestrosRepository + MaestrosReader adapter. Spec anchors: S-2 §7.2.4 B
// (MaestrosRepository body) + §7.2.4 A (MaestrosReader body) + §7.2.5
// composition `maestrosReader: maestros` line.
//
// W4-3a SPEC-GAP REPAIR: the factory returns `MaestrosRepository & MaestrosReader`
// (instead of the briefing's literal `MaestrosRepository`) so the composition
// root's `maestrosReader: maestros` assignment type-checks. The reader port
// has 3 methods (findActiveBySlug + findById + findBrandOwner) that the
// repository port does not name; running both in the same concrete object is
// the minimum-diff that preserves the spec-prescribed composition wiring.
// Flagged in G_C-37 close-note as transparent scope expansion (Lesson 2:
// "Mechanical scaffolding" — required for downstream composition to compile).

import { and, eq } from 'drizzle-orm';

import type { Db } from '@/infrastructure/db/client';
import { teachers } from '@/infrastructure/db/schema';
import { getEnv } from '@/infrastructure/env';

import type { MaestrosReader } from '@/domain/booking/ports';
import type { Availability, NewTeacher, Teacher } from '@/domain/maestros/entities';
import type { MaestrosRepository } from '@/domain/maestros/ports';

/**
 * Canonical brand-owner email: lower-cased + trimmed first entry of
 * `ADMIN_EMAILS`. Mirrors `brandOwnerEmail()` in src/application/notify/
 * brand-owner.ts — duplicated here (1 line) instead of imported to keep the
 * layer direction infrastructure-pure (no application → domain inversion).
 */
function brandOwnerEmailFromEnv(): string {
  return (getEnv().ADMIN_EMAILS.split(',')[0] ?? '').trim().toLowerCase();
}

export function makeMaestrosRepository(db: Db): MaestrosRepository & MaestrosReader {
  return {
    async list(args?: { activeOnly?: boolean }): Promise<Teacher[]> {
      if (args?.activeOnly) {
        return db.select().from(teachers).where(eq(teachers.active, true));
      }
      return db.select().from(teachers);
    },

    async findBySlug(slug: string): Promise<Teacher | null> {
      const rows = await db.select().from(teachers).where(eq(teachers.slug, slug)).limit(1);
      return rows[0] ?? null;
    },

    async findById(id: string): Promise<Teacher | null> {
      const rows = await db.select().from(teachers).where(eq(teachers.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async findActiveBySlug(slug: string): Promise<Teacher | null> {
      const rows = await db
        .select()
        .from(teachers)
        .where(and(eq(teachers.slug, slug), eq(teachers.active, true)))
        .limit(1);
      return rows[0] ?? null;
    },

    async findBrandOwner(): Promise<Teacher | null> {
      const email = brandOwnerEmailFromEnv();
      const rows = await db.select().from(teachers).where(eq(teachers.email, email)).limit(1);
      return rows[0] ?? null;
    },

    async insert(input: NewTeacher): Promise<Teacher> {
      const rows = await db.insert(teachers).values(input).returning();
      const row = rows[0];
      if (!row) throw new Error('maestros.insert: RETURNING produced no row');
      return row;
    },

    async updateAvailability(id: string, availability: Availability): Promise<Teacher | null> {
      const rows = await db
        .update(teachers)
        .set({ availability: JSON.stringify(availability), updatedAt: Date.now() })
        .where(eq(teachers.id, id))
        .returning();
      return rows[0] ?? null;
    },

    async updateTelegramChatId(id: string, chatId: number | null): Promise<Teacher | null> {
      const rows = await db
        .update(teachers)
        .set({
          telegramChatId: chatId === null ? null : String(chatId),
          updatedAt: Date.now(),
        })
        .where(eq(teachers.id, id))
        .returning();
      return rows[0] ?? null;
    },

    async archive(id: string): Promise<Teacher | null> {
      const rows = await db
        .update(teachers)
        .set({ active: false, updatedAt: Date.now() })
        .where(eq(teachers.id, id))
        .returning();
      return rows[0] ?? null;
    },
  };
}
