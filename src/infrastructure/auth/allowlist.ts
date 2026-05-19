/**
 * Admin allowlist — pure-function gate used by the Auth.js v5 `signIn`
 * callback in `auth.ts` (G_B-1). Lives in its own module so the unit pairing
 * can exercise every branch in isolation without dragging in NextAuth's
 * transitive `next/server` resolution (Next 16 still ships no
 * package.json#exports for it; vitest's strict ESM resolver rejects it).
 *
 * Spec anchors: AC-1.3.2 (anti-enum lista-de-acceso) + AC-2.4.3 (signIn
 * callback shape).
 */

/**
 * Split the comma-separated `ADMIN_EMAILS` env into a lowercase, trimmed list.
 * Empty segments (`",,admin@…"` / trailing comma / pure whitespace) are dropped
 * so the predicate never matches the empty string — the catastrophic case
 * where `isAdminEmail("")` would otherwise grant access to a no-email caller.
 */
export function parseAdminAllowlist(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
}

/**
 * True iff `email` matches an entry in the comma-separated allowlist
 * `allowlistRaw` after both sides are lowercased + trimmed. False for any
 * nullish / empty email regardless of allowlist content.
 */
export function isAdminEmail(
  email: string | null | undefined,
  allowlistRaw: string | null | undefined,
): boolean {
  if (!email) return false;
  return parseAdminAllowlist(allowlistRaw).includes(email.toLowerCase());
}
