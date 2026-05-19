/**
 * Pool-b section file — admin-facing + admin-controlled UI strings.
 *
 * Spec anchors: AC-1.3.2, AC-2.5.2, AC-3.2.1, AC-3.2.2, AC-3.3.5, AC-3.4.3,
 *               AC-3.7.4, AC-3.7.6, AC-3.8.1, AC-3.8.2, §15.1.
 *
 * Voice: íntima pero no familiar, erudita pero no distante, mística pero no
 * esotérica (IDENTITY.md). Brief, warm, no jargon, no hyperbole.
 *
 * Scope discipline: this file owns the UI-string surface PLUS the admin-
 * controlled landing/reservar copy (LANDING.sla, RESERVAR.cancellation) per
 * AC-3.8.* — those slots ARE Augusto-editable from the panel in v1.1, so the
 * spec puts them under CONTENT_PANEL even though they render on public pages.
 *
 * NOT in this file: any transactional email body. Magic-link body, decline
 * email, maestroFallback, visitor-* emails all live in `lib/content/email.ts`
 * (pool-c, G_C-18) and are referenced via `CONTENT_EMAIL.*`.
 *
 * Interpolation contract: every `{tokenName}` is a placeholder the consumer
 * substitutes at render time. Token names are camelCase identifiers; the unit
 * pairing asserts every placeholder is well-formed (no stray `{` / `}`, no
 * `{}` empties, no `${...}` shell-style escapes that would render literally).
 */

/* ────────────────────────────────────────────────────────────────────────── *
 * AUTH — sign-in form copy (AC-1.3.2 + AC-2.5.2 carried via AC-3.8.4).
 *
 * `checkInboxNeutral` is the load-bearing anti-enum string per AC-1.3.2: on-
 * list AND off-list submissions render this exact text so the off-list path
 * does not signal "your address is not authorized". The wording deliberately
 * starts with the conditional "Si tu correo está autorizado" so it is honest
 * to both audiences.
 * ────────────────────────────────────────────────────────────────────────── */
const AUTH = {
  headline: 'Acceso al panel',
  emailLabel: 'Correo',
  emailPlaceholder: 'tu@correo.com',
  submitButton: 'Enviar enlace',
  signOutButton: 'Salir',
  // AC-1.3.2 — byte-identical anti-enum response. Editing this text MUST
  // preserve the property that nothing in the wording reveals authorisation
  // status. Verified by the unit pairing.
  checkInboxNeutral: 'Si tu correo está autorizado, te enviamos el enlace.',
  // AC-2.5.2 — short Spanish line shown on the verify-request page above
  // the (framework-supplied) "open your inbox" instruction. The verbatim 24h
  // sentence lives in the email body itself (CONTENT_EMAIL.PANEL.AUTH.
  // magicLinkBody) not here.
  verifyRequestSubtitle:
    'Si tu correo está autorizado, vas a recibir el enlace en los próximos minutos.',
} as const;

/* ────────────────────────────────────────────────────────────────────────── *
 * ERRORS — admin-facing error messages.
 *
 * `invalidTransition` is the AC-3.4.3 + AC-2.2.4 contract: when the mutation
 * layer rejects a status flip with 409, the response body uses this text.
 * `{from}` and `{to}` are substituted with the rejected transition labels in
 * Spanish (mapped at the consumer; e.g. `pending` → `pendiente`).
 * ────────────────────────────────────────────────────────────────────────── */
const ERRORS = {
  invalidTransition:
    'No se puede pasar de "{from}" a "{to}". El estado actual no permite esta acción.',
  unauthorized: 'No tenés acceso a esta sección.',
  notFound: 'No encontramos lo que estás buscando.',
  serverError: 'Ocurrió un problema al procesar tu pedido. Probá nuevamente.',
} as const;

/* ────────────────────────────────────────────────────────────────────────── *
 * STATUS — panel chrome indicators (AC-3.7.6).
 *
 * The webhook status dot (top-right of `/panel/layout.tsx`) reads its color
 * label + tooltip directly from these slots. `{checkedAt}` is substituted at
 * render time with a localized timestamp string of the cached `getWebhookInfo`
 * probe.
 * ────────────────────────────────────────────────────────────────────────── */
const STATUS = {
  webhook_ok: {
    label: 'Webhook activo',
    color: 'verde',
    tooltipTemplate: 'Última verificación: {checkedAt}',
  },
  webhook_broken: {
    label: 'Webhook caído',
    color: 'rojo',
    tooltipTemplate: 'Última verificación: {checkedAt} · revisá la configuración del bot.',
  },
} as const;

