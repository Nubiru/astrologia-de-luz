// NotifyLog adapter. Spec anchor: S-2 §7.2.4 C (NotifyLog port body) +
// AC-3.3.1 (failure-only telemetry).
//
// W4-3a SPEC-GAP REPAIR: persistence side mirrors src/application/notify/
// shared.ts:persistFailures — same batch-INSERT shape, same row identity.
// The `payload` field returned by findById packages the non-port row data
// (status / errorBody / attemptNumber / createdAt) as a single unknown so
// the retry-path G_C-15 caller can reconstruct without a second SELECT.

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import type { Db } from '@/infrastructure/db/client';
import { notifyLog } from '@/infrastructure/db/schema';

import type { EventKind } from '@/domain/notifications/event-kinds';
import type { NotifyLog as NotifyLogPort } from '@/domain/notifications/ports';

export function makeNotifyLogRepository(db: Db): NotifyLogPort {
  return {
    async persistFailures(
      outcomes: Array<{
        sessionId: string;
        channel: 'telegram' | 'resend';
        eventKind: EventKind;
        recipient: string;
        status: number;
        errorBody: string | null;
        attemptNumber: number;
      }>,
    ): Promise<void> {
      if (outcomes.length === 0) return;
      const now = Date.now();
      await db.insert(notifyLog).values(
        outcomes.map((o) => ({
          id: randomUUID(),
          sessionId: o.sessionId,
          eventKind: o.eventKind,
          channel: o.channel,
          recipient: o.recipient,
          status: o.status,
          errorBody: o.errorBody,
          attemptNumber: o.attemptNumber,
          createdAt: now,
        })),
      );
    },

    async findById(id: string) {
      const rows = await db.select().from(notifyLog).where(eq(notifyLog.id, id)).limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        sessionId: row.sessionId,
        channel: row.channel as 'telegram' | 'resend',
        eventKind: row.eventKind as EventKind,
        recipient: row.recipient,
        // Non-port row fields packed for retry-path reconstruction (G_C-15).
        payload: {
          status: row.status,
          errorBody: row.errorBody,
          attemptNumber: row.attemptNumber,
          createdAt: row.createdAt,
        },
      };
    },
  };
}
