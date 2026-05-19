/**
 * G_B-4 / G_C-38 integration pairing — webhook status helper (AC-3.7.6).
 *
 * Drives `createGetWebhookStatus({ telegram, clock })` factory instances end-
 * to-end against hand-rolled `TelegramBot` + `Clock` stubs, validating the
 * four branches of the verde/rojo state machine PLUS the 5-minute cache TTL.
 *
 * G_C-38 refactor (M-20 / D-056): the legacy module-mocked + arg-injected
 * clock shape is replaced by Path A — each test (or sub-block) builds its own
 * factory instance with full control over both ports. No `vi.mock` of the
 * telegram client; no `__resetWebhookStatusCache` calls. The default-instance
 * path (`getWebhookStatus()` with no args) is wired by the composition root
 * and smoke-tested in G_C-36 — out of scope for this file.
 *
 * Fails when:
 *   - `getExpectedWebhookUrl()` drifts away from `${AUTH_URL}/api/telegram/
 *     webhook` (would mean every legitimate webhook still shows rojo because
 *     the URL no longer matches expectation).
 *   - The "url matches expectation" leg is dropped — a webhook pointing at
 *     the wrong origin (e.g. attacker-controlled) would render verde.
 *   - The cache TTL regresses to a different value or stops invalidating —
 *     either a stale rojo persists past the 5-minute window OR every page
 *     render hits Telegram's API (rate-limit blowup).
 *   - A future "simplification" removes the clock-injection seam and the
 *     cache becomes untestable.
 *   - Per-instance cache regresses into a module-scoped singleton (would
 *     leak state across factory instances and silently couple tests).
 */

import { describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  for (const [k, v] of Object.entries({
    TURSO_DATABASE_URL: ':memory:',
    TURSO_AUTH_TOKEN: 'fixture-token',
    AUTH_SECRET: 'w'.repeat(48),
    // AUTH_URL drives `getExpectedWebhookUrl()` — pin it so the helper
    // produces a deterministic expected URL the stubs can match.
    AUTH_URL: 'https://astrologiadeluz.test',
    AUTH_RESEND_KEY: 're_fixture_webhook',
    RESEND_FROM: 'no-reply@webhook.test',
    ADMIN_EMAILS: 'a@b.test',
    TELEGRAM_BOT_TOKEN: '1:webhook-fixture',
    TELEGRAM_BOT_USERNAME: 'WebhookBot',
    TELEGRAM_WEBHOOK_SECRET: 'x'.repeat(48),
  })) {
    process.env[k] = v;
  }
});

import {
  WEBHOOK_CACHE_TTL_MS,
  createGetWebhookStatus,
  getExpectedWebhookUrl,
} from '@/application/panel/webhook-status';

import { buildClockStub, buildTelegramStub } from '../_helpers/dispatcher-stubs';

const okWebhookInfo = (url: string) => ({
  ok: true as const,
  result: {
    url,
    pending_update_count: 0,
  },
});

describe('AC-3.7.6 — getExpectedWebhookUrl from AUTH_URL', () => {
  test('appends /api/telegram/webhook to AUTH_URL without a trailing slash', () => {
    expect(getExpectedWebhookUrl()).toBe('https://astrologiadeluz.test/api/telegram/webhook');
  });
});

describe('AC-3.7.6 — verde branch (ok + url matches expected)', () => {
  test('returns ok:true with the matching url', async () => {
    const telegram = buildTelegramStub();
    vi.mocked(telegram.getWebhookInfo).mockResolvedValue(okWebhookInfo(getExpectedWebhookUrl()));
    const { clock } = buildClockStub(1_700_000_000_000);
    const statusFn = createGetWebhookStatus({ telegram, clock });

    const status = await statusFn();

    expect(status.ok).toBe(true);
    expect(status.url).toBe(getExpectedWebhookUrl());
    expect(status.checkedAt).toBeGreaterThan(0);
  });
});

describe('AC-3.7.6 — rojo branches (RPC fail OR url mismatch)', () => {
  test('returns ok:false when getWebhookInfo returns ok=false', async () => {
    const telegram = buildTelegramStub();
    vi.mocked(telegram.getWebhookInfo).mockResolvedValue({ ok: false });
    const { clock } = buildClockStub(1_700_000_000_000);
    const statusFn = createGetWebhookStatus({ telegram, clock });

    const status = await statusFn();

    expect(status.ok).toBe(false);
    // No URL is reported when the RPC fails — caller must not display a
    // partial / stale URL in the tooltip.
    expect(status.url).toBeNull();
  });

  test('returns ok:false when getWebhookInfo url does NOT match the expected URL', async () => {
    // Plausible regression: webhook was rebound to an attacker-controlled
    // origin (or a stale ngrok URL from dev). The helper MUST surface this
    // as rojo even though the RPC succeeded.
    const telegram = buildTelegramStub();
    vi.mocked(telegram.getWebhookInfo).mockResolvedValue(
      okWebhookInfo('https://attacker.example/api/telegram/webhook'),
    );
    const { clock } = buildClockStub(1_700_000_000_000);
    const statusFn = createGetWebhookStatus({ telegram, clock });

    const status = await statusFn();

    expect(status.ok).toBe(false);
    // The actual url IS captured so a tooltip can surface "actual vs
    // expected" — the boolean is what gates the color.
    expect(status.url).toBe('https://attacker.example/api/telegram/webhook');
  });

  test('returns ok:false when url is the expected origin but a different path', async () => {
    const telegram = buildTelegramStub();
    vi.mocked(telegram.getWebhookInfo).mockResolvedValue(
      okWebhookInfo('https://astrologiadeluz.test/different-path'),
    );
    const { clock } = buildClockStub(1_700_000_000_000);
    const statusFn = createGetWebhookStatus({ telegram, clock });

    const status = await statusFn();

    expect(status.ok).toBe(false);
  });
});

