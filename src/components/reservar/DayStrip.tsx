'use client';

/**
 * G_A-8 — Día step + booking context.
 *
 * This file ships THREE exports:
 *   - `DayStripProvider`  — orchestrator client component. Owns the visitor
 *     TZ detection, the `GET /api/teachers/[slug]/availability` fetch, the
 *     60s + on-focus auto-refresh wiring, and the selected-day state. Wraps
 *     `<DayStrip />` + `<SlotGrid />` so both consume the same context.
 *   - `DayStrip`          — the "Día" step `<section>`. 14-chip radiogroup
 *     per AC-1.2.5 (weekday-short + date number + slot-count badge; chips
 *     with zero availability are `aria-disabled` and opacity-muted).
 *   - `useReservarBooking` — context hook for `SlotGrid` (sibling file).
 *
 * Why one file holds the provider + the dia step component (vs splitting):
 *   the spec's `filesAffected[]` declared exactly two component files
 *   (`DayStrip.tsx` + `SlotGrid.tsx`). The provider needs to live somewhere;
 *   colocating it with `DayStrip` (the first visible step) keeps the file
 *   count to spec while still giving `SlotGrid.tsx` clean single-component
 *   focus.
 *
 * Spec anchors: AC-1.2.5 (day strip shape), AC-1.2.8 (TZ display fallback —
 * implemented in SlotGrid; provider here is what resolves the detected TZ),
 * R-1 (DST-correct via Intl), R-5 (60s auto-refresh narrows the slot-race
 * window).
 */

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { CONTENT_PUBLIC } from '@/infrastructure/content/public';

const DEFAULT_TZ = 'America/Argentina/Buenos_Aires';
const HORIZON_DAYS = 14;
const REFRESH_INTERVAL_MS = 60_000;

/** A single slot rendered in the visitor's TZ. */
export type ReservarSlot = {
  /** UTC ISO instant as returned by the availability endpoint. */
  readonly iso: string;
  /** Visitor's local calendar date (YYYY-MM-DD). */
  readonly ymd: string;
  /** `HH:MM` 24h Spanish locale. AC-1.2.6 label format. */
  readonly hhmm: string;
};

/** A single chip rendered in the 14-day strip. */
export type ReservarDayChip = {
  /** Visitor's local calendar date (YYYY-MM-DD). */
  readonly ymd: string;
  /** Spanish 2-char weekday short — `Lu/Ma/Mi/Ju/Vi/Sá/Do`. */
  readonly weekdayShort: string;
  /** Day-of-month 1..31. */
  readonly dateNumber: number;
  /** Count of slots in the visitor's TZ that fall on this day. */
  readonly slotCount: number;
};

export type ReservarBookingContextValue = {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly visitorTz: string;
  /** Active maestro's identity — surfaced for Form's submit body + ConfirmationPanel dual-TZ render (G_A-9 / AC-1.2.9). */
  readonly maestroSlug: string | null;
  readonly maestroName: string | null;
  readonly maestroTimezone: string | null;
  readonly days: ReadonlyArray<ReservarDayChip>;
  readonly slotsForSelectedDay: ReadonlyArray<ReservarSlot>;
  readonly selectedDayYmd: string | null;
  readonly setSelectedDayYmd: (ymd: string) => void;
  readonly selectedSlotIso: string | null;
  readonly setSelectedSlotIso: (iso: string | null) => void;
  /**
   * G_A-9 / AC-3.6.1 — apply the fresh `availableSlots[]` returned by a 409
   * slot-race response. Replaces the local slot set verbatim (server is the
   * source of truth) AND clears `selectedSlotIso` (the slot the visitor
   * tried to book is by definition no longer offered).
   */
  readonly applyServerAvailableSlots: (slots: ReadonlyArray<string>) => void;
};

const ReservarBookingContext = createContext<ReservarBookingContextValue | null>(null);

/** Sibling-file hook — `SlotGrid` consumes the same provider state. */
export function useReservarBooking(): ReservarBookingContextValue {
  const value = useContext(ReservarBookingContext);
  if (!value) {
    throw new Error(
      'useReservarBooking must be used inside <DayStripProvider>. Wrap the dia + horario steps in the provider in app/reservar/page.tsx.',
    );
  }
  return value;
}

