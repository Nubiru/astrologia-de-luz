// GET /api/teachers/[slug]/availability — 14-day slot list for a maestro.
// Spec anchors: S-1 AC-1.2.5, AC-1.2.6, AC-2.1.4, AC-3.6.2, R-1, R-5.
//
// Query params:
//   - tz: visitor's IANA timezone. Default = product.timezone fallback.
//         Validated via Intl.DateTimeFormat (bad tz → 400).
//
// Response shape:
//   { tz, rangeStartUtc, rangeEndUtc, slots: string[] }
//   slots are UTC ISO instants in ascending order; client groups by day in
//   the visitor's TZ using Intl.DateTimeFormat (DST-correct per browser).
//
// Behaviour:
//   - 404 when the slug does not resolve OR the row is active=false (the
//     archive contract from AC-1.5.3 mirrors here: archived = unbookable).
//   - 400 when the tz query param fails Intl-validation.
//   - 200 with an empty slots[] when the maestro has empty availability
//     windows (R-9 launch gate; the seed ships this way intentionally).
//   - Subtracts already-confirmed sessions in the [rangeStart, rangeEnd)
//     range so the picker never offers a slot the server would 409 (R-5).
//   - Drops slots whose UTC start has already passed (`> now`) — visitors
//     should not see slots in their own past.
//   - The defensive AvailabilityShape.safeParse() guards against a manually
//     edited DB row violating the locked JSON shape; on shape failure we
//     return an empty slot list rather than 500. The slot grid is
//     informational and the panel will flag the bad row through its own
//     write-time validator (AC-1.6.4).

import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { and, eq, gte, lt } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { getDb } from '@/db/client';
import { sessions, teachers } from '@/db/schema';
import { deriveSlots } from '@/lib/availability/derive';
import { type Availability, AvailabilityShape } from '@/lib/availability/schema';

export const runtime = 'nodejs';

const DEFAULT_TZ = 'America/Argentina/Buenos_Aires';
const HORIZON_DAYS = 14;
const DURATION_MIN = 60;

const isValidTz = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

// Push a YYYY-MM-DD forward by N days via UTC-midnight anchoring. The teacher
// TZ's calendar is what we want to advance; anchoring at UTC midnight of the
// YMD string means no host-side DST skew interferes with the addition.
const addDaysYmd = (ymd: string, days: number): string => {
  const anchor = new Date(`${ymd}T00:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return anchor.toISOString().slice(0, 10);
};

interface AvailabilityResponse {
  readonly tz: string;
  readonly rangeStartUtc: string;
  readonly rangeEndUtc: string;
  readonly slots: string[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const url = new URL(request.url);
  const visitorTz = url.searchParams.get('tz') ?? DEFAULT_TZ;

  if (!isValidTz(visitorTz)) {
    return NextResponse.json({ error: 'Zona horaria inválida.' }, { status: 400 });
  }

  const db = getDb();
  const teacherRows = await db
    .select()
    .from(teachers)
    .where(and(eq(teachers.slug, slug), eq(teachers.active, true)))
    .limit(1);

  const teacher = teacherRows[0];
  if (!teacher) {
    return NextResponse.json({ error: 'Maestro no encontrado.' }, { status: 404 });
  }

  // Anchor the 14-day window at start-of-today in the VISITOR's TZ so the
  // calendar the picker shows matches the day boundaries the visitor sees.
  const now = new Date();
  const todayYmdVisitor = formatInTimeZone(now, visitorTz, 'yyyy-MM-dd');
  const rangeStartUtc = fromZonedTime(`${todayYmdVisitor}T00:00:00`, visitorTz);
  const endYmdVisitor = addDaysYmd(todayYmdVisitor, HORIZON_DAYS);
  const rangeEndUtc = fromZonedTime(`${endYmdVisitor}T00:00:00`, visitorTz);

  let availability: Availability;
  try {
    const parsed = AvailabilityShape.safeParse(JSON.parse(teacher.availability));
    if (!parsed.success) {
      return NextResponse.json({
        tz: visitorTz,
        rangeStartUtc: rangeStartUtc.toISOString(),
        rangeEndUtc: rangeEndUtc.toISOString(),
        slots: [],
      } satisfies AvailabilityResponse);
    }
    availability = parsed.data;
  } catch {
    return NextResponse.json({
      tz: visitorTz,
      rangeStartUtc: rangeStartUtc.toISOString(),
      rangeEndUtc: rangeEndUtc.toISOString(),
      slots: [],
    } satisfies AvailabilityResponse);
  }

  const confirmedRows = await db
    .select({ startsAtUtc: sessions.startsAtUtc })
    .from(sessions)
    .where(
      and(
        eq(sessions.teacherId, teacher.id),
        eq(sessions.status, 'confirmed'),
        gte(sessions.startsAtUtc, rangeStartUtc.getTime()),
        lt(sessions.startsAtUtc, rangeEndUtc.getTime()),
      ),
    );

  const derived = deriveSlots({
    availability,
    teacherTz: teacher.timezone,
    rangeStartUtc,
    rangeEndUtc,
    durationMinutes: DURATION_MIN,
    alreadyConfirmedUtc: confirmedRows.map((r) => new Date(r.startsAtUtc)),
  });

  // Drop slots that have already started (visitor cannot book the past).
  const futureSlots = derived.filter((d) => d.getTime() > now.getTime());

  return NextResponse.json({
    tz: visitorTz,
    rangeStartUtc: rangeStartUtc.toISOString(),
    rangeEndUtc: rangeEndUtc.toISOString(),
    slots: futureSlots.map((d) => d.toISOString()),
  } satisfies AvailabilityResponse);
}
