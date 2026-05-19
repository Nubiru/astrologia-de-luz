// Brand-owner resolution — factory + default-instance per S-2 §7.2.3 / G_C-31.
// Spec anchors: S-1 §11 intro + AC-3.2.1.
//
// §11 intro (verbatim): "the brand owner is the unique `teachers` row whose
// `email` (lower-cased) matches the FIRST entry of `ADMIN_EMAILS` (also
// lower-cased + trimmed). The seed migration in AC-2.1.5 guarantees this row
// exists. No separate env var, no separate column."
//
// Factory shape (D-049 / D-050): `createGetBrandOwner({ maestrosReader })`
// returns the resolver; default-instance reads composition lazily so
// __resetCompositionForTests() flushes cleanly between tests.
//
// brandOwnerEmail() stays as a pure helper — used by the maestros repository
// adapter for its own findBrandOwner() implementation. Keeping it
// application-layer-owned avoids duplicating the canonical-email rule across
// layers.

import type * as schema from '@/infrastructure/db/schema';
import { getEnv } from '@/infrastructure/env';
import { getComposition } from '@/main/composition';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';

import type { MaestrosReader } from '@/domain/booking/ports';
import type { Teacher } from '@/domain/maestros/entities';

/**
 * Back-compat type — preserves the @/lib barrel's `DbClient` re-export so
 * unmigrated callers (5 dispatcher-direct integration tests, S-2 §7.2.7 A
 * W4-5 cleanup-CP scope) keep type-resolving until G_C-35 rewrites them.
 */
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

export interface GetBrandOwnerDeps {
  maestrosReader: MaestrosReader;
}

export type GetBrandOwnerFn = () => Promise<Teacher | null>;

/** Factory. Tests substitute a fake `maestrosReader`; production wires from composition. */
export function createGetBrandOwner(deps: GetBrandOwnerDeps): GetBrandOwnerFn {
  return () => deps.maestrosReader.findBrandOwner();
}

/**
 * Default-instance — reads composition lazily at each invocation. Routes +
 * application use cases import this; tests prefer the factory with a fake.
 */
export const getBrandOwner: GetBrandOwnerFn = () => {
  const c = getComposition();
  return createGetBrandOwner({ maestrosReader: c.maestrosReader })();
};
