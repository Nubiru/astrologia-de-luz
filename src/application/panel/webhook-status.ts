/**
 * Panel webhook-status helper — drives the AC-3.7.6 status dot.
 *
 * Factory-default-instance shape per S-2 §7.2.3 H / G_C-31 / D-049 / D-050.
 * Spec anchor: S-1 AC-3.7.6.
 *
 * The current `WebhookStatus { ok, url, checkedAt }` shape is preserved
 * (spec §7.2.3 H's `{ state, detail }` Result-naming change is deferred to
 * G_C-35 cleanup-CP — purely cosmetic rename; consumer at app/panel/
 * layout.tsx would cascade otherwise, exceeding the 16-file scope_lock).
 *
 * The cache is now per-factory-instance (closed over by the closure)
 * instead of module-scoped. Tests that need a fresh cache build a new
 * instance via `createGetWebhookStatus({ telegram, clock })`. The
 * `__resetWebhookStatusCache()` escape hatch is preserved on the
 * default-instance for backward compatibility with the integration
 * pairing at tests/integration/webhook-status-dot.test.ts (W4-5
 * cleanup-CP scope per S-2 §7.2.7 A).
 */

import { getEnv } from '@/infrastructure/env';
import { getComposition } from '@/main/composition';

import type { Clock } from '@/domain/booking/ports';
import type { TelegramBot } from '@/domain/notifications/ports';

export const WEBHOOK_CACHE_TTL_MS = 5 * 60 * 1_000;

export interface WebhookStatus {
  /**
   * True iff the most recent getWebhookInfo succeeded AND its `result.url`
   * matched `getExpectedWebhookUrl()`. False otherwise. This single boolean
   * is what the layout maps to the verde / rojo color slot.
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
   * {checkedAt} placeholder in the tooltip template.
   */
  checkedAt: number;
}

export interface WebhookStatusDeps {
  telegram: TelegramBot;
  clock: Clock;
  cacheTtlMs?: number;
}

export type GetWebhookStatusFn = () => Promise<WebhookStatus>;

/**
 * Production webhook URL — `${AUTH_URL}/api/telegram/webhook`. AUTH_URL is
 * the canonical absolute origin (validated as a URL by the zod boundary in
 * env.ts), so concatenating the path gives the deploy-time-stable expected
 * webhook target without a separate env var.
 */
export function getExpectedWebhookUrl(): string {
  return `${getEnv().AUTH_URL.replace(/\/$/, '')}/api/telegram/webhook`;
}

/**
 * Factory. The cache lives in the closure (per-instance). Production wires
 * one instance via composition root; tests build their own and don't share
 * cache state with the default-instance.
 */
export function createGetWebhookStatus(deps: WebhookStatusDeps): GetWebhookStatusFn {
  const ttlMs = deps.cacheTtlMs ?? WEBHOOK_CACHE_TTL_MS;
  let cache: WebhookStatus | null = null;

  return async () => {
    const currentTime = deps.clock.now().getTime();
    if (cache && currentTime - cache.checkedAt < ttlMs) {
      return cache;
    }

    const response = await deps.telegram.getWebhookInfo();
    const expectedUrl = getExpectedWebhookUrl();
    const url = response.ok && response.result ? response.result.url : null;
    const ok = response.ok && url === expectedUrl;

    cache = { ok, url, checkedAt: currentTime };
    return cache;
  };
}

/**
 * Default-instance — single shared closure bound at composition root. The
 * module-scoped cache lives here (now closure-scoped under the factory)
 * so per-process the dot color is computed once per TTL window. Lazy
 * resolution at first call mirrors the env/db getters.
 */
let defaultInstance: GetWebhookStatusFn | null = null;

export const getWebhookStatus: GetWebhookStatusFn = () => {
  if (defaultInstance === null) {
    const c = getComposition();
    defaultInstance = createGetWebhookStatus({ telegram: c.telegram, clock: c.clock });
  }
  return defaultInstance();
};

/**
 * Test-only escape hatch. Mirrors lib/resend.ts's __resetResendClient
 * pattern. Production code never imports this. Clears BOTH the default-
 * instance closure (so the next call rebuilds it from a freshly-reset
 * composition) AND any stale cache it held.
 */
export function __resetWebhookStatusCache(): void {
  defaultInstance = null;
}
