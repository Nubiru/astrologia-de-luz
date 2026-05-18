/**
 * G_C-18 pairing — CONTENT_EMAIL slot smoke.
 *
 * Spec anchors: AC-2.5.2, AC-3.2.3, AC-3.2.4, AC-3.4.2, AC-3.8.3, AC-3.8.4.
 *
 * What this catches:
 *   - A named slot is dropped or renamed — downstream dispatcher (G_C-13 /
 *     G_C-14) hits `undefined` at send time.
 *   - An email body is silently truncated below the smoke threshold.
 *   - The interpolation contract drifts (visitorRequestReceived loses
 *     {sla} → visitor confirmation reads as a robotic acknowledgement).
 *   - The magic-link body loses the verbatim 24h+single-use sentence
 *     (AC-3.8.4 verbatim guarantee broken).
 *   - The decline body gains a `{reason}` placeholder (AC-3.8.3 forbids
 *     reason-disclosure for relationship-quality reasons).
 *   - The maestroFallback subject loses the [FALLBACK] prefix
 *     (the inbox-preview channel-degradation signal vanishes).
 *   - The PANEL.EMAIL.decline alias diverges from PUBLIC.visitorDeclined
 *     (the same Spanish body shipped to the visitor from two paths starts
 *     to drift).
 */

import { describe, expect, test } from 'vitest';

import { CONTENT_EMAIL, type EmailSlot } from '@/lib/content/email';

const MIN_BODY_CHARS = 50; // AC-2.5.2 smoke
const DECLINE_MIN_CHARS = 80; // AC-3.8.3 substantive body

const isSlot = (s: unknown): s is EmailSlot =>
  typeof s === 'object' &&
  s !== null &&
  typeof (s as EmailSlot).subject === 'string' &&
  typeof (s as EmailSlot).html === 'string' &&
  typeof (s as EmailSlot).text === 'string';

const PUBLIC_SLOTS = [
  'visitorRequestReceived',
  'visitorConfirmed',
  'visitorDeclined',
  'visitorCancelled',
] as const;

describe('CONTENT_EMAIL.PUBLIC — visitor-facing transactional bodies', () => {
  test.each(PUBLIC_SLOTS)('%s exports subject + html + text strings', (name) => {
    const slot = CONTENT_EMAIL.PUBLIC[name];
    expect(isSlot(slot)).toBe(true);
  });

  test.each(PUBLIC_SLOTS)('%s text body has substantive copy (≥ smoke chars)', (name) => {
    const slot = CONTENT_EMAIL.PUBLIC[name];
    expect(slot.text.length).toBeGreaterThanOrEqual(MIN_BODY_CHARS);
  });

  test.each(PUBLIC_SLOTS)('%s html body has substantive copy (≥ smoke chars)', (name) => {
    const slot = CONTENT_EMAIL.PUBLIC[name];
    expect(slot.html.length).toBeGreaterThanOrEqual(MIN_BODY_CHARS);
  });

  test.each(PUBLIC_SLOTS)('%s subject carries the brand sign-off', (name) => {
    const slot = CONTENT_EMAIL.PUBLIC[name];
    expect(slot.subject).toContain('Astrologia de Luz');
  });
});

describe('AC-3.2.4 — visitorRequestReceived dual-timezone + SLA contract', () => {
  const slot = CONTENT_EMAIL.PUBLIC.visitorRequestReceived;

  test('subject is the canonical "Recibimos" line', () => {
    expect(slot.subject).toBe('Recibimos tu solicitud — Astrologia de Luz');
  });

  test('body interpolates both visitor + maestro timezones', () => {
    expect(slot.text).toContain('{visitorTimezone}');
    expect(slot.text).toContain('{maestroTimezone}');
  });

  test('body interpolates both dual-TZ slot strings', () => {
    expect(slot.text).toContain('{slotVisitorLocal}');
    expect(slot.text).toContain('{slotMaestroLocal}');
  });

  test('body interpolates the SLA window (AC-3.8.1)', () => {
    expect(slot.text).toContain('{sla}');
  });

  test('body interpolates the contact channel preview', () => {
    expect(slot.text).toContain('{contactChannel}');
  });

  test('body signs off with the brand-owner name', () => {
    expect(slot.text).toContain('{brandOwnerName}');
  });
});

