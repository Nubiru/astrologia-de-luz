/**
 * `/panel/agenda/notificaciones-fallidas` — read-only failed-notification
 * log for the last 7 days + per-row Reenviar button (G_B-7 wave).
 *
 * Spec anchors:
 *   - AC-3.3.1 — notify_log row contract (event_kind / channel /
 *     recipient / status / error_body / attempt_number / created_at).
 *   - AC-3.3.4 — no automatic retry loop in v1.0; this listing surface +
 *     the AC-3.3.5 button are the only manual recovery paths.
 *   - AC-3.3.5 — each row carries a Reenviar button → POST
 *     `/api/notify/[id]/retry` (G_C-15 endpoint). Toast outcomes come
 *     from `CONTENT_PANEL.NOTIFY.reenviar_*` slots.
 *
 * Runtime + dynamic-cascade: `runtime = 'nodejs'` + `dynamic =
 * 'force-dynamic'` — same rationale as the parent `/panel/agenda` page
 * (G_C-25 lazy-env pattern; admin lists are per-request).
 *
 * Auth gate: panel layout's `auth()` short-circuit handles the redirect.
 *
 * Window: rolling 7 days. The same `FAILED_LOG_WINDOW_MS` constant is
 * used by the AC-3.3.2 banner so the count + listing always agree.
 */

import type { Metadata } from 'next';

import {
  FAILED_LOG_WINDOW_MS,
  type FailedNotifyRow,
  selectFailedNotifyLogs,
} from '@/application/panel/failed-log';
import { ReenviarButton } from '@/components/panel/ReenviarButton';
import { CONTENT_PANEL } from '@/infrastructure/content';
import { getDb } from '@/infrastructure/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: CONTENT_PANEL.AGENDA.failedListPageTitle,
  robots: { index: false, follow: false },
};

const ERROR_PREVIEW_AT = 200;

function formatCreatedAt(epochMs: number): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(epochMs));
}

function FailedLogRow({ row }: { row: FailedNotifyRow }): React.ReactElement {
  const errorPreview =
    row.errorBody !== null && row.errorBody.length > ERROR_PREVIEW_AT
      ? `${row.errorBody.slice(0, ERROR_PREVIEW_AT - 1)}…`
      : row.errorBody;

  return (
    <tr data-failed-row data-log-id={row.id}>
      <td data-field="event">{row.eventKind}</td>
      <td data-field="channel">{row.channel}</td>
      <td data-field="recipient">{row.recipient}</td>
      <td data-field="status">{row.status}</td>
      <td data-field="attempt">{row.attemptNumber}</td>
      <td data-field="created-at" data-epoch-ms={row.createdAt}>
        {formatCreatedAt(row.createdAt)}
      </td>
      <td data-field="error">
        {row.errorBody === null ? (
          <span data-field="error-empty" />
        ) : row.errorBody.length > ERROR_PREVIEW_AT ? (
          <details data-field="error-details">
            <summary>
              <span data-field="error-preview">{errorPreview}</span>
            </summary>
            <span data-field="error-full">{row.errorBody}</span>
          </details>
        ) : (
          <span data-field="error-full">{row.errorBody}</span>
        )}
      </td>
      <td data-field="action">
        <ReenviarButton logId={row.id} />
      </td>
    </tr>
  );
}

export default async function NotificacionesFallidasPage(): Promise<React.ReactElement> {
  const sinceMs = Date.now() - FAILED_LOG_WINDOW_MS;
  const rows = await selectFailedNotifyLogs(getDb(), sinceMs);

  return (
    <main data-page="panel-notificaciones-fallidas">
      <header>
        <h1>{CONTENT_PANEL.AGENDA.failedListHeading}</h1>
        <p data-subheading>{CONTENT_PANEL.AGENDA.failedListSubheading}</p>
      </header>
      {rows.length === 0 ? (
        <p data-failed-empty>{CONTENT_PANEL.AGENDA.failedListEmpty}</p>
      ) : (
        <table data-failed-table>
          <thead>
            <tr>
              <th scope="col">{CONTENT_PANEL.AGENDA.failedColEvent}</th>
              <th scope="col">{CONTENT_PANEL.AGENDA.failedColChannel}</th>
              <th scope="col">{CONTENT_PANEL.AGENDA.failedColRecipient}</th>
              <th scope="col">{CONTENT_PANEL.AGENDA.failedColStatus}</th>
              <th scope="col">{CONTENT_PANEL.AGENDA.failedColAttempt}</th>
              <th scope="col">{CONTENT_PANEL.AGENDA.failedColCreatedAt}</th>
              <th scope="col">{CONTENT_PANEL.AGENDA.failedColError}</th>
              <th scope="col">{CONTENT_PANEL.AGENDA.failedColAction}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <FailedLogRow key={row.id} row={row} />
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
