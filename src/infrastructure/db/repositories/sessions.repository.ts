// SessionsRepository adapter. Spec anchors: S-2 §7.2.4 A (port body) + §7.2.5
// (composition root wiring) + O-7 partial-unique-index discipline (raw `sql`
// for the WHERE status='confirmed' filter, NEVER eq()).
//
// W4-3a SPEC-GAP REPAIR: foundational adapter authoring per M-18 + D-055.
// G_C-31 wires the resulting factory into the composition root.

import { and, eq, gte, lt, sql } from 'drizzle-orm';

import type { Db } from '@/infrastructure/db/client';
import { sessions } from '@/infrastructure/db/schema';

import type { NewSession, Session, SessionStatus } from '@/domain/booking/entities';
import type { SessionsRepository } from '@/domain/booking/ports';

export function makeSessionsRepository(db: Db): SessionsRepository {
  return {
    async insertPending(input: NewSession): Promise<Session> {
      const rows = await db.insert(sessions).values(input).returning();
      const row = rows[0];
      if (!row) throw new Error('sessions.insertPending: RETURNING produced no row');
      return row;
    },

    async findById(id: string): Promise<Session | null> {
      const rows = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async updateStatus(
      id: string,
      from: SessionStatus,
      to: SessionStatus,
    ): Promise<Session | null> {
      // Atomic compare-and-set on the status column. The (from, to) guard is
      // the load-bearing concurrency control: a stale precondition (someone
      // else already advanced the row) returns no rows, signalling 409 to the
      // caller without a separate SELECT.
      const rows = await db
        .update(sessions)
        .set({ status: to, updatedAt: Date.now() })
        .where(and(eq(sessions.id, id), eq(sessions.status, from)))
        .returning();
      return rows[0] ?? null;
    },

    async confirmedStartsForMaestroInRange(args: {
      maestroId: string;
      rangeStartUtc: Date;
      rangeEndUtc: Date;
    }): Promise<Date[]> {
      // Raw `sql` filter on `status = 'confirmed'` per O-7 — matches the
      // partial-unique-index WHERE clause emitted by the schema so the
      // planner can use `sessions_teacher_slot_confirmed` directly.
      const rows = await db
        .select({ startsAtUtc: sessions.startsAtUtc })
        .from(sessions)
        .where(
          and(
            eq(sessions.teacherId, args.maestroId),
            sql`status = 'confirmed'`,
            gte(sessions.startsAtUtc, args.rangeStartUtc.getTime()),
            lt(sessions.startsAtUtc, args.rangeEndUtc.getTime()),
          ),
        );
      return rows.map((r) => new Date(r.startsAtUtc));
    },
  };
}
