/**
 * G_C-7 pairing — availability JSON shape (AC-2.1.4 + AC-1.6.4).
 *
 * What this catches:
 *   - The `tz` key is silently allowed to go missing (a future "tz is always
 *     overridden by teachers.timezone, drop it" PR would break the documented
 *     contract that `null` means "fall back" but absent means "broken row").
 *   - The HH:MM regex is loosened (e.g. accepts `9:00` or `25:00` or `12:60`)
 *     — the day-strip + slot picker assume well-formed `HH:MM` strings; a
 *     malformed string would crash `Number(...)` parsing in deriveSlots.
 *   - The `start < end` refinement is dropped — `09:00→09:00` would emit zero
 *     slots silently; `12:00→09:00` would emit a negative range and never
 *     iterate. Both look "valid" without the refinement.
 *   - The past-blackout rejection on write is dropped (AC-1.6.4) — Augusto
 *     could persist stale blackouts that confuse the panel UI forever.
 *   - Empty windows/blackouts arrays are wrongly rejected (the spec
 *     explicitly permits both — a freshly-seeded teacher row has both empty).
 */

import { describe, expect, test } from 'vitest';

import { AvailabilityShape, availabilityWriteSchema } from '@/domain/booking/availability';

const VALID = {
  tz: 'America/Argentina/Buenos_Aires',
  windows: [{ weekday: 1, start: '09:00', end: '12:00' }],
  blackouts: [{ date: '2099-12-31' }],
};

describe('AvailabilityShape — AC-2.1.4 shape gate', () => {
  test('accepts a well-formed availability row', () => {
    const r = AvailabilityShape.safeParse(VALID);
    expect(r.success).toBe(true);
  });

  test('accepts tz: null (means "fall back to teachers.timezone")', () => {
    const r = AvailabilityShape.safeParse({ ...VALID, tz: null });
    expect(r.success).toBe(true);
  });

  test('rejects a row with the tz key missing entirely', () => {
    const { tz: _ignored, ...withoutTz } = VALID;
    const r = AvailabilityShape.safeParse(withoutTz);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join('.') === 'tz')).toBe(true);
    }
  });

  test('rejects malformed HH:MM in window.start', () => {
    const cases = ['9:00', '25:00', '12:60', '12-00', '12:0', ''];
    for (const bad of cases) {
      const r = AvailabilityShape.safeParse({
        ...VALID,
        windows: [{ weekday: 1, start: bad, end: '23:00' }],
      });
      expect(r.success, `expected to reject start="${bad}"`).toBe(false);
    }
  });

  test('rejects window with start >= end', () => {
    for (const [start, end] of [
      ['12:00', '09:00'],
      ['09:00', '09:00'],
    ] as const) {
      const r = AvailabilityShape.safeParse({
        ...VALID,
        windows: [{ weekday: 1, start, end }],
      });
      expect(r.success, `expected to reject ${start}→${end}`).toBe(false);
    }
  });

  test('rejects weekday outside 0..6', () => {
    for (const bad of [-1, 7, 1.5]) {
      const r = AvailabilityShape.safeParse({
        ...VALID,
        windows: [{ weekday: bad, start: '09:00', end: '12:00' }],
      });
      expect(r.success, `expected to reject weekday=${bad}`).toBe(false);
    }
  });

  test('accepts empty windows[] (a brand-new maestro has none)', () => {
    const r = AvailabilityShape.safeParse({
      tz: 'America/Argentina/Buenos_Aires',
      windows: [],
      blackouts: [],
    });
    expect(r.success).toBe(true);
  });

  test('rejects blackout date that is not YYYY-MM-DD', () => {
    for (const bad of ['2026/05/18', '18-05-2026', '2026-5-18', '20260518']) {
      const r = AvailabilityShape.safeParse({
        ...VALID,
        blackouts: [{ date: bad }],
      });
      expect(r.success, `expected to reject blackout date="${bad}"`).toBe(false);
    }
  });
});

describe('availabilityWriteSchema — AC-1.6.4 write-time past-blackout reject', () => {
  const NOW = new Date('2026-05-18T12:00:00Z');

  test('rejects a blackout strictly before today (yesterday)', () => {
    const schema = availabilityWriteSchema({ now: NOW });
    const r = schema.safeParse({ ...VALID, blackouts: [{ date: '2026-05-17' }] });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path.join('.') === 'blackouts.0.date');
      expect(issue, 'expected an issue at blackouts.0.date').toBeDefined();
    }
  });

  test('accepts a blackout on today', () => {
    const schema = availabilityWriteSchema({ now: NOW });
    const r = schema.safeParse({ ...VALID, blackouts: [{ date: '2026-05-18' }] });
    expect(r.success).toBe(true);
  });

  test('accepts a blackout strictly after today', () => {
    const schema = availabilityWriteSchema({ now: NOW });
    const r = schema.safeParse({ ...VALID, blackouts: [{ date: '2099-12-31' }] });
    expect(r.success).toBe(true);
  });
});