/* ────────────────────────────────────────────────────────────────────────── *
 * NOTIFY — Telegram message bodies + panel-side toast/button labels.
 *
 * Telegram-bound texts use `parse_mode: 'HTML'` (AC-3.2.1) so `<b>` tags are
 * rendered as bold. Newlines are literal `\n` — Telegram preserves them. Every
 * `{token}` is substituted by the dispatcher at send-time.
 *
 * `brandOwnerNewRequest` lands in Augusto's own chat (AC-3.2.1).
 * `assignedMaestroNewRequest` lands in the assigned maestro's chat when the
 * assigned maestro is NOT the brand owner (AC-3.2.2 dedupe).
 * `maestroOnboardedSuccess` is the reply Augusto's bot sends a teacher right
 * after the /start deep-link consumes their token (AC-3.7.4).
 * `brandOwnerMaestroOnboardedPing` is the matching ping back to Augusto so he
 * sees who just connected (AC-3.7.4 closing paragraph).
 *
 * `reenviar_*` slots back the AC-3.3.5 manual-retry surface on
 * `/panel/agenda/notificaciones-fallidas`.
 * ────────────────────────────────────────────────────────────────────────── */
const NOTIFY = {
  // AC-3.2.1 — substitutions: visitorName, maestroName, slotBrandOwnerLocal,
  // contactChannel, contactValue, visitorIntent.
  brandOwnerNewRequest:
    '<b>Nueva solicitud</b>\n' +
    'Maestro: {maestroName}\n' +
    'Visitante: {visitorName}\n' +
    'Slot: {slotBrandOwnerLocal}\n' +
    'Contacto: {contactChannel} · {contactValue}\n' +
    'Intención: {visitorIntent}',

  // AC-3.2.2 — substitutions: visitorName, slotMaestroLocal, contactChannel,
  // contactValue, visitorIntent. (No maestroName — the message goes to the
  // maestro themselves.)
  assignedMaestroNewRequest:
    '<b>Nueva solicitud</b>\n' +
    'Visitante: {visitorName}\n' +
    'Slot: {slotMaestroLocal}\n' +
    'Contacto: {contactChannel} · {contactValue}\n' +
    'Intención: {visitorIntent}',

  // AC-3.7.4 — reply to the maestro after the /start onboarding consumes
  // their token. `{maestroName}` substituted with the row's `name`.
  maestroOnboardedSuccess:
    'Listo, {maestroName}. Las próximas solicitudes para vos llegan a este chat.',

  // AC-3.7.4 — paired ping to the brand-owner chat so Augusto sees who
  // just connected. `{maestroName}` substituted.
  brandOwnerMaestroOnboardedPing: 'Maestro {maestroName} ya está conectado al bot.',

  // AC-3.3.5 — manual retry surface. Button label + the two toast outcomes.
  reenviar_button: 'Reenviar',
  reenviar_success_toast: 'Notificación reenviada correctamente.',
  reenviar_failed_toast: 'No se pudo reenviar. Revisá el registro para más detalles.',
} as const;

/* ────────────────────────────────────────────────────────────────────────── *
 * LANDING + RESERVAR — admin-controlled public-page copy (AC-3.8.1 + AC-3.8.2).
 *
 * These render on PUBLIC surfaces (`/` landing + `/reservar` booking page +
 * confirmation flows) but are PANEL-controlled: Augusto edits the seeded
 * defaults via the panel in v1.1 (env-var-overrideable in v1.0).
 *
 * Seeded defaults are spec-pinned verbatim — the unit pairing asserts the
 * literal substrings so a future "soft" edit can't drift away from the
 * documented copy without an accompanying spec update.
 * ────────────────────────────────────────────────────────────────────────── */
const LANDING = {
  // AC-3.8.1 — MUST contain "24-48 horas" as the SLA window (per MEGA CP-3
  // priming note 6). Rendered on / + visitor-receipt email + the FAQ entry.
  sla: {
    text: 'Augusto te responderá dentro de 24-48 horas.',
  },
} as const;

const RESERVAR = {
  // AC-3.8.2 — MUST contain "24 horas" + "reagendamiento" (per MEGA CP-3
  // priming note 6). Rendered on /reservar + FAQ entry.
  cancellation: {
    text: 'Libre hasta 24 horas antes de la sesión. Reagendamiento posible una vez sin costo.',
  },
} as const;

/* ────────────────────────────────────────────────────────────────────────── *
 * AGENDA — `/panel/agenda` UI strings (AC-1.4.1 + AC-1.4.2).
 *
 * Section headings render verbatim and are load-bearing for AC-1.4.1's DOM-
 * order Playwright check (`<h2>` text matched against `sectionPending` /
 * `sectionConfirmed`). The Aceptar / Rechazar button labels are the literal
 * call-to-action on each pending row (AC-1.4.2).
 *
 * `verMas` is the AC-1.4.2 "Ver más" toggle copy that reveals the full intent
 * note when the truncated 120-char preview is collapsed. The label is the
 * spec-pinned phrase — drift here breaks the AC's verbatim contract.
 *
 * Row-field labels (`labelMaestro`, `labelVisitor`, ...) are accessible
 * row-leading definitions consumed by the page row template. They carry no
 * placeholders — pure static labels.
 *
 * `errorPatch` is shown inline when the Aceptar/Rechazar PATCH returns a
 * non-2xx response that is not an invalid_transition (those rely on
 * ERRORS.invalidTransition). Concrete fail-soft copy so the admin sees
 * *something* instead of an empty state.
 * ────────────────────────────────────────────────────────────────────────── */
