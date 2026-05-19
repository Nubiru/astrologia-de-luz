/**
 * Composition root. Cockburn Fig 6.22 L647 §2.17 row 67.
 *
 * The ONE place where concrete adapters are bound to application services.
 * Routes import default-instances from each application module (which
 * read this composition lazily at invocation); tests import factories
 * directly OR `__resetCompositionForTests()` to flush bindings between
 * cases.
 *
 * Spec anchor: S-2 §7.2.5 (verbatim body) + D-050 (single composition root,
 * SOUL-Simplicity-Test ratified at SOUL 95/100).
 *
 * Lazy + memoized: first import triggers wiring, subsequent imports reuse.
 * Mirrors the env/db/resend lazy-cache convention so test-time substitution
 * stays clean.
 */

import { isAdminEmail } from '@/infrastructure/auth/allowlist';
import { getDb } from '@/infrastructure/db/client';
import { getEnv } from '@/infrastructure/env';

import { systemClock } from '@/infrastructure/clock';
import { makeMaestrosRepository } from '@/infrastructure/db/repositories/maestros.repository';
import { makeNotifyLogRepository } from '@/infrastructure/db/repositories/notify-log.repository';
import { makeSessionsRepository } from '@/infrastructure/db/repositories/sessions.repository';
import { makeEmailSender } from '@/infrastructure/email/resend';
import { makeRateLimitGate } from '@/infrastructure/rate-limit/token-bucket';
import { makeTelegramBot } from '@/infrastructure/telegram/client';

import type { AdminAllowlist } from '@/domain/auth/ports';
import type {
  Clock,
  MaestrosReader,
  RateLimitGate,
  SessionsRepository,
} from '@/domain/booking/ports';
import type { MaestrosRepository } from '@/domain/maestros/ports';
import type { EmailSender, NotifyLog, TelegramBot } from '@/domain/notifications/ports';

export interface Composition {
  sessions: SessionsRepository;
  maestros: MaestrosRepository;
  maestrosReader: MaestrosReader; // structural-subset view
  notifyLog: NotifyLog;
  rateLimit: RateLimitGate;
  emailSender: EmailSender;
  telegram: TelegramBot;
  adminAllowlist: AdminAllowlist;
  clock: Clock;
}

let cached: Composition | null = null;

export function getComposition(): Composition {
  if (cached === null) {
    const db = getDb();
    const maestros = makeMaestrosRepository(db);
    cached = {
      sessions: makeSessionsRepository(db),
      maestros,
      // makeMaestrosRepository returns `MaestrosRepository & MaestrosReader`
      // (G_C-37 union widening); the reader view is the same concrete object.
      maestrosReader: maestros,
      notifyLog: makeNotifyLogRepository(db),
      rateLimit: makeRateLimitGate(db),
      emailSender: makeEmailSender(),
      telegram: makeTelegramBot(),
      adminAllowlist: {
        contains: (email) => isAdminEmail(email, getEnv().ADMIN_EMAILS),
      },
      clock: systemClock,
    };
  }
  return cached;
}

export function __resetCompositionForTests(): void {
  cached = null;
}
