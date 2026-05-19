'use client';

/**
 * G_B-7 — manual "Reenviar" button for a single notify_log failure row.
 *
 * Spec anchors: S-1 AC-3.3.5 (button label + POST `/api/notify/[id]/retry`
 * + toast outcomes from `CONTENT_PANEL.NOTIFY.reenviar_*` slots) +
 * AC-3.3.4 (no automatic retry loop in v1.0; this is the only retry path).
 *
 * Click semantics:
 *   - Disables the button (busy state) for the duration of the POST so
 *     double-clicks cannot double-fire the retry. The trail row is still
 *     idempotency-keyed on (sessionId, eventKind, attempt) at the email
 *     adapter (AC-3.2.6) — defense-in-depth, but the UI guard is cheap.
 *   - On `kind: 'retry_ok'`  → render `reenviar_success_toast` + refresh
 *     so the Server Component re-fetches and the row's `attempt_number`
 *     advances (or a new trail row appears).
 *   - On `kind: 'retry_failed'` → render `reenviar_failed_toast`. The
 *     original failure row stays in the list; a new failure trail row
 *     surfaces on refresh.
 *   - On 401 / 404 / 409 / 500 / network → `AGENDA.errorPatch`.
 *
 * `data-action="reenviar"` + `data-log-id` + `data-toast` are the
 * Playwright selectors used by `tests/e2e/reenviar-button.spec.ts`.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { CONTENT_PANEL } from '@/infrastructure/content';

interface ReenviarButtonProps {
  logId: string;
}

interface RetryResponseBody {
  kind?: string;
  toast?: string;
}

async function postRetry(
  logId: string,
): Promise<
  { kind: 'retry_ok' | 'retry_failed'; toast: string } | { kind: 'error'; toast: string }
> {
  let response: Response;
  try {
    response = await fetch(`/api/notify/${logId}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return { kind: 'error', toast: CONTENT_PANEL.AGENDA.errorPatch };
  }

  let body: RetryResponseBody | null = null;
  try {
    body = (await response.json()) as RetryResponseBody;
  } catch {
    body = null;
  }

  if (response.ok && (body?.kind === 'retry_ok' || body?.kind === 'retry_failed')) {
    const toast = body?.toast ?? CONTENT_PANEL.NOTIFY.reenviar_success_toast;
    return { kind: body.kind, toast };
  }
  return { kind: 'error', toast: CONTENT_PANEL.AGENDA.errorPatch };
}

export function ReenviarButton({ logId }: ReenviarButtonProps): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<boolean>(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const handleClick = (): void => {
    setBusy(true);
    setToast(null);

    void (async () => {
      const result = await postRetry(logId);
      setBusy(false);
      if (result.kind === 'retry_ok') {
        setToast({ kind: 'success', text: result.toast });
        startTransition(() => {
          router.refresh();
        });
      } else if (result.kind === 'retry_failed') {
        setToast({ kind: 'error', text: result.toast });
        startTransition(() => {
          router.refresh();
        });
      } else {
        setToast({ kind: 'error', text: result.toast });
      }
    })();
  };

  return (
    <span data-log-id={logId} data-reenviar-cell>
      <button type="button" data-action="reenviar" disabled={busy || pending} onClick={handleClick}>
        {CONTENT_PANEL.NOTIFY.reenviar_button}
      </button>
      {toast !== null && (
        <output data-toast data-toast-kind={toast.kind}>
          {toast.text}
        </output>
      )}
    </span>
  );
}
