/**
 * G_C-31 unit pairing — retryFailed use case (S-2 §7.2.3 C / §7.2.7 B).
 *
 * What this catches:
 *   - The use case skips the trail-row INSERT on success (regression on the
 *     AC-3.3.5 "preserve the trail" clause — listing page never sees the
 *     recovery row).
 *   - The use case fails to increment the attempt number (regression on the
 *     AC-3.2.6 idempotency-key axis; Resend would dedupe the retry).
 *   - The use case dispatches when session/maestro/brand-owner is missing
 *     (must short-circuit to a typed-sum failure kind, never reach refire).
 *   - Wrong EventKind branching: a visitor_receipt log retries as a
 *     maestro_failure (Telegram) instead of an EmailSender.send().
 *
 * Tests use createRetryFailed(fakeDeps) directly — the factory shape per
 * D-049 / D-050.
 */

import { describe, expect, test, vi } from 'vitest';

import { createRetryFailed } from '@/application/notify/retry-failed';
import type { MaestrosReader, SessionsRepository } from '@/domain/booking/ports';
import type { Teacher } from '@/domain/maestros/entities';
import type { EventKind } from '@/domain/notifications/event-kinds';
import type { EmailSender, NotifyLog, TelegramBot } from '@/domain/notifications/ports';
import type { Session } from '@/infrastructure/db/schema';

const seedSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'sess-r',
  teacherId: 't-1',
  startsAtUtc: 1_779_789_600_000,
  durationMinutes: 60,
  status: 'pending',
  visitorName: 'Carla',
  visitorEmail: 'carla@example.com',
  contactPref: 'email',
  contactValue: 'carla@example.com',
  visitorIntent: null,
  visitorTimezone: 'America/Argentina/Buenos_Aires',
  notesInternal: null,
  decidedAt: null,
  createdAt: 1_779_789_000_000,
  updatedAt: 1_779_789_000_000,
  ...overrides,
});

const seedMaestro = (overrides: Partial<Teacher> = {}): Teacher => ({
  id: 't-1',
  slug: 'augusto',
  name: 'Augusto',
  email: 'augusto@example.com',
  bio: null,
  telegramChatId: null,
  availability: '{}',
  avatarUrl: null,
  timezone: 'America/Argentina/Buenos_Aires',
  active: true,
  createdAt: 1_779_789_000_000,
  updatedAt: 1_779_789_000_000,
  ...overrides,
});

function buildDeps(opts: {
  log?: {
    sessionId: string;
    channel: 'telegram' | 'resend';
    eventKind: EventKind;
    recipient: string;
    payload: unknown;
  } | null;
  session?: Session | null;
  maestro?: Teacher | null;
  brandOwner?: Teacher | null;
  emailSend?: { ok: boolean; status: number; errorBody: string | null };
  telegramSend?: { ok: boolean; status: number; errorBody: string | null };
}): {
  deps: {
    notifyLog: NotifyLog;
    emailSender: EmailSender;
    telegram: TelegramBot;
    sessions: SessionsRepository;
    maestrosReader: MaestrosReader;
  };
  emailSpy: ReturnType<typeof vi.fn>;
  telegramSpy: ReturnType<typeof vi.fn>;
  persistSpy: ReturnType<typeof vi.fn>;
} {
  const persistSpy = vi.fn(async () => undefined);
  const notifyLog: NotifyLog = {
    persistFailures: persistSpy,
    findById: vi.fn(async () => opts.log ?? null),
  };
  const emailSpy = vi.fn(async () => opts.emailSend ?? { ok: true, status: 200, errorBody: null });
  const emailSender: EmailSender = { send: emailSpy };
  const telegramSpy = vi.fn(
    async () => opts.telegramSend ?? { ok: true, status: 200, errorBody: null },
  );
  const telegram: TelegramBot = {
    sendMessage: telegramSpy,
    getWebhookInfo: vi.fn(),
  };
  const sessions: SessionsRepository = {
    insertPending: vi.fn(),
    findById: vi.fn(async () => opts.session ?? null),
    updateStatus: vi.fn(),
    confirmedStartsForMaestroInRange: vi.fn(async () => []),
  };
  const maestrosReader: MaestrosReader = {
    findActiveBySlug: vi.fn(),
    findById: vi.fn(async () => opts.maestro ?? null),
    findBrandOwner: vi.fn(async () => opts.brandOwner ?? null),
  };
  return {
    deps: { notifyLog, emailSender, telegram, sessions, maestrosReader },
    emailSpy,
    telegramSpy,
    persistSpy,
  };
}

