// Pure slot derivation. Spec anchors: AC-1.2.5, AC-1.2.6, AC-2.1.4, R-1.
//
// Given a teacher's availability pattern + their fallback timezone + a UTC
// range + (optionally) the list of already-confirmed UTC starts, return the
// derivable slot UTC starts inside the range, with already-booked subtracted
// and DST-gap slots excluded.
//
// Iteration walks calendar days in the teacher's TZ (so a "Monday window"
// renders on the correct local Monday regardless of where the server lives).
// Local→UTC conversion goes through `fromZonedTime` so DST-active TZs get the
// right offset on either side of a transition. The roundtrip guard at the
// bottom catches spring-forward gap slots (e.g. Europe/Madrid 02:30 on the
// last Sunday of March, which doesn't exist locally) and silently drops them
// rather than letting the visitor pick a non-existent time.

import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

import type { Availability } from './schema';

const minutesOf = (hhmm: string): number => {
  const [hh = '0', mm = '0'] = hhmm.split(':');
  return Number(hh) * 60 + Number(mm);
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

export interface DeriveSlotsArgs {
  readonly availability: Availability;
  readonly teacherTz: string;
  readonly rangeStartUtc: Date;
  readonly rangeEndUtc: Date;
  readonly durationMinutes?: number;
  readonly alreadyConfirmedUtc?: readonly Date[];
}

export function deriveSlots(args: DeriveSlotsArgs): Date[] {
  const duration = args.durationMinutes ?? 60;
  const tz = args.availability.tz ?? args.teacherTz;
  const blackoutSet = new Set(args.availability.blackouts.map((b) => b.date));
  const bookedSet = new Set((args.alreadyConfirmedUtc ?? []).map((d) => d.toISOString()));

  const byWeekday = new Map<number, Array<{ start: number; end: number }>>();
  for (const w of args.availability.windows) {
    const arr = byWeekday.get(w.weekday) ?? [];
    arr.push({ start: minutesOf(w.start), end: minutesOf(w.end) });
    byWeekday.set(w.weekday, arr);
  }

  const startYmd = formatInTimeZone(args.rangeStartUtc, tz, 'yyyy-MM-dd');
  const endYmd = formatInTimeZone(args.rangeEndUtc, tz, 'yyyy-MM-dd');

  const slots: Date[] = [];
  // Anchor calendar iteration at UTC midnight of the YMD strings so date math
  // never crosses a host-side DST boundary.
  const cursor = new Date(`${startYmd}T00:00:00Z`);
  const stop = new Date(`${endYmd}T00:00:00Z`);

  while (cursor <= stop) {
    const ymd = cursor.toISOString().slice(0, 10);
    if (!blackoutSet.has(ymd)) {
      const weekday = cursor.getUTCDay();
      const windows = byWeekday.get(weekday) ?? [];
      for (const win of windows) {
        for (let t = win.start; t + duration <= win.end; t += duration) {
          const localNaive = `${ymd}T${pad2(Math.floor(t / 60))}:${pad2(t % 60)}:00`;
          const utc = fromZonedTime(localNaive, tz);
          if (utc < args.rangeStartUtc || utc >= args.rangeEndUtc) continue;
          if (bookedSet.has(utc.toISOString())) continue;
          const roundtrip = formatInTimeZone(utc, tz, "yyyy-MM-dd'T'HH:mm:00");
          if (roundtrip !== localNaive) continue;
          slots.push(utc);
        }
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return slots;
}
