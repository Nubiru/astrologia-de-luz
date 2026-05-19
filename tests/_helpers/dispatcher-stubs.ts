/**
 * Shared dispatcher-stub helpers — Path A pattern across the 9-file
 * cascade-repair sweep (G_C-38..G_C-46) deduplicated into one module per
 * G_C-47 + D-053 mechanical-codemod exception.
 *
 * Consolidated from the most-evolved variants:
 *   - buildEmailSenderStub + buildTelegramStub: notify-failure-logs.test.ts
 *     (G_C-42 post — has both .calls AND the .setResultByEventKind /
 *     .setResultByChatId failure-injection setters).
 *   - buildMaestrosReaderStub: notify-fanout-augusto.test.ts (G_C-40 post —
 *     direct brandOwner return) + brand-owner-lookup.test.ts (G_C-39 post —
 *     custom findBrandOwner thunk). The unified signature accepts EITHER
 *     `brandOwner` (direct return) OR a `findBrandOwner` thunk for tests
 *     that need to drive findBrandOwner from a closure (e.g. brand-owner-
 *     lookup's per-test SQL query).
 *   - buildClockStub: webhook-status-dot.test.ts (G_C-38 post — mutable
 *     time pointer with `setTime` advance).
 *   - buildTestComposition + installTestComposition: manual-reenviar-
 *     success.test.ts (G_C-45 post — composition-injection Path A variant
 *     for route-handler integration tests).
 *
 * The helpers preserve the EXACT shapes used in-file at each pilot's close
 * — this is a pure mechanical deduplication. ZERO production touch.
 */

import { vi } from 'vitest';

import type { AdminAllowlist } from '@/domain/auth/ports';
import type { Clock, MaestrosReader, SessionsRepository } from '@/domain/booking/ports';
import type { RateLimitGate } from '@/domain/booking/ports';
import type { Teacher } from '@/domain/maestros/entities';
import type { MaestrosRepository } from '@/domain/maestros/ports';
import type { EmailSender, NotifyLog, TelegramBot } from '@/domain/notifications/ports';

import type { Db } from '@/infrastructure/db/client';
import { makeMaestrosRepository } from '@/infrastructure/db/repositories/maestros.repository';
import { makeNotifyLogRepository } from '@/infrastructure/db/repositories/notify-log.repository';
import { makeSessionsRepository } from '@/infrastructure/db/repositories/sessions.repository';
import * as compositionMod from '@/main/composition';
import type { Composition } from '@/main/composition';

/**
 * Port-result shape for failure injection — mirrors the boundary translation
 * the production adapters do at runtime. Each cascade test that uses
 * setResultByEventKind / setResultByChatId pushes a PortResult through this
 * type.
 */
export type PortResult = { ok: boolean; status: number; errorBody: string | null };

// ───────────────────────────────────────────────────────────────────────────
// EmailSender stub
// ───────────────────────────────────────────────────────────────────────────

export type EmailSenderCall = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  sessionId: string;
  eventKind: string;
  attempt: number;
};

export type EmailSenderStub = EmailSender & {
  calls: EmailSenderCall[];
  setResultByEventKind: (eventKind: string, response: PortResult) => void;
};

/**
 * Build an `EmailSender` port stub that records each `send()` call into
 * `.calls` and returns `{ ok: true, status: 200, errorBody: null }` by
 * default. Per-eventKind failure injection via `setResultByEventKind`.
 */
