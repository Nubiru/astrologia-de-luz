// Pool-c section: transactional email bodies.
// Spec anchors: AC-2.5.2, AC-3.2.3, AC-3.2.4, AC-3.4.2, AC-3.8.3, AC-3.8.4, §15.1.
//
// Voice: íntima pero no familiar, erudita pero no distante, mística pero no esotérica
// (IDENTITY.md). Brief, warm, no astrology jargon, no hyperbole.
//
// Interpolation contract: every `{tokenName}` placeholder is substituted by the
// dispatcher at send time. The CONTENT slot owns the COPY; the dispatcher
// (G_C-13 for AC-3.2 fan-out, G_C-14 for AC-3.4 transitions, Auth.js v5's
// Resend provider for magicLinkBody) owns the substitution + delivery.
//
// Namespace mirrors the spec ACs:
//   CONTENT_EMAIL.PUBLIC.visitorRequestReceived → AC-3.2.4
//   CONTENT_EMAIL.PUBLIC.visitorConfirmed       → AC-3.4.2 pending→confirmed
//   CONTENT_EMAIL.PUBLIC.visitorDeclined        → AC-3.8.3 + AC-3.4.2 pending→rejected
//   CONTENT_EMAIL.PUBLIC.visitorCancelled       → AC-3.4.2 confirmed→cancelled
//   CONTENT_EMAIL.PANEL.AUTH.magicLinkBody      → AC-2.5.2 (carried by AC-3.8.4)
//   CONTENT_EMAIL.PANEL.EMAIL.maestroFallback   → AC-3.2.3
//   CONTENT_EMAIL.PANEL.EMAIL.decline           → AC-3.8.3 alias for PUBLIC.visitorDeclined
//
// The `__CONTENT_EMAIL_SCAFFOLD` sentinel below is retained — G_C-1's
// install-smoke pairing asserts it through the barrel and that pairing is not
// in this task's filesAffected. A janitorial sweep removes it (together with
// public.ts + panel.ts scaffolds) after all 3 section files are filled.

export interface EmailSlot {
  subject: string;
  html: string;
  text: string;
}

const visitorRequestReceived: EmailSlot = {
  subject: 'Recibimos tu solicitud — Astrologia de Luz',
  html: `<p>Hola {visitorName},</p>

<p>Recibimos tu solicitud de sesión con <strong>{maestroName}</strong> para <strong>{slotVisitorLocal}</strong> (tu hora · {visitorTimezone}) · {slotMaestroLocal} (hora de {maestroName} · {maestroTimezone}).</p>

<p>{brandOwnerName} te responderá por {contactChannel} dentro de {sla}.</p>

<p>Si tu plan cambia o tenés dudas antes de la confirmación, podés responder a este correo.</p>

<p>Con claridad,<br>
{brandOwnerName} · Astrologia de Luz</p>`,
  text: `Hola {visitorName},

Recibimos tu solicitud de sesión con {maestroName} para {slotVisitorLocal} (tu hora · {visitorTimezone}) · {slotMaestroLocal} (hora de {maestroName} · {maestroTimezone}).

{brandOwnerName} te responderá por {contactChannel} dentro de {sla}.

Si tu plan cambia o tenés dudas antes de la confirmación, podés responder a este correo.

Con claridad,
{brandOwnerName} · Astrologia de Luz`,
};

const visitorConfirmed: EmailSlot = {
  subject: 'Sesión confirmada — Astrologia de Luz',
  html: `<p>Hola {visitorName},</p>

<p>Tu sesión con <strong>{maestroName}</strong> queda confirmada para <strong>{slotVisitorLocal}</strong> (tu hora · {visitorTimezone}) · {slotMaestroLocal} (hora de {maestroName} · {maestroTimezone}).</p>

<p>Nos pondremos en contacto por {contactChannel} cerca del horario para coordinar el encuentro.</p>

<p>Si necesitás reagendar, escribinos respondiendo este correo con la mayor antelación posible.</p>

<p>Con claridad,<br>
{brandOwnerName} · Astrologia de Luz</p>`,
  text: `Hola {visitorName},

Tu sesión con {maestroName} queda confirmada para {slotVisitorLocal} (tu hora · {visitorTimezone}) · {slotMaestroLocal} (hora de {maestroName} · {maestroTimezone}).

Nos pondremos en contacto por {contactChannel} cerca del horario para coordinar el encuentro.

Si necesitás reagendar, escribinos respondiendo este correo con la mayor antelación posible.

Con claridad,
{brandOwnerName} · Astrologia de Luz`,
};

// AC-3.8.3: courteous, brief, signs off with brand-owner name, NO concrete reason.
// Privacy + relationship-quality both improve when the response is warm but
// closed — a templated reason invites templated rebuttal.
const visitorDeclined: EmailSlot = {
  subject: 'Sobre tu solicitud — Astrologia de Luz',
  html: `<p>Hola {visitorName},</p>

<p>Después de revisar tu solicitud, no podremos acompañarte en esta oportunidad. Agradecemos profundamente tu interés en este espacio.</p>

<p>Si tu intuición te trae nuevamente a buscar este encuentro en el futuro, vas a poder enviarnos otra solicitud por la misma vía.</p>

<p>Con respeto,<br>
{brandOwnerName} · Astrologia de Luz</p>`,
  text: `Hola {visitorName},

Después de revisar tu solicitud, no podremos acompañarte en esta oportunidad. Agradecemos profundamente tu interés en este espacio.

Si tu intuición te trae nuevamente a buscar este encuentro en el futuro, vas a poder enviarnos otra solicitud por la misma vía.

Con respeto,
{brandOwnerName} · Astrologia de Luz`,
};

