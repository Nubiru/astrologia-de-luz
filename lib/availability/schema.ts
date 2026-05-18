// Availability JSON validation. Spec anchors: AC-2.1.4, AC-1.6.4.
//
// Shape (per AC-2.1.4):
//   { tz: string | null, windows: Array<{weekday, start, end}>, blackouts: Array<{date}> }
//
// AvailabilityShape — pure shape validator used at read-time (existing rows may
// have past blackouts that the panel will prune lazily).
//
// availabilityWriteSchema({ now }) — write-time validator that additionally
// rejects blackouts whose `date` is strictly before today (per AC-1.6.4). The
// `now` injection keeps the schema deterministic for tests; production callers
// omit it to default to `new Date()`.

import { z } from 'zod';

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

const minutesOf = (hhmm: string): number => {
  const [hh = '0', mm = '0'] = hhmm.split(':');
  return Number(hh) * 60 + Number(mm);
};

const WindowSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    start: z.string().regex(HHMM_RE, 'debe tener formato HH:MM'),
    end: z.string().regex(HHMM_RE, 'debe tener formato HH:MM'),
  })
  .refine((w) => minutesOf(w.start) < minutesOf(w.end), {
    message: 'start debe ser anterior a end',
    path: ['end'],
  });

const BlackoutShape = z.object({
  date: z.string().regex(YMD_RE, 'debe tener formato YYYY-MM-DD'),
});

export const AvailabilityShape = z.object({
  tz: z.string().nullable(),
  windows: z.array(WindowSchema),
  blackouts: z.array(BlackoutShape),
});

export type Availability = z.infer<typeof AvailabilityShape>;

export function availabilityWriteSchema(opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const todayYmd = now.toISOString().slice(0, 10);
  const BlackoutWrite = BlackoutShape.refine((b) => b.date >= todayYmd, {
    message: 'la fecha no puede ser anterior a hoy',
    path: ['date'],
  });
  return z.object({
    tz: z.string().nullable(),
    windows: z.array(WindowSchema),
    blackouts: z.array(BlackoutWrite),
  });
}
