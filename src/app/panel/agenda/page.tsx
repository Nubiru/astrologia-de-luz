/**
 * `/panel/agenda` — pending requests list (G_B-5) + confirmed calendar
 * + empty-state cards (G_B-6).
 *
 * Spec anchors:
 *   - AC-1.4.1 — `<h2>Solicitudes pendientes</h2>` + `<h2>Agenda
 *     confirmada</h2>` rendered in this DOM order.
 *   - AC-1.4.2 — per-pending-row contents + Aceptar/Rechazar buttons →
 *     PATCH `/api/sessions/[id]` with `{ status: 'confirmed' | 'rejected' }`.
 *   - AC-1.4.3 — per-confirmed-row contents: date + start time (maestro
 *     TZ) + maestro name + visitor name + contact channel +
 *     "Marcar como completada" + "No-show" affordances (time-guarded;
 *     PATCH route enforces `now >= startsAtUtc + duration_ms`). Past
 *     slots show muted via `data-past="true"` for downstream CSS.
 *   - AC-1.4.4 — 0-active-maestros → render the call-to-action card
 *     (replaces both sections) pointing at `/panel/maestros` (G_B-8).
 *   - AC-1.4.5 — 0-pending + 0-confirmed → per-section neutral copy.
 *   - AC-1.7.7 — Server Component (SSR) with interactive client islands
 *     for the action buttons.
 *
 * Runtime + dynamic-cascade: `runtime = 'nodejs'` (AC-2.4.5 — `getDb()`
 * pulls @libsql/client) + `dynamic = 'force-dynamic'` (G_C-25 pattern —
 * admin agenda is per-request; Next 16's SSG would attempt to
 * prerender → `getEnv()` at build-time would throw).
 *
 * Auth gate: panel layout (`src/app/panel/layout.tsx`) handles the
 * unauthenticated redirect; this page does not duplicate the check.
 *
 * Confirmed-calendar window: `[now - 1d, now + 30d]`. The 1d past tail
 * preserves AC-1.4.3's "past slots show muted" semantics — Augusto can
 * still mark Completada/No-show on a session that just ended. Sessions
 * older than 24h that remain `confirmed` fall out of the rolling view;
 * Augusto's housekeeping flow for those is a v1.1 candidate.
 */

import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { Metadata } from 'next';

import { FAILED_LOG_WINDOW_MS, countFailedNotifyLogs } from '@/application/panel/failed-log';
import { AgendaConfirmedActions } from '@/components/panel/AgendaConfirmedActions';
import { AgendaPendingActions } from '@/components/panel/AgendaPendingActions';
import { CONTENT_PANEL } from '@/infrastructure/content';
import { getDb } from '@/infrastructure/db/client';
import { sessions, teachers } from '@/infrastructure/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  // AC-1.7.1 — panel titles begin "Panel · "; the root layout's title
  // template (if any) does NOT wrap admin titles. Setting the literal here
  // keeps the title verbatim regardless of any future template change.
  title: CONTENT_PANEL.AGENDA.pageTitle,
  // Admin surfaces are noindex by default — panel routes do not belong in
  // search engine indices.
  robots: { index: false, follow: false },
};

const INTENT_TRUNCATE_AT = 120;

const CONFIRMED_PAST_WINDOW_MS = 24 * 60 * 60 * 1000;
const CONFIRMED_FUTURE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

interface PendingRow {
  sessionId: string;
  startsAtUtc: number;
  visitorName: string;
  visitorEmail: string;
  visitorTimezone: string | null;
  contactPref: string;
  contactValue: string;
  visitorIntent: string | null;
  maestroName: string;
  maestroTimezone: string;
}

interface ConfirmedRow {
  sessionId: string;
  startsAtUtc: number;
  durationMinutes: number;
  visitorName: string;
  contactPref: string;
  contactValue: string;
  maestroName: string;
  maestroTimezone: string;
}

async function countActiveMaestros(): Promise<number> {
  const rows = await getDb()
    .select({ id: teachers.id })
    .from(teachers)
    .where(eq(teachers.active, true));
  return rows.length;
}

async function loadPendingRequests(): Promise<PendingRow[]> {
  // AC-2.2.3 partial index `sessions_status_created_idx` covers
  // (status='pending', created_at) so the order-by + filter pair lands on a
  // single index scan; the join into teachers is a PK lookup.
  const rows = await getDb()
    .select({
      sessionId: sessions.id,
      startsAtUtc: sessions.startsAtUtc,
      visitorName: sessions.visitorName,
      visitorEmail: sessions.visitorEmail,
      visitorTimezone: sessions.visitorTimezone,
      contactPref: sessions.contactPref,
      contactValue: sessions.contactValue,
      visitorIntent: sessions.visitorIntent,
      maestroName: teachers.name,
      maestroTimezone: teachers.timezone,
    })
    .from(sessions)
    .innerJoin(teachers, eq(sessions.teacherId, teachers.id))
    .where(eq(sessions.status, 'pending'))
    .orderBy(asc(sessions.createdAt));
  return rows;
}

