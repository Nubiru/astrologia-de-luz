/**
 * G_C-35 W4-5 cleanup-CP pairing — legacy-import gate.
 *
 * Cites verbatim: M-12 Hook-CP1-3 STRICT cleanup-CP gate + S-2 §7.3.1 G_C-35 pairings AC.
 *
 * Spec anchor: S-2 §7.3.1 G_C-35 AC-G_C-35.4 + R-S2-7 strict gate.
 *
 * Assertion contract: after the cleanup-CP codemod + barrel deletes, no
 * source file under `src/**` or `tests/**` may import from any of the three
 * legacy alias families. Future regressions (copy-paste from an old branch,
 * imported snippet, etc.) flip this test red immediately at qa:fast time.
 *
 * The three greps:
 *   1. `from '@/db/...'` or `from '@/lib/...'` or `from '@legacy/...'` — count=0
 *   2. `from '@/infrastructure/auth/config'` (the legacy single-file alias; src/auth.ts deleted) — count=0
 *   3. `@legacy/` literal anywhere (catches alias usage in dynamic imports + comments) — count=0
 *
 * Note on the §7.1.4 vs §7.3.1 components question: S-2 §7.1.4 line 709
 * explicitly states `@/components/*` is the canonical post-cleanup form (NO
 * REWRITE for the 21 component literals). §7.3.1's first grep regex
 * incidentally alternates `/db|/lib|/components|legacy` — that regex was a
 * draft over-reach. This test follows §7.1.4's authoritative intent and
 * EXCLUDES `@/components` from the legacy set. The canonical alias for
 * components stays operative.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');
const ROOTS = ['src', 'tests'] as const;
const FILE_EXTS = /\.(?:ts|tsx)$/;

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = resolve(dir, entry);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (stat.isFile() && FILE_EXTS.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function collectFiles(): string[] {
  const collected: string[] = [];
  for (const root of ROOTS) {
    walk(resolve(REPO_ROOT, root), collected);
  }
  return collected;
}

// Grep 1: import literals beginning `@/db/` or `@/lib/` or `@legacy/`.
const LEGACY_IMPORT_RE = /from\s+['"]@(?:\/db\/|\/lib\/|legacy\/)/;

// Grep 2: bare `@/auth` (with quote at end so it does not collide against
// the canonical `@/infrastructure/auth/...` literal).
const LEGACY_AUTH_RE = /from\s+['"]@\/auth['"]/;

// Grep 3: any literal `@legacy/` in source (imports, dynamic imports, comments).
const LEGACY_PREFIX_RE = /@legacy\//;

describe('AC-G_C-35.4 — legacy-import zero-count gate (M-12 Hook-CP1-3 STRICT cleanup-CP gate + S-2 §7.3.1 G_C-35 pairings AC)', () => {
  test('scanner covers at least one source file (anchor — if zero files found, the walker is broken)', () => {
    const files = collectFiles();
    expect(
      files.length,
      `legacy-references-count walker found ZERO source files under ${ROOTS.join(' or ')} — the walker is broken`,
    ).toBeGreaterThan(0);
  });

  test('no source imports from `@/db/*`, `@/lib/*`, or `@legacy/*`', () => {
    const files = collectFiles();
    const offenders: { file: string; line: number; literal: string }[] = [];
    for (const file of files) {
      // Self-exclusion — this file documents the legacy literals it is
      // guarding against; matching its own corpus would be a false positive.
      if (file.endsWith('legacy-references-count.test.ts')) continue;
      const source = readFileSync(file, 'utf8');
      const lines = source.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined) continue;
        if (LEGACY_IMPORT_RE.test(line)) {
          offenders.push({
            file: file.replace(`${REPO_ROOT}/`, ''),
            line: i + 1,
            literal: line.trim(),
          });
        }
      }
    }
    expect(
      offenders,
      `legacy "@/db/*" / "@/lib/*" / "@legacy/*" import literals MUST be 0 after the cleanup-CP codemod:\n${offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.literal}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  test('no source imports from `@/auth` (the legacy single-file alias)', () => {
    const files = collectFiles();
    const offenders: { file: string; line: number; literal: string }[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const lines = source.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined) continue;
        if (LEGACY_AUTH_RE.test(line)) {
          offenders.push({
            file: file.replace(`${REPO_ROOT}/`, ''),
            line: i + 1,
            literal: line.trim(),
          });
        }
      }
    }
    expect(
      offenders,
      `legacy auth-barrel import literals MUST be 0 after src/auth.ts is deleted:\n${offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.literal}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  test('no `@legacy/` literal appears anywhere in source (imports, dynamic imports, comments)', () => {
    const files = collectFiles();
    const offenders: { file: string; line: number; literal: string }[] = [];
    for (const file of files) {
      // Skip THIS file — the regex string + the comment-narrative include the
      // literal `@legacy/` for documentation. Self-exclusion is intentional;
      // the gate would otherwise fail against its own corpus.
      if (file.endsWith('legacy-references-count.test.ts')) continue;
      const source = readFileSync(file, 'utf8');
      const lines = source.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined) continue;
        if (LEGACY_PREFIX_RE.test(line)) {
          offenders.push({
            file: file.replace(`${REPO_ROOT}/`, ''),
            line: i + 1,
            literal: line.trim(),
          });
        }
      }
    }
    expect(
      offenders,
      `"@legacy/" literal MUST be 0 after the alias is removed (this catches dynamic imports + stale comments):\n${offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.literal}`)
        .join('\n')}`,
    ).toEqual([]);
  });
});
