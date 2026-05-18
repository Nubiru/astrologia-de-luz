// Brand-owner identification rule. Spec anchor: S-1 §11 intro + AC-3.2.1.
//
// §11 intro (verbatim): "the brand owner is the unique `teachers` row whose
// `email` (lower-cased) matches the FIRST entry of `ADMIN_EMAILS` (also
// lower-cased + trimmed). The seed migration in AC-2.1.5 guarantees this row
// exists. No separate env var, no separate column."
//
// G_C-2c (0003_seed_augusto.sql) inserts Augusto's row with `LOWER(email)`,
// so `teachers.email` is already canonical and equality-matches the result of
// `brandOwnerEmail()` without further normalisation at the DB layer.

import type * as schema from '@/db/schema';
import { type Teacher, teachers } from '@/db/schema';
import { getEnv } from '@/lib/env';
import { eq } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';

export type DbClient = LibSQLDatabase<typeof schema>;

/**
 * The lower-cased + trimmed first entry of ADMIN_EMAILS — the canonical form
 * the brand-owner row is keyed on. Defaults to `getEnv().ADMIN_EMAILS` (lazy,
 * resolved at call time per G_C-25); passing an explicit string lets tests +
 * admin tooling bypass env validation without priming every required var.
 */
export function brandOwnerEmail(adminEmails: string = getEnv().ADMIN_EMAILS): string {
  const first = adminEmails.split(',')[0] ?? '';
  return first.trim().toLowerCase();
}

/**
 * Resolve the brand-owner teachers row.
 *
 * Returns `null` when the seed migration has not yet run (defensive — never
 * the case in production, but pre-bootstrap admin tooling + first-boot
 * recovery paths can call this safely).
 */
export async function getBrandOwner(
  db: DbClient,
  adminEmails: string = getEnv().ADMIN_EMAILS,
): Promise<Teacher | null> {
  const email = brandOwnerEmail(adminEmails);
  const rows = await db.select().from(teachers).where(eq(teachers.email, email)).limit(1);
  return rows[0] ?? null;
}
