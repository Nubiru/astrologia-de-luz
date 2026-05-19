// POST /api/notify/[id]/retry — manual "Reenviar" recovery endpoint.
// Thin HTTP-translation layer; orchestration lives at
// @/application/notify/retry-failed.
//
// Spec anchors: S-1 AC-3.3.4 + AC-3.3.5 + S-2 §7.2.6 C.
//
// Visitor-facing contract: panel-authed only (cookie gate). The handler
// always returns 200 for the post-auth lookup-OK branches — outcome surfaces
// via toast slot. 4xx is reserved for auth + lookup failures (401 / 404 /
// 409 / 500).

import { type NextRequest, NextResponse } from 'next/server';

import { retryFailed } from '@/application/notify/retry-failed';
import { auth } from '@/infrastructure/auth/config';
import { CONTENT_PANEL } from '@/infrastructure/content';

export const runtime = 'nodejs';

const methodNotAllowed = (): Response =>
  NextResponse.json({ kind: 'method_not_allowed' }, { status: 405, headers: { Allow: 'POST' } });

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // ─── 0. Auth (panel-authed; AC-3.3.5 implicit via /panel/* boundary) ─
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ kind: 'unauthorized' }, { status: 401 });
  }

  const { id: logId } = await params;

  const outcome = await retryFailed({ notifyLogId: logId });

  switch (outcome.kind) {
    case 'not_found':
      return NextResponse.json({ kind: 'not_found' }, { status: 404 });
    case 'session_missing':
      return NextResponse.json({ kind: 'session_missing' }, { status: 409 });
    case 'maestro_missing':
      return NextResponse.json({ kind: 'maestro_missing' }, { status: 409 });
    case 'brand_owner_missing':
      return NextResponse.json({ kind: 'brand_owner_missing' }, { status: 500 });
    case 'retry_ok':
      return NextResponse.json(
        {
          kind: 'retry_ok',
          toast: CONTENT_PANEL.NOTIFY.reenviar_success_toast,
          attemptNumber: outcome.attemptNumber,
          status: outcome.outcome.status,
        },
        { status: 200 },
      );
    case 'retry_failed':
      return NextResponse.json(
        {
          kind: 'retry_failed',
          toast: CONTENT_PANEL.NOTIFY.reenviar_failed_toast,
          attemptNumber: outcome.attemptNumber,
          status: outcome.outcome.status,
        },
        { status: 200 },
      );
  }
}
