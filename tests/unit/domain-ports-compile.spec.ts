// Domain ports type-only compile check. Spec anchor: S-2 §7.3.1 G_C-32 row.
//
// Asserts that each of the 8 port interfaces (across 4 bounded contexts)
// (a) compiles, (b) has the expected member set, and (c) types-check against
// a structural mock. Uses vitest's `assertType<>` — a compile-time gate that
// makes the test red if a port interface drifts from the spec body.
//
// This is a *typeshape* spec — it does not exercise any runtime. A red here
// signals that a port surface changed (intentionally or not) and the wave
// composition root + future adapters must be re-checked.

import { assertType, describe, it } from 'vitest';

import type { AdminAllowlist } from '@/domain/auth/ports';
import type {
  Clock,
  MaestrosReader,
  RateLimitGate,
  SessionsRepository,
} from '@/domain/booking/ports';
import type { MaestrosRepository } from '@/domain/maestros/ports';
import type { EmailSender, NotifyLog, TelegramBot } from '@/domain/notifications/ports';

describe('domain ports — typeshape compile gate', () => {
  it('SessionsRepository has the spec §7.2.4 A member set', () => {
    const mock = {} as SessionsRepository;
    assertType<SessionsRepository['insertPending']>(mock.insertPending);
    assertType<SessionsRepository['findById']>(mock.findById);
    assertType<SessionsRepository['updateStatus']>(mock.updateStatus);
    assertType<SessionsRepository['confirmedStartsForMaestroInRange']>(
      mock.confirmedStartsForMaestroInRange,
    );
  });

  it('MaestrosReader is read-only (3 finder methods)', () => {
    const mock = {} as MaestrosReader;
    assertType<MaestrosReader['findActiveBySlug']>(mock.findActiveBySlug);
    assertType<MaestrosReader['findById']>(mock.findById);
    assertType<MaestrosReader['findBrandOwner']>(mock.findBrandOwner);
  });

  it('RateLimitGate exposes a single check(ip) → { allowed, retryAfterSeconds, count }', () => {
    const mock = {} as RateLimitGate;
    assertType<RateLimitGate['check']>(mock.check);
  });

  it('Clock is { now(): Date }', () => {
    const mock: Clock = { now: () => new Date() };
    assertType<Clock>(mock);
  });

  it('MaestrosRepository is full read+write (spec §7.2.4 B)', () => {
    const mock = {} as MaestrosRepository;
    assertType<MaestrosRepository['list']>(mock.list);
    assertType<MaestrosRepository['findBySlug']>(mock.findBySlug);
    assertType<MaestrosRepository['findById']>(mock.findById);
    assertType<MaestrosRepository['insert']>(mock.insert);
    assertType<MaestrosRepository['updateAvailability']>(mock.updateAvailability);
    assertType<MaestrosRepository['updateTelegramChatId']>(mock.updateTelegramChatId);
    assertType<MaestrosRepository['archive']>(mock.archive);
  });

  it('EmailSender has a single send() returning { ok, status, errorBody }', () => {
    const mock = {} as EmailSender;
    assertType<EmailSender['send']>(mock.send);
  });

  it('TelegramBot has sendMessage + getWebhookInfo', () => {
    const mock = {} as TelegramBot;
    assertType<TelegramBot['sendMessage']>(mock.sendMessage);
    assertType<TelegramBot['getWebhookInfo']>(mock.getWebhookInfo);
  });

  it('NotifyLog has persistFailures + findById (retry-path-aware)', () => {
    const mock = {} as NotifyLog;
    assertType<NotifyLog['persistFailures']>(mock.persistFailures);
    assertType<NotifyLog['findById']>(mock.findById);
  });

  it('AdminAllowlist is { contains(email): boolean }', () => {
    const mock: AdminAllowlist = { contains: () => true };
    assertType<AdminAllowlist>(mock);
  });
});
