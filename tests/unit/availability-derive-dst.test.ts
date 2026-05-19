/**
 * G_C-7 pairing — pure slot derivation. Spec anchors: AC-1.2.5, AC-1.2.6,
 * AC-2.1.4, R-1.
 *
 * What this catches:
 *   - Server-local Date arithmetic creeping back in (would fail in Europe/Madrid
 *     under DST: a 10:00 slot before March 29 vs after must produce DIFFERENT
 *     UTC values, since CET→CEST flips the offset by an hour).
 *   - Argentina (no DST since 2009) silently picking up a phantom DST shift —
 *     would happen if the derive helper assumed every TZ behaved like Europe.
 *   - The DST-spring-forward gap silently emitting a non-existent local slot
 *     (Europe/Madrid 02:30 on the transition Sunday: the local clock skips
 *     from 02:00 straight to 03:00, so 02:30 is unbookable).
 *   - The already-confirmed subtraction comparing by reference / Date object
 *     identity instead of by UTC instant.
 *   - Blackout dates being skipped only for the FIRST blackout in the array,
 *     or vice-versa (a Set lookup bug).
 *   - A partial slot at the tail of a window being emitted (10:00→11:30 with
 *     60-min duration should emit ONLY 10:00, never 11:00 — the slot would
 *     exceed the window).
 *   - The `availability.tz` override never being consulted (fallback to
 *     teacherTz used even when the row sets its own tz).
 *
 * The DST anchors picked here are real: Europe/Madrid spring-forward in 2026
 * lands on Sunday 2026-03-29, with the clock jumping 02:00 → 03:00 local.
 * Argentina (BSAS) has been UTC-3 year-round since 2009.
 */

import { describe, expect, test } from 'vitest';

import { deriveSlots } from '@/application/booking/derive-availability';
import type { Availability } from '@/domain/booking/availability';

const BSAS = 'America/Argentina/Buenos_Aires';
const MADRID = 'Europe/Madrid';

// Sunday=0 .. Saturday=6.
const SUN = 0;
const MON = 1;
const TUE = 2;

const day = (utcIso: string) => new Date(utcIso);

describe('deriveSlots — basic emission', () => {
  test('returns no slots when availability.windows is empty', () => {
    const avail: Availability = { tz: BSAS, windows: [], blackouts: [] };
    const out = deriveSlots({
      availability: avail,
      teacherTz: BSAS,
      rangeStartUtc: day('2026-06-01T00:00:00Z'),
      rangeEndUtc: day('2026-06-15T00:00:00Z'),
    });
    expect(out).toEqual([]);
  });

  test('emits N slots for a single window of N*duration minutes', () => {
    // Monday 09:00-12:00 BSAS = 12:00-15:00Z. 60min slots → 3.
    // Range covers Mon 2026-06-01 (which IS a Monday).
    const avail: Availability = {
      tz: BSAS,
      windows: [{ weekday: MON, start: '09:00', end: '12:00' }],
      blackouts: [],
    };
    const out = deriveSlots({
      availability: avail,
      teacherTz: BSAS,
      rangeStartUtc: day('2026-06-01T00:00:00Z'),
      rangeEndUtc: day('2026-06-02T00:00:00Z'),
    });
    expect(out.map((d) => d.toISOString())).toEqual([
      '2026-06-01T12:00:00.000Z',
      '2026-06-01T13:00:00.000Z',
      '2026-06-01T14:00:00.000Z',
    ]);
  });

  test('drops the trailing partial slot when duration does not divide the window', () => {
    // Monday 09:00-11:30 BSAS, 60min → 09:00 only (10:00 + 60 = 11:00 ≤ 11:30 ✓
    // → also 10:00 emits). Actually 09:00 → emits, 10:00 → 10:00+60=11:00 ≤ 11:30 → emits,
    // 11:00 → 11:00+60=12:00 > 11:30 → dropped. So 2 slots.
    const avail: Availability = {
      tz: BSAS,
      windows: [{ weekday: MON, start: '09:00', end: '11:30' }],
      blackouts: [],
    };
    const out = deriveSlots({
      availability: avail,
      teacherTz: BSAS,
      rangeStartUtc: day('2026-06-01T00:00:00Z'),
      rangeEndUtc: day('2026-06-02T00:00:00Z'),
    });
    expect(out.map((d) => d.toISOString())).toEqual([
      '2026-06-01T12:00:00.000Z',
      '2026-06-01T13:00:00.000Z',
    ]);
  });

  test('emits multiple windows on the same weekday in chronological order', () => {
    const avail: Availability = {
      tz: BSAS,
      windows: [
        { weekday: TUE, start: '09:00', end: '10:00' },
        { weekday: TUE, start: '15:00', end: '16:00' },
      ],
      blackouts: [],
    };
    // 2026-06-02 is a Tuesday.
    const out = deriveSlots({
      availability: avail,
      teacherTz: BSAS,
      rangeStartUtc: day('2026-06-02T00:00:00Z'),
      rangeEndUtc: day('2026-06-03T00:00:00Z'),
    });
    expect(out.map((d) => d.toISOString())).toEqual([
      '2026-06-02T12:00:00.000Z',
      '2026-06-02T18:00:00.000Z',
    ]);
  });
});

