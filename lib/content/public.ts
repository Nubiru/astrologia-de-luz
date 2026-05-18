/**
 * Pool-a section: visitor-facing UI strings (HOME.* + RESERVAR.*).
 *
 * Spec anchors: AC-1.1.5, AC-1.1.7, AC-1.1.9, AC-1.1.10, AC-3.8.1, AC-3.8.2,
 *               §15.1.
 *
 * Voice: íntima pero no familiar, erudita pero no distante, mística pero no
 * esotérica (IDENTITY.md). Slots are seeded with voice-aligned defaults per
 * the briefs in `.context/active/right-now/augusto-input-required.md` §A —
 * Augusto's real copy lands via admin-edit in v1.1 (R-10 in S-1).
 *
 * Scope-by-task — G_A-4 seeds HOME.hero only; G_A-5 adds HOME.problemas +
 * HOME.servicios; G_A-6 (this) closes HOME with sobre + testimonios + faq +
 * ctaFinal; G_A-7..G_A-9 add the RESERVAR.* namespace.
 *
 * Cross-pool reads: two FAQ entries (AC-3.8.1 SLA + AC-3.8.2 cancellation
 * policy) reference `CONTENT_PANEL.LANDING.sla.text` /
 * `CONTENT_PANEL.RESERVAR.cancellation.text`. Per the spec these strings are
 * panel-controlled (admin-editable in v1.1) — pool-a READS them via the
 * sibling section file but never WRITES (CP-4 D-029 pool-isolation rule).
 *
 * Wordmark literal — AC-1.1.7 — is "ASTROLOGIA DE LUZ" (uppercase, regular
 * spaces). The brand-manual.html "ASTRALUMEN" wordmark is explicitly NOT
 * adopted (NOTIFICATIONS 2026-05-17T17:31Z NAME-RESOLVED). Pairing
 * `tests/unit/wordmark-not-astralumen.test.ts` asserts this invariant at
 * every G_A-* close.
 */

import { CONTENT_PANEL } from './panel';

