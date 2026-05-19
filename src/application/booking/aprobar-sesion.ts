/**
 * aprobar-sesion.ts — pending→confirmed transition use case.
 *
 * Factory-default-instance shape per S-2 §7.2.3 E / G_C-31 / D-049 / D-050.
 * Spec anchor: S-1 AC-2.2.4 (allow-list: `pending→confirmed`).
 *
 * Narrow extract from src/app/api/sessions/[id]/route.ts PATCH handler — owns
 * exclusively the `pending→confirmed` transition. The route preserves the
 * legacy `body.status` interface (deviation from spec §7.2.6 B's
 * `body.action` proposal — preserves the existing patch-sessions-6x6
 * test contract; flagged in G_C-31 close-note).
 *
 * decided_at semantics: this use case does NOT update decided_at — the
 * SessionsRepository.updateStatus port only flips status + updated_at.
 * The legacy route preserved decided_at on the first non-pending
 * transition; under CP-3 that responsibility either (a) regresses to
 * v1.1 OR (b) lifts into a future port method. Tracked in close-note as
 * a W4-5 cleanup-CP follow-up.
 */

import type { Session } from '@/infrastructure/db/schema';
import { getComposition } from '@/main/composition';

import type { DispatchTransitionFn } from '@/application/notify/dispatch-transition';
import { dispatchTransition } from '@/application/notify/dispatch-transition';
import type { MaestrosReader, SessionsRepository } from '@/domain/booking/ports';

export interface AprobarSesionDeps {
  sessions: SessionsRepository;
  maestrosReader: MaestrosReader;
  dispatch: DispatchTransitionFn;
}

export interface AprobarSesionInput {
  sessionId: string;
  adminEmail: string; // audit trail; verified by the route before invocation
}

export type AprobarSesionOutcome =
  | { kind: 'not_found' }
  | { kind: 'illegal_transition'; from: string; to: 'confirmed' }
  | { kind: 'confirmed'; session: Session };

export type AprobarSesionFn = (input: AprobarSesionInput) => Promise<AprobarSesionOutcome>;

export function createAprobarSesion(deps: AprobarSesionDeps): AprobarSesionFn {
  const { sessions, maestrosReader, dispatch } = deps;

  return async (input: AprobarSesionInput): Promise<AprobarSesionOutcome> => {
    const current = await sessions.findById(input.sessionId);
    if (!current) return { kind: 'not_found' };

    if (current.status !== 'pending') {
      return { kind: 'illegal_transition', from: current.status, to: 'confirmed' };
    }

    const updated = await sessions.updateStatus(input.sessionId, 'pending', 'confirmed');
    if (!updated) {
      // Concurrent transition raced us; the pre-conditions no longer hold.
      return { kind: 'illegal_transition', from: current.status, to: 'confirmed' };
    }

    const maestro = await maestrosReader.findById(updated.teacherId);
    if (maestro) {
      // Post-commit fan-out (AC-3.4.2). The dispatcher never throws on
      // delivery failure — it logs into notify_log and returns outcomes.
      await dispatch({ session: updated, previousStatus: 'pending', assignedMaestro: maestro });
    }

    return { kind: 'confirmed', session: updated };
  };
}

export const aprobarSesion: AprobarSesionFn = (input) => {
  const c = getComposition();
  return createAprobarSesion({
    sessions: c.sessions,
    maestrosReader: c.maestrosReader,
    dispatch: dispatchTransition,
  })(input);
};