describe('retryFailed', () => {
  test('returns not_found when notifyLog row is missing', async () => {
    const { deps, emailSpy, telegramSpy, persistSpy } = buildDeps({ log: null });
    const outcome = await createRetryFailed(deps)({ notifyLogId: 'nope' });
    expect(outcome).toEqual({ kind: 'not_found' });
    expect(emailSpy).not.toHaveBeenCalled();
    expect(telegramSpy).not.toHaveBeenCalled();
    expect(persistSpy).not.toHaveBeenCalled();
  });

  test('returns session_missing when log resolves but session is gone', async () => {
    const { deps } = buildDeps({
      log: {
        sessionId: 'sess-r',
        channel: 'resend',
        eventKind: 'visitor_receipt',
        recipient: 'carla@example.com',
        payload: { attemptNumber: 1 },
      },
      session: null,
    });
    const outcome = await createRetryFailed(deps)({ notifyLogId: 'log-1' });
    expect(outcome).toEqual({ kind: 'session_missing' });
  });

  test('returns maestro_missing when session resolves but maestro is gone', async () => {
    const { deps } = buildDeps({
      log: {
        sessionId: 'sess-r',
        channel: 'resend',
        eventKind: 'visitor_receipt',
        recipient: 'carla@example.com',
        payload: { attemptNumber: 1 },
      },
      session: seedSession(),
      maestro: null,
    });
    const outcome = await createRetryFailed(deps)({ notifyLogId: 'log-1' });
    expect(outcome).toEqual({ kind: 'maestro_missing' });
  });

  test('returns brand_owner_missing when brand-owner row is gone', async () => {
    const { deps } = buildDeps({
      log: {
        sessionId: 'sess-r',
        channel: 'resend',
        eventKind: 'visitor_receipt',
        recipient: 'carla@example.com',
        payload: { attemptNumber: 1 },
      },
      session: seedSession(),
      maestro: seedMaestro(),
      brandOwner: null,
    });
    const outcome = await createRetryFailed(deps)({ notifyLogId: 'log-1' });
    expect(outcome).toEqual({ kind: 'brand_owner_missing' });
  });

  test('retries visitor_receipt as email + persists trail row on success', async () => {
    const { deps, emailSpy, telegramSpy, persistSpy } = buildDeps({
      log: {
        sessionId: 'sess-r',
        channel: 'resend',
        eventKind: 'visitor_receipt',
        recipient: 'carla@example.com',
        payload: { attemptNumber: 1 },
      },
      session: seedSession(),
      maestro: seedMaestro(),
      brandOwner: seedMaestro({ id: 'bo', email: 'augusto@example.com' }),
      emailSend: { ok: true, status: 200, errorBody: null },
    });
    const outcome = await createRetryFailed(deps)({ notifyLogId: 'log-1' });
    expect(outcome.kind).toBe('retry_ok');
    if (outcome.kind === 'retry_ok') {
      expect(outcome.attemptNumber).toBe(2);
      expect(outcome.outcome.channel).toBe('resend');
      expect(outcome.outcome.status).toBe(200);
    }
    expect(emailSpy).toHaveBeenCalledOnce();
    const callArg = emailSpy.mock.calls[0]?.[0] as { eventKind: string; attempt: number };
    expect(callArg.eventKind).toBe('visitor_receipt');
    expect(callArg.attempt).toBe(2);
    expect(telegramSpy).not.toHaveBeenCalled();
    expect(persistSpy).toHaveBeenCalledOnce();
    const persisted = persistSpy.mock.calls[0]?.[0] as Array<{
      attemptNumber: number;
      status: number;
    }>;
    expect(persisted[0]?.attemptNumber).toBe(2);
    expect(persisted[0]?.status).toBe(200);
  });

  test('retries maestro_failure as telegram + returns retry_failed on non-2xx', async () => {
    const { deps, emailSpy, telegramSpy, persistSpy } = buildDeps({
      log: {
        sessionId: 'sess-r',
        channel: 'telegram',
        eventKind: 'maestro_failure',
        recipient: '111222333',
        payload: { attemptNumber: 2 },
      },
      session: seedSession(),
      maestro: seedMaestro({ telegramChatId: '111222333' }),
      brandOwner: seedMaestro({
        id: 'bo',
        email: 'augusto@example.com',
        telegramChatId: '111222333',
      }),
      telegramSend: { ok: false, status: 403, errorBody: 'Forbidden' },
    });
    const outcome = await createRetryFailed(deps)({ notifyLogId: 'log-2' });
    expect(outcome.kind).toBe('retry_failed');
    if (outcome.kind === 'retry_failed') {
      expect(outcome.attemptNumber).toBe(3);
      expect(outcome.outcome.channel).toBe('telegram');
      expect(outcome.outcome.status).toBe(403);
    }
    expect(telegramSpy).toHaveBeenCalledOnce();
    expect(emailSpy).not.toHaveBeenCalled();
    expect(persistSpy).toHaveBeenCalledOnce();
  });
});
