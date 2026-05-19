// AC-S2-9 — force-dynamic cascade guard (D-051 canonized at M-15).
//
// The rule (verbatim from S-2 §7.2.2):
//
//   Any `app/<page>` (currently) — and `src/app/<page>` after G_C-34 —
//   whose transitive import graph reaches a module that DECLARES one of the
//   sentinel "env-touching" symbols (`getDb`, `getEnv`, `getResend`,
//   `getTelegram`, `getClient`, `createClient`) MUST declare
//   `export const dynamic = 'force-dynamic'`.
//
// Why this matters (G_C-25 empirical anchor): Next 16's default SSG renders
// the page at build time during page-data collection. If the render function
// reaches `getDb()` → `createClient(url, authToken)`, the libsql client opens
// against build-time env which is intentionally bare in CI — and the build
// fails. The fix is `export const dynamic = 'force-dynamic'` (opts out of
// SSG; per-request render only).
//
// Detection heuristic (sentinel-DECLARATION based, broader than the spec's
// "top-level CALL" wording because G_C-25 showed that render-time calls
// inside thunks ALSO trigger the cascade — see CHANGES.md G_C-25 close-note):
//
//   1. Walk the page.tsx files under `app/` + `src/app/`.
//   2. For each page: build the transitive import-graph closure across
//      project source files (anything reachable via `@/*` or relative paths;
//      node_modules excluded).
//   3. A file is "DB-cascading" if its source contains a top-level
//      declaration of one of the sentinels (`export function getDb`, etc.
//      — pattern is the export keyword + the identifier).
//   4. If the closure contains any DB-cascading file AND the page does NOT
//      declare `export const dynamic = 'force-dynamic'`, the page is an
//      offender. Test fails with the page path + the first cascading
//      transitive dep.
//
// Route handlers (`route.ts` under `app/api/`) are inherently dynamic —
// Next.js never SSG's them — so they are NOT in the scan scope (the spec
// §7.2.2 table classifies these as "implicit force-dynamic").
//
// Runs in `npm run qa:fast` per D-040 / D-043 — catches future regressions
// at task-close time, BEFORE the next `npm run qa`'s `next build` gate.
//
// G_C-26 (this task) ships this guard against the current `app/` tree.
// G_C-34 widens the scope to `src/app/` when the framework files move.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');

// Both legacy and future app roots are scanned. At W4-1 time only `app/`
// exists; once G_C-34 lands, `src/app/` populates and the legacy `app/` empties.
// The walk gracefully handles missing directories (returns []).
const APP_ROOTS = ['app', 'src/app'] as const;

// The 6 sentinels per S-2 §7.2.2 + the auxiliary `getClient` G_C-25 added
// to db/client.ts (the actual libsql connection opener — distinct from
// drizzle's `getDb` wrapper).
const SENTINELS = [
  'getDb',
  'getEnv',
  'getResend',
  'getResendClient',
  'getTelegram',
  'getClient',
  'createClient',
] as const;

const PAGE_PATTERN = /^page\.tsx?$/;
const FORCE_DYNAMIC = /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/;

// Matches an export of a sentinel as either `export function NAME` or
// `export const NAME = ...`. This is "DECLARATION at module top-level" —
// the broader rule (vs only top-level CALLS) catches the G_C-25 class.
const declRegexFor = (name: string): RegExp =>
  new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|var)\\s+${name}\\b`);

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
    } else if (stat.isFile() && PAGE_PATTERN.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function tryFindFile(basePath: string): string | null {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}/index.ts`,
    `${basePath}/index.tsx`,
  ];
  for (const c of candidates) {
    try {
      const s = statSync(c);
      if (s.isFile()) return c;
    } catch {
      /* not found — try next */
    }
  }
  return null;
}

// Resolve an import specifier (the string after `from`) to an absolute
// project file path. Returns null for non-project specifiers (node_modules,
// `next/*`, etc.) — we don't recurse into those.
//
// Post-G_C-35 cleanup-CP: every wave-4 transitional alias retired (db barrel,
// lib barrel, auth single-file alias, fallback prefix alias). The generic
// `@/*` -> `./src/*` mapping is the canonical resolver root. Future waves
// that add layer-specific aliases append here.
function resolveImport(spec: string, fromFile: string): string | null {
  if (spec.startsWith('@/')) {
    return tryFindFile(resolve(REPO_ROOT, 'src', spec.slice(2)));
  }
  if (spec.startsWith('./') || spec.startsWith('../')) {
    return tryFindFile(resolve(dirname(fromFile), spec));
  }
  // Bare specifier (npm package) — not a project file.
  return null;
}

function extractImports(content: string): string[] {
  // Static imports + re-exports. Both are sufficient to drag a module into
  // the page's module graph at SSR time.
  const re = /\bfrom\s+['"]([^'"]+)['"]/g;
  const out: string[] = [];
  for (const match of content.matchAll(re)) {
    const spec = match[1];
    if (spec) out.push(spec);
  }
  return out;
}

