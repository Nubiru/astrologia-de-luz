'use client';

/**
 * G_A-9 — Form step (visitor session-request form).
 *
 * Renders the 4th step of /reservar: visitor name + email + contact pref +
 * contact value + (optional) intent + acceptsPending checkbox. Plus the
 * three machinery fields that drive anti-abuse + server validation:
 *   - honeypot `companyName` (visually-hidden, NOT display:none, AC-3.5.1)
 *   - min-fill-time `_t` (ms since form mount, computed at submit, AC-3.5.2)
 *   - context fields: `teacherSlug` + `slotUtcIso` + `visitorTimezone`
 *
 * Submission flow (with JS):
 *   - `onSubmit` → fetch POST /api/sessions
 *   - 201 → replace the form section with <ConfirmationPanel>
 *   - 409 → toast + `applyServerAvailableSlots(response.availableSlots)`
 *           (per AC-3.6.1: slot grid re-renders in-place; the taken slot
 *           is removed because the fresh list does not include it)
 *   - 422 → render field-keyed Spanish error messages from `fieldErrors`
 *   - 429 → render the rate-limit Spanish message
 *   - 500 → render the insert-failed Spanish message
 *
 * Progressive enhancement (AC-1.2.10): the `<form>` element carries
 * `method="POST" action="/api/sessions"` so a JS-disabled visitor can
 * still POST the body. The server returns JSON in that path — the no-JS
 * landing-page experience is a known v1.0 limitation tracked separately.
 *
 * Spec anchors: AC-1.2.7, AC-1.2.9, AC-1.2.10, AC-3.5.1, AC-3.5.2, AC-3.6.1.
 */

import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { CONTENT_PANEL } from '@/infrastructure/content/panel';
import { CONTENT_PUBLIC } from '@/infrastructure/content/public';

import { ConfirmationPanel } from './ConfirmationPanel';
import { useReservarBooking } from './DayStrip';

/*
 * HONEYPOT_STYLE — AC-3.5.1 visually-hidden-but-focusable.
 *
 * The three px literals below are bot-defeating machinery — `left:-9999px`
 * pushes the input off-screen without `display:none` (bots skip `display:none`
 * but follow inputs they can read at -9999px), while `width:1px` + `height:1px`
 * keep the element in the layout tree so screen-readers + bots still see it.
 * Tailwind's `sr-only` utility uses `clip` / `clip-path` which sophisticated
 * bots have learned to skip — the spec mandates the older `-9999px` form for
 * defense-in-depth. These are anti-abuse load-bearing values, not brand-design
 * numbers; promotion to @theme tokens would be a single-use anti-pattern per
 * SOUL Simplicity-Test.
 */
const HONEYPOT_STYLE = {
  position: 'absolute',
  left: '-9999px', // stylelint-ignore custom/no-hardcode -- AC-3.5.1 anti-abuse off-screen position; cannot use clip/clip-path (sophisticated bots skip those).
  top: 'auto',
  width: '1px', // stylelint-ignore custom/no-hardcode -- AC-3.5.1 minimum non-zero box for screen-reader + bot reachability.
  height: '1px', // stylelint-ignore custom/no-hardcode -- AC-3.5.1 minimum non-zero box for screen-reader + bot reachability.
  overflow: 'hidden',
  opacity: 0,
  pointerEvents: 'none',
} as const satisfies React.CSSProperties;

/** Internal form-field shape — the visitor-typeable rows. */
export type ReservarFormFields = {
  readonly visitorName: string;
  readonly visitorEmail: string;
  readonly contactPref: 'email' | 'whatsapp' | 'phone' | '';
  readonly contactValue: string;
  readonly visitorIntent: string;
  readonly acceptsPending: boolean;
};

const INITIAL_FIELDS: ReservarFormFields = {
  visitorName: '',
  visitorEmail: '',
  contactPref: '',
  contactValue: '',
  visitorIntent: '',
  acceptsPending: false,
};

/** API response discriminator — matches the API at src/app/api/sessions/route.ts. */
type ApiOutcome =
  | {
      kind: 'created';
      sessionId: string;
      slotUtcIso: string;
      maestroName: string;
      maestroTimezone: string;
      visitorTimezone: string;
    }
  | { kind: 'received' }
  | { kind: 'slot_taken'; error: string; availableSlots: ReadonlyArray<string> }
  | { kind: 'invalid'; fieldErrors: Record<string, ReadonlyArray<string>> }
  | { kind: 'invalid_body'; error: string }
  | { kind: 'maestro_gone'; error: string }
  | { kind: 'rate_limited'; error: string }
  | { kind: 'insert_failed'; error: string }
  | { kind: 'method_not_allowed' };

