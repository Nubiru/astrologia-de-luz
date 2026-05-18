/**
 * `/panel` — magic-link entry. Renders one of three states from a single
 * Server Component:
 *
 *   1. **Authed visit** — `auth()` returns a session. Redirect to
 *      `/panel/agenda` (AC-1.3.3).
 *   2. **Post-submit verify-request view** — searchParams arrive as
 *      `provider=resend&type=email` (Auth.js's verify-request URL pattern).
 *      Both on-list AND off-list legs converge here per the byte-identical
 *      anti-enum invariant from G_B-1 (auth.ts pages.verifyRequest hook),
 *      and the same `CONTENT_PANEL.AUTH.checkInboxNeutral` copy renders for
 *      both (AC-1.3.2).
 *   3. **Default GET** — render the single-email magic-link form. The form
 *      action is the Auth.js v5 `signIn` server action, which handles CSRF +
 *      verificationToken creation + Resend dispatch + the verify-request
 *      redirect (AC-1.3.1).
 *
 * Node runtime is REQUIRED (AC-2.4.5): `auth()` calls into the Drizzle
 * adapter which pulls in @libsql/client — not Edge-safe.
 */

import { redirect } from 'next/navigation';

import { auth, signIn } from '@/auth';
import { CONTENT_PANEL } from '@/lib/content';

export const runtime = 'nodejs';
// G_C-25: `/panel` calls `auth()` which reads the session cookie + invokes
// the (lazy) NextAuth factory. Next 16's SSG would attempt a prerender at
// build time which materialises the auth config (env access) and reads
// cookies — both incompatible with build-time-static. Forcing dynamic
// matches the per-request nature of an auth-gated surface; the form post
// + searchParams branch are visitor-scoped anyway.
export const dynamic = 'force-dynamic';

interface PanelPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Spec anchor: AC-1.3.3 + AC-1.3.2 callback path. The magic-link in the email
// points back to `/api/auth/callback/resend?token=…&callbackUrl=<this>`; on
// success Auth.js verifies the token, mints the JWT cookie, and redirects to
// callbackUrl. Pointing it at the agenda avoids one extra hop through the
// `/panel` → 302 → `/panel/agenda` chain for the authenticated case.
const POST_AUTH_REDIRECT = '/panel/agenda';

export default async function PanelPage({ searchParams }: PanelPageProps) {
  // AC-1.3.3 — already-authed visit redirects to the agenda without rendering
  // the form. `auth()` reads + verifies the JWT cookie via Auth.js core; for
  // anonymous requests it returns null + we fall through to the form view.
  const session = await auth();
  if (session?.user) {
    redirect(POST_AUTH_REDIRECT);
  }

  // AC-1.3.2 — post-submit / verify-request view. Auth.js's
  // `pages.verifyRequest` hook lands BOTH on-list and off-list legs on
  // `/panel?provider=resend&type=email` (see auth.ts VERIFY_REQUEST_PATH +
  // FRAMEWORK_VERIFY_REQUEST_URL). The neutral copy is the only content
  // rendered — no form, no status indicators, nothing that would distinguish
  // the two legs to a client observer.
  const params = await searchParams;
  if (params.provider === 'resend' && params.type === 'email') {
    return (
      <main>
        <h1>{CONTENT_PANEL.AUTH.headline}</h1>
        <p>{CONTENT_PANEL.AUTH.verifyRequestSubtitle}</p>
        <p>{CONTENT_PANEL.AUTH.checkInboxNeutral}</p>
      </main>
    );
  }

  // AC-1.3.1 — default GET /panel: the single-email magic-link form. Posting
  // via the Auth.js `signIn` server action covers CSRF + JWT-cookie binding
  // implicitly; no hidden csrfToken field needed.
  async function submitSignIn(formData: FormData) {
    'use server';
    await signIn('resend', {
      email: formData.get('email'),
      redirectTo: POST_AUTH_REDIRECT,
    });
  }

  return (
    <main>
      <h1>{CONTENT_PANEL.AUTH.headline}</h1>
      <form action={submitSignIn}>
        <label htmlFor="panel-signin-email">{CONTENT_PANEL.AUTH.emailLabel}</label>
        <input
          id="panel-signin-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder={CONTENT_PANEL.AUTH.emailPlaceholder}
        />
        <button type="submit">{CONTENT_PANEL.AUTH.submitButton}</button>
      </form>
    </main>
  );
}
