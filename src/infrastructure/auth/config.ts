/**
 * Auth.js v5 — single-admin magic-link config.
 *
 * Spec anchors: S-1 AC-2.4.1 / AC-2.4.2 / AC-2.4.3 / AC-1.3.2 / AC-2.5.1.
 * Migration: moved from repo-root `auth.ts` to `src/infrastructure/auth/config.ts`
 * per S-2 §7.1.4 row 61 + G_C-29 wave-4 W4-2 dispatch. The relative-imports
 * workaround for the alias-second-resolve bug (NOTIFICATIONS 2026-05-18T10:10Z)
 * is no longer required because the file now lives under `src/**` —
 * `tsconfig.include[]` walks that tree natively + vite-tsconfig-paths resolves
 * `@/...` cleanly from inside it.
 *
 * Surface:
 *   - Resend provider (HTTP transport per O-7 PROBE 2 — NOT nodemailer).
 *   - DrizzleAdapter wired to libsql (G_C-3 adapter tables, D-033 camelCase
 *     foreign-contract carve-out).
 *   - JWT session strategy (D-018 — Edge-future-compat; AUTH_SECRET rotation
 *     is the global revoke).
 *   - 7-day cookie (HttpOnly + Secure-in-prod + SameSite=Lax — Auth.js v5
 *     defaults; the maxAge override is the only knob this config touches).
 *   - signIn callback enforces the `ADMIN_EMAILS` lista de acceso.
 *
 * Lazy initialization (G_C-25): `NextAuth` is invoked with a factory
 * function so `getEnv()` and `getDb()` are not called at module load —
 * they fire per-request via the documented v5 lazy form
 * (https://authjs.dev/getting-started/migrating-to-v5#lazy-initialization).
 * The eager-config form (used through G_C-24) blocked `next build`
 * page-data collection on every page that imports from this module,
 * because the providers array + secret line evaluated env at import time.
 *
 * Anti-enum invariant (AC-1.3.2 + AC-2.4.3): on-list emails get `true` from
 * the signIn callback and follow the normal Email-provider path. Off-list
 * emails get the verify-request URL STRING from the callback — that hook is
 * documented in @auth/core's signin send-token action (lines 22-33) and
 * produces a byte-identical Location header to the success path. The spec's
 * AC-2.4.3 claim that `return false` alone is sufficient is empirically
 * incorrect for Auth.js v5: false throws AccessDenied + redirects to
 * `/api/auth/error?error=AccessDenied`, which leaks the off-list signal.
 * The integration pairing locks the corrected behaviour in.
 */

import { DrizzleAdapter } from '@auth/drizzle-adapter';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Resend from 'next-auth/providers/resend';

import { getDb } from '@/infrastructure/db/client';
import { account, session, user, verificationToken } from '@/infrastructure/db/schema';
import { getEnv } from '@/infrastructure/env';

import { isAdminEmail } from './allowlist';

export { isAdminEmail, parseAdminAllowlist } from './allowlist';

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

// Provider id used in the Auth.js verify-request URL — must match the id
// Auth.js assigns to the Resend provider so the off-list redirect matches the
// on-list one byte-for-byte.
const RESEND_PROVIDER_ID = 'resend';

// Custom verify-request page exposed at /panel — Auth.js's framework default
// (`/api/auth/verify-request`) is English-only and unstyled. With
// `pages.verifyRequest` set below, GET /api/auth/verify-request issues a 302
// to this path so the user lands on the Spanish `CONTENT_PANEL.AUTH.
// checkInboxNeutral` rendering (AC-1.3.2).
export const VERIFY_REQUEST_PATH = '/panel';

// Initial Location header returned by both the on-list AND off-list signin
// POST. Auth.js's framework path — used verbatim by send-token.js for the
// success leg (lines 60-72 of @auth/core/lib/actions/signin/send-token.js,
// non-overrideable by `pages.verifyRequest`) AND returned by our signIn
// callback for the off-list leg. The pages.verifyRequest hook handles the
// SECOND hop (the framework /api/auth/verify-request handler 302s to
// /panel?provider=…&type=…), but the IMMEDIATE Location must match across
// both legs — that's the byte-identical anti-enum invariant from AC-1.3.2.
const FRAMEWORK_VERIFY_REQUEST_URL = `/api/auth/verify-request?provider=${RESEND_PROVIDER_ID}&type=email`;

/**
 * Build the NextAuthConfig from runtime state. Called by NextAuth on every
 * request (lazy v5 form) so env + db access is deferred past module load.
 * Exported so the integration pairing can inspect the materialized config
 * without going through the NextAuth wrapper.
 */
export function buildAuthConfig(): NextAuthConfig {
  const env = getEnv();
  return {
    // D-033: explicit-tables form against the snake_case-business / camelCase-
    // adapter dual-naming schema. Passing the four tables by reference future-
    // proofs against any @auth/drizzle-adapter renaming of the convention keys.
    adapter: DrizzleAdapter(getDb(), {
      usersTable: user,
      accountsTable: account,
      sessionsTable: session,
      verificationTokensTable: verificationToken,
    }),
    providers: [
      Resend({
        apiKey: env.AUTH_RESEND_KEY,
        from: env.RESEND_FROM,
      }),
    ],
    secret: env.AUTH_SECRET,
    session: {
      strategy: 'jwt',
      maxAge: SESSION_MAX_AGE_SECONDS,
    },
    // G_B-3 hook: re-route the Auth.js framework verify-request page back into
    // our own `/panel` Server Component so the post-submit copy is the Spanish
    // `CONTENT_PANEL.AUTH.checkInboxNeutral` per AC-1.3.2. Auth.js's success leg
    // redirects to `<verifyRequest>?provider=resend&type=email`; our signIn
    // callback (below) returns the same string for the off-list leg so both
    // legs produce byte-identical Location headers.
    pages: {
      verifyRequest: VERIFY_REQUEST_PATH,
    },
    callbacks: {
      // Anti-enum (AC-1.3.2 + AC-2.4.3): on-list returns `true` and the normal
      // Email-provider flow takes over (token + Resend + redirect to
      // verify-request). Off-list returns the SAME verify-request URL string —
      // Auth.js v5 then routes through `callbacks.redirect` and produces a
      // byte-identical Location header. The spec's claim that `return false`
      // alone short-circuits to verify-request is incorrect for Auth.js v5:
      // empirically `false` throws AccessDenied and the framework redirects to
      // `/api/auth/error?error=AccessDenied` — distinguishable from the success
      // path. Returning the verify-request URL string is the documented hook
      // (see `@auth/core/lib/actions/signin/send-token.js` lines 22-33).
      signIn: ({ user: u }) =>
        isAdminEmail(u.email, getEnv().ADMIN_EMAILS) ? true : FRAMEWORK_VERIFY_REQUEST_URL,
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => buildAuthConfig());
