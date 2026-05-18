/**
 * `/panel/*` layout — auth guard + panel chrome + webhook status dot.
 *
 * Spec anchors: S-1 AC-1.3.3 + AC-1.3.4 + AC-2.4.5 + AC-3.7.6.
 *
 * Three render branches keyed off the `x-pathname` header that `proxy.ts`
 * forwards:
 *
 *   1. **`/panel` itself** — chrome is suppressed; children render bare. The
 *      sign-in form (G_B-3) renders its own minimal shell; layering chrome
 *      with a "Salir" button on an unauthenticated page would be confusing.
 *
 *   2. **`/panel/<sub-route>` + no session** — defense-in-depth redirect to
 *      `/panel?next=<sub-route>` (AC-1.3.4). The Edge proxy already gates the
 *      cookie-presence case, but the layout closes the gap when a forged or
 *      expired cookie passes the Edge check.
 *
 *   3. **`/panel/<sub-route>` + authed** — render chrome (nav + sign-out +
 *      webhook status dot) wrapping `children`.
 *
 * Node runtime is REQUIRED (AC-2.4.5): `auth()` pulls in the Drizzle adapter
 * + libsql; the layout MUST run on Node for the adapter to be reachable.
 */

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { auth, signOut } from '@/auth';
import { CONTENT_PANEL } from '@/lib/content';
import { getWebhookStatus } from '@/lib/panel/webhook-status';

export const runtime = 'nodejs';

const PANEL_SIGNIN_PATH = '/panel';

interface PanelLayoutProps {
  children: ReactNode;
}

// `proxy.ts` forwards `x-pathname` on every matched request; reading from
// headers() keeps the layout pure-server-side and avoids prop-drilling the
// URL through every nested page.
async function readPathname(): Promise<string> {
  const hdrs = await headers();
  return hdrs.get('x-pathname') ?? '';
}

async function signOutAction(): Promise<void> {
  'use server';
  // AC-1.3.3 inverse: signing out lands on the sign-in form so the visitor
  // can immediately re-authenticate.
  await signOut({ redirectTo: PANEL_SIGNIN_PATH });
}

export default async function PanelLayout({ children }: PanelLayoutProps) {
  const pathname = await readPathname();

  // Branch 1 — `/panel` itself: render the children bare (no auth guard, no
  // chrome). The page (G_B-3) handles its own three states.
  if (pathname === PANEL_SIGNIN_PATH || pathname === '') {
    return <>{children}</>;
  }

  // Branch 2 — unauthenticated `/panel/<sub>`: redirect to the sign-in form
  // with the original path preserved. Mirrors proxy.ts's Edge-side redirect;
  // defense-in-depth catches forged/expired cookies that pass the Edge gate.
  const session = await auth();
  if (!session?.user) {
    const params = new URLSearchParams({ next: pathname });
    redirect(`${PANEL_SIGNIN_PATH}?${params.toString()}`);
  }

  // Branch 3 — authed `/panel/<sub>`: render chrome + children.
  const status = await getWebhookStatus();
  const statusSlot = status.ok
    ? CONTENT_PANEL.STATUS.webhook_ok
    : CONTENT_PANEL.STATUS.webhook_broken;
  const checkedAtIso = new Date(status.checkedAt).toISOString();
  const tooltipText = statusSlot.tooltipTemplate.replace('{checkedAt}', checkedAtIso);

  return (
    <>
      <header>
        <nav aria-label="Panel">
          <a href="/panel/agenda">Agenda</a>
          <a href="/panel/maestros">Maestros</a>
          <form action={signOutAction}>
            <button type="submit">{CONTENT_PANEL.AUTH.signOutButton}</button>
          </form>
        </nav>
        <output
          aria-label={statusSlot.label}
          data-color={statusSlot.color}
          data-checked-at={checkedAtIso}
          title={tooltipText}
        >
          <span aria-hidden="true">●</span> {statusSlot.label}
        </output>
      </header>
      {children}
    </>
  );
}