const AGENDA = {
  pageTitle: 'Panel · Agenda',
  // AC-1.4.1 — Section h2 headings; load-bearing for the DOM-order
  // Playwright check.
  sectionPending: 'Solicitudes pendientes',
  sectionConfirmed: 'Agenda confirmada',
  noPending: 'Por ahora no hay solicitudes pendientes.',
  // AC-1.4.2 — action buttons + intent "Ver más" toggle.
  aceptarButton: 'Aceptar',
  rechazarButton: 'Rechazar',
  verMas: 'Ver más',
  // Row-field labels.
  labelMaestro: 'Maestro',
  labelVisitor: 'Visitante',
  labelContact: 'Contacto',
  labelIntent: 'Intención',
  labelSlot: 'Horario',
  labelSlotMaestroTz: 'Horario (zona del maestro)',
  labelSlotVisitorTz: 'Horario (zona del visitante)',
  // Channel labels (mirrors the AC-3.2.1 contactChannelLabel helper but the
  // panel-row surface needs its own copy so the page does not pull
  // application-layer code into a Server Component path).
  channelEmail: 'email',
  channelWhatsapp: 'WhatsApp',
  channelPhone: 'teléfono',
  // PATCH non-2xx fall-back copy (AC-3.4.3 invalidTransition still uses the
  // ERRORS slot; this one covers network errors + 500 + 401).
  errorPatch: 'No pudimos actualizar el estado. Probá nuevamente.',
  // AC-1.4.3 — confirmed-calendar row affordances. The PATCH route's
  // time-guard (route.ts::timeGuardSatisfied) is the load-bearing server-
  // side check; these labels drive the disabled-state-with-tooltip
  // surface on the buttons themselves.
  completadaButton: 'Marcar como completada',
  noShowButton: 'No-show',
  completadaButtonLockedTooltip:
    'Disponible cuando la sesión haya terminado (al menos 60 min después del inicio).',
  noConfirmed: 'No hay sesiones confirmadas en los próximos 30 días.',
  // AC-1.4.4 — 0-active-maestros card. The link target MUST resolve to
  // /panel/maestros (G_B-8 surface); the link label is the prose verb so
  // the card reads naturally with surrounding copy.
  noMaestrosHeading: 'Empezá agregando un maestro',
  noMaestrosBody: 'No hay maestros activos. Andá a',
  noMaestrosLinkLabel: '/panel/maestros',
  noMaestrosBodyAfter: 'para agregar uno.',
  // AC-3.3.2 — banner at the top of /panel/agenda when failed sends > 0
  // in the rolling 7-day window. `{count}` substitutes to the integer
  // count; `revisar registro` is the load-bearing link label so the
  // banner reads as a single sentence directing the admin to the listing.
  bannerFailedTemplate: '{count} envío(s) fallaron en los últimos 7 días',
  bannerFailedLinkLabel: 'revisar registro',
  // AC-3.3.5 — `/panel/agenda/notificaciones-fallidas` page surface. The
  // column labels are the <th> contents of the failed-log table. `colError`
  // is intentionally a short noun ("Error") so the truncated error body
  // renders without crowding the row.
  failedListPageTitle: 'Panel · Notificaciones fallidas',
  failedListHeading: 'Notificaciones fallidas',
  failedListSubheading: 'Últimos 7 días',
  failedListEmpty: 'No hay envíos fallidos en los últimos 7 días.',
  failedColEvent: 'Evento',
  failedColChannel: 'Canal',
  failedColRecipient: 'Destinatario',
  failedColStatus: 'Estado',
  failedColAttempt: 'Intento',
  failedColCreatedAt: 'Fecha',
  failedColError: 'Error',
  failedColAction: 'Acción',
} as const;

/* ────────────────────────────────────────────────────────────────────────── *
 * Public surface — `CONTENT_PANEL` is the single import target for every
 * consumer (panel pages, Telegram dispatcher, mutation layer, public pages
 * for SLA + cancellation). The granular sub-modules above are intentionally
 * NOT re-exported individually — keeping the import path uniform makes the
 * grep-for-string-usage signal at audit time interpretable.
 * ────────────────────────────────────────────────────────────────────────── */
export const CONTENT_PANEL = {
  AUTH,
  ERRORS,
  STATUS,
  NOTIFY,
  LANDING,
  RESERVAR,
  AGENDA,
} as const;

// Foundation-phase sentinel — G_C-1's install-smoke pairing asserts this
// through the barrel. Mirrors the same retain-until-janitorial-sweep pattern
// used in `lib/content/email.ts` (G_C-18). Removing it now would break the
// install-smoke pairing's barrel-end-to-end assertion.
export const __CONTENT_PANEL_SCAFFOLD = true;
