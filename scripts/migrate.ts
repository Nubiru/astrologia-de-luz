/**
 * Drizzle migrate runner — Spec anchor: S-1 AC-2.3.3 + R-8.
 *
 * Wired as `npm run db:migrate` AND the npm `postbuild` hook so Vercel
 * deploys apply pending migrations once per release (atomic build-or-rollback
 * gives recovery on partial failure — R-8). The seed migration
 * `0003_seed_augusto.sql` ships a `$$ADMIN_EMAIL$$` placeholder;
 * `runMigrations` stages `db/migrations/` to tmp, substitutes the brand-owner
 * email (SQL-quote-escaped), then hands the staging dir to drizzle's libsql
 * migrator. Exported so the pairing test can drive it against an in-memory
 * libsql without going through `@/db/client` (which validates env lazily on
 * first getDb() / getClient() call per G_C-25).
 */

import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';

export async function runMigrations<TSchema extends Record<string, unknown>>(
  db: LibSQLDatabase<TSchema>,
  adminEmail: string,
  migrationsFolder = 'db/migrations',
): Promise<void> {
  const staging = mkdtempSync(join(tmpdir(), 'drizzle-migrations-'));
  cpSync(migrationsFolder, staging, { recursive: true });
  const escaped = adminEmail.replace(/'/g, "''");
  for (const name of readdirSync(staging).filter((n) => n.endsWith('.sql'))) {
    const fp = join(staging, name);
    writeFileSync(fp, readFileSync(fp, 'utf8').split('$$ADMIN_EMAIL$$').join(escaped), 'utf8');
  }
  await migrate(db, { migrationsFolder: staging });
}

const isCli = fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '');
if (isCli) {
  Promise.all([import('@/db/client'), import('@/lib/env')])
    .then(async ([{ getClient, getDb }, { getEnv }]) => {
      const adminEmails = getEnv().ADMIN_EMAILS;
      const firstAdmin = adminEmails.split(',')[0] ?? adminEmails;
      await runMigrations(getDb(), firstAdmin.trim());
      getClient().close();
    })
    .catch((err: unknown) => {
      process.stderr.write(`migrate: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
