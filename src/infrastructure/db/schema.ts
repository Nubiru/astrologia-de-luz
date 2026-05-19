/**
 * Drizzle schema — Astrologia de Luz v1.0.
 *
 * Layered by task:
 *   - G_C-2a: business tables (`teachers` + `sessions`).
 *   - G_C-3:  Auth.js v5 DrizzleAdapter tables
 *             (`user` + `account` + `session` + `verificationToken`).
 *   - G_C-2b: auxiliary tables (`notify_log`, `teacher_onboarding_tokens`,
 *             `rate_limit_buckets`).
 *   - G_C-2c: Augusto seed migration.
 *
 * Spec anchors: S-1 AC-2.1.1, AC-2.2.1, AC-2.2.2, AC-2.2.3, AC-2.4.1.
 * Spanish-everywhere rule: SQL identifiers stay English (industry standard,
 * never user-facing); UI strings derived from these rows are Spanish.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { AdapterAccountType } from 'next-auth/adapters';

// AC-2.1.1: empty availability is the locked default (intentional half-config
// refusal — Augusto must enter real hours via the panel before any visitor
// request can match a slot). See D-017 in META_PILLAR §4.
const AVAILABILITY_DEFAULT = '{"tz":null,"windows":[],"blackouts":[]}';

// D-008: Spanish-LATAM brand voice; per-row override available via the admin UI.
const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';

/**
 * `teachers` — the maestros catalog (AC-2.1.1).
 *
 * UI label = "maestro/maestra" (Spanish); SQL identifier stays English per the
 * Spanish-everywhere carve-out (META_PILLAR D-010).
 */
