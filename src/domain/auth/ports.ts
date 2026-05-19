// Auth bounded-context port. Spec anchor: S-2 §7.2.4 D (verbatim body).
//
// W4-4 stub: pure-predicate interface. Adapter at src/infrastructure/auth/
// allowlist.ts (already shipped by G_C-29); composition root binds:
//   { contains: (e) => isAdminEmail(e, getEnv().ADMIN_EMAILS) }

/**
 * AdminAllowlist — pure-predicate port; the Auth.js v5 signIn callback's gate.
 * No I/O; reads from env-derived list (composition root wires).
 */
export interface AdminAllowlist {
  contains(email: string | null | undefined): boolean;
}