describe('deriveSlots — blackouts + already-confirmed subtraction', () => {
  test('skips slots whose LOCAL date is in blackouts[]', () => {
    const avail: Availability = {
      tz: BSAS,
      windows: [{ weekday: MON, start: '09:00', end: '10:00' }],
      blackouts: [{ date: '2026-06-08' }], // skip the second Monday in range
    };
    // Range covers Mon June 1, Mon June 8 (blacked-out), Mon June 15.
    // End is half-open so June 15 itself is in-range up to (but not including)
    // its UTC midnight — well after the 12:00Z slot.
    const out = deriveSlots({
      availability: avail,
      teacherTz: BSAS,
      rangeStartUtc: day('2026-06-01T00:00:00Z'),
      rangeEndUtc: day('2026-06-16T00:00:00Z'),
    });
    expect(out.map((d) => d.toISOString())).toEqual([
      '2026-06-01T12:00:00.000Z',
      '2026-06-15T12:00:00.000Z',
    ]);
  });

  test('subtracts already-confirmed UTC starts (compared by ISO instant)', () => {
    const avail: Availability = {
      tz: BSAS,
      windows: [{ weekday: MON, start: '09:00', end: '12:00' }],
      blackouts: [],
    };
    const out = deriveSlots({
      availability: avail,
      teacherTz: BSAS,
      rangeStartUtc: day('2026-06-01T00:00:00Z'),
      rangeEndUtc: day('2026-06-02T00:00:00Z'),
      alreadyConfirmedUtc: [day('2026-06-01T13:00:00.000Z')], // remove the middle one
    });
    expect(out.map((d) => d.toISOString())).toEqual([
      '2026-06-01T12:00:00.000Z',
      '2026-06-01T14:00:00.000Z',
    ]);
  });
});

