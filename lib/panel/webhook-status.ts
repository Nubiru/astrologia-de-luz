/**
 * Panel webhook-status helper — drives the AC-3.7.6 status dot.
 *
 * Spec anchor: S-1 AC-3.7.6 ("Color from CONTENT.PANEL.STATUS.webhook_ok
 * (verde) when the most recent getWebhookInfo HEAD call returned ok:true AND
 * url MATCHES the expected production URL; webhook_broken (rojo) otherwise.
 * The check is cached in-memory for 5 minutes via a server-side
 * unstable_cache wrapper (or equivalent simple in-process cache).")
 *
 * Implementation choice: a simple module-scoped in-process cache (Map-style
 * single-slot) per the spec's "or equivalent simple in-process cache" carve-
 * out. Reasons over `next/cache`:
 *   - testable in isolation from vitest (no Next runtime / no request scope).
 *   - the cache key is fixed (no input axis) — `unstable_cache`'s key tuple
 *     would be a constant string anyway.
 *   - matches the same approach the wave-1 `lib/resend.ts` client uses for
 *     its lazy-init module-scoped client handle.
 *
 * Consumer: `app/panel/layout.tsx` reads `getWebhookStatus()` once per render
 * and maps `.ok` to `CONTENT_PANEL.STATUS.webhook_ok` / `webhook_broken` for
 * the status dot. The `__resetWebhookStatusCache()` escape hatch exists for
 * tests (same `__reset...` convention as `lib/resend.ts`).
 */

import { getEnv } from '@/lib/env';
import { getWebhookInfo } from '@/lib/telegram';

export const WEBHOOK_CACHE_TTL_MS = 5 * 60 * 1_000;

export interface WebhookStatus {
  /**
   * True iff the most recent `getWebhookInfo` succeeded AND its `result.url`
   * matched `getExpectedWebhookUrl()`. False otherwise (RPC failure, mismatched
   * URL, or both). This single boolean is what the layout maps to the verde /
   * rojo color slot.
   */
  ok: boolean;
  /**
   * The webhook URL Telegram currently reports — present only when the
   * underlying RPC succeeded. Useful for the tooltip when surfacing the
   * "actual vs expected" mismatch.
   */
  url: string | null;
  /**
   * Epoch ms when the cache slot was populated. Surfaced through the
   * `{checkedAt}` placeholder in the tooltip template (see CONTENT_PANEL.
   * STATUS.webhook_*.tooltipTemplate).
   */
  checkedAt: number;
}

let cache: WebhookStatus | null = null;

/**
 * Production webhook URL — `${AUTH_URL}/api/telegram/webhook`. AUTH_URL is
 * the canonical absolute origin (validated as a URL by the zod boundary in
 * lib/env.ts), so concatenating the path gives the deploy-time stable
 * expected webhook target without a separate env var.
 */
export function getExpectedWebhookUrl(): string {
  return `${getEnv().AUTH_URL.replace(/\/$/, '')}/api/telegram/webhook`;
}

/**
 * Returns the current cached webhook status, refreshing the cache when more
 * than `WEBHOOK_CACHE_TTL_MS` has elapsed since the last fetch.
 *
 * The `now` parameter is injected (defaulting to `Date.now`) so tests can
 * advance the clock deterministically without touching real time.
 */
export async function getWebhookStatus(now: () => number = Date.now): Promise<WebhookStatus> {
  const currentTime = now();
  if (cache && currentTime - cache.checkedAt < WEBHOOK_CACHE_TTL_MS) {
    return cache;
  }

  const response = await getWebhookInfo();
  const expectedUrl = getExpectedWebhookUrl();
  const url = response.ok ? response.result.url : null;
  const ok = response.ok && url === expectedUrl;

  cache = { ok, url, checkedAt: currentTime };
  return cache;
}

/**
 * Test-only escape hatch. Mirrors `lib/resend.ts`'s `__resetResendClient`
 * pattern. Production code never imports this.
 */
export function __resetWebhookStatusCache(): void {
  cache = null;
}