async function loadConfirmedSessions(nowMs: number): Promise<ConfirmedRow[]> {
  // AC-1.4.1 + AC-1.4.3 rolling window. The starts_idx (AC-2.2.3) covers
  // the range scan on starts_at_utc; an additional filter on
  // status='confirmed' is applied at the WHERE.
  const lowerBound = nowMs - CONFIRMED_PAST_WINDOW_MS;
  const upperBound = nowMs + CONFIRMED_FUTURE_WINDOW_MS;
  const rows = await getDb()
    .select({
      sessionId: sessions.id,
      startsAtUtc: sessions.startsAtUtc,
      durationMinutes: sessions.durationMinutes,
      visitorName: sessions.visitorName,
      contactPref: sessions.contactPref,
      contactValue: sessions.contactValue,
      maestroName: teachers.name,
      maestroTimezone: teachers.timezone,
    })
    .from(sessions)
    .innerJoin(teachers, eq(sessions.teacherId, teachers.id))
    .where(
      and(
        eq(sessions.status, 'confirmed'),
        gte(sessions.startsAtUtc, lowerBound),
        lte(sessions.startsAtUtc, upperBound),
      ),
    )
    .orderBy(asc(sessions.startsAtUtc));
  return rows;
}

function formatSlotInTz(epochMs: number, tz: string): string {
  // Stable Spanish-LATAM formatting for the slot label — same convention as
  // `src/application/notify/shared.ts::formatSlot` but inlined to avoid
  // pulling notification-layer code into the page bundle.
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: tz,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(epochMs));
}

function contactChannelLabel(pref: string): string {
  switch (pref) {
    case 'email':
      return CONTENT_PANEL.AGENDA.channelEmail;
    case 'whatsapp':
      return CONTENT_PANEL.AGENDA.channelWhatsapp;
    case 'phone':
      return CONTENT_PANEL.AGENDA.channelPhone;
    default:
      return pref;
  }
}

function PendingRowItem({ row }: { row: PendingRow }): React.ReactElement {
  const slotMaestroLocal = formatSlotInTz(row.startsAtUtc, row.maestroTimezone);
  const visitorTz = row.visitorTimezone;
  const showVisitorTz = visitorTz !== null && visitorTz !== row.maestroTimezone;
  const slotVisitorLocal = showVisitorTz
    ? formatSlotInTz(row.startsAtUtc, visitorTz as string)
    : null;

  const intent = row.visitorIntent ?? '';
  const intentTruncated =
    intent.length > INTENT_TRUNCATE_AT ? `${intent.slice(0, INTENT_TRUNCATE_AT - 1)}…` : intent;
  const intentNeedsToggle = intent.length > INTENT_TRUNCATE_AT;

  return (
    <li data-pending-row data-session-id={row.sessionId}>
      <dl>
        <dt>{CONTENT_PANEL.AGENDA.labelMaestro}</dt>
        <dd data-field="maestro">{row.maestroName}</dd>
        <dt>
          {showVisitorTz ? CONTENT_PANEL.AGENDA.labelSlotMaestroTz : CONTENT_PANEL.AGENDA.labelSlot}
        </dt>
        <dd data-field="slot-maestro" data-tz={row.maestroTimezone}>
          {slotMaestroLocal}
        </dd>
        {showVisitorTz && slotVisitorLocal !== null && (
          <>
            <dt>{CONTENT_PANEL.AGENDA.labelSlotVisitorTz}</dt>
            <dd data-field="slot-visitor" data-tz={visitorTz}>
              {slotVisitorLocal}
            </dd>
          </>
        )}
        <dt>{CONTENT_PANEL.AGENDA.labelVisitor}</dt>
        <dd data-field="visitor">
          <span data-field="visitor-name">{row.visitorName}</span>{' '}
          <span data-field="visitor-email">{row.visitorEmail}</span>
        </dd>
        <dt>{CONTENT_PANEL.AGENDA.labelContact}</dt>
        <dd data-field="contact">
          <span data-field="contact-channel">{contactChannelLabel(row.contactPref)}</span>
          {' · '}
          <span data-field="contact-value">{row.contactValue}</span>
        </dd>
        <dt>{CONTENT_PANEL.AGENDA.labelIntent}</dt>
        <dd data-field="intent">
          {intent.length === 0 ? (
            <span data-field="intent-empty" />
          ) : intentNeedsToggle ? (
            <details data-field="intent-details">
              <summary>
                <span data-field="intent-preview">{intentTruncated}</span>{' '}
                <span data-field="intent-vermas">{CONTENT_PANEL.AGENDA.verMas}</span>
              </summary>
              <span data-field="intent-full">{intent}</span>
            </details>
          ) : (
            <span data-field="intent-full">{intent}</span>
          )}
        </dd>
      </dl>
      <AgendaPendingActions sessionId={row.sessionId} />
    </li>
  );
}