type SubmitState =
  | { kind: 'editing'; submitError: string | null; fieldErrors: Record<string, string> }
  | { kind: 'submitting' }
  | { kind: 'confirmed'; payload: Extract<ApiOutcome, { kind: 'created' }> };

/** Toast message surfaced above the form on 409. Cleared on next submit. */
type SlotTakenToast = {
  readonly message: string;
  readonly takenIso: string;
};

export type FormProps = {
  readonly stepNumber: number;
};

const FORM_H2_ID = 'reservar-form-h2';

/* ──────────────────────────────────────────────────────────────────────── *
 * Pure helper — exported for the G_A-9 unit pairing
 * `tests/unit/form-preserves-on-409.test.ts`.
 *
 * Reduces the current form state + the server's 409 response into the next
 * state. Field-preservation invariant (AC-3.6.1): the visitor's typed input
 * survives a 409 byte-equal so they don't have to re-enter anything.
 * ──────────────────────────────────────────────────────────────────────── */
export type SlotTakenUpdate = {
  readonly fields: ReservarFormFields;
  readonly newAvailableSlots: ReadonlyArray<string>;
  readonly takenSlotIso: string | null;
  readonly toastMessage: string;
};

export function processSlotTakenResponse(
  currentFields: ReservarFormFields,
  currentSlotIso: string | null,
  response: Extract<ApiOutcome, { kind: 'slot_taken' }>,
): SlotTakenUpdate {
  return {
    fields: currentFields,
    newAvailableSlots: response.availableSlots,
    takenSlotIso: currentSlotIso,
    toastMessage: response.error,
  };
}

