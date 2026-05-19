/**
 * Auth.js v5 catch-all route handler.
 *
 * Mounts every Auth.js endpoint Auth.js needs to operate the magic-link flow
 * (signin / signin/resend / callback/resend / signout / csrf / session /
 * verify-request / error). The actual handler logic lives in `auth.ts` —
 * this file is the Next.js App-Router-facing shim.
 *
 * Spec anchors: S-1 AC-2.4.5, AC-2.4.6.
 *
 * Node runtime is REQUIRED here because @auth/drizzle-adapter calls into
 * @libsql/client which is not Edge-safe (server bindings + node:crypto).
 * Per AC-2.4.5 every file under app/api/auth/** MUST declare this. The
 * runtime-grep pairing fails this task if the declaration ever regresses.
 */

import { handlers } from '@/infrastructure/auth/config';

export const { GET, POST } = handlers;

export const runtime = 'nodejs';
