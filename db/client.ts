/**
 * Drizzle libSQL client — the single load-bearing DB handle for the app.
 *
 * Spec anchor: S-1 AC-2.3.1 ("Connection via db/client.ts exporting
 * createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN }) and
 * drizzle(client, { schema })"). Lazy form per G_C-25 — module-body
 * createClient() was the second eager env consumer that blocked
 * `next build` page-data collection (M-11).
 *
 * Consumers:
 *   - auth.ts (G_B-1) — passed to DrizzleAdapter(db) via buildAuthConfig.
 *   - app/api/sessions/** (G_C-9..G_C-11) — booking-row mutations.
 *   - app/api/notify/** (G_C-13..G_C-15) — notify_log writes.
 *   - scripts/migrate.ts (G_C-5) — migration runner.
 *
 * PRAGMA foreign_keys = ON is set per-connection so the ON DELETE
 * RESTRICT contract on sessions.teacher_id (AC-2.2.6) and the ON DELETE
 * CASCADE on the auxiliary tables (D-033, AC-3.3.1, AC-3.7.1) are actually
 * enforced — SQLite/libSQL default this to OFF for legacy compatibility, so
 * forgetting it would silently downgrade every FK in the schema.
 */

import { type Client, createClient } from '@libsql/client';
import { type LibSQLDatabase, drizzle } from 'drizzle-orm/libsql';

import * as schema from '@/db/schema';
import { getEnv } from '@/lib/env';

let cachedClient: Client | null = null;
let cachedDb: LibSQLDatabase<typeof schema> | null = null;

export function getClient(): Client {
  if (cachedClient === null) {
    const env = getEnv();
    cachedClient = createClient({
      url: env.TURSO_DATABASE_URL,
      authToken: env.TURSO_AUTH_TOKEN,
    });
    void cachedClient.execute('PRAGMA foreign_keys = ON');
  }
  return cachedClient;
}

export function getDb(): LibSQLDatabase<typeof schema> {
  if (cachedDb === null) cachedDb = drizzle(getClient(), { schema });
  return cachedDb;
}

export type Db = LibSQLDatabase<typeof schema>;

/**
 * Test-only escape hatch. Clears both the libsql client handle and the
 * Drizzle wrapper so a test that re-mocks `process.env` (and therefore
 * remints `TURSO_DATABASE_URL`) can rebuild against the new credentials.
 * Same convention as `lib/env.ts.__resetEnvForTests` and
 * `lib/resend.ts.__resetResendClient`.
 */
export function __resetDbForTests(): void {
  cachedClient = null;
  cachedDb = null;
}
