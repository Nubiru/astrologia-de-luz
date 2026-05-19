/**
 * G_C-3 unit pairing — Drizzle schema introspection for the Auth.js v5
 * DrizzleAdapter tables (`user` / `account` / `session` / `verificationToken`),
 * plus an end-to-end smoke that `DrizzleAdapter(db, schema)` constructs cleanly
 * against our exported tables.
 *
 * Fails when:
 *   - Any of the four adapter tables is dropped, renamed, or its SQL identifier
 *     drifts away from the singular form locked by S-1 AC-2.4.1.
 *   - A column required by `@auth/drizzle-adapter` is missing, renamed,
 *     retyped, or its notNull contract regresses.
 *   - `user.email` loses its UNIQUE declaration (would let the adapter's
 *     lookup-by-email path return ambiguous rows + break the magic-link flow).
 *   - The composite PRIMARY KEY on `account` (provider, providerAccountId) or
 *     on `verificationToken` (identifier, token) is dropped, reordered, or
 *     repointed — both are load-bearing for adapter upsert semantics.
 *   - The `userId` FK on `account` or `session` loses ON DELETE CASCADE
 *     (would orphan adapter rows when a user is deleted — Auth.js documents
 *     CASCADE as the contract).
 *   - The `session` (Auth.js singular) table name collides with the booking
 *     `sessions` (plural) table — the JS-singular vs SQL-singular pairing is
 *     the only thing keeping the namespace clean.
 *   - `@auth/drizzle-adapter` throws when constructed with our schema (the
 *     end-to-end smoke for the adapter contract — catches a future major
 *     that changes the options shape or required method surface).
 *
 * Pure-introspection (no DB connection). The behavioural counterpart
 * (does `0001_authjs.sql` actually apply to libSQL on top of `0000_init.sql`?)
 * is covered by the G_C-2b sister integration test once the auxiliary tables
 * land — adding a duplicate behavioural test here would be coverage
 * decoration, not regression signal.
 *
 * Spec anchors: S-1 AC-2.4.1.
 */

import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, test } from 'vitest';

import { account, session, user, verificationToken } from '@/infrastructure/db/schema';

const userConfig = getTableConfig(user);
const accountConfig = getTableConfig(account);
const sessionConfig = getTableConfig(session);
const verificationTokenConfig = getTableConfig(verificationToken);

type TableConfig = ReturnType<typeof getTableConfig>;
const colByName = (cfg: TableConfig, name: string) => cfg.columns.find((c) => c.name === name);

describe('AC-2.4.1 — `user` table contract (@auth/drizzle-adapter)', () => {
  test('table name is exactly `user` (singular per spec)', () => {
    expect(userConfig.name).toBe('user');
  });

  // `emailVerified` carries `{ mode: 'timestamp_ms' }` so its Drizzle-side
  // `dataType` is `'date'` (the SQL column is still `integer`). The @auth
  // drizzle-adapter reference schema uses the same shape — Date in JS, epoch
  // ms in SQL — so this is the load-bearing assertion, not a regression.
  test.each([
    ['id', 'string', true],
    ['name', 'string', false],
    ['email', 'string', false],
    ['emailVerified', 'date', false],
    ['image', 'string', false],
  ])('column `%s` is %s, notNull=%s', (name, dataType, notNull) => {
    const col = colByName(userConfig, name);
    expect(col, `column ${name} missing from user schema`).toBeDefined();
    expect(col?.dataType).toBe(dataType);
    expect(col?.notNull).toBe(notNull);
  });

  test('`id` is the primary key', () => {
    expect(colByName(userConfig, 'id')?.primary).toBe(true);
  });

  test('`email` is declared UNIQUE (adapter lookup-by-email path)', () => {
    expect(colByName(userConfig, 'email')?.isUnique).toBe(true);
  });
});

describe('AC-2.4.1 — `account` table contract', () => {
  test('table name is exactly `account`', () => {
    expect(accountConfig.name).toBe('account');
  });

  test.each([
    ['userId', 'string', true],
    ['type', 'string', true],
    ['provider', 'string', true],
    ['providerAccountId', 'string', true],
    ['refresh_token', 'string', false],
    ['access_token', 'string', false],
    ['expires_at', 'number', false],
    ['token_type', 'string', false],
    ['scope', 'string', false],
    ['id_token', 'string', false],
    ['session_state', 'string', false],
  ])('column `%s` is %s, notNull=%s', (name, dataType, notNull) => {
    const col = colByName(accountConfig, name);
    expect(col, `column ${name} missing from account schema`).toBeDefined();
    expect(col?.dataType).toBe(dataType);
    expect(col?.notNull).toBe(notNull);
  });

  test('composite PRIMARY KEY on (provider, providerAccountId) in order', () => {
    expect(accountConfig.primaryKeys).toHaveLength(1);
    const pk = accountConfig.primaryKeys[0];
    if (!pk) throw new Error('expected exactly one composite PK on account');
    expect(pk.columns.map((c) => c.name)).toEqual(['provider', 'providerAccountId']);
  });

  test('`userId` FK targets user.id ON DELETE CASCADE', () => {
    expect(accountConfig.foreignKeys).toHaveLength(1);
    const fk = accountConfig.foreignKeys[0];
    if (!fk) throw new Error('expected exactly one FK on account');
    const ref = fk.reference();
    expect(ref.columns.map((c) => c.name)).toEqual(['userId']);
    expect(ref.foreignColumns.map((c) => c.name)).toEqual(['id']);
    expect(ref.foreignTable).toBe(user);
    expect(fk.onDelete).toBe('cascade');
  });
});