describe('AC-3.7.6 — 5-minute in-process cache (per-factory-instance)', () => {
  test('second call within the TTL window does NOT invoke getWebhookInfo again', async () => {
    const telegram = buildTelegramStub();
    vi.mocked(telegram.getWebhookInfo).mockResolvedValue(okWebhookInfo(getExpectedWebhookUrl()));
    const { clock } = buildClockStub(1_700_000_000_000);
    const statusFn = createGetWebhookStatus({ telegram, clock });

    await statusFn();
    await statusFn();
    await statusFn();

    expect(vi.mocked(telegram.getWebhookInfo)).toHaveBeenCalledTimes(1);
  });

  test('call after the TTL window invokes getWebhookInfo a second time', async () => {
    const telegram = buildTelegramStub();
    vi.mocked(telegram.getWebhookInfo).mockResolvedValue(okWebhookInfo(getExpectedWebhookUrl()));
    const t0 = 1_700_000_000_000;
    const { clock, setTime } = buildClockStub(t0);
    const statusFn = createGetWebhookStatus({ telegram, clock });

    await statusFn();
    expect(vi.mocked(telegram.getWebhookInfo)).toHaveBeenCalledTimes(1);

    // Step time just past the TTL boundary.
    setTime(t0 + WEBHOOK_CACHE_TTL_MS + 1);
    await statusFn();

    expect(vi.mocked(telegram.getWebhookInfo)).toHaveBeenCalledTimes(2);
  });

  test('the cache spans the verde→rojo transition (TTL has not expired)', async () => {
    // The first call returns verde, the underlying RPC then flips to fail —
    // but the cached verde MUST persist until the TTL elapses (matches the
    // "cached in-memory for 5 minutes" spec). Without this property the dot
    // would flicker on every page render under transient RPC failures.
    const telegram = buildTelegramStub();
    vi.mocked(telegram.getWebhookInfo).mockResolvedValueOnce(
      okWebhookInfo(getExpectedWebhookUrl()),
    );
    const t0 = 1_700_000_000_000;
    const { clock, setTime } = buildClockStub(t0);
    const statusFn = createGetWebhookStatus({ telegram, clock });

    const first = await statusFn();
    expect(first.ok).toBe(true);

    // Subsequent rejection NEVER fires because the cache short-circuits.
    vi.mocked(telegram.getWebhookInfo).mockResolvedValue({ ok: false });
    setTime(t0 + WEBHOOK_CACHE_TTL_MS - 1); // still inside the window

    const second = await statusFn();
    expect(second.ok).toBe(true);
    expect(second.checkedAt).toBe(t0); // same slot, NOT re-fetched
    expect(vi.mocked(telegram.getWebhookInfo)).toHaveBeenCalledTimes(1);
  });

  test('a fresh factory instance starts with an empty cache (per-instance isolation)', async () => {
    // Path A replacement for the old `__resetWebhookStatusCache` escape
    // hatch: each `createGetWebhookStatus` call closes over its own cache,
    // so building a new instance is the canonical way to start fresh. Two
    // instances over the SAME telegram stub each fetch once → 2 calls total.
    const telegram = buildTelegramStub();
    vi.mocked(telegram.getWebhookInfo).mockResolvedValue(okWebhookInfo(getExpectedWebhookUrl()));
    const { clock } = buildClockStub(1_700_000_000_000);

    const firstInstance = createGetWebhookStatus({ telegram, clock });
    await firstInstance();
    expect(vi.mocked(telegram.getWebhookInfo)).toHaveBeenCalledTimes(1);

    const secondInstance = createGetWebhookStatus({ telegram, clock });
    await secondInstance();
    expect(vi.mocked(telegram.getWebhookInfo)).toHaveBeenCalledTimes(2);
  });
});

describe('AC-3.7.6 — status helper integrates with CONTENT_PANEL.STATUS slots', () => {
  test('the verde/rojo state cleanly maps to the CONTENT_PANEL slots', async () => {
    // Direct integration with the consumer surface (the layout's color
    // dispatch). The verde slot's color === verde + tooltip contains the
    // {checkedAt} placeholder — both must hold across edits.
    const { CONTENT_PANEL } = await import('@/infrastructure/content');
    expect(CONTENT_PANEL.STATUS.webhook_ok.color).toBe('verde');
    expect(CONTENT_PANEL.STATUS.webhook_broken.color).toBe('rojo');
    expect(CONTENT_PANEL.STATUS.webhook_ok.tooltipTemplate).toContain('{checkedAt}');
    expect(CONTENT_PANEL.STATUS.webhook_broken.tooltipTemplate).toContain('{checkedAt}');
  });
});