/** Detect the visitor's IANA TZ. Falls back to `DEFAULT_TZ` when Intl returns empty / throws. */
function detectVisitorTz(): string {
  try {
    const detected = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected?.trim()) return detected;
  } catch {
    // Intl available but threw — fall through.
  }
  return DEFAULT_TZ;
}

/** Format a Date instant as YYYY-MM-DD in the given IANA TZ. `en-CA` outputs ISO date by default. */
function ymdInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

const WEEKDAY_SHORT_ES: Record<string, string> = {
  Sun: 'Do',
  Mon: 'Lu',
  Tue: 'Ma',
  Wed: 'Mi',
  Thu: 'Ju',
  Fri: 'Vi',
  Sat: 'Sá',
};

/**
 * Compute the Spanish 2-char weekday for a calendar date. We anchor at noon
 * UTC so DST edges + cross-midnight TZ boundaries cannot mis-attribute the
 * weekday (a calendar Tuesday is a Tuesday regardless of TZ).
 */
function weekdayShortFor(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const anchor = new Date(Date.UTC(y, m - 1, d, 12));
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
  }).format(anchor);
  return WEEKDAY_SHORT_ES[weekday] ?? '?';
}

/** Advance a YYYY-MM-DD by N days using pure calendar math (no TZ involvement). */
function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const anchor = new Date(Date.UTC(y, m - 1, d));
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return ymdInTz(anchor, 'UTC');
}

function hhmmInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * Group raw UTC slots into:
 *   - per-day counts for the 14-chip strip
 *   - per-day slot lists for the slot grid
 * All grouping happens in the visitor's TZ — DST-correct via Intl.
 */
function groupSlotsByDay(
  utcIsoSlots: ReadonlyArray<string>,
  visitorTz: string,
): {
  countByYmd: Map<string, number>;
  slotsByYmd: Map<string, ReadonlyArray<ReservarSlot>>;
} {
  const countByYmd = new Map<string, number>();
  const slotsByYmdMutable = new Map<string, ReservarSlot[]>();
  for (const iso of utcIsoSlots) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    const ymd = ymdInTz(d, visitorTz);
    const hhmm = hhmmInTz(d, visitorTz);
    countByYmd.set(ymd, (countByYmd.get(ymd) ?? 0) + 1);
    const bucket = slotsByYmdMutable.get(ymd) ?? [];
    bucket.push({ iso, ymd, hhmm });
    slotsByYmdMutable.set(ymd, bucket);
  }
  const slotsByYmd = new Map<string, ReadonlyArray<ReservarSlot>>();
  for (const [ymd, list] of slotsByYmdMutable) slotsByYmd.set(ymd, list);
  return { countByYmd, slotsByYmd };
}

type AvailabilityResponse = {
  readonly tz: string;
  readonly rangeStartUtc: string;
  readonly rangeEndUtc: string;
  readonly slots: ReadonlyArray<string>;
};

export type DayStripProviderProps = {
  /** Active maestro's slug. `null` when the visitor has not picked yet (multi-maestro idle). */
  readonly maestroSlug: string | null;
  /** Active maestro's display name — used by `ConfirmationPanel` (G_A-9 / AC-1.2.9). */
  readonly maestroName?: string | null;
  /** Active maestro's IANA timezone — used for the teacher-side time in `ConfirmationPanel`. */
  readonly maestroTimezone?: string | null;
  /** Visitor-facing fallback TZ when Intl detection fails. Defaults to product.timezone. */
  readonly defaultTz?: string;
  readonly children: ReactNode;
};