describe('AC-2.4.1 — `session` table contract (Auth.js — NOT booking sessions)', () => {
  test('table name is exactly `session` (singular — distinct from booking `sessions`)', () => {
    expect(sessionConfig.name).toBe('session');
    // Explicit cross-check: the booking-table collision is the whole reason
    // we kept the JS export singular. Asserting both invariants here means a
    // future "let's just call it sessions" PR fails this test loudly.
    expect(sessionConfig.name).not.toBe('sessions');
  });

  // `expires` carries `{ mode: 'timestamp_ms' }` — Drizzle-side dataType is
  // `'date'` (SQL is still `integer`). Same shape as the adapter reference.
  test.each([
    ['sessionToken', 'string', true],
    ['userId', 'string', true],
    ['expires', 'date', true],
  ])('column `%s` is %s, notNull=%s', (name, dataType, notNull) => {
    const col = colByName(sessionConfig, name);
    expect(col, `column ${name} missing from session schema`).toBeDefined();
    expect(col?.dataType).toBe(dataType);
    expect(col?.notNull).toBe(notNull);
  });

  test('`sessionToken` is the primary key', () => {
    expect(colByName(sessionConfig, 'sessionToken')?.primary).toBe(true);
  });

  test('`userId` FK targets user.id ON DELETE CASCADE', () => {
    expect(sessionConfig.foreignKeys).toHaveLength(1);
    const fk = sessionConfig.foreignKeys[0];
    if (!fk) throw new Error('expected exactly one FK on session');
    const ref = fk.reference();
    expect(ref.columns.map((c) => c.name)).toEqual(['userId']);
    expect(ref.foreignColumns.map((c) => c.name)).toEqual(['id']);
    expect(ref.foreignTable).toBe(user);
    expect(fk.onDelete).toBe('cascade');
  });
});

describe('AC-2.4.1 — `verificationToken` table contract (magic-link load-bearing)', () => {
  test('table name is exactly `verificationToken`', () => {
    expect(verificationTokenConfig.name).toBe('verificationToken');
  });

  // `expires` carries `{ mode: 'timestamp_ms' }` — Drizzle-side dataType is
  // `'date'` (SQL is still `integer`).
  test.each([
    ['identifier', 'string', true],
    ['token', 'string', true],
    ['expires', 'date', true],
  ])('column `%s` is %s, notNull=%s', (name, dataType, notNull) => {
    const col = colByName(verificationTokenConfig, name);
    expect(col, `column ${name} missing from verificationToken schema`).toBeDefined();
    expect(col?.dataType).toBe(dataType);
    expect(col?.notNull).toBe(notNull);
  });

  test('composite PRIMARY KEY on (identifier, token) in order', () => {
    expect(verificationTokenConfig.primaryKeys).toHaveLength(1);
    const pk = verificationTokenConfig.primaryKeys[0];
    if (!pk) throw new Error('expected exactly one composite PK on verificationToken');
    expect(pk.columns.map((c) => c.name)).toEqual(['identifier', 'token']);
  });
});

describe('AC-2.4.1 — DrizzleAdapter wiring smoke', () => {
  test('DrizzleAdapter(db, schema) constructs without throwing + exposes the documented surface', () => {
    // `@auth/drizzle-adapter` v1.7+ hardened its DB-instance guard — passing
    // `{} as Parameters<typeof DrizzleAdapter>[0]` (the previous stand-in)
    // now throws `Unsupported database type (object) in Auth.js Drizzle
    // adapter.`. A real Drizzle wrapper around an in-memory libSQL client
    // satisfies the runtime guard with zero I/O (no schema migrated, no
    // network), keeping this assertion a unit test in spirit.
    //
    // The instantiated adapter must expose the standard NextAuthAdapter
    // surface; the method-name checks below catch a future
    // @auth/drizzle-adapter major that renames or removes any of the
    // Email-Provider-required entry points (createVerificationToken +
    // useVerificationToken are the load-bearing pair for the magic-link
    // flow per AC-2.5.3).
    const memClient = createClient({ url: ':memory:' });
    try {
      const db = drizzle(memClient);
      const adapter = DrizzleAdapter(db, {
        usersTable: user,
        accountsTable: account,
        sessionsTable: session,
        verificationTokensTable: verificationToken,
      });

      expect(adapter).toBeDefined();
      expect(typeof adapter.createUser).toBe('function');
      expect(typeof adapter.getUser).toBe('function');
      expect(typeof adapter.getUserByEmail).toBe('function');
      expect(typeof adapter.linkAccount).toBe('function');
      expect(typeof adapter.createVerificationToken).toBe('function');
      expect(typeof adapter.useVerificationToken).toBe('function');
    } finally {
      memClient.close();
    }
  });
});
