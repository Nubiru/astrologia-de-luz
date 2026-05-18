// Boot-time env boundary. Spec anchors: AC-2.6.1, AC-2.6.2, AC-3.9, G_C-25.
// Identifier names stay English (D-010 carve-out); validation messages are Spanish (AC-2.6.2).
//
// Lazy form (G_C-25): no module-load validation. Importing this file does
// NOT touch process.env — `getEnv()` parses on first call and memoizes the
// result. Production code accesses env at request/handler time; tests can
// flip the cache via `__resetEnvForTests()` (same convention as
// lib/resend.ts `__resetResendClient`). The legacy `env` Proxy was lazy on
// property access but module-body destructuring patterns (auth.ts providers
// array, db/client.ts createClient call) still triggered validation at import
// time, which blocked `next build` page-data collection (M-11).

import { z } from 'zod';

const requiredString = (label = 'requerida') =>
  z.string({ required_error: label, invalid_type_error: 'debe ser texto' });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TELEGRAM_BOT_TOKEN_RE = /^\d+:[A-Za-z0-9_-]+$/;

const SCHEMA = z.object({
  TURSO_DATABASE_URL: requiredString().min(1, 'no puede estar vacía'),
  TURSO_AUTH_TOKEN: requiredString().min(1, 'no puede estar vacía'),
  AUTH_SECRET: requiredString().min(32, 'debe tener al menos 32 caracteres'),
  AUTH_URL: requiredString().url('debe ser una URL válida (ej. https://astrologiadeluz.com)'),
  AUTH_RESEND_KEY: requiredString()
    .min(1, 'no puede estar vacía')
    .regex(/^re_/, 'debe comenzar con "re_" (clave de Resend)'),
  RESEND_FROM: requiredString().min(1, 'no puede estar vacía'),
  ADMIN_EMAILS: requiredString()
    .min(1, 'no puede estar vacía')
    .refine(
      (s) => s.split(',').every((p) => EMAIL_RE.test(p.trim())),
      'debe ser una lista de correos válidos separada por comas',
    ),
  TELEGRAM_BOT_TOKEN: requiredString().regex(
    TELEGRAM_BOT_TOKEN_RE,
    'debe tener formato <numérico>:<token> (de @BotFather)',
  ),
  TELEGRAM_BOT_USERNAME: requiredString().min(1, 'no puede estar vacía'),
  TELEGRAM_WEBHOOK_SECRET: requiredString().min(
    32,
    'debe tener al menos 32 caracteres (openssl rand -hex 32)',
  ),
});

export type Env = z.infer<typeof SCHEMA>;

export const ENV_ERROR_HEADER = 'Variables de entorno faltantes o inválidas:';

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = SCHEMA.safeParse(source);
  if (result.success) return result.data;
  const lines = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
  const message = `${ENV_ERROR_HEADER}\n${lines.join('\n')}`;
  process.stderr.write(`${message}\n`);
  throw new Error(message);
}

let cached: Env | null = null;

/**
 * Returns the validated env. Parses `process.env` once on first call, then
 * returns the cached object on every subsequent call. Throws the same
 * Spanish-headed error as `parseEnv` when validation fails (AC-G_C-25.5).
 *
 * Call this at request/handler time, not at module body — that is the
 * whole point of the lazy form. Module-body access defeats the purpose
 * and re-introduces the build-time validation that broke `next build`.
 */
export function getEnv(): Env {
  if (cached === null) cached = parseEnv(process.env);
  return cached;
}

/**
 * Test-only escape hatch. Clears the memoized env so a test that remocks
 * `process.env` can reparse against the new values. Mirrors the
 * `__resetResendClient` / `__resetWebhookStatusCache` convention.
 */
export function __resetEnvForTests(): void {
  cached = null;
}
