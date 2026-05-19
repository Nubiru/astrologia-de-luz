/**
 * G_A-8 unit pairing — formatTzDisplay() pure helper.
 *
 * Anchors:
 *   - AC-1.2.8 — TZ display literal: `Zona horaria: <IANA> (UTC<±HH:MM>) · Cambiar`.
 *   - AC-1.2.8 fallback — when `Intl.DateTimeFormat().resolvedOptions().timeZone`
 *     returns empty / null / an invalid IANA name, fall back to
 *     `America/Argentina/Buenos_Aires` (IDENTITY.md `product.timezone`).
 *
 * Strategy: `formatTzDisplay` is exported from `@/components/reservar/SlotGrid`
 * as a pure (Date-injectable) helper. We pin `now` to a known UTC instant
 * outside DST edges so the offset assertions are deterministic on any host.
 */

import { describe, expect, test } from 'vitest';

import { TZ_DISPLAY_FALLBACK, formatTzDisplay } from '@/components/reservar/SlotGrid';

// 2026-05-19T15:00:00Z — well outside both Northern + Southern DST transitions.
// Buenos Aires sits at UTC-03:00 year-round (no DST since 2009);
// Europe/Madrid is on CEST (UTC+02:00) in May;
// America/New_York is on EDT (UTC-04:00) in May.
const FIXED_NOW = new Date('2026-05-19T15:00:00Z');

describe('formatTzDisplay — output shape (AC-1.2.8)', () => {
  test('detected IANA tz renders verbatim with UTC offset + " · Cambiar" suffix', () => {
    const result = formatTzDisplay('America/Argentina/Buenos_Aires', FIXED_NOW);
    expect(result.iana).toBe('America/Argentina/Buenos_Aires');
    expect(result.offsetLabel).toBe('UTC-03:00');
    expect(result.display).toBe(
      'Zona horaria: America/Argentina/Buenos_Aires (UTC-03:00) · Cambiar',
    );
  });

  test('display literal matches the AC-1.2.8 regex `^Zona horaria: \\S.+ \\(UTC[+-]\\d{2}:\\d{2}\\) · Cambiar$`', () => {
    const result = formatTzDisplay('Europe/Madrid', FIXED_NOW);
    const ACRegex = /^Zona horaria: \S.+ \(UTC[+-]\d{2}:\d{2}\) · Cambiar$/;
    expect(result.display).toMatch(ACRegex);
  });

  test('offset format renders as "UTC±HH:MM" (not "GMT…", not bare "+HH")', () => {
    const ny = formatTzDisplay('America/New_York', FIXED_NOW);
    expect(ny.offsetLabel).toMatch(/^UTC[+-]\d{2}:\d{2}$/);
    expect(ny.offsetLabel).not.toMatch(/^GMT/);
    expect(ny.display.includes(ny.offsetLabel)).toBe(true);
  });

  test('UTC tz itself renders as "UTC+00:00" (not bare "GMT")', () => {
    const utc = formatTzDisplay('UTC', FIXED_NOW);
    expect(utc.offsetLabel).toBe('UTC+00:00');
    expect(utc.iana).toBe('UTC');
  });
});

describe('formatTzDisplay — fallback (AC-1.2.8 fallback)', () => {
  test('null detected tz falls back to America/Argentina/Buenos_Aires', () => {
    const result = formatTzDisplay(null, FIXED_NOW);
    expect(result.iana).toBe(TZ_DISPLAY_FALLBACK);
    expect(result.iana).toBe('America/Argentina/Buenos_Aires');
    expect(result.display).toContain('America/Argentina/Buenos_Aires');
    expect(result.display.endsWith(' · Cambiar')).toBe(true);
  });

  test('undefined detected tz falls back', () => {
    const result = formatTzDisplay(undefined, FIXED_NOW);
    expect(result.iana).toBe(TZ_DISPLAY_FALLBACK);
  });

  test('empty-string detected tz falls back (Intl returns "" on some headless browsers)', () => {
    const result = formatTzDisplay('', FIXED_NOW);
    expect(result.iana).toBe(TZ_DISPLAY_FALLBACK);
  });

  test('whitespace-only detected tz falls back', () => {
    const result = formatTzDisplay('   ', FIXED_NOW);
    expect(result.iana).toBe(TZ_DISPLAY_FALLBACK);
  });

  test('invalid IANA name falls back (Intl throws on the candidate)', () => {
    const result = formatTzDisplay('Not/A/Real/Zone', FIXED_NOW);
    expect(result.iana).toBe(TZ_DISPLAY_FALLBACK);
    expect(result.offsetLabel).toBe('UTC-03:00');
  });

  test('fallback IANA renders with the AC-1.2.8 offset format', () => {
    const result = formatTzDisplay(null, FIXED_NOW);
    expect(result.offsetLabel).toMatch(/^UTC[+-]\d{2}:\d{2}$/);
    expect(result.display).toBe(
      'Zona horaria: America/Argentina/Buenos_Aires (UTC-03:00) · Cambiar',
    );
  });
});

describe('formatTzDisplay — failure mode invariants', () => {
  test('return value is always a fully-populated record (never undefined fields)', () => {
    const cases: ReadonlyArray<string | null | undefined> = [
      null,
      undefined,
      '',
      'America/Argentina/Buenos_Aires',
      'America/New_York',
      'invalid',
    ];
    for (const candidate of cases) {
      const result = formatTzDisplay(candidate, FIXED_NOW);
      expect(typeof result.iana).toBe('string');
      expect(result.iana.length).toBeGreaterThan(0);
      expect(typeof result.offsetLabel).toBe('string');
      expect(result.offsetLabel).toMatch(/^UTC[+-]\d{2}:\d{2}$/);
      expect(typeof result.display).toBe('string');
      expect(result.display.startsWith('Zona horaria: ')).toBe(true);
      expect(result.display.endsWith(' · Cambiar')).toBe(true);
    }
  });
});