const HOME = {
  /* ────────────────────────────────────────────────────────────────────── *
   * HERO (S1) — AC-1.1.5 / AC-1.1.6 / AC-1.1.7 anchored.
   *
   *   - `eyebrow` is the brand wordmark, rendered as <p>/<div> NOT <h1>
   *     (AC-1.1.6 heading hierarchy).
   *   - `h1` is the single <h1> on the home page; ≤12 palabras (O-6 §C
   *     hero shape) — the emotional claim, not the technical service.
   *   - `sub` is the positioning sentence; ≤22 palabras (O-6 §C).
   *   - `cta` lands every section's "Reservar" affordance at /reservar
   *     (AC-1.1.4) — string text comes from THIS slot, not hard-coded.
   * ────────────────────────────────────────────────────────────────────── */
  hero: {
    eyebrow: 'ASTROLOGIA DE LUZ',
    h1: 'Hay momentos en que necesitás saber por dónde seguir.',
    sub: 'Lectura del cielo con Augusto Rocha. Para personas que buscan claridad antes que respuestas fáciles.',
    cta: {
      text: 'Reservar sesión',
      href: '/reservar',
    },
  },

  /* ────────────────────────────────────────────────────────────────────── *
   * PROBLEMAS (S2) — AC-1.1.2 / AC-1.1.4 anchored; G_A-5.
   *
   * Per playbook §2 ("El foco NO es astrología") + augusto-input §A3 the
   * S2 section opens with the EMOTIONAL problem before the technical
   * answer. 4 cards (within the 3–5 budget) authored from the briefs;
   * each card is ≤12 palabras to keep the eye flow vertical + scannable.
   * Heading + cards land verbatim until Augusto's admin edits arrive (R-10).
   * ────────────────────────────────────────────────────────────────────── */
  problemas: {
    heading: 'En qué momentos te puedo ayudar',
    items: [
      'Ansiedad sobre decisiones que parecen no tener salida.',
      'Bloqueo creativo o profesional.',
      'Patrones repetidos en relaciones.',
      'Sentirte perdido respecto a tu propósito.',
    ],
    cta: {
      text: 'Reservar sesión',
      href: '/reservar',
    },
  },

  /* ────────────────────────────────────────────────────────────────────── *
   * SERVICIOS (S3) — AC-1.1.4 anchored; G_A-5.
   *
   * Per playbook §3 ("3-6 ofertas claras") + O-6 §S3 recommendation, v1.0
   * ships exactly 3 offerings. Each card carries name + duration + `resultado`
   * (≤18 palabras per O-6 §C "qué se LLEVA, no la mecánica") so the visitor
   * reads outcome-language, NOT astrology jargon (avoid "casas", "tránsitos",
   * "aspectos" per augusto-input §A4 conversion-aligned voice).
   * ────────────────────────────────────────────────────────────────────── */
  servicios: {
    heading: 'Cómo trabajamos',
    items: [
      {
        name: 'Lectura natal',
        duration: '1 hora',
        resultado: 'Descubrí cómo está armado tu mapa y qué te pide cada parte de él.',
      },
      {
        name: 'Revolución solar',
        duration: '1 hora',
        resultado: 'Una guía del año que empieza con tu cumpleaños y dónde poner energía.',
      },
      {
        name: 'Sesión de orientación',
        duration: '1 hora',
        resultado:
          'Una pregunta concreta, una hora para abrirla y salir con un próximo paso claro.',
      },
    ],
    cta: {
      text: 'Reservar sesión',
      href: '/reservar',
    },
  },

  /* ────────────────────────────────────────────────────────────────────── *
   * SOBRE (S4) — AC-1.1.9 / AC-1.1.10 anchored; G_A-6.
   *
   * v1.0 home renders EXACTLY ONE teacher card on /, the brand owner
   * Augusto. Other maestros (added via panel CRUD post-v1.0) appear at
   * /reservar, NOT on the home page (O-6 §B3 ruling iii — brand-and-discovery
   * separation). The Sobre-component invariant asserts `count === 1`.
   *
   * Bio: 150–250 palabras, first-person, voice-aligned. Seeded placeholder
   * until Augusto's real bio lands via admin-edit (R-10 NOT a launch blocker).
   * ────────────────────────────────────────────────────────────────────── */
  sobre: {
    heading: 'Sobre Augusto',
    augusto: {
      name: 'Augusto Rocha',
      role: 'Astrólogo · Lectura evolutiva',
      portraitUrl: '/portraits/augusto.jpg',
      portraitAlt: 'Retrato de Augusto Rocha',
      bio: [
        'Acompaño a personas hispanohablantes en momentos de claridad y decisión a través de la astrología. Llegué a este lenguaje hace años buscando una herramienta que dialogara con la vida, no que la prescribiera — y me quedé porque encontré exactamente eso. Desde entonces no dejé de estudiar, de leer cartas, y de aprender de cada persona que se sienta a conversar conmigo.',
        'Trabajo desde la tradición evolutiva: la carta natal no decide tu vida; te muestra los materiales con los que estás construyendo y dónde están las preguntas que vale la pena hacerse ahora. En una sesión no esperes diagnósticos ni predicciones. Esperá un espacio para mirar tu momento con más perspectiva, en compañía de alguien que escucha sin prisa y sin juicio.',
        'Doy sesiones de una hora por videollamada, en español, a personas de toda Latinoamérica y España. La primera vez suele ser una mezcla de curiosidad y nervios — es completamente normal. Llevame tu pregunta más honesta, aunque todavía no sepas formularla del todo, y desde ahí trabajamos juntos.',
      ],
    },
    cta: {
      text: 'Reservar sesión',
      href: '/reservar',
    },
  },

  /* ────────────────────────────────────────────────────────────────────── *
   * TESTIMONIOS (S5) — AC-1.1.4 / AC-1.1.10 anchored; G_A-6.
   *
   * Per playbook §5 + augusto-input §A4 — 30–80 palabras each, conversion-
   * aligned voice ("me ayudó a entender", "salí con claridad"), NO
   * astrology jargon (no "casas/tránsitos/aspectos"). Seeded placeholders
   * until Augusto's real testimonios arrive via admin-edit (R-10).
   *
   * Three is the playbook minimum + AC-1.2.11 also reads the first 2 from
   * this slot on the /reservar booking surface, so keep ≥ 2 at all times.
   * ────────────────────────────────────────────────────────────────────── */
  testimonios: {
    heading: 'Lo que dice quien ya pasó por una sesión',
    items: [
      {
        quote:
          'Salí de la sesión con claridad sobre algo que llevaba meses dando vueltas. No me dijo qué hacer, me ayudó a ver lo que yo ya sabía pero no me animaba a nombrar.',
        name: 'Lucía M.',
        city: 'Buenos Aires',
      },
      {
        quote:
          'Augusto escucha de un modo que ya es media respuesta. Sentí que mi historia tenía sentido aunque yo no lo viera del todo. Me fui con preguntas mejores, no con respuestas prestadas.',
        name: 'Sebastián R.',
        city: 'Santiago',
      },
      {
        quote:
          'Llegué pidiendo una lectura natal y me fui con un cambio de dirección. Es la primera vez que la astrología me sirve para algo concreto, no como horóscopo sino como herramienta para pensar mi propia vida.',
        name: 'Martina A.',
        city: 'Ciudad de México',
      },
    ],
    cta: {
      text: 'Reservar sesión',
      href: '/reservar',
    },
  },

  /* ────────────────────────────────────────────────────────────────────── *
   * FAQ (S6) — AC-1.1.4 / AC-1.1.10 / AC-1.1.11 / AC-3.8.1 / AC-3.8.2.
   *
   * Renders as native <details>/<summary> (AC-1.1.11) — no JS required.
   * No section-level CTA (AC-1.1.4 — FAQ "softens").
   *
   * Two entries pull from CONTENT_PANEL (the canonical SLA + cancellation
   * slots are admin-controlled in v1.1):
   *   - "¿Cuánto tardás en responder?"  → CONTENT_PANEL.LANDING.sla.text
   *   - "¿Puedo cancelar o reagendar?"  → CONTENT_PANEL.RESERVAR.cancellation.text
   * AC-3.8.1 / AC-3.8.2 require those strings to appear verbatim across
   * three / two surfaces respectively — the FAQ is one of them.
   * ────────────────────────────────────────────────────────────────────── */
  faq: {
    heading: 'Preguntas frecuentes',
    items: [
      {
        q: '¿Qué es una sesión y cuánto dura?',
        a: 'Una hora por videollamada. Empezamos con tu pregunta y desde ahí miramos tu carta. Sin agenda fija — el ritmo lo marca lo que aparece.',
      },
      {
        q: '¿Necesito traer mi carta natal?',
        a: 'No. Si me pasás tu fecha, hora y lugar de nacimiento al reservar, llego con el mapa listo.',
      },
      {
        q: '¿Tengo que creer en la astrología para que funcione?',
        a: 'No. Sirve como espejo, no como dogma. Si te interesa mirar tu vida con un lenguaje nuevo, alcanza con eso.',
      },
      {
        q: '¿Cómo es el pago?',
        a: 'Por ahora se acuerda al confirmar la sesión. Aceptamos transferencia o las plataformas que sean prácticas para vos.',
      },
      {
        q: '¿Cuánto tardás en responder?',
        a: CONTENT_PANEL.LANDING.sla.text,
      },
      {
        q: '¿Puedo cancelar o reagendar?',
        a: CONTENT_PANEL.RESERVAR.cancellation.text,
      },
      {
        q: '¿Las sesiones son confidenciales?',
        a: 'Sí. Lo que se habla en la sesión queda entre vos y yo.',
      },
    ],
  },

  /* ────────────────────────────────────────────────────────────────────── *
   * CTA-FINAL (S7) — AC-1.1.4 / AC-1.1.10; G_A-6.
   *
   * Short emotional line (≤18 palabras per O-6 §7) + final CTA to /reservar.
   * Section sits on dark bg (matches the alternating rhythm — S7 = dark per
   * AC-1.1.3) like brand-manual's back-cover treatment.
   * ────────────────────────────────────────────────────────────────────── */
  ctaFinal: {
    line: 'Cuando estés listo para mirar tu próximo paso con más claridad, el cielo está disponible.',
    cta: {
      text: 'Reservar sesión',
      href: '/reservar',
    },
  },
} as const;