export const teachers = sqliteTable('teachers', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  bio: text('bio'),
  telegramChatId: text('telegram_chat_id'),
  availability: text('availability').notNull().default(AVAILABILITY_DEFAULT),
  avatarUrl: text('avatar_url'),
  timezone: text('timezone').notNull().default(DEFAULT_TIMEZONE),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * `sessions` — visitor booking requests + their lifecycle (AC-2.2.1).
 *
 * Status state-machine: 6 values, 6 allowed transitions (AC-2.2.4). The
 * CHECK constraint here enforces the membership invariant at the DB layer;
 * the allowed-transition matrix is enforced in the mutation layer.
 */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    // AC-2.2.6: ON DELETE RESTRICT — defense-in-depth against deleting a maestro
    // with live sessions. Archiving (active=0) is the soft-delete path.
    teacherId: text('teacher_id')
      .notNull()
      .references(() => teachers.id, { onDelete: 'restrict' }),
    startsAtUtc: integer('starts_at_utc').notNull(),
    durationMinutes: integer('duration_minutes').notNull().default(60),
    status: text('status').notNull().default('pending'),
    visitorName: text('visitor_name').notNull(),
    visitorEmail: text('visitor_email').notNull(),
    contactPref: text('contact_pref').notNull(),
    contactValue: text('contact_value').notNull(),
    visitorIntent: text('visitor_intent'),
    visitorTimezone: text('visitor_timezone'),
    notesInternal: text('notes_internal'),
    decidedAt: integer('decided_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  // Drizzle 0.36 `SQLiteTableExtraConfig`: extraConfig callback must return
  // an object literal keyed by JS-side identifiers (the keys are
  // semantic-only — never emitted into SQL). The previous array-returning
  // form is rejected at the type layer in 0.36+; the SQL output is
  // unchanged.
  (t) => ({
    // AC-2.2.1: membership CHECK on the status enum (6 values).
    // Raw-literal column ref (no `${t.status}` interpolation) so the emitted DDL
    // stays an unqualified `CHECK(status IN (...))` — aligned with the
    // partial-unique WHERE convention below.
    statusCheck: check(
      'sessions_status_check',
      sql`status IN ('pending', 'confirmed', 'cancelled', 'rejected', 'no_show', 'completed')`,
    ),
    // AC-2.2.1: membership CHECK on the contact-preference enum (3 values).
    contactPrefCheck: check(
      'sessions_contact_pref_check',
      sql`contact_pref IN ('email', 'whatsapp', 'phone')`,
    ),
    // AC-2.2.2 — Partial-unique index: only one CONFIRMED row per
    // (teacher_id, starts_at_utc).
    //
    // CRITICAL: declared via the raw `sql` template literal, NEVER via the
    // eq() helper. Drizzle bug #4790 — eq() inside a partial-index WHERE
    // generates parameterised SQL with an unsubstituted "$1" placeholder,
    // producing invalid DDL on libSQL.
    //
    //   NEVER: .where(eq(sessions.status, 'confirmed'))   // BROKEN; see #4790
    //
    // The WHERE clause is intentionally written without a column-ref
    // interpolation so the emitted DDL contains the literal substring
    // `WHERE status = 'confirmed'` — directly asserted by the unit pairing.
    teacherSlotConfirmedUq: uniqueIndex('sessions_teacher_slot_confirmed')
      .on(t.teacherId, t.startsAtUtc)
      .where(sql`status = 'confirmed'`),
    // AC-2.2.3 — partial index for the agenda pending-requests list
    // (oldest first; scans only pending rows).
    statusCreatedIdx: index('sessions_status_created_idx')
      .on(t.status, t.createdAt)
      .where(sql`status = 'pending'`),
    // AC-2.2.3 — agenda calendar range scans, keyed on maestro + slot.
    teacherStartsIdx: index('sessions_teacher_starts_idx').on(t.teacherId, t.startsAtUtc),
    // AC-2.2.3 — cross-maestro time-range queries.
    startsIdx: index('sessions_starts_idx').on(t.startsAtUtc),
  }),
);

export type Teacher = typeof teachers.$inferSelect;
export type NewTeacher = typeof teachers.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

/* ============================================================================
 * Auth.js v5 — DrizzleAdapter tables (G_C-3 slice).
 *
 * Spec anchor: S-1 AC-2.4.1. Magic-link admin auth uses
 * `@auth/drizzle-adapter` against the SAME libsql DB as the business tables.
 * The four tables below are the canonical adapter contract; `src/infrastructure/auth/config.ts` (G_B-1)
 * wires them via the explicit-options form:
 *
 *   DrizzleAdapter(db, {
 *     usersTable: user,
 *     accountsTable: account,
 *     sessionsTable: session,
 *     verificationTokensTable: verificationToken,
 *   })
 *
 * Naming carve-outs vs the rest of this file:
 *   - JS exports are SINGULAR (`user` / `account` / `session` /
 *     `verificationToken`) so the Auth.js `session` does NOT collide with the
 *     booking `sessions` (plural) declared above. AC-2.4.1 names them
 *     singular; the JS-side singular keeps that the load-bearing distinction.
 *   - SQL column identifiers use CAMELCASE (`emailVerified`, `userId`,
 *     `sessionToken`, `providerAccountId`) to match the @auth/drizzle-adapter
 *     reference schema verbatim. This is a foreign-contract carve-out from
 *     the snake_case convention used for the business tables — analogous to
 *     META_PILLAR D-010 (SQL-stays-English within Spanish-everywhere). The
 *     adapter resolves by Drizzle column refs, not by raw strings, but
 *     matching the reference DDL minimises drift risk across adapter majors.
 *
 * Session strategy is JWT (META_PILLAR D-018), so the `session` table is
 * declared for adapter type-completeness but unused at runtime. The
 * load-bearing magic-link table is `verificationToken` — it gates the
 * Email provider's anti-enum flow (AC-2.4.3 + AC-2.5.4).
 *
 * Cascade rationale: `account.userId` and `session.userId` are user-owned
 * ephemeral identity rows; ON DELETE CASCADE on the user → adapter row
 * deletion is the Auth.js-documented contract (NOT analogous to the
 * RESTRICT-on-teacher_id decision for sessions, which protects
 * visitor-PII evidence).
 * ============================================================================ */

export const user = sqliteTable('user', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: integer('emailVerified', { mode: 'timestamp_ms' }),
  image: text('image'),
});

export const account = sqliteTable(
  'account',
  {
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type').$type<AdapterAccountType>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
  }),
);

export const session = sqliteTable('session', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  expires: integer('expires', { mode: 'timestamp_ms' }).notNull(),
});

export const verificationToken = sqliteTable(
  'verificationToken',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: integer('expires', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.identifier, t.token] }),
  }),
);

// Adapter-row types. Auth.js `Session` / `NewSession` aliases are intentionally
// NOT exported — the names are taken by the booking-row types above, and the
// JWT session strategy (D-018) leaves the `session` table unused at runtime so
// no application code consumes those types.
export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;
export type VerificationToken = typeof verificationToken.$inferSelect;
export type NewVerificationToken = typeof verificationToken.$inferInsert;

