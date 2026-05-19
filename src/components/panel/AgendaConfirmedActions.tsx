'use client';

/**
 * G_B-6 — Completada / No-show action buttons for a single confirmed
 * session row.
 *
 * Spec anchors: S-1 AC-1.4.3 (button labels + time-guard surface) +
 * AC-3.4.2 (transitions confirmed→completed / confirmed→no_show fire NO
 * email — admin internal disposition) + AC-2.2.5 time-guard contract.
 *
 * Time-guard surface:
 *   The PATCH route (`/api/sessions/[id]`) enforces server-side that
 *   `Date.now() >= startsAtUtc + durationMinutes * 60_000` for both
 *   `confirmed→completed` and `confirmed→no_show`. This island mirrors
 *   that check client-side as a *UX surface only* — the server is the
 *   source of truth. A user with a stale page who clicks before the
 *   guard satisfies would receive a 409 `guardFailed: true` from the
 *   route; that path is surfaced via the same fall-back as a network
 *   error (AGENDA.errorPatch).
 *
 * `endsAtMs` is passed pre-computed by the server-component page so the
 * island stays free of date-arithmetic and timezone reasoning. A
 * `useEffect` ticks once per 30 seconds to re-check the guard so the
 * buttons unlock without requiring a full reload (cheap; covers the
 * common case where Augusto leaves the agenda open during a session).
 *
 * Failure surface mirrors AgendaPendingActions:
 *   - 409 invalid_transition / guardFailed → route's localized error body.
 *   - 401 / 500 / network                  → AGENDA.errorPatch.
 *
 * data-* selectors (`data-session-id` + `data-action="completada"|"no-show"`)
 * are the Playwright selectors used by
 * `tests/e2e/agenda-completada-time-guard.spec.ts`.
 */

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { CONTENT_PANEL } from '@/infrastructure/content';

type ActionKind = 'completada' | 'no-show';

interface AgendaConfirmedActionsProps {
  sessionId: string;
  /** Epoch-ms when the session ends — guard satisfies once `now >= endsAtMs`. */
  endsAtMs: number;
}

interface PatchErrorBody {
  kind?: string;
  error?: string;
}

async function patchSessionStatus(
  sessionId: string,
  newStatus: 'completed' | 'no_show',
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

  let body: PatchErrorBody | null = null;
  try {
    body = (await response.json()) as PatchErrorBody;
  } catch {
    body = null;
  }
  const message = body?.error ?? CONTENT_PANEL.AGENDA.errorPatch;
  return { ok: false, message };
}

export function AgendaConfirmedActions({
  sessionId,
  endsAtMs,
}: AgendaConfirmedActionsProps): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyAction, setBusyAction] = useState<ActionKind | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [guardSatisfied, setGuardSatisfied] = useState<boolean>(() => Date.now() >= endsAtMs);

  useEffect(() => {
    if (guardSatisfied) return;
    // Tick once per 30s until the guard satisfies. After it satisfies we
    // clear the interval and stop ticking — no work to do.
    const timer = setInterval(() => {
      if (Date.now() >= endsAtMs) {
        setGuardSatisfied(true);
      }
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, [endsAtMs, guardSatisfied]);

  const handleClick = (kind: ActionKind): void => {
    const newStatus: 'completed' | 'no_show' = kind === 'completada' ? 'completed' : 'no_show';
    setBusyAction(kind);
    setErrorMessage(null);

    void (async () => {
      const result = await patchSessionStatus(sessionId, newStatus);
      if (!result.ok) {
        setBusyAction(null);
        setErrorMessage(result.message);
        return;
      }
      startTransition(() => {
        router.refresh();
        setBusyAction(null);
      });
    })();
  };

  const disabled = pending || busyAction !== null || !guardSatisfied;
  const tooltip = guardSatisfied ? undefined : CONTENT_PANEL.AGENDA.completadaButtonLockedTooltip;

  return (
    <div
      data-session-id={sessionId}
      data-agenda-actions="confirmed"
      data-guard-satisfied={guardSatisfied}
    >
      <button
        type="button"
        data-action="completada"
        disabled={disabled}
        title={tooltip}
        onClick={() => {
          handleClick('completada');
        }}
      >
        {CONTENT_PANEL.AGENDA.completadaButton}
      </button>
      <button
        type="button"
        data-action="no-show"
        disabled={disabled}
        title={tooltip}
        onClick={() => {
          handleClick('no-show');
        }}
      >
        {CONTENT_PANEL.AGENDA.noShowButton}
      </button>
      {errorMessage !== null && (
        <p data-agenda-error role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