describe('AC-3.4.2 — transition emails (subject contract)', () => {
  test('visitorConfirmed subject', () => {
    expect(CONTENT_EMAIL.PUBLIC.visitorConfirmed.subject).toBe(
      'Sesión confirmada — Astrologia de Luz',
    );
  });

  test('visitorDeclined subject', () => {
    expect(CONTENT_EMAIL.PUBLIC.visitorDeclined.subject).toBe(
      'Sobre tu solicitud — Astrologia de Luz',
    );
  });

  test('visitorCancelled subject', () => {
    expect(CONTENT_EMAIL.PUBLIC.visitorCancelled.subject).toBe(
      'Cambio en tu sesión — Astrologia de Luz',
    );
  });

  test('visitorConfirmed body interpolates dual-TZ slot + contact channel', () => {
    const text = CONTENT_EMAIL.PUBLIC.visitorConfirmed.text;
    expect(text).toContain('{slotVisitorLocal}');
    expect(text).toContain('{slotMaestroLocal}');
    expect(text).toContain('{contactChannel}');
  });

  test('visitorCancelled body references the original slot', () => {
    const text = CONTENT_EMAIL.PUBLIC.visitorCancelled.text;
    expect(text).toContain('{slotVisitorLocal}');
    expect(text).toContain('{maestroName}');
  });
});

describe('AC-3.8.3 — visitorDeclined polite-decline contract', () => {
  const slot = CONTENT_EMAIL.PUBLIC.visitorDeclined;

  test('text body is substantive (≥ 80 chars)', () => {
    expect(slot.text.length).toBeGreaterThanOrEqual(DECLINE_MIN_CHARS);
  });

  test('body signs off with the brand-owner placeholder', () => {
    expect(slot.text).toContain('{brandOwnerName}');
  });

  test('body offers NO concrete reason placeholder (text)', () => {
    expect(slot.text).not.toContain('{reason}');
  });

  test('body offers NO concrete reason placeholder (html)', () => {
    expect(slot.html).not.toContain('{reason}');
  });

  test('PANEL.EMAIL.decline IS the same object as PUBLIC.visitorDeclined (alias)', () => {
    expect(CONTENT_EMAIL.PANEL.EMAIL.decline).toBe(slot);
  });
});

describe('AC-2.5.2 + AC-3.8.4 — magicLinkBody verbatim guarantees', () => {
  const slot = CONTENT_EMAIL.PANEL.AUTH.magicLinkBody;
  const VERBATIM_EXPIRY = 'Este enlace expira en 24 horas y solo puede usarse una vez.';

  test('subject is the panel-entry line', () => {
    expect(slot.subject).toBe('Tu enlace para entrar al panel');
  });

  test('text body is ≥ 50 chars (AC-2.5.2 smoke)', () => {
    expect(slot.text.length).toBeGreaterThanOrEqual(MIN_BODY_CHARS);
  });

  test('text body contains the {url} substitution token', () => {
    expect(slot.text).toContain('{url}');
  });

  test('html body contains the {url} substitution token (clickable anchor)', () => {
    expect(slot.html).toContain('{url}');
  });

  test('text body contains the verbatim 24h+single-use sentence (AC-3.8.4)', () => {
    expect(slot.text).toContain(VERBATIM_EXPIRY);
  });

  test('html body contains the verbatim 24h+single-use sentence too', () => {
    expect(slot.html).toContain(VERBATIM_EXPIRY);
  });
});

describe('AC-3.2.3 — maestroFallback channel-degradation email', () => {
  const slot = CONTENT_EMAIL.PANEL.EMAIL.maestroFallback;

  test('subject begins with the [FALLBACK] prefix (MEGA CP-3 priming note 2)', () => {
    expect(slot.subject).toMatch(/^\[FALLBACK\]/);
  });

  test('subject interpolates the visitor name', () => {
    expect(slot.subject).toContain('{visitorName}');
  });

  test('body explains the degradation cause (telegram chat_id missing)', () => {
    expect(slot.text.toLowerCase()).toMatch(/telegram|chat_id|respaldo/);
  });

  test('body surfaces slot + visitor + contact detail interpolations', () => {
    expect(slot.text).toContain('{slotMaestroLocal}');
    expect(slot.text).toContain('{visitorName}');
    expect(slot.text).toContain('{visitorEmail}');
    expect(slot.text).toContain('{contactChannel}');
    expect(slot.text).toContain('{contactValue}');
    expect(slot.text).toContain('{visitorIntent}');
  });
});