// BFS the project-source transitive closure of `entry`. Caches reads to keep
// the test sub-second even with multiple pages.
function transitiveClosure(entry: string, cache: Map<string, string>): Set<string> {
  const seen = new Set<string>([entry]);
  const queue: string[] = [entry];
  while (queue.length > 0) {
    const file = queue.shift();
    if (!file) continue;
    let content = cache.get(file);
    if (content === undefined) {
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      cache.set(file, content);
    }
    for (const spec of extractImports(content)) {
      const resolved = resolveImport(spec, file);
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved);
        queue.push(resolved);
      }
    }
  }
  return seen;
}

function isDbCascading(content: string): string | null {
  for (const name of SENTINELS) {
    if (declRegexFor(name).test(content)) return name;
  }
  return null;
}

describe('AC-S2-9 — force-dynamic cascade guard', () => {
  test('the scan covers at least one page (anchor — if zero pages found, the walker is broken)', () => {
    const pages: string[] = [];
    for (const root of APP_ROOTS) {
      walk(resolve(REPO_ROOT, root), pages);
    }
    expect(
      pages.length,
      `force-dynamic cascade guard found ZERO page.tsx files under ${APP_ROOTS.join(' or ')} — the walker is broken or both roots are empty`,
    ).toBeGreaterThan(0);
  });

  test('every page whose transitive imports reach a sentinel-declaring module declares force-dynamic', () => {
    const pages: string[] = [];
    for (const root of APP_ROOTS) {
      walk(resolve(REPO_ROOT, root), pages);
    }

    const cache = new Map<string, string>();
    const offenders: { page: string; via: string; sentinel: string }[] = [];

    for (const page of pages) {
      const pageRel = relative(REPO_ROOT, page).replace(/\\/g, '/');
      const pageContent = cache.get(page) ?? readFileSync(page, 'utf8');
      cache.set(page, pageContent);

      const closure = transitiveClosure(page, cache);
      let cascadingFile: string | null = null;
      let sentinel: string | null = null;

      for (const dep of closure) {
        if (dep === page) continue;
        const depContent = cache.get(dep) ?? readFileSync(dep, 'utf8');
        cache.set(dep, depContent);
        const found = isDbCascading(depContent);
        if (found !== null) {
          cascadingFile = relative(REPO_ROOT, dep).replace(/\\/g, '/');
          sentinel = found;
          break;
        }
      }

      if (cascadingFile !== null && sentinel !== null && !FORCE_DYNAMIC.test(pageContent)) {
        offenders.push({ page: pageRel, via: cascadingFile, sentinel });
      }
    }

    expect(
      offenders,
      `pages whose transitive import-graph reaches a sentinel-declaring module are MISSING \`export const dynamic = 'force-dynamic'\`:\n${offenders
        .map((o) => `  ${o.page}  (cascades through ${o.via}, sentinel: ${o.sentinel})`)
        .join('\n')}`,
    ).toEqual([]);
  });

  test('non-cascading pages do NOT spuriously declare force-dynamic (catches over-application)', () => {
    // Inverse direction: a page that does NOT reach any sentinel should be
    // free to remain statically rendered. If it nonetheless declares
    // `force-dynamic`, that is a perf regression worth flagging — but only
    // as informational, not blocking, since `force-dynamic` can be a valid
    // performance trade-off for ISR-heavy pages.
    //
    // For W4-1 we KEEP this assertion empty (no offenders expected) but
    // the harness exists so a future page-by-page audit can plug into it.
    const pages: string[] = [];
    for (const root of APP_ROOTS) {
      walk(resolve(REPO_ROOT, root), pages);
    }

    const cache = new Map<string, string>();
    const overApplied: { page: string }[] = [];

    for (const page of pages) {
      const pageRel = relative(REPO_ROOT, page).replace(/\\/g, '/');
      const pageContent = cache.get(page) ?? readFileSync(page, 'utf8');
      cache.set(page, pageContent);

      if (!FORCE_DYNAMIC.test(pageContent)) continue;

      const closure = transitiveClosure(page, cache);
      let cascadingFile: string | null = null;
      for (const dep of closure) {
        if (dep === page) continue;
        const depContent = cache.get(dep) ?? readFileSync(dep, 'utf8');
        cache.set(dep, depContent);
        if (isDbCascading(depContent) !== null) {
          cascadingFile = dep;
          break;
        }
      }

      if (cascadingFile === null) overApplied.push({ page: pageRel });
    }

    expect(
      overApplied,
      `pages declare \`force-dynamic\` but their transitive imports never reach any sentinel — review whether SSG/ISR is the better choice:\n${overApplied
        .map((o) => `  ${o.page}`)
        .join('\n')}`,
    ).toEqual([]);
  });
});