function ConfirmedRowItem({
  row,
  nowMs,
}: {
  row: ConfirmedRow;
  nowMs: number;
}): React.ReactElement {
  const slotMaestroLocal = formatSlotInTz(row.startsAtUtc, row.maestroTimezone);
  const endsAtMs = row.startsAtUtc + row.durationMinutes * 60_000;
  // AC-1.4.3 — past slots show muted. "Past" means the slot has started
  // (current time ≥ startsAtUtc). The CSS layer translates `data-past="true"`
  // into the muted visual; the data attribute is the assertion surface.
  const isPast = nowMs >= row.startsAtUtc;

  return (
    <li data-confirmed-row data-session-id={row.sessionId} data-past={isPast ? 'true' : 'false'}>
      <dl>
        <dt>{CONTENT_PANEL.AGENDA.labelMaestro}</dt>
        <dd data-field="maestro">{row.maestroName}</dd>
        <dt>{CONTENT_PANEL.AGENDA.labelSlot}</dt>
        <dd data-field="slot-maestro" data-tz={row.maestroTimezone}>
          {slotMaestroLocal}
        </dd>
        <dt>{CONTENT_PANEL.AGENDA.labelVisitor}</dt>
        <dd data-field="visitor">
          <span data-field="visitor-name">{row.visitorName}</span>
        </dd>
        <dt>{CONTENT_PANEL.AGENDA.labelContact}</dt>
        <dd data-field="contact">
          <span data-field="contact-channel">{contactChannelLabel(row.contactPref)}</span>
          {' · '}
          <span data-field="contact-value">{row.contactValue}</span>
        </dd>
      </dl>
      <AgendaConfirmedActions sessionId={row.sessionId} endsAtMs={endsAtMs} />
    </li>
  );
}

function NoMaestrosCard(): React.ReactElement {
  return (
    <section data-section="no-maestros-card" aria-labelledby="agenda-no-maestros-heading">
      <h2 id="agenda-no-maestros-heading">{CONTENT_PANEL.AGENDA.noMaestrosHeading}</h2>
      <p>
        {CONTENT_PANEL.AGENDA.noMaestrosBody}{' '}
        <a href="/panel/maestros" data-no-maestros-link>
          {CONTENT_PANEL.AGENDA.noMaestrosLinkLabel}
        </a>{' '}
        {CONTENT_PANEL.AGENDA.noMaestrosBodyAfter}
      </p>
    </section>
  );
}

function FailedBanner({ count }: { count: number }): React.ReactElement {
  const bannerText = CONTENT_PANEL.AGENDA.bannerFailedTemplate.replace('{count}', String(count));
  return (
    <output data-failed-banner data-failed-count={count}>
      {bannerText} —{' '}
      <a href="/panel/agenda/notificaciones-fallidas" data-failed-banner-link>
        {CONTENT_PANEL.AGENDA.bannerFailedLinkLabel}
      </a>
    </output>
  );
}

export default async function AgendaPage(): Promise<React.ReactElement> {
  // AC-1.4.4 short-circuit — when there are no active maestros, neither
  // section can populate, so render the call-to-action card and stop. The
  // pending/confirmed queries would return [] anyway, but the empty-state
  // copy in those sections is too generic to direct the admin to the
  // right next action (add a maestro).
  const maestrosCount = await countActiveMaestros();
  if (maestrosCount === 0) {
    return (
      <main data-page="panel-agenda" data-state="no-maestros">
        <h1>{CONTENT_PANEL.AGENDA.pageTitle}</h1>
        <NoMaestrosCard />
      </main>
    );
  }

  const nowMs = Date.now();
  const [pending, confirmed, failedCount] = await Promise.all([
    loadPendingRequests(),
    loadConfirmedSessions(nowMs),
    countFailedNotifyLogs(getDb(), nowMs - FAILED_LOG_WINDOW_MS),
  ]);

  return (
    <main data-page="panel-agenda">
      <h1>{CONTENT_PANEL.AGENDA.pageTitle}</h1>
      {failedCount > 0 && <FailedBanner count={failedCount} />}
      <section aria-labelledby="agenda-pending-heading" data-section="pending">
        <h2 id="agenda-pending-heading">{CONTENT_PANEL.AGENDA.sectionPending}</h2>
        {pending.length === 0 ? (
          <p data-pending-empty>{CONTENT_PANEL.AGENDA.noPending}</p>
        ) : (
          <ul data-pending-list>
            {pending.map((row) => (
              <PendingRowItem key={row.sessionId} row={row} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="agenda-confirmed-heading" data-section="confirmed">
        <h2 id="agenda-confirmed-heading">{CONTENT_PANEL.AGENDA.sectionConfirmed}</h2>
        {confirmed.length === 0 ? (
          <p data-confirmed-empty>{CONTENT_PANEL.AGENDA.noConfirmed}</p>
        ) : (
          <ul data-confirmed-list>
            {confirmed.map((row) => (
              <ConfirmedRowItem key={row.sessionId} row={row} nowMs={nowMs} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