/* ──────────────────────────────────────────────────────────────────────── *
 * RESERVAR namespace — /reservar booking surface. G_A-7 seeds the shell +
 * picker copy; G_A-8 will add day-strip + slot-grid strings; G_A-9 will add
 * form labels + confirmation panel + dual-TZ rendering copy.
 *
 * Spec anchors: AC-1.2.1, AC-1.2.3, AC-1.2.4, §15.1.
 * ──────────────────────────────────────────────────────────────────────── */
const RESERVAR = {
  /** `<h1>` text — AC-1.2.1 requires textContent to match /Reservar tu sesión/. */
  heading: 'Reservar tu sesión',

  /**
   * Default sub-headline rendered when ≥ 2 active maestros (visitor picks
   * one). Static copy.
   */
  subDefault: 'Elegí un maestro y un horario que te quede cómodo.',

  /**
   * Sub-headline rendered when EXACTLY 1 active maestro (the seeded Augusto-
   * only state) — AC-1.2.4 mandates the maestro is named ONCE in the hero.
   * `{name}` is substituted at render time with the maestro's display name.
   */
  subWithMaestroTemplate: 'Reservar con {name}',

  /**
   * Picker step copy — AC-1.2.3 requires the radiogroup to carry
   * `aria-label="Elegí un maestro"` so `pickerHeading` doubles as the
   * radiogroup aria-label literal.
   */
  pickerHeading: 'Elegí un maestro',
  pickerChooseLabel: 'Elegir',
  pickerCardBioFallback: '', // empty fallback when a maestro row has no bio yet

  /**
   * Step eyebrow labels rendered above each visible step. Eyebrow numbering
   * is derived at render time so the `picker` step's omission (AC-1.2.4)
   * shifts the remaining three steps from 2/3/4 to 1/2/3 automatically.
   */
  stepLabels: {
    maestro: 'Maestro',
    dia: 'Día',
    horario: 'Horario',
    form: 'Tus datos',
  },

  /**
   * Step-placeholder body copy — G_A-7 ships the shell + picker; the día /
   * horario / form bodies land in G_A-8 / G_A-9. These placeholder lines
   * make the empty step containers visible to QA + the e2e specs that count
   * visible steps in DOM order (AC-1.2.2).
   */
  stepPlaceholders: {
    dia: 'Disponibilidad próxima en 14 días.',
    horario: 'Horarios disponibles según el día elegido.',
    form: 'Completá tus datos y una intención breve para la sesión.',
  },
} as const;

export const CONTENT_PUBLIC = {
  HOME,
  RESERVAR,
} as const;

// Foundation-phase sentinel — `tests/ci/install-smoke.spec.ts:150` asserts the
// barrel re-exports this constant. Drop in the same task that completes the
// HOME namespace (G_A-6), once install-smoke's barrel-presence assertion can
// switch to `CONTENT_PUBLIC.HOME.*` directly.
export const __CONTENT_PUBLIC_SCAFFOLD = true;
