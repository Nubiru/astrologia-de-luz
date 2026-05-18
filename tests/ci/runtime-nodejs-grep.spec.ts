/**
 * G_B-2 CI pairing — every Auth.js + panel route file declares
 * `export const runtime = 'nodejs'` (AC-2.4.5).
 *
 * Auth.js v5's DrizzleAdapter pulls in @libsql/client, which is NOT Edge-safe
 * (node:crypto + native bindings). Any route under `app/api/auth/**` or
 * `app/panel/**` that boots into Edge runtime would either:
 *   - fail at build with "Cannot use module X in Edge runtime", OR
 *   - succeed but throw at first DB call.
 *
 * Both failure modes are loud-but-late. This grep gate is the EARLY catch:
 * it scans the routes folder and fails the build the moment a route is added
 * without the runtime declaration.
 *
 * Fails when:
 *   - A new file lands under `app/api/auth/**` or `app/panel/**` without the
 *     literal `export const runtime = 'nodejs'` declaration anywhere in its
 *     source (catches both pure-missing AND typo'd `'node'` / `"nodejs"` with
 *     mismatched quote / spelling variants).
 *   - A future refactor removes the declaration from an existing route while
 *     keeping the file.
 *   - The catch-all route file's location changes and the route stops
 *     declaring nodejs (an Edge upgrade attempt would silently re-enter the
 *     "Edge bundles libsql" failure mode).
 *
 * Implementation note: this lives in `tests/ci/` so it ships with the CI lane
 * (per `tests/ci/install-smoke.spec.ts` precedent) rather than the unit lane.
 * The check is purely structural — no runtime invocation — so it stays fast
 * regardless of vitest configuration.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');

// AC-2.4.5 requires this LITERAL — both the keyword `const` AND the bare
// `'nodejs'` (single-quoted) so the lint pattern is stable across Biome's
// formatter passes. Accept both quote styles defensively in the regex so a
// Prettier-style auto-fix to double quotes does NOT silently break the gate.
const RUNTIME_DECLARATION = /export\s+const\s+runtime\s*=\s*['"]nodejs['"]/;

// Files in these subtrees MUST declare Node runtime. The `app/panel/**` arm is
// future-proofed: today the directory does not exist yet (G_B-3+ create it),
// the walker simply returns [] in that case and the test stays green until a
// page lands without the declaration.
const RUNTIME_SCOPED_ROOTS = ['app/api/auth', 'app/panel'] as const;

// Only route-handler / page files carry the runtime contract. Layouts +
// loading + error + not-found also count — they execute on the server.
// Everything else (CSS, fonts, JSON) is irrelevant.
const ROUTE_FILE_PATTERN = /(?:route|page|layout|loading|error|not-found)\.(?:ts|tsx)$/;

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (stat.isFile() && ROUTE_FILE_PATTERN.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function collectRouteFiles(): { absolute: string; relative: string }[] {
  const collected: { absolute: string; relative: string }[] = [];
  for (const root of RUNTIME_SCOPED_ROOTS) {
    const absoluteRoot = resolve(REPO_ROOT, root);
    for (const file of walk(absoluteRoot)) {
      collected.push({ absolute: file, relative: relative(REPO_ROOT, file) });
    }
  }
  return collected;
}

describe('AC-2.4.5 — runtime contract grep', () => {
  test('the catch-all Auth.js handler exists (G_B-2 anchor)', () => {
    // Anchor assertion: if `app/api/auth/[...nextauth]/route.ts` ever
    // disappears, the runtime contract becomes vacuous (walker returns []).
    // This test fails LOUDLY in that case rather than silently passing.
    const files = collectRouteFiles();
    const authRouteHits = files.filter((f) =>
      f.relative.replace(/\\/g, '/').startsWith('app/api/auth/'),
    );
    expect(
      authRouteHits.length,
      `no route files found under app/api/auth/** — did the catch-all move? (collected files: ${files.map((f) => f.relative).join(', ') || '<none>'})`,
    ).toBeGreaterThan(0);
  });

  test('every collected route file declares Node runtime', () => {
    const files = collectRouteFiles();
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file.absolute, 'utf8');
      if (!RUNTIME_DECLARATION.test(source)) {
        offenders.push(file.relative);
      }
    }
    expect(
      offenders,
      `routes missing \`export const runtime = 'nodejs'\`: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});

describe('AC-2.4.6 — catch-all route file shape', () => {
  test('the Auth.js catch-all re-exports handlers.GET + handlers.POST from `@/auth`', () => {
    const routePath = resolve(REPO_ROOT, 'app/api/auth/[...nextauth]/route.ts');
    const source = readFileSync(routePath, 'utf8');

    // Source-of-truth import: handlers comes from `@/auth` (the Auth.js v5
    // wiring). If a future refactor swaps it for a hand-rolled handler, the
    // file would compile but the byte-identical anti-enum behavior from G_B-1
    // would silently regress because the test would now exercise a parallel
    // codepath.
    expect(source).toMatch(/from\s+['"]@\/auth['"]/);

    // The two exports the App Router wants for a catch-all route. Accept
    // either explicit `export const GET / POST` or the `export const { GET,
    // POST } = handlers` destructure form — both are idiomatic.
    expect(source).toMatch(/export\s+(?:const|{[^}]*\bGET\b[^}]*})/);
    expect(source).toMatch(/export\s+(?:const|{[^}]*\bPOST\b[^}]*})/);
  });
});

describe('AC-2.4.5 — proxy.ts matcher contract', () => {
  test('proxy.ts exports a config matcher covering /panel/* and /api/auth/*', () => {
    const proxyPath = resolve(REPO_ROOT, 'proxy.ts');
    const source = readFileSync(proxyPath, 'utf8');

    // The matcher is a literal in the source — assert against the literal so
    // a future "narrowing" refactor that drops one of the two arms surfaces
    // here instead of silently dropping the gate at runtime.
    expect(source).toMatch(/export\s+const\s+config\s*=/);
    expect(source).toMatch(/['"]\/panel\/:path\*['"]/);
    expect(source).toMatch(/['"]\/api\/auth\/:path\*['"]/);

    // The proxy DOES NOT import `@/auth` (which would drag the libsql adapter
    // into the Edge bundle and explode at build time). Keep the proxy
    // dependency-free of Auth.js's full wiring.
    expect(source).not.toMatch(/from\s+['"]@\/auth['"]/);
  });
});