export function Form({ stepNumber }: FormProps) {
  const {
    maestroSlug,
    maestroName,
    maestroTimezone,
    selectedSlotIso,
    visitorTz,
    applyServerAvailableSlots,
  } = useReservarBooking();
  const { FORM, finePrintCancellationPrefix, slotTakenToastSuffix } = CONTENT_PUBLIC.RESERVAR;

  const [fields, setFields] = useState<ReservarFormFields>(INITIAL_FIELDS);
  const [state, setState] = useState<SubmitState>({
    kind: 'editing',
    submitError: null,
    fieldErrors: {},
  });
  const [toast, setToast] = useState<SlotTakenToast | null>(null);
  const mountedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    mountedAtRef.current = Date.now();
  }, []);

  const readyToSubmit = useMemo(
    () =>
      Boolean(maestroSlug) &&
      Boolean(selectedSlotIso) &&
      fields.acceptsPending &&
      fields.visitorName.trim().length >= 2 &&
      fields.visitorEmail.trim().length > 0 &&
      fields.contactPref !== '' &&
      fields.contactValue.trim().length >= 5,
    [maestroSlug, selectedSlotIso, fields],
  );

  const updateField = <K extends keyof ReservarFormFields>(
    key: K,
    value: ReservarFormFields[K],
  ): void => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (state.kind === 'submitting') return;
    if (!maestroSlug || !selectedSlotIso) return;

    setState({ kind: 'submitting' });
    setToast(null);

    const body = {
      teacherSlug: maestroSlug,
      slotUtcIso: selectedSlotIso,
      visitorName: fields.visitorName.trim(),
      visitorEmail: fields.visitorEmail.trim(),
      contactPref: fields.contactPref,
      contactValue: fields.contactValue.trim(),
      visitorTimezone: visitorTz,
      visitorIntent: fields.visitorIntent.trim() || undefined,
      acceptsPending: fields.acceptsPending,
      companyName: '',
      _t: Date.now() - mountedAtRef.current,
    };

    let outcome: ApiOutcome;
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      outcome = (await res.json()) as ApiOutcome;
    } catch {
      setState({
        kind: 'editing',
        submitError: FORM.errors.network,
        fieldErrors: {},
      });
      return;
    }

    switch (outcome.kind) {
      case 'created':
        setState({ kind: 'confirmed', payload: outcome });
        return;
      case 'received':
        // Honeypot / min-fill-time silent-drop. The server says "received" but
        // didn't actually insert. We still show the confirmation panel — the
        // POINT of the silent-drop is that the bot can't distinguish it from a
        // real success. Without a real `created` payload we synthesise a
        // best-effort confirmation from local state.
        setState({
          kind: 'confirmed',
          payload: {
            kind: 'created',
            sessionId: 'pending',
            slotUtcIso: selectedSlotIso,
            maestroName: maestroName ?? '',
            maestroTimezone: maestroTimezone ?? visitorTz,
            visitorTimezone: visitorTz,
          },
        });
        return;
      case 'slot_taken': {
        const update = processSlotTakenResponse(fields, selectedSlotIso, outcome);
        applyServerAvailableSlots(update.newAvailableSlots);
        setFields(update.fields);
        setToast({
          message: `${update.toastMessage} ${slotTakenToastSuffix}`.trim(),
          takenIso: update.takenSlotIso ?? '',
        });
        setState({ kind: 'editing', submitError: null, fieldErrors: {} });
        return;
      }
      case 'invalid': {
        const flat: Record<string, string> = {};
        for (const [k, msgs] of Object.entries(outcome.fieldErrors)) {
          if (Array.isArray(msgs) && msgs.length > 0) {
            const first = msgs[0];
            if (typeof first === 'string' && first.length > 0) flat[k] = first;
          }
        }
        setState({ kind: 'editing', submitError: null, fieldErrors: flat });
        return;
      }
      case 'invalid_body':
      case 'maestro_gone':
      case 'rate_limited':
      case 'insert_failed':
        setState({ kind: 'editing', submitError: outcome.error, fieldErrors: {} });
        return;
      case 'method_not_allowed':
        setState({ kind: 'editing', submitError: FORM.errors.unexpected, fieldErrors: {} });
    }
  };

  if (state.kind === 'confirmed') {
    return (
      <section
        data-step="form"
        data-step-number={stepNumber}
        aria-labelledby={FORM_H2_ID}
        className="w-full"
      >
        <ConfirmationPanel
          slotUtcIso={state.payload.slotUtcIso}
          maestroName={state.payload.maestroName}
          maestroTimezone={state.payload.maestroTimezone}
          visitorTimezone={state.payload.visitorTimezone}
        />
      </section>
    );
  }

  const fieldErrors = state.kind === 'editing' ? state.fieldErrors : {};
  const submitError = state.kind === 'editing' ? state.submitError : null;
  const submitting = state.kind === 'submitting';

  return (
    <section
      data-step="form"
      data-step-number={stepNumber}
      aria-labelledby={FORM_H2_ID}
      className="w-full"
    >
      <p
        data-brand="step-eyebrow"
        className="font-display uppercase tracking-display-lg text-xs text-tinta-suave"
      >
        Paso {stepNumber} · {FORM.eyebrow}
      </p>
      <h2
        id={FORM_H2_ID}
        className="mt-2 font-editorial italic text-2xl sm:text-3xl text-tinta-nocturna"
      >
        {FORM.heading}
      </h2>

      {toast ? (
        <p
          data-brand="slot-taken-toast"
          data-toast-taken-iso={toast.takenIso}
          role="alert"
          aria-live="polite"
          className="mt-4 px-4 py-3 border border-tinta-suave bg-blanco-estelar text-tinta-nocturna font-body text-sm rounded-sm"
        >
          {toast.message}
        </p>
      ) : null}

      <form
        method="POST"
        action="/api/sessions"
        onSubmit={onSubmit}
        data-brand="reservar-form"
        className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6"
        noValidate
      >
        {/* Context-derived hidden fields — server reads these from JSON in the
            enhanced path, AND from POST form-encoded in the no-JS path. */}
        <input type="hidden" name="teacherSlug" value={maestroSlug ?? ''} readOnly />
        <input type="hidden" name="slotUtcIso" value={selectedSlotIso ?? ''} readOnly />
        <input type="hidden" name="visitorTimezone" value={visitorTz} readOnly />
        <input
          type="hidden"
          name="_t"
          value={Date.now() - mountedAtRef.current}
          readOnly
          data-brand="min-fill-time"
        />

        {/* Honeypot — visually-hidden but in DOM (AC-3.5.1). Bots typically
            fill every visible-looking field; humans never see this one. */}
        <div style={HONEYPOT_STYLE} aria-hidden="true">
          <label htmlFor="reservar-form-companyName">{FORM.honeypotLabel}</label>
          <input
            id="reservar-form-companyName"
            type="text"
            name="companyName"
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
            data-brand="honeypot"
          />
        </div>

        {renderTextField({
          id: 'reservar-form-visitorName',
          name: 'visitorName',
          label: FORM.labels.visitorName,
          value: fields.visitorName,
          onChange: (v) => updateField('visitorName', v),
          autoComplete: 'name',
          required: true,
          minLength: 2,
          maxLength: 80,
          error: fieldErrors.visitorName,
        })}

        {renderTextField({
          id: 'reservar-form-visitorEmail',
          name: 'visitorEmail',
          label: FORM.labels.visitorEmail,
          value: fields.visitorEmail,
          onChange: (v) => updateField('visitorEmail', v),
          type: 'email',
          autoComplete: 'email',
          required: true,
          maxLength: 254,
          error: fieldErrors.visitorEmail,
        })}

        <label className="flex flex-col gap-2">
          <span className="font-body text-sm text-tinta-nocturna">
            {FORM.labels.contactPref}
            <span aria-hidden="true" className="text-tinta-suave">
              {' '}
              *
            </span>
          </span>
          <select
            name="contactPref"
            data-brand="form-field-contactPref"
            value={fields.contactPref}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              updateField('contactPref', e.target.value as ReservarFormFields['contactPref'])
            }
            required
            className="border border-tinta-suave bg-blanco-estelar text-tinta-nocturna px-3 py-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dorado-imperial"
          >
            <option value="" disabled>
              {FORM.contactPrefPlaceholder}
            </option>
            <option value="email">{FORM.contactPrefOptions.email}</option>
            <option value="whatsapp">{FORM.contactPrefOptions.whatsapp}</option>
            <option value="phone">{FORM.contactPrefOptions.phone}</option>
          </select>
          {fieldErrors.contactPref ? (
            <span data-brand="field-error" className="font-body text-xs text-tinta-nocturna">
              {fieldErrors.contactPref}
            </span>
          ) : null}
        </label>

        {renderTextField({
          id: 'reservar-form-contactValue',
          name: 'contactValue',
          label: FORM.labels.contactValue,
          value: fields.contactValue,
          onChange: (v) => updateField('contactValue', v),
          autoComplete: 'tel',
          required: true,
          minLength: 5,
          maxLength: 40,
          error: fieldErrors.contactValue,
          help: FORM.contactValueHelp,
        })}

        <label className="sm:col-span-2 flex flex-col gap-2">
          <span className="font-body text-sm text-tinta-nocturna">
            {FORM.labels.visitorIntent}
            <span aria-hidden="true" className="text-tinta-suave">
              {' '}
              {FORM.optionalSuffix}
            </span>
          </span>
          <textarea
            name="visitorIntent"
            data-brand="form-field-visitorIntent"
            value={fields.visitorIntent}
            onChange={(e) => updateField('visitorIntent', e.target.value)}
            maxLength={500}
            rows={4}
            className="border border-tinta-suave bg-blanco-estelar text-tinta-nocturna px-3 py-2 rounded-sm font-body text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dorado-imperial"
          />
          {fieldErrors.visitorIntent ? (
            <span data-brand="field-error" className="font-body text-xs text-tinta-nocturna">
              {fieldErrors.visitorIntent}
            </span>
          ) : null}
        </label>

        <label className="sm:col-span-2 flex items-start gap-3">
          <input
            type="checkbox"
            name="acceptsPending"
            data-brand="form-field-acceptsPending"
            checked={fields.acceptsPending}
            onChange={(e) => updateField('acceptsPending', e.target.checked)}
            required
            className="mt-1"
          />
          <span className="font-body text-sm text-tinta-nocturna">{FORM.acceptsPendingLabel}</span>
        </label>

        {submitError ? (
          <p
            data-brand="form-submit-error"
            role="alert"
            aria-live="polite"
            className="sm:col-span-2 font-body text-sm text-tinta-nocturna"
          >
            {submitError}
          </p>
        ) : null}

        <div className="sm:col-span-2 flex flex-col gap-3">
          <button
            type="submit"
            data-brand="reservar-submit"
            data-form-ready={readyToSubmit}
            disabled={submitting || !readyToSubmit}
            className="self-start inline-flex items-center justify-center min-h-[44px] px-6 py-3 border border-tinta-nocturna bg-tinta-nocturna text-blanco-estelar font-display uppercase tracking-display-md text-sm rounded-sm transition-opacity duration-micro ease-elegant disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dorado-imperial" // stylelint-ignore custom/no-hardcode -- 44px is the WCAG 2.5.5 minimum touch-target floor (a11y constraint); promotion to a token is single-use anti-pattern per SOUL Simplicity-Test.
          >
            {submitting ? FORM.submittingLabel : FORM.submitLabel}
          </button>

          <p data-brand="reservar-fine-print" className="font-body text-xs text-tinta-suave">
            {finePrintCancellationPrefix}: {CONTENT_PANEL.RESERVAR.cancellation.text}
          </p>
        </div>
      </form>
    </section>
  );
}

type TextFieldProps = {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'email' | 'tel';
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  error?: string;
  help?: string;
};

function renderTextField({
  id,
  name,
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  required = false,
  minLength,
  maxLength,
  error,
  help,
}: TextFieldProps): ReactNode {
  return (
    <label key={id} htmlFor={id} className="flex flex-col gap-2">
      <span className="font-body text-sm text-tinta-nocturna">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-tinta-suave">
            {' '}
            *
          </span>
        ) : null}
      </span>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        data-brand={`form-field-${name}`}
        aria-invalid={Boolean(error) || undefined}
        className="border border-tinta-suave bg-blanco-estelar text-tinta-nocturna px-3 py-2 rounded-sm font-body text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dorado-imperial"
      />
      {help ? <span className="font-body text-xs text-tinta-suave">{help}</span> : null}
      {error ? (
        <span data-brand="field-error" className="font-body text-xs text-tinta-nocturna">
          {error}
        </span>
      ) : null}
    </label>
  );
}