export function DayStripProvider({
  maestroSlug,
  maestroName = null,
  maestroTimezone = null,
  defaultTz = DEFAULT_TZ,
  children,
}: DayStripProviderProps) {
  const [visitorTz, setVisitorTz] = useState<string>(defaultTz);
  const [utcSlots, setUtcSlots] = useState<ReadonlyArray<string>>([]);
  const [status, setStatus] = useState<ReservarBookingContextValue['status']>('idle');
  const [selectedDayYmd, setSelectedDayYmd] = useState<string | null>(null);
  const [selectedSlotIso, setSelectedSlotIso] = useState<string | null>(null);

  useEffect(() => {
    setVisitorTz(detectVisitorTz());
  }, []);

  const fetchAvailability = useCallback(async (slug: string, tz: string, signal: AbortSignal) => {
    try {
      const url = `/api/teachers/${encodeURIComponent(slug)}/availability?tz=${encodeURIComponent(tz)}`;
      const res = await fetch(url, { signal, cache: 'no-store' });
      if (!res.ok) {
        setStatus('error');
        return;
      }
      const data = (await res.json()) as AvailabilityResponse;
      if (signal.aborted) return;
      setUtcSlots(data.slots);
      setStatus('ready');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!maestroSlug) {
      setStatus('idle');
      setUtcSlots([]);
      return;
    }
    const controller = new AbortController();
    setStatus('loading');
    fetchAvailability(maestroSlug, visitorTz, controller.signal);

    const interval = window.setInterval(() => {
      fetchAvailability(maestroSlug, visitorTz, controller.signal);
    }, REFRESH_INTERVAL_MS);
    const onFocus = () => fetchAvailability(maestroSlug, visitorTz, controller.signal);
    window.addEventListener('focus', onFocus);

    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [maestroSlug, visitorTz, fetchAvailability]);

  const { days, slotsForSelectedDay } = useMemo(() => {
    const todayYmd = ymdInTz(new Date(), visitorTz);
    const { countByYmd, slotsByYmd } = groupSlotsByDay(utcSlots, visitorTz);
    const builtDays: ReservarDayChip[] = [];
    for (let i = 0; i < HORIZON_DAYS; i++) {
      const ymd = addDaysYmd(todayYmd, i);
      const dateNumber = Number(ymd.slice(8, 10));
      builtDays.push({
        ymd,
        weekdayShort: weekdayShortFor(ymd),
        dateNumber,
        slotCount: countByYmd.get(ymd) ?? 0,
      });
    }
    const selected = selectedDayYmd && slotsByYmd.get(selectedDayYmd);
    return {
      days: builtDays,
      slotsForSelectedDay: (selected ?? []) as ReadonlyArray<ReservarSlot>,
    };
  }, [utcSlots, visitorTz, selectedDayYmd]);

  // Auto-select the first day that has slots once data lands — gives the
  // visitor an instant slot grid without an extra click.
  useEffect(() => {
    if (selectedDayYmd) return;
    const firstWithSlots = days.find((d) => d.slotCount > 0);
    if (firstWithSlots) setSelectedDayYmd(firstWithSlots.ymd);
  }, [days, selectedDayYmd]);

  const applyServerAvailableSlots = useCallback((slots: ReadonlyArray<string>) => {
    setUtcSlots(slots);
    setSelectedSlotIso(null);
    setStatus('ready');
  }, []);

  const value = useMemo<ReservarBookingContextValue>(
    () => ({
      status,
      visitorTz,
      maestroSlug,
      maestroName,
      maestroTimezone,
      days,
      slotsForSelectedDay,
      selectedDayYmd,
      setSelectedDayYmd: (ymd: string) => {
        setSelectedDayYmd(ymd);
        setSelectedSlotIso(null);
      },
      selectedSlotIso,
      setSelectedSlotIso,
      applyServerAvailableSlots,
    }),
    [
      status,
      visitorTz,
      maestroSlug,
      maestroName,
      maestroTimezone,
      days,
      slotsForSelectedDay,
      selectedDayYmd,
      selectedSlotIso,
      applyServerAvailableSlots,
    ],
  );

  return (
    <ReservarBookingContext.Provider value={value}>{children}</ReservarBookingContext.Provider>
  );
}

export type DayStripProps = {
  readonly stepNumber: number;
};

const DAY_STRIP_H2_ID = 'reservar-day-strip-h2';

export function DayStrip({ stepNumber }: DayStripProps) {
  const { days, selectedDayYmd, setSelectedDayYmd, status } = useReservarBooking();
  const { stepLabels, dayStripAriaLabel, slotCountEmptyBadge, idleEmptyState } =
    CONTENT_PUBLIC.RESERVAR;

  const isIdle = status === 'idle';

  return (
    <section
      data-step="dia"
      data-step-number={stepNumber}
      aria-labelledby={DAY_STRIP_H2_ID}
      className="w-full"
    >
      <p
        data-brand="step-eyebrow"
        className="font-display uppercase tracking-display-lg text-xs text-tinta-suave"
      >
        Paso {stepNumber} · {stepLabels.dia}
      </p>
      <h2
        id={DAY_STRIP_H2_ID}
        className="mt-2 font-editorial italic text-2xl sm:text-3xl text-tinta-nocturna"
      >
        {stepLabels.dia}
      </h2>

      {isIdle ? (
        <p data-brand="dia-idle" className="mt-4 font-body text-sm text-tinta-suave">
          {idleEmptyState}
        </p>
      ) : (
        <ul
          role="radiogroup"
          aria-label={dayStripAriaLabel}
          data-brand="day-strip"
          data-status={status}
          className="mt-6 grid grid-cols-7 sm:grid-cols-7 md:grid-cols-14 gap-2 sm:gap-3"
        >
          {days.map((chip) => {
            const disabled = chip.slotCount === 0;
            const selected = chip.ymd === selectedDayYmd;
            return (
              <li key={chip.ymd} className="contents">
                <button
                  type="button"
                  // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA APG radio-group pattern — chip wraps weekday + date + badge composition; <input type=radio> cannot carry block children.
                  role="radio"
                  aria-checked={selected}
                  aria-disabled={disabled}
                  aria-label={`${chip.weekdayShort} ${chip.dateNumber}, ${chip.slotCount} ${chip.slotCount === 1 ? 'horario' : 'horarios'}`}
                  disabled={disabled}
                  data-brand="day-chip"
                  data-day-ymd={chip.ymd}
                  data-day-disabled={disabled}
                  data-day-selected={selected}
                  data-day-slot-count={chip.slotCount}
                  onClick={() => {
                    if (disabled) return;
                    setSelectedDayYmd(chip.ymd);
                  }}
                  className={[
                    'flex flex-col items-center justify-center gap-1 min-w-[44px] min-h-[64px] px-2 py-3 border rounded-sm transition-colors duration-micro ease-elegant', // stylelint-ignore custom/no-hardcode -- 44px is the WCAG 2.5.5 minimum touch-target floor (AC-1.2.5); 64px is +20px chip vertical breathing room for weekday+date+badge composition; both are a11y constraints, not brand-design numbers — promotion to a token is single-use anti-pattern per SOUL Simplicity-Test.
                    'font-display uppercase tracking-display-md text-xs',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dorado-imperial',
                    disabled
                      ? 'opacity-40 cursor-not-allowed border-tinta-suave bg-blanco-estelar text-tinta-suave'
                      : selected
                        ? 'border-tinta-nocturna bg-tinta-nocturna text-blanco-estelar'
                        : 'border-tinta-suave bg-blanco-estelar text-tinta-nocturna hover:border-tinta-nocturna',
                  ].join(' ')}
                >
                  <span data-brand="day-chip-weekday" className="leading-none">
                    {chip.weekdayShort}
                  </span>
                  <span
                    data-brand="day-chip-date"
                    className="font-editorial italic text-lg leading-none"
                  >
                    {chip.dateNumber}
                  </span>
                  <span
                    data-brand="day-chip-badge"
                    className="font-body text-[10px] leading-none opacity-80" // stylelint-ignore custom/no-hardcode -- one-off: chip slot-count badge at 10px sits below the body floor (text-xs = 12px), brand-signal at decorative size; same justification class as Logo sm-variant wordmark (AC-G_A-12.4); promotion to --text-2xs token is single-use anti-pattern.
                  >
                    {disabled ? slotCountEmptyBadge : chip.slotCount}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