const visitorCancelled: EmailSlot = {
  subject: 'Cambio en tu sesión — Astrologia de Luz',
  html: `<p>Hola {visitorName},</p>

<p>Tu sesión con <strong>{maestroName}</strong>, originalmente prevista para <strong>{slotVisitorLocal}</strong> (tu hora · {visitorTimezone}), queda cancelada.</p>

<p>Si querés volver a coordinar un encuentro, podés enviar una nueva solicitud desde el sitio. Gracias por tu comprensión.</p>

<p>Con claridad,<br>
{brandOwnerName} · Astrologia de Luz</p>`,
  text: `Hola {visitorName},

Tu sesión con {maestroName}, originalmente prevista para {slotVisitorLocal} (tu hora · {visitorTimezone}), queda cancelada.

Si querés volver a coordinar un encuentro, podés enviar una nueva solicitud desde el sitio. Gracias por tu comprensión.

Con claridad,
{brandOwnerName} · Astrologia de Luz`,
};

// AC-2.5.2 + AC-3.8.4: contains the verbatim 24h+single-use sentence per
// MEGA CP-2 hook resolution 5. Auth.js v5's Resend provider performs the
// {url} substitution; the rest of the body stays static.
const magicLinkBody: EmailSlot = {
  subject: 'Tu enlace para entrar al panel',
  html: `<p>Hola,</p>

<p>Hacé clic en el siguiente enlace para entrar al panel de Astrologia de Luz:</p>

<p><a href="{url}">{url}</a></p>

<p>Este enlace expira en 24 horas y solo puede usarse una vez.</p>

<p>Si no fuiste vos quien pidió este acceso, podés ignorar este correo.</p>`,
  text: `Hola,

Hacé clic en el siguiente enlace para entrar al panel de Astrologia de Luz:

{url}

Este enlace expira en 24 horas y solo puede usarse una vez.

Si no fuiste vos quien pidió este acceso, podés ignorar este correo.`,
};

// AC-3.2.3: subject MUST begin with [FALLBACK] (MEGA CP-3 priming note 2) so
// the maestro's inbox preview surfaces the channel-degradation reason at a
// glance. Body explains the degradation so the maestro knows to capture their
// chat_id via the /start onboarding flow (AC-3.7).
const maestroFallback: EmailSlot = {
  subject: '[FALLBACK] Nueva solicitud — {visitorName}',
  html: `<p>Hola {maestroName},</p>

<p>Nueva solicitud para una sesión con vos:</p>

<ul>
  <li><strong>{slotMaestroLocal}</strong> (hora de {maestroName} · {maestroTimezone})</li>
  <li>Visitante: {visitorName} &lt;{visitorEmail}&gt;</li>
  <li>Contacto preferido: {contactChannel} · {contactValue}</li>
  <li>Intención: {visitorIntent}</li>
</ul>

<p>Este correo es un canal de respaldo: no encontramos un Telegram chat_id configurado en tu perfil. Cuando lo capturemos vía /start del bot, las próximas solicitudes llegan ahí en segundos.</p>

<p>Podés aceptar o rechazar la solicitud desde el panel de Astrologia de Luz.</p>`,
  text: `Hola {maestroName},

Nueva solicitud para una sesión con vos:

- {slotMaestroLocal} (hora de {maestroName} · {maestroTimezone})
- Visitante: {visitorName} <{visitorEmail}>
- Contacto preferido: {contactChannel} · {contactValue}
- Intención: {visitorIntent}

Este correo es un canal de respaldo: no encontramos un Telegram chat_id configurado en tu perfil. Cuando lo capturemos vía /start del bot, las próximas solicitudes llegan ahí en segundos.

Podés aceptar o rechazar la solicitud desde el panel de Astrologia de Luz.`,
};

export const CONTENT_EMAIL = {
  PUBLIC: {
    visitorRequestReceived,
    visitorConfirmed,
    visitorDeclined,
    visitorCancelled,
  },
  PANEL: {
    AUTH: {
      magicLinkBody,
    },
    EMAIL: {
      // AC-3.8.3 alias — `decline` is the spec's PANEL-side name for the
      // same Spanish polite-decline body referenced from PUBLIC. Same
      // object reference so a future-edit of one updates both views.
      decline: visitorDeclined,
      maestroFallback,
    },
  },
} as const;

// Foundation-phase sentinel — G_C-1 install-smoke pairing asserts this
// through the barrel. Removed by a future janitorial sweep once all three
// section files (public.ts + panel.ts + email.ts) carry real content.
export const __CONTENT_EMAIL_SCAFFOLD = true;
