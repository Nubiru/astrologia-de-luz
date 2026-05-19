// POST /api/webhook/telegram — Telegram Bot API webhook ingestion.
//
// Spec anchors: S-1 AC-3.7.2 (secret header validation, 401 silent on
// mismatch), AC-3.7.3 (/start <token> token-consume + chat-bind + 2 replies),
// R-6 (secret rotation risk register).
//
// Telegram POSTs JSON Updates to this URL whenever a message reaches the bot.
// The only command handled here is `/start <onboarding_token>` from the
// per-maestro deep-link rendered in the panel (AC-3.7.1). All other Telegram
// updates resolve to a silent 200 — Telegram retries on non-2xx, so noise
// from non-onboarding traffic must not poison the delivery queue.
//
// Method discipline: only POST. Other verbs return 405 with `Allow: POST`.
// Node runtime is required transitively via the libsql client + the
// Telegram client's fetch.

import { timingSafeEqual } from 'node:crypto';

import { and, eq, gt, isNull } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { brandOwnerEmail } from '@/application/notify/brand-owner';
import { CONTENT_PANEL } from '@/infrastructure/content/panel';
import { getDb } from '@/infrastructure/db/client';
import { teacherOnboardingTokens, teachers } from '@/infrastructure/db/schema';
import { getEnv } from '@/infrastructure/env';
import { getComposition } from '@/main/composition';

export const runtime = 'nodejs';

const methodNotAllowed = (): Response =>
  NextResponse.json({ kind: 'method_not_allowed' }, { status: 405, headers: { Allow: 'POST' } });

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;

// Telegram's recommended webhook auth (https://core.telegram.org/bots/api#setwebhook).
// Mismatch returns 401 with no body so an attacker can't distinguish "no
// secret configured" from "wrong secret" (anti-enum at the secret seam).
function secretMatches(header: string | null): boolean {
  if (header === null) return false;
  const expected = getEnv().TELEGRAM_WEBHOOK_SECRET;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface TelegramChat {
  id: number;
}

interface TelegramMessage {
  text?: string;
  chat?: TelegramChat;
}

interface TelegramUpdate {
  message?: TelegramMessage;
}

// `/start abc` — 1-or-more non-whitespace token. Optional trailing whitespace
// is tolerated (some clients append a newline). Any other text payload (incl.
// `/start` with no argument) is silently ignored per the non-onboarding
// traffic policy above.
const START_RE = /^\/start\s+(\S+)\s*$/;

const okSilent = (): Response => NextResponse.json({ ok: true }, { status: 200 });

export async function POST(request: NextRequest): Promise<Response> {
  if (!secretMatches(request.headers.get('x-telegram-bot-api-secret-token'))) {
    return new Response(null, { status: 401 });
  }

  let body: TelegramUpdate;
  try {
    body = (await request.json()) as TelegramUpdate;
  } catch {
    // Malformed JSON — return 200 so Telegram does not retry. The bot is not
    // the right surface to surface client errors at; Telegram never sends
    // malformed payloads itself, so this branch is defense against probes.
    return okSilent();
  }

  const text = body?.message?.text ?? '';
  const chatId = body?.message?.chat?.id;
  if (typeof chatId !== 'number') return okSilent();

  const match = START_RE.exec(text);
  if (!match) return okSilent();
  const token = match[1] as string;

  const now = Date.now();
  const db = getDb();

  // Token lookup + chat-bind + consume — single transaction so a partial
  // failure can't leave a consumed token without a bound chat_id (or vice
  // versa). The SELECT filters consumed and expired tokens so the UPDATE
  // path only runs on a live token.
  const teacherRow = await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        teacherId: teachers.id,
        teacherName: teachers.name,
        teacherEmail: teachers.email,
      })
      .from(teacherOnboardingTokens)
      .innerJoin(teachers, eq(teacherOnboardingTokens.teacherId, teachers.id))
      .where(
        and(
          eq(teacherOnboardingTokens.token, token),
          isNull(teacherOnboardingTokens.consumedAt),
          gt(teacherOnboardingTokens.expiresAt, now),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    await tx
      .update(teachers)
      .set({ telegramChatId: String(chatId), updatedAt: now })
      .where(eq(teachers.id, row.teacherId));

    await tx
      .update(teacherOnboardingTokens)
      .set({ consumedAt: now })
      .where(eq(teacherOnboardingTokens.token, token));

    return row;
  });

  if (!teacherRow) return okSilent();

  const { telegram, maestrosReader } = getComposition();

  await telegram.sendMessage({
    chatId,
    text: CONTENT_PANEL.NOTIFY.maestroOnboardedSuccess.replace(
      '{maestroName}',
      teacherRow.teacherName,
    ),
  });

  // Brand-owner ping: skipped silently when the onboarded teacher IS the
  // brand owner (the maestro reply already went to that chat — sending the
  // ping a second time would be self-addressed noise). Mirrors AC-3.2.2's
  // assigned-maestro dedupe convention.
  const isBrandOwner = teacherRow.teacherEmail.toLowerCase() === brandOwnerEmail();
  if (!isBrandOwner) {
    const owner = await maestrosReader.findBrandOwner();
    // Per S-1 line 650: until the brand owner runs /start themselves their
    // telegram_chat_id is null; in that window brand-owner pings are
    // skipped silently rather than crashing the webhook.
    if (owner?.telegramChatId) {
      await telegram.sendMessage({
        chatId: owner.telegramChatId,
        text: CONTENT_PANEL.NOTIFY.brandOwnerMaestroOnboardedPing.replace(
          '{maestroName}',
          teacherRow.teacherName,
        ),
      });
    }
  }

  return okSilent();
}
