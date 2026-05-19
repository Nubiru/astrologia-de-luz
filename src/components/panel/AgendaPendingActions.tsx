'use client';

/**
 * G_B-5 — Aceptar / Rechazar action buttons for a single pending session row.
 *
 * Spec anchors: S-1 AC-1.4.2 (button labels + dispatch semantics) +
 * AC-3.4.1/AC-3.4.2 (PATCH endpoint + post-commit dispatch contract).
 *
 * Each click PATCHes `/api/sessions/[id]` with `{ status: 'confirmed' }` or
 * `{ status: 'rejected' }`. The route owns the 6×6 allow-list (AC-2.2.4)
 * and the post-commit visitor-email dispatch — this island only drives the
 * HTTP call + a router.refresh() so the Server Component re-fetches the
 * pending list and drops the just-actioned row.
 *
 * Failure surface (AC-3.4.3 + fall-back):
 *   - 409 invalid_transition → render the route's Spanish error body.
 *   - 401 / 500 / network    → render `CONTENT_PANEL.AGENDA.errorPatch`.
 * The error is wiped on the next click so a second attempt is unblocked.
 *
 * `data-session-id` + `data-action-pending`/`data-action-rejected` are the
 * Playwright selectors used by `tests/e2e/agenda-accept.spec.ts` +
 * `tests/e2e/agenda-reject-decline-email.spec.ts`. They survive minification
 * because `data-*` attributes are not subject to React's prop-renaming.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { CONTENT_PANEL } from '@/infrastructure/content';

type ActionKind = 'aceptar' | 'rechazar';

interface AgendaPendingActionsProps {
  sessionId: string;
}

interface PatchErrorBody {
  kind?: string;
  error?: string;
}

async function patchSessionStatus(
  sessionId: string,
  newStatus: 'confirmed' | 'rejected',
): Promise<{ ok: true } | { ok: false; message: string }> {
  let response: Response;
  try {
    response = await fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
  } catch {
    return { ok: false, message: CONTENT_PANEL.AGENDA.errorPatch };
  }

  if (response.ok) return { ok: true };

  // The route returns `{ kind, error }` for 409s (AC-3.4.3) — prefer that
  // body when present so the admin sees the localized invalid-transition
  // message; fall back to the generic copy otherwise.
  let body: PatchErrorBody | null = null;
  try {
    body = (await response.json()) as PatchErrorBody;
  } catch {
    body = null;
  }
  const message = body?.error ?? CONTENT_PANEL.AGENDA.errorPatch;
  return { ok: false, message };
}

export function AgendaPendingActions({ sessionId }: AgendaPendingActionsProps): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyAction, setBusyAction] = useState<ActionKind | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleClick = (kind: ActionKind): void => {
    const newStatus: 'confirmed' | 'rejected' = kind === 'aceptar' ? 'confirmed' : 'rejected';
    setBusyAction(kind);
    setErrorMessage(null);

    void (async () => {
      const result = await patchSessionStatus(sessionId, newStatus);
      if (!result.ok) {
        setBusyAction(null);
        setErrorMessage(result.message);
        return;
      }
      // The Server Component re-queries the pending list on refresh — the
      // just-actioned row disappears from the DOM.
      startTransition(() => {
        router.refresh();
        setBusyAction(null);
      });
    })();
  };

  const disabled = pending || busyAction !== null;

  return (
    <div data-session-id={sessionId} data-agenda-actions>
      <button
        type="button"
        data-action="aceptar"
        disabled={disabled}
        onClick={() => {
          handleClick('aceptar');
        }}
      >
        {CONTENT_PANEL.AGENDA.aceptarButton}
      </button>
      <button
        type="button"
        data-action="rechazar"
        disabled={disabled}
        onClick={() => {
          handleClick('rechazar');
        }}
      >
        {CONTENT_PANEL.AGENDA.rechazarButton}
      </button>
      {errorMessage !== null && (
        <p data-agenda-error role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
