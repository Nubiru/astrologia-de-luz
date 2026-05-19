/**
 * rechazar-sesion.ts — pending→rejected transition use case.
 *
 * Factory-default-instance shape per S-2 §7.2.3 E / G_C-31 / D-049 / D-050.
 * Spec anchor: S-1 AC-2.2.4 (allow-list: `pending→rejected`) + AC-3.4.2
 * (decline-email fires via dispatchTransition).
 *
 * Symmetric to aprobar-sesion: narrow extract from the PATCH handler that
 * owns exclusively the `pending→rejected` transition. The decline email
 * fires via the post-commit dispatcher (D-014 lead-ratified: rejected
 * sessions send a polite Spanish decline rather than silent drop).
 */

import type { Session } from '@/infrastructure/db/schema';
import { getComposition } from '@/main/composition';

import type { DispatchTransitionFn } from '@/application/notify/dispatch-transition';
import { dispatchTransition } from '@/application/notify/dispatch-transition';
import type { MaestrosReader, SessionsRepository } from '@/domain/booking/ports';

export interface RechazarSesionDeps {
  sessions: SessionsRepository;
  maestrosReader: MaestrosReader;
  dispatch: DispatchTransitionFn;
}

export interface RechazarSesionInput {
  sessionId: string;
  adminEmail: string;
}

export type RechazarSesionOutcome =
  | { kind: 'not_found' }
  | { kind: 'illegal_transition'; from: string; to: 'rejected' }
  | { kind: 'rejected'; session: Session };

export type RechazarSesionFn = (input: RechazarSesionInput) => Promise<RechazarSesionOutcome>;

export function createRechazarSesion(deps: RechazarSesionDeps): RechazarSesionFn {
  const { sessions, maestrosReader, dispatch } = deps;

  return async (input: RechazarSesionInput): Promise<RechazarSesionOutcome> => {
    const current = await sessions.findById(input.sessionId);
    if (!current) return { kind: 'not_found' };

    if (current.status !== 'pending') {
      return { kind: 'illegal_transition', from: current.status, to: 'rejected' };
    }

    const updated = await sessions.updateStatus(input.sessionId, 'pending', 'rejected');
    if (!updated) {
      return { kind: 'illegal_transition', from: current.status, to: 'rejected' };
    }

    const maestro = await maestrosReader.findById(updated.teacherId);
    if (maestro) {
      await dispatch({ session: updated, previousStatus: 'pending', assignedMaestro: maestro });
    }

    return { kind: 'rejected', session: updated };
  };
}

export const rechazarSesion: RechazarSesionFn = (input) => {
  const c = getComposition();
  return createRechazarSesion({
    sessions: c.sessions,
    maestrosReader: c.maestrosReader,
    dispatch: dispatchTransition,
  })(input);
};