/* ============================================================================
 * G_C-2b — CP-3 auxiliary tables.
 *
 * Spec anchors: AC-3.3.1 (notify_log), AC-3.7.1 (teacher_onboarding_tokens),
 * AC-3.5.3 + AC-3.5.5 (rate_limit_buckets).
 *
 * All three are telemetry/throttle surfaces — the application is the
 * source-of-truth for what they contain; they exist to make notification
 * failure visible (notify_log), connect a Telegram chat to a teacher
 * (teacher_onboarding_tokens), and gate abusive request volume
 * (rate_limit_buckets). Naming stays snake_case per the business-table
 * convention (D-010 carve-out for the Auth.js adapter tables does NOT
 * extend here).
 *
 * Cascade discipline:
 *   - notify_log.session_id → sessions.id ON DELETE CASCADE: the log is
 *     derivative; if a `sessions` row is ever hard-deleted (currently
 *     RESTRICTed by AC-2.2.6, but future-proof), the log goes with it
 *     (AC-3.3.1 closing paragraph).
 *   - teacher_onboarding_tokens.teacher_id → teachers.id ON DELETE CASCADE:
 *     tokens are bound to a specific teacher's onboarding; removing the
 *     teacher kills any pending invitation.
 *   - rate_limit_buckets has no FK — keyed only by (ip, hour_bucket).
 * ============================================================================ */

// AC-3.3.1 — event_kind enum mirrors the AC-3.2.6 idempotency-key event_kind
// union exactly. Keep these two in lockstep: a NEW dispatch kind requires
// updating BOTH (a) the EventKind type in `src/infrastructure/email/resend.ts` AND (b) this CHECK.
const NOTIFY_EVENT_KIND_CHECK = sql`event_kind IN ('visitor_receipt', 'visitor_confirm', 'visitor_decline', 'visitor_cancel', 'maestro_fallback', 'maestro_failure')`;

// AC-3.3.1 — the two channels v1.0 dispatches over. Telegram = push;
// Resend = email. Adding a third channel (e.g. WhatsApp Cloud API) requires a
// migration to widen this CHECK.
const NOTIFY_CHANNEL_CHECK = sql`channel IN ('telegram', 'resend')`;

export const notifyLog = sqliteTable(
  'notify_log',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    eventKind: text('event_kind').notNull(),
    channel: text('channel').notNull(),
    recipient: text('recipient').notNull(),
    // HTTP status from the upstream call, or 0 when the dispatcher caught a
    // synchronous throw (network error / DNS / fetch reject). 0 distinguishes
    // "we tried and got nothing" from any real 2xx-5xx response.
    status: integer('status').notNull(),
    // Truncated to 2000 chars at the write site (AC-3.3.1); the column itself
    // accepts arbitrary text so a future audit-tooling iteration can widen.
    errorBody: text('error_body'),
    attemptNumber: integer('attempt_number').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  () => ({
    eventKindCheck: check('notify_log_event_kind_check', NOTIFY_EVENT_KIND_CHECK),
    channelCheck: check('notify_log_channel_check', NOTIFY_CHANNEL_CHECK),
  }),
);

export const teacherOnboardingTokens = sqliteTable('teacher_onboarding_tokens', {
  token: text('token').primaryKey(),
  teacherId: text('teacher_id')
    .notNull()
    .references(() => teachers.id, { onDelete: 'cascade' }),
  // Epoch ms; 24h TTL enforced at the webhook (AC-3.7.3) — the DB does not
  // auto-prune (expired tokens are simply ignored on lookup; they cost
  // ~80 bytes each and arrive at single-digits-per-day cadence).
  expiresAt: integer('expires_at').notNull(),
  // NULL while the token is live; populated with the consumption epoch ms when
  // the webhook successfully binds the chat_id (single-use semantics).
  consumedAt: integer('consumed_at'),
  // SQL-level default per AC-3.7.1 verbatim — the webhook handler INSERTs
  // without supplying this column. UNIXEPOCH() is libSQL/SQLite-native
  // (seconds since epoch); multiplying by 1000 keeps the ms-epoch convention
  // shared with every other created_at column in this schema.
  createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
});

export const rateLimitBuckets = sqliteTable(
  'rate_limit_buckets',
  {
    ip: text('ip').notNull(),
    // floor(Date.now() / 3_600_000) — one bucket per IP per UTC hour.
    // AC-3.5.5 prunes rows where `hour_bucket < (now_bucket - 24)`, so no
    // explicit created_at column is needed.
    hourBucket: integer('hour_bucket').notNull(),
    count: integer('count').notNull().default(1),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.ip, t.hourBucket] }),
  }),
);

export type NotifyLog = typeof notifyLog.$inferSelect;
export type NewNotifyLog = typeof notifyLog.$inferInsert;
export type TeacherOnboardingToken = typeof teacherOnboardingTokens.$inferSelect;
export type NewTeacherOnboardingToken = typeof teacherOnboardingTokens.$inferInsert;
export type RateLimitBucket = typeof rateLimitBuckets.$inferSelect;
export type NewRateLimitBucket = typeof rateLimitBuckets.$inferInsert;
