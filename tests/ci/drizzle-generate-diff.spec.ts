/**
 * G_C-4 pairing — drizzle-kit zero-diff CI gate.
 *
 * Spec anchor: S-1 AC-2.3.1 — "Verified by a `drizzle-kit generate` smoke run
 * in CI ... must produce ... a zero-diff migration on second run with no
 * schema changes."
 *
 * What this asserts (and what it would catch if it failed):
 *
 *  1. `drizzle.config.ts` shape — dialect / schema / out / dbCredentials env
 *     wiring. Would fail if a future contributor "simplifies" the file and
 *     drops the libsql dialect, or repoints out= away from `db/migrations/`
 *     (silently breaking the migrate runner G_C-5 + every subsequent
 *     drizzle-kit invocation).
 *
 *  2. `meta/_journal.json` is in lockstep with the authored .sql files —
 *     same count, same tags, lexical order. Would fail if a new
 *     `0004_*.sql` was committed without its journal entry (drizzle-kit
 *     would treat the schema as drifted on every generate), or if the
 *     journal had stale entries pointing at non-existent files.
 *
 *  3. The latest `meta/<idx>_snapshot.json` exists for the highest idx
 *     entry — drizzle-kit's generate diffs against this exact file. Would
 *     fail if the snapshot wasn't checked in (the regression that
 *     necessitated G_C-4 in the first place — see CHANGES.md G_C-4 entry).
 *
 *  4. **The zero-diff invariant itself** — running `drizzle-kit generate`
 *     against the current schema + meta/ produces "No schema changes" and
 *     does NOT add or modify any file under `db/migrations/`. Would fail
 *     when `db/schema.ts` drifts from the snapshot — exactly the regression
 *     the spec calls out as "orphan schema-vs-migration drift."
 *
 * Self-healing: if drizzle-kit DOES emit a new .sql/snapshot/journal entry
 * during the zero-diff run (because the schema genuinely drifted), the
 * test's `finally` block restores `db/migrations/` to its pre-run state.
 * The assertion still fails (which is the diagnostic signal we want), but
 * the developer's working tree is left pristine so a re-run after fixing
 * the drift is deterministic. The drift filenames are written to stderr
 * for triage.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
const MIGRATIONS = resolve(ROOT, 'db/migrations');
const META = resolve(MIGRATIONS, 'meta');
const DRIZZLE_KIT = resolve(ROOT, 'node_modules/.bin/drizzle-kit');
const CONFIG = resolve(ROOT, 'drizzle.config.ts');

const AUTHORED_MIGRATIONS = [
  '0000_init',
  '0001_authjs',
  '0002_cp3_tables',
  '0003_seed_augusto',
] as const;

/**
 * Recursively walk `db/migrations/` and return a content-addressed map.
 * Keys are paths relative to `db/migrations/`; values are file contents.
 * Used by the zero-diff test to detect added/modified files after running
 * `drizzle-kit generate` and to restore on assertion failure.
 */
function snapshotMigrations(): Map<string, string> {
  const state = new Map<string, string>();
  function walk(abs: string, rel: string): void {
    for (const name of readdirSync(abs)) {
      const childAbs = join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      if (statSync(childAbs).isDirectory()) walk(childAbs, childRel);
      else state.set(childRel, readFileSync(childAbs, 'utf8'));
    }
  }
  walk(MIGRATIONS, '');
  return state;
}

/**
 * Diff a fresh `snapshotMigrations()` against a previous one and restore the
 * pre-run state in-place. Returns the per-class drift counts so the test can
 * surface them on assertion failure.
 */
function restoreMigrations(before: Map<string, string>): {
  added: string[];
  modified: string[];
} {
  const after = snapshotMigrations();
  const added: string[] = [];
  const modified: string[] = [];
  for (const key of after.keys()) {
    if (!before.has(key)) added.push(key);
    else if (before.get(key) !== after.get(key)) modified.push(key);
  }
  for (const key of added) unlinkSync(join(MIGRATIONS, key));
  for (const key of modified) {
    writeFileSync(join(MIGRATIONS, key), before.get(key) as string, 'utf8');
  }
  return { added, modified };
}

describe('G_C-4 — drizzle-kit zero-diff CI gate (AC-2.3.1)', () => {
  describe('drizzle.config.ts — shape gate', () => {
    const config = readFileSync(resolve(ROOT, 'drizzle.config.ts'), 'utf8');

    test('targets the turso/libsql dialect (matches db/client.ts runtime)', () => {
      expect(config).toMatch(/dialect:\s*['"]turso['"]/);
    });

    test('schema input points at db/schema.ts', () => {
      expect(config).toMatch(/schema:\s*['"]\.\/db\/schema\.ts['"]/);
    });

    test('migrations output points at db/migrations', () => {
      expect(config).toMatch(/out:\s*['"]\.\/db\/migrations['"]/);
    });

    test('dbCredentials read TURSO_* env vars (for push/studio surface)', () => {
      expect(config).toContain('TURSO_DATABASE_URL');
      expect(config).toContain('TURSO_AUTH_TOKEN');
    });
  });

  describe('meta/_journal.json — migration ledger drizzle-kit walks', () => {
    const journal = JSON.parse(readFileSync(join(META, '_journal.json'), 'utf8')) as {
      version: string;
      dialect: string;
      entries: Array<{ idx: number; tag: string; when: number }>;
    };

    test('declares sqlite dialect (the libsql wire format)', () => {
      expect(journal.dialect).toBe('sqlite');
    });

    test('lists every authored migration in lexical order', () => {
      expect(journal.entries.map((e) => e.tag)).toEqual([...AUTHORED_MIGRATIONS]);
    });

    test('idx values are sequential from 0', () => {
      expect(journal.entries.map((e) => e.idx)).toEqual([0, 1, 2, 3]);
    });

    test('every authored .sql file has a matching journal entry', () => {
      const sqlBasenames = readdirSync(MIGRATIONS)
        .filter((n) => n.endsWith('.sql'))
        .map((n) => n.replace(/\.sql$/, ''))
        .sort();
      expect(sqlBasenames).toEqual([...AUTHORED_MIGRATIONS]);
    });

    test('latest snapshot file exists for the highest idx entry', () => {
      const latestIdx = Math.max(...journal.entries.map((e) => e.idx));
      const padded = String(latestIdx).padStart(4, '0');
      expect(() => statSync(join(META, `${padded}_snapshot.json`))).not.toThrow();
    });
  });

  describe('zero-diff invariant — generate against current state is a no-op', () => {
    test('drizzle-kit generate reports "No schema changes" and leaves db/migrations/ unchanged', () => {
      const before = snapshotMigrations();
      let output = '';
      let drift: { added: string[]; modified: string[] } = {
        added: [],
        modified: [],
      };
      try {
        output = execFileSync(DRIZZLE_KIT, ['generate', `--config=${CONFIG}`], {
          cwd: ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 30_000,
        });
      } finally {
        drift = restoreMigrations(before);
        if (drift.added.length > 0 || drift.modified.length > 0) {
          process.stderr.write(
            `drizzle-generate-diff: drift detected — added=${JSON.stringify(
              drift.added,
            )} modified=${JSON.stringify(drift.modified)}\n`,
          );
        }
      }
      expect(output).toContain('No schema changes');
      expect(drift.added).toEqual([]);
      expect(drift.modified).toEqual([]);
    });
  });
});
