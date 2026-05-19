/**
 * G_A-9 unit pairing — Form 409 slot-race state reducer (AC-3.6.1).
 *
 * The reducer-of-record is `processSlotTakenResponse(currentFields, currentSlotIso, response)`,
 * exported from `@/components/reservar/Form`. It is the pure function that
 * decides what changes when the server returns 409:
 *   - field values MUST be preserved byte-for-byte (visitor's typing survives)
 *   - the fresh `availableSlots[]` from the server replaces the local slot set
 *   - the previously-selected slot is reported as `takenSlotIso` so the caller
 *     can drop it from selection state
 *   - the server's Spanish error message lands in `toastMessage`
 *
 * Strategy: pure-function under test; vitest in node env; no DOM required.
 */

import { describe, expect, test } from 'vitest';

import { type ReservarFormFields, processSlotTakenResponse } from '@/components/reservar/Form';

const FILLED_FIELDS: ReservarFormFields = {
  visitorName: 'Lucía Martínez',
  visitorEmail: 'lucia@example.test',
  contactPref: 'whatsapp',
  contactValue: '+54 9 11 1234 5678',
  visitorIntent:
    'Hace meses que doy vueltas sobre un cambio laboral; me gustaría mirar el momento con perspectiva.',
  acceptsPending: true,
};

const TAKEN_ISO = '2026-05-20T15:00:00.000Z';

const NEW_SLOTS = [
  '2026-05-20T16:00:00.000Z',
  '2026-05-20T17:00:00.000Z',
  '2026-05-21T14:00:00.000Z',
];

const SERVER_ERROR_ES = 'Ese horario ya no está disponible.';

function slotTakenResponse(availableSlots: ReadonlyArray<string>, error: string = SERVER_ERROR_ES) {
  return { kind: 'slot_taken' as const, error, availableSlots };
}

describe('processSlotTakenResponse — field preservation (AC-3.6.1)', () => {
  test('returns the SAME fields object content byte-for-byte', () => {
    const result = processSlotTakenResponse(FILLED_FIELDS, TAKEN_ISO, slotTakenResponse(NEW_SLOTS));
    expect(result.fields).toEqual(FILLED_FIELDS);
    // Each property pair must match exactly.
    expect(result.fields.visitorName).toBe('Lucía Martínez');
    expect(result.fields.visitorEmail).toBe('lucia@example.test');
    expect(result.fields.contactPref).toBe('whatsapp');
    expect(result.fields.contactValue).toBe('+54 9 11 1234 5678');
    expect(result.fields.visitorIntent.length).toBeGreaterThan(50);
    expect(result.fields.acceptsPending).toBe(true);
  });

  test('preserves empty / partial fields verbatim (does not coerce undefined)', () => {
    const partial: ReservarFormFields = {
      visitorName: '',
      visitorEmail: '',
      contactPref: '',
      contactValue: '',
      visitorIntent: '',
      acceptsPending: false,
    };
    const result = processSlotTakenResponse(partial, null, slotTakenResponse([]));
    expect(result.fields).toEqual(partial);
  });

  test('does not strip whitespace or otherwise normalise the visitor input', () => {
    const padded: ReservarFormFields = {
      ...FILLED_FIELDS,
      visitorName: '  Lucía  ',
      visitorIntent: '\n\nBuenas\n',
    };
    const result = processSlotTakenResponse(padded, TAKEN_ISO, slotTakenResponse(NEW_SLOTS));
    expect(result.fields.visitorName).toBe('  Lucía  ');
    expect(result.fields.visitorIntent).toBe('\n\nBuenas\n');
  });
});

describe('processSlotTakenResponse — slot list replacement (AC-3.6.1)', () => {
  test('newAvailableSlots equals the server payload — server is the source of truth', () => {
    const result = processSlotTakenResponse(FILLED_FIELDS, TAKEN_ISO, slotTakenResponse(NEW_SLOTS));
    expect(result.newAvailableSlots).toEqual(NEW_SLOTS);
  });

  test('empty server availableSlots[] is preserved (no implicit fallback to old list)', () => {
    const result = processSlotTakenResponse(FILLED_FIELDS, TAKEN_ISO, slotTakenResponse([]));
    expect(result.newAvailableSlots).toEqual([]);
  });

  test('server can introduce slots that the client had never seen (e.g., after a panel update)', () => {
    const surprise = ['2026-06-01T13:00:00.000Z'];
    const result = processSlotTakenResponse(FILLED_FIELDS, TAKEN_ISO, slotTakenResponse(surprise));
    expect(result.newAvailableSlots).toEqual(surprise);
  });
});

describe('processSlotTakenResponse — taken slot + toast', () => {
  test('takenSlotIso surfaces the originally-selected slot so the caller can drop selection', () => {
    const result = processSlotTakenResponse(FILLED_FIELDS, TAKEN_ISO, slotTakenResponse(NEW_SLOTS));
    expect(result.takenSlotIso).toBe(TAKEN_ISO);
  });

  test('takenSlotIso is null when no slot was selected (defensive — shouldn’t happen in prod)', () => {
    const result = processSlotTakenResponse(FILLED_FIELDS, null, slotTakenResponse(NEW_SLOTS));
    expect(result.takenSlotIso).toBeNull();
  });

  test('toastMessage equals the server’s Spanish error verbatim', () => {
    const result = processSlotTakenResponse(FILLED_FIELDS, TAKEN_ISO, slotTakenResponse(NEW_SLOTS));
    expect(result.toastMessage).toBe(SERVER_ERROR_ES);
  });

  test('toastMessage forwards alternative server messages without translation', () => {
    const alt = slotTakenResponse(NEW_SLOTS, 'Alguien acaba de tomar ese horario.');
    const result = processSlotTakenResponse(FILLED_FIELDS, TAKEN_ISO, alt);
    expect(result.toastMessage).toBe('Alguien acaba de tomar ese horario.');
  });
});

describe('processSlotTakenResponse — return-shape invariants', () => {
  test('returns a fully-populated record on every call (no undefined keys)', () => {
    const cases: ReadonlyArray<{
      fields: ReservarFormFields;
      slot: string | null;
      slots: ReadonlyArray<string>;
    }> = [
      { fields: FILLED_FIELDS, slot: TAKEN_ISO, slots: NEW_SLOTS },
      { fields: FILLED_FIELDS, slot: null, slots: [] },
      {
        fields: { ...FILLED_FIELDS, acceptsPending: false },
        slot: TAKEN_ISO,
        slots: ['x'],
      },
    ];
    for (const c of cases) {
      const r = processSlotTakenResponse(c.fields, c.slot, slotTakenResponse(c.slots));
      expect(r.fields).toBeDefined();
      expect(Array.isArray(r.newAvailableSlots)).toBe(true);
      expect(typeof r.toastMessage).toBe('string');
      expect(r.toastMessage.length).toBeGreaterThan(0);
    }
  });
});
