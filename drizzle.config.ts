/**
 * Drizzle Kit config — AC-2.3.1 anchor for G_C-4.
 *
 * Dialect = 'turso' to match the runtime client (`db/client.ts` via
 * `@libsql/client` against `TURSO_DATABASE_URL`). Credentials are NOT
 * consumed by `drizzle-kit generate` (which diffs schema vs the
 * `src/infrastructure/db/migrations/meta/` snapshot only) — they are
 * required by `drizzle-kit push` / `studio` if either is ever wired in. The
 * `?? ''` fallback keeps `generate` workable in CI runners that don't
 * inject Turso secrets.
 *
 * Zero-diff invariant: with `0000_init` + `0001_authjs` + `0002_cp3_tables` +
 * `0003_seed_augusto` already authored AND the
 * `src/infrastructure/db/migrations/meta/` snapshot in lockstep, a second
 * `drizzle-kit generate` must emit `No schema changes, nothing to migrate`
 * and create no new `.sql` file. The regression-guard lives in
 * `tests/ci/drizzle-generate-diff.spec.ts`.
 *
 * Spec anchors: S-1 AC-2.3.1.
 * G_C-27 W4-2: schema + migrations folder moved from `db/` to
 * `src/infrastructure/db/` (per S-2 §7.1.2 row 11-17).
 */

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'turso',
  schema: './src/infrastructure/db/schema.ts',
  out: './src/infrastructure/db/migrations',
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? '',
    authToken: process.env.TURSO_AUTH_TOKEN ?? '',
  },
  strict: true,
  verbose: false,
});