describe('deriveSlots — DST correctness (R-1)', () => {
  test('Europe/Madrid: a 10:00-local slot before DST is at 09:00Z, after DST is at 08:00Z', () => {
    const avail: Availability = {
      tz: MADRID,
      windows: [{ weekday: SUN, start: '10:00', end: '11:00' }],
      blackouts: [],
    };
    // Bracket spring-forward Sunday 2026-03-29:
    //   2026-03-22 (Sun, CET, offset +01:00) → 10:00 local = 09:00Z
    //   2026-04-05 (Sun, CEST, offset +02:00) → 10:00 local = 08:00Z
    const out = deriveSlots({
      availability: avail,
      teacherTz: MADRID,
      rangeStartUtc: day('2026-03-22T00:00:00Z'),
      rangeEndUtc: day('2026-04-06T00:00:00Z'),
    });
    const iso = out.map((d) => d.toISOString());
    expect(iso).toContain('2026-03-22T09:00:00.000Z'); // pre-DST: +01:00 offset
    expect(iso).toContain('2026-03-29T08:00:00.000Z'); // DST transition Sunday: window starts at 10:00 CEST
    expect(iso).toContain('2026-04-05T08:00:00.000Z'); // post-DST: +02:00 offset
  });

  test('Europe/Madrid: silently drops the non-existent 02:30 spring-forward slot', () => {
    // Clock jumps 02:00 → 03:00 local on Sun 2026-03-29.
    // A window 02:00-04:00 with 30-minute duration on Sundays would notionally
    // emit 02:00, 02:30, 03:00, 03:30. The 02:30 slot does not exist locally;
    // derive must drop it. The 02:00 slot is ALSO unstable — fromZonedTime
    // collapses 02:00 to the pre-transition offset, but the roundtrip lands at
    // 03:00 (the wall clock that DID happen), so it ALSO gets dropped.
    // 03:00 and 03:30 are unambiguous post-transition local times → kept.
    const avail: Availability = {
      tz: MADRID,
      windows: [{ weekday: SUN, start: '02:00', end: '04:00' }],
      blackouts: [],
    };
    const out = deriveSlots({
      availability: avail,
      teacherTz: MADRID,
      durationMinutes: 30,
      rangeStartUtc: day('2026-03-29T00:00:00Z'),
      rangeEndUtc: day('2026-03-30T00:00:00Z'),
    });
    const iso = out.map((d) => d.toISOString());
    // After DST applied, 03:00 CEST = 01:00Z and 03:30 CEST = 01:30Z.
    expect(iso).toContain('2026-03-29T01:00:00.000Z');
    expect(iso).toContain('2026-03-29T01:30:00.000Z');
    // The non-existent 02:30 (and the ambiguous 02:00) must NOT appear.
    // Their would-be UTC equivalents under the pre-transition offset are
    // 01:00Z and 00:30Z — 00:30Z is the giveaway, since post-transition
    // 02:30 has no real UTC representation.
    expect(iso).not.toContain('2026-03-29T00:30:00.000Z');
  });

  test('Argentina/Buenos_Aires (no DST): 10:00 local stays at 13:00Z across the southern-hemisphere spring window', () => {
    // BSAS has been UTC-3 year-round since 2009. A naive "every TZ has DST"
    // implementation would phantom-shift a slot to 12:00Z somewhere in Oct.
    const avail: Availability = {
      tz: BSAS,
      windows: [{ weekday: SUN, start: '10:00', end: '11:00' }],
      blackouts: [],
    };
    // Cover both sides of what WOULD be a DST transition in a +DST country:
    //   2026-10-04 (1st Sun of October) + 2026-10-11 + 2026-10-18.
    const out = deriveSlots({
      availability: avail,
      teacherTz: BSAS,
      rangeStartUtc: day('2026-10-04T00:00:00Z'),
      rangeEndUtc: day('2026-10-19T00:00:00Z'),
    });
    expect(out.map((d) => d.toISOString())).toEqual([
      '2026-10-04T13:00:00.000Z',
      '2026-10-11T13:00:00.000Z',
      '2026-10-18T13:00:00.000Z',
    ]);
  });
});

describe('deriveSlots — tz fallback + range bounds', () => {
  test('availability.tz overrides teacherTz when set (the JSON wins)', () => {
    const avail: Availability = {
      tz: MADRID, // teacher row says BSAS, but availability JSON pins Madrid
      windows: [{ weekday: MON, start: '10:00', end: '11:00' }],
      blackouts: [],
    };
    const out = deriveSlots({
      availability: avail,
      teacherTz: BSAS,
      rangeStartUtc: day('2026-06-01T00:00:00Z'),
      rangeEndUtc: day('2026-06-02T00:00:00Z'),
    });
    // Madrid in June = CEST (+02:00) → 10:00 local = 08:00Z. If the function
    // had used BSAS it would have emitted 13:00Z.
    expect(out.map((d) => d.toISOString())).toEqual(['2026-06-01T08:00:00.000Z']);
  });

  test('falls back to teacherTz when availability.tz is null', () => {
    const avail: Availability = {
      tz: null,
      windows: [{ weekday: MON, start: '10:00', end: '11:00' }],
      blackouts: [],
    };
    const out = deriveSlots({
      availability: avail,
      teacherTz: BSAS,
      rangeStartUtc: day('2026-06-01T00:00:00Z'),
      rangeEndUtc: day('2026-06-02T00:00:00Z'),
    });
    expect(out.map((d) => d.toISOString())).toEqual(['2026-06-01T13:00:00.000Z']);
  });

  test('excludes slots whose UTC start falls outside [rangeStartUtc, rangeEndUtc)', () => {
    const avail: Availability = {
      tz: BSAS,
      windows: [{ weekday: MON, start: '09:00', end: '12:00' }],
      blackouts: [],
    };
    // Tight range starting at 13:00Z (the middle slot) and ending at 14:00Z
    // (which excludes the 14:00Z slot per the half-open interval).
    const out = deriveSlots({
      availability: avail,
      teacherTz: BSAS,
      rangeStartUtc: day('2026-06-01T13:00:00.000Z'),
      rangeEndUtc: day('2026-06-01T14:00:00.000Z'),
    });
    expect(out.map((d) => d.toISOString())).toEqual(['2026-06-01T13:00:00.000Z']);
  });
});
