// GET /api/teachers — active-maestros catalog for the booking picker.
// Spec anchors: S-1 AC-1.2.3, AC-1.5.3.
//
// Returns the projection the visitor-side picker needs (id, slug, name, bio,
// avatarUrl, timezone). Archived rows (active=0) are excluded so the picker
// surface and the booking flow agree with AC-1.5.3 ("Archiving hides the
// teacher from /reservar").
//
// Node runtime is required transitively via @/db/client (the libSQL client
// uses node:crypto + native bindings; not Edge-safe).

import { asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '@/infrastructure/db/client';
import { teachers } from '@/infrastructure/db/schema';

export const runtime = 'nodejs';

export interface MaestroListItem {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly bio: string | null;
  readonly avatarUrl: string | null;
  readonly timezone: string;
}

export async function GET(): Promise<Response> {
  const rows = await getDb()
    .select({
      id: teachers.id,
      slug: teachers.slug,
      name: teachers.name,
      bio: teachers.bio,
      avatarUrl: teachers.avatarUrl,
      timezone: teachers.timezone,
    })
    .from(teachers)
    .where(eq(teachers.active, true))
    .orderBy(asc(teachers.name));

  return NextResponse.json({ maestros: rows satisfies MaestroListItem[] });
}