export function buildEmailSenderStub(): EmailSenderStub {
  const calls: EmailSenderCall[] = [];
  const responseByEventKind = new Map<string, PortResult>();
  return {
    calls,
    setResultByEventKind: (eventKind, response) => {
      responseByEventKind.set(eventKind, response);
    },
    send: vi.fn(async (input) => {
      calls.push(input);
      return responseByEventKind.get(input.eventKind) ?? { ok: true, status: 200, errorBody: null };
    }),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// TelegramBot stub
// ───────────────────────────────────────────────────────────────────────────

export type TelegramCall = {
  chatId: number | string;
  text: string;
  parseMode?: 'HTML' | 'MarkdownV2';
};

export type TelegramBotStub = TelegramBot & {
  calls: TelegramCall[];
  setResultByChatId: (chatId: number | string, response: PortResult) => void;
};

/**
 * Build a `TelegramBot` port stub that records each `sendMessage()` call
 * into `.calls` and returns success by default. Per-chatId failure injection
 * via `setResultByChatId`. The `getWebhookInfo` method defaults to
 * `{ ok: true }`; webhook-status tests override via
 * `vi.mocked(telegram.getWebhookInfo).mockResolvedValue(...)` OR by passing
 * a custom `getWebhookInfoImpl`.
 */
export function buildTelegramStub(opts?: {
  getWebhookInfoImpl?: TelegramBot['getWebhookInfo'];
}): TelegramBotStub {
  const calls: TelegramCall[] = [];
  const responseByChatId = new Map<string, PortResult>();
  const defaultGetWebhookInfo: TelegramBot['getWebhookInfo'] = async () => ({ ok: true });
  return {
    calls,
    setResultByChatId: (chatId, response) => {
      responseByChatId.set(String(chatId), response);
    },
    sendMessage: vi.fn(async (input) => {
      calls.push(input);
      return (
        responseByChatId.get(String(input.chatId)) ?? { ok: true, status: 200, errorBody: null }
      );
    }),
    getWebhookInfo: vi.fn(opts?.getWebhookInfoImpl ?? defaultGetWebhookInfo),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// MaestrosReader stub
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build a `MaestrosReader` port stub. Two equivalent ways to drive
 * `findBrandOwner`:
 *
 *   - `brandOwner: Teacher | null` — direct return (dominant pattern across
 *     notify-fanout-*, notify-failure-logs, visitor-email-failure-warning,
 *     dispatch-transition-matrix).
 *   - `findBrandOwner: () => Promise<Teacher | null>` — custom thunk
 *     (brand-owner-lookup's per-test SQL query closure).
 *
 * `findActiveBySlug` + `findById` default to `null` returns (unused by the
 * cascade-test paths); override-able for completeness.
 */
export function buildMaestrosReaderStub(opts: {
  brandOwner?: Teacher | null;
  findBrandOwner?: () => Promise<Teacher | null>;
  findActiveBySlug?: (slug: string) => Promise<Teacher | null>;
  findById?: (id: string) => Promise<Teacher | null>;
}): MaestrosReader {
  const brandOwnerThunk = opts.findBrandOwner ?? (async () => opts.brandOwner ?? null);
  return {
    findActiveBySlug: opts.findActiveBySlug ?? (async () => null),
    findById: opts.findById ?? (async () => null),
    findBrandOwner: brandOwnerThunk,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Clock stub
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build a `Clock` port stub whose `now()` reads from a shared mutable
 * closure-scoped time variable. Returns the clock and a `setTime` setter so
 * a test can advance time mid-execution (e.g. to exercise the
 * webhook-status cache-TTL boundary).
 */
export function buildClockStub(initialMs: number): {
  clock: Clock;
  setTime: (ms: number) => void;
} {
  let t = initialMs;
  return {
    clock: { now: () => new Date(t) },
    setTime: (ms: number) => {
      t = ms;
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Composition-injection (Path A variant for route-handler integration tests)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build a `Composition` object suitable for `vi.spyOn(compositionMod,
 * 'getComposition').mockReturnValue(...)` — wraps REAL repositories around
 * the supplied in-memory libSQL DB so trail-row assertions stay
 * byte-identical with production behaviour. Side-effect ports
 * (emailSender / telegram) default to fresh stubs; pass overrides to
 * inject failure responses or shared instances. The `maestros` ↔
 * `maestrosReader` union-widening invariant (G_C-37) is preserved when
 * both fields use the factory default.
 */
export function buildTestComposition(db: Db, overrides: Partial<Composition> = {}): Composition {
  const maestros = (overrides.maestros ?? makeMaestrosRepository(db)) as MaestrosRepository;
  const maestrosReader: MaestrosReader =
    overrides.maestrosReader ?? (maestros as unknown as MaestrosReader);
  const sessions: SessionsRepository = overrides.sessions ?? makeSessionsRepository(db);
  const notifyLog: NotifyLog = overrides.notifyLog ?? makeNotifyLogRepository(db);
  const rateLimit: RateLimitGate = overrides.rateLimit ?? {
    check: async () => ({ allowed: true, retryAfterSeconds: 0, count: 0 }),
  };
  const emailSender: EmailSender = overrides.emailSender ?? buildEmailSenderStub();
  const telegram: TelegramBot = overrides.telegram ?? buildTelegramStub();
  const adminAllowlist: AdminAllowlist = overrides.adminAllowlist ?? { contains: () => true };
  const clock: Clock = overrides.clock ?? { now: () => new Date() };
  return {
    sessions,
    maestros,
    maestrosReader,
    notifyLog,
    rateLimit,
    emailSender,
    telegram,
    adminAllowlist,
    clock,
  };
}

/**
 * Install a test composition by spying `getComposition()` on the
 * production composition module. The spy is auto-restored by
 * `vi.restoreAllMocks()` in the consumer's `afterEach`.
 */
export function installTestComposition(testComposition: Composition): void {
  vi.spyOn(compositionMod, 'getComposition').mockReturnValue(testComposition);
}
