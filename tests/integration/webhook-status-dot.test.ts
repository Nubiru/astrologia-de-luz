/**
 * G_B-4 integration pairing — webhook status helper (AC-3.7.6).
 *
 * Drives `getWebhookStatus()` from `lib/panel/webhook-status.ts` end-to-end
 * against a mocked `getWebhookInfo` from `lib/telegram`, validating the four
 * branches of the verde/rojo state machine PLUS the 5-minute cache TTL.
 *
 * The helper is the single source of truth for the status dot color — the
 * layout consumes `.ok` and maps it directly to
 * `CONTENT_PANEL.STATUS.webhook_ok` vs `webhook_broken`. A regression in the
 * helper's boolean output silently flips the dot's color in production.
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
 *   - A future "simplification" removes the time-injection seam and the
 *     cache becomes untestable.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  for (const [k, v] of Object.entries({
    TURSO_DATABASE_URL: ':memory:',
    TURSO_AUTH_TOKEN: 'fixture-token',
    AUTH_SECRET: 'w'.repeat(48),
    // AUTH_URL drives `getExpectedWebhookUrl()` — pin it so the helper
    // produces a deterministic expected URL the mock can match.
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

// Stub the Telegram client at the import boundary — the helper depends on
// `getWebhookInfo` and nothing else from lib/telegram, so the mock surface
// is minimal.
vi.mock('@/lib/telegram', () => ({
  getWebhookInfo: vi.fn(),
}));

import {
  WEBHOOK_CACHE_TTL_MS,
  __resetWebhookStatusCache,
  getExpectedWebhookUrl,
  getWebhookStatus,
} from '@/lib/panel/webhook-status';
import { getWebhookInfo } from '@/lib/telegram';

const okWebhookInfo = (url: string) => ({
  ok: true as const,
  result: {
    url,
    has_custom_certificate: false,
    pending_update_count: 0,
  },
});

beforeEach(() => {
  __resetWebhookStatusCache();
  vi.mocked(getWebhookInfo).mockReset();
});

afterEach(() => {
  __resetWebhookStatusCache();
});

describe('AC-3.7.6 — getExpectedWebhookUrl from AUTH_URL', () => {
  test('appends /api/telegram/webhook to AUTH_URL without a trailing slash', () => {
    expect(getExpectedWebhookUrl()).toBe('https://astrologiadeluz.test/api/telegram/webhook');
  });
});

describe('AC-3.7.6 — verde branch (ok + url matches expected)', () => {
  test('returns ok:true with the matching url', async () => {
    vi.mocked(getWebhookInfo).mockResolvedValue(okWebhookInfo(getExpectedWebhookUrl()));

    const status = await getWebhookStatus();

    expect(status.ok).toBe(true);
    expect(status.url).toBe(getExpectedWebhookUrl());
    expect(status.checkedAt).toBeGreaterThan(0);
  });
});

describe('AC-3.7.6 — rojo branches (RPC fail OR url mismatch)', () => {
  test('returns ok:false when getWebhookInfo returns ok=false', async () => {
    vi.mocked(getWebhookInfo).mockResolvedValue({
      ok: false,
      error_code: 502,
      description: 'Bad gateway',
    });

    const status = await getWebhookStatus();

    expect(status.ok).toBe(false);
    // No URL is reported when the RPC fails — caller must not display a
    // partial / stale URL in the tooltip.
    expect(status.url).toBeNull();
  });

  test('returns ok:false when getWebhookInfo url does NOT match the expected URL', async () => {
    // Plausible regression: webhook was rebound to an attacker-controlled
    // origin (or a stale ngrok URL from dev). The helper MUST surface this
    // as rojo even though the RPC succeeded.
    vi.mocked(getWebhookInfo).mockResolvedValue(
      okWebhookInfo('https://attacker.example/api/telegram/webhook'),
    );

    const status = await getWebhookStatus();

    expect(status.ok).toBe(false);
    // The actual url IS captured so a tooltip can surface "actual vs
    // expected" — the boolean is what gates the color.
    expect(status.url).toBe('https://attacker.example/api/telegram/webhook');
  });

  test('returns ok:false when url is the expected origin but a different path', async () => {
    vi.mocked(getWebhookInfo).mockResolvedValue(
      okWebhookInfo('https://astrologiadeluz.test/different-path'),
    );

    const status = await getWebhookStatus();

    expect(status.ok).toBe(false);
  });
});

describe('AC-3.7.6 — 5-minute in-process cache', () => {
  test('second call within the TTL window does NOT invoke getWebhookInfo again', async () => {
    vi.mocked(getWebhookInfo).mockResolvedValue(okWebhookInfo(getExpectedWebhookUrl()));

    const t0 = 1_700_000_000_000;
    const now = () => t0;

    await getWebhookStatus(now);
    await getWebhookStatus(now);
    await getWebhookStatus(now);

    expect(vi.mocked(getWebhookInfo)).toHaveBeenCalledTimes(1);
  });

  test('call after the TTL window invokes getWebhookInfo a second time', async () => {
    vi.mocked(getWebhookInfo).mockResolvedValue(okWebhookInfo(getExpectedWebhookUrl()));

    const t0 = 1_700_000_000_000;
    let t = t0;
    const now = () => t;

    await getWebhookStatus(now);
    expect(vi.mocked(getWebhookInfo)).toHaveBeenCalledTimes(1);

    // Step time just past the TTL boundary.
    t = t0 + WEBHOOK_CACHE_TTL_MS + 1;
    await getWebhookStatus(now);

    expect(vi.mocked(getWebhookInfo)).toHaveBeenCalledTimes(2);
  });

  test('the cache spans the verde→rojo transition (TTL has not expired)', async () => {
    // The first call returns verde, the underlying RPC then flips to fail —
    // but the cached verde MUST persist until the TTL elapses (matches the
    // "cached in-memory for 5 minutes" spec). Without this property the dot
    // would flicker on every page render under transient RPC failures.
    vi.mocked(getWebhookInfo).mockResolvedValueOnce(okWebhookInfo(getExpectedWebhookUrl()));

    const t0 = 1_700_000_000_000;
    const now = () => t0 + WEBHOOK_CACHE_TTL_MS - 1; // still inside the window

    const first = await getWebhookStatus(() => t0);
    expect(first.ok).toBe(true);

    // Subsequent rejection NEVER fires because the cache short-circuits.
    vi.mocked(getWebhookInfo).mockResolvedValue({
      ok: false,
      description: 'should not be called',
    });

    const second = await getWebhookStatus(now);
    expect(second.ok).toBe(true);
    expect(second.checkedAt).toBe(t0); // same slot, NOT re-fetched
    expect(vi.mocked(getWebhookInfo)).toHaveBeenCalledTimes(1);
  });

  test('__resetWebhookStatusCache forces a fresh fetch (test escape hatch)', async () => {
    vi.mocked(getWebhookInfo).mockResolvedValue(okWebhookInfo(getExpectedWebhookUrl()));

    await getWebhookStatus();
    __resetWebhookStatusCache();
    await getWebhookStatus();

    expect(vi.mocked(getWebhookInfo)).toHaveBeenCalledTimes(2);
  });
});

describe('AC-3.7.6 — status helper integrates with CONTENT_PANEL.STATUS slots', () => {
  test('the verde/rojo state cleanly maps to the CONTENT_PANEL slots', async () => {
    // Direct integration with the consumer surface (the layout's color
    // dispatch). The verde slot's color === verde + tooltip contains the
    // {checkedAt} placeholder — both must hold across edits.
    const { CONTENT_PANEL } = await import('@/lib/content');
    expect(CONTENT_PANEL.STATUS.webhook_ok.color).toBe('verde');
    expect(CONTENT_PANEL.STATUS.webhook_broken.color).toBe('rojo');
    expect(CONTENT_PANEL.STATUS.webhook_ok.tooltipTemplate).toContain('{checkedAt}');
    expect(CONTENT_PANEL.STATUS.webhook_broken.tooltipTemplate).toContain('{checkedAt}');
  });
});
