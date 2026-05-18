-- 0003_seed_augusto.sql — Augusto Rocha brand-owner seed (G_C-2c).
--
-- Spec anchors: S-1 AC-2.1.5 + R-9 (empty-availability launch gate) +
-- META_PILLAR D-017 (half-config refusal across ALL environments).
--
-- Template substitution (handled by scripts/migrate.ts in G_C-2c's downstream
-- task G_C-5, AC-2.3.3): the `admin@example.com` token below is replaced at
-- apply time with `env.ADMIN_EMAILS.split(',')[0].trim()`. The SQL LOWER()
-- wrapper normalises accidental upper-case entries at the DB layer so the
-- teachers_email_unique index from 0000_init.sql sees a canonical value.
--
-- Idempotency: re-running this migration is a no-op via ON CONFLICT(email)
-- DO NOTHING, leaning on the teachers_email_unique index from 0000_init.sql.
-- The stable id `augusto-rocha-uuid-stable` is a deterministic identifier
-- (not a generated UUID) so the seed is reproducible across environments and
-- safe to reference from CI fixtures.
--
-- R-9 protection: availability ships with EMPTY windows + EMPTY blackouts.
-- Production refuses to match any slot until Augusto adds real hours via
-- /panel/maestros/augusto-rocha. This is intentional — preventing the visitor
-- from seeing a fake calendar before the system is configured is a stronger
-- launch posture than a synthetic-hours placeholder.

INSERT INTO teachers (
  id,
  slug,
  name,
  email,
  bio,
  availability,
  timezone,
  active,
  created_at,
  updated_at
) VALUES (
  'augusto-rocha-uuid-stable',
  'augusto-rocha',
  'Augusto Rocha',
  LOWER('$$ADMIN_EMAIL$$'),
  NULL,
  '{"tz":"America/Argentina/Buenos_Aires","windows":[],"blackouts":[]}',
  'America/Argentina/Buenos_Aires',
  1,
  unixepoch() * 1000,
  unixepoch() * 1000
) ON CONFLICT(email) DO NOTHING;
