/**
 * Auth infrastructure barrel — entry point for the `@/infrastructure/auth`
 * alias. Explicit-named only per D-047 (no `export *`): the cleanup-CP G_C-35
 * codemod can drive a monotonic-decrease assertion on legacy import literals,
 * which silent `export *` would defeat.
 *
 * Surface mirrors what the repo-root `auth.ts` exposed before the move:
 *   - Auth.js wiring (`handlers`, `auth`, `signIn`, `signOut`) + the lazy
 *     `buildAuthConfig` factory + the two module-level constants.
 *   - The pure allowlist predicates (`isAdminEmail`, `parseAdminAllowlist`).
 */

export {
  SESSION_MAX_AGE_SECONDS,
  VERIFY_REQUEST_PATH,
  auth,
  buildAuthConfig,
  handlers,
  isAdminEmail,
  parseAdminAllowlist,
  signIn,
  signOut,
} from './config';
